#!/usr/bin/env node
/**
 * Measures the storefront in both perf modes and writes a comparison report.
 *
 *   npm run perf
 *
 * For each mode it starts a production preview server on its own port, runs
 * Lighthouse against every URL under test several times, and keeps the median.
 * Lighthouse is noisy enough that a single run is not evidence of anything;
 * the median of an odd number of runs is the cheapest defensible summary.
 *
 * Output:
 *   docs/perf/latest.md    human-readable comparison table
 *   docs/perf/latest.json  raw medians, for diffing across commits
 *
 * See docs/adr/0003-baseline-vs-optimized-perf-modes.md
 */

import {spawn} from 'node:child_process';
import {mkdir, writeFile, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = path.join(ROOT, '.perf-tmp');
const OUT_DIR = path.join(ROOT, 'docs', 'perf');

const RUNS_PER_URL = Number(process.env.PERF_RUNS ?? 3);
const MODES = [
  {mode: 'baseline', port: 3101},
  {mode: 'optimized', port: 3102},
];

/** Metrics worth reporting. Everything else is noise for this comparison. */
const METRICS = [
  {key: 'performanceScore', label: 'Performance score', unit: '', better: 'up'},
  {key: 'lcp', label: 'LCP', unit: 'ms', better: 'down'},
  {key: 'fcp', label: 'FCP', unit: 'ms', better: 'down'},
  {key: 'tbt', label: 'Total Blocking Time', unit: 'ms', better: 'down'},
  {key: 'cls', label: 'CLS', unit: '', better: 'down'},
  {key: 'speedIndex', label: 'Speed Index', unit: 'ms', better: 'down'},
  {key: 'transferKb', label: 'Transfer size', unit: 'KB', better: 'down'},
];

function log(...args) {
  console.log('[perf]', ...args);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * mock.shop's catalog is fixed but its handles are not this script's to
 * hardcode, so the product URL is discovered from the same API the storefront
 * uses. Falls back to skipping the PDP rather than failing the whole run.
 */
async function discoverUrls() {
  const urls = ['/', '/collections/all'];
  try {
    const res = await fetch('https://mock.shop/api', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        query: '{ products(first: 1) { edges { node { handle } } } }',
      }),
    });
    const handle = (await res.json())?.data?.products?.edges?.[0]?.node?.handle;
    if (handle) urls.push(`/products/${handle}`);
  } catch {
    log('could not resolve a product handle; skipping the PDP');
  }
  return urls;
}

async function writeEnvFile(mode) {
  await mkdir(TMP_DIR, {recursive: true});
  const file = path.join(TMP_DIR, `${mode}.env`);
  await writeFile(
    file,
    [
      'PUBLIC_STORE_DOMAIN="mock.shop"',
      'SESSION_SECRET="shopify-headless-perf-lab-perf-run"',
      `PERF_MODE="${mode}"`,
      '',
    ].join('\n'),
  );
  return file;
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      shell: false,
    });
  } else {
    child.kill('SIGTERM');
  }
}

async function waitForServer(port, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}

async function startPreview(mode, port) {
  const envFile = await writeEnvFile(mode);
  log(`starting preview (${mode}) on :${port}`);

  const child = spawn(
    'npx',
    [
      'shopify',
      'hydrogen',
      'preview',
      '--env-file',
      path.relative(ROOT, envFile),
      '--port',
      String(port),
    ],
    {cwd: ROOT, shell: true, stdio: 'ignore'},
  );

  if (!(await waitForServer(port))) {
    killTree(child);
    throw new Error(
      `preview server for "${mode}" never became ready on :${port}`,
    );
  }
  return child;
}

async function runLighthouse(url, chromePort) {
  const result = await lighthouse(
    url,
    {port: chromePort, output: 'json', logLevel: 'error'},
    {
      extends: 'lighthouse:default',
      settings: {
        // Mobile emulation with the default 4x CPU / Slow 4G throttling.
        // Desktop numbers flatter every storefront and hide exactly the
        // main-thread cost this comparison is about.
        formFactor: 'mobile',
        onlyCategories: ['performance'],
      },
    },
  );

  const {audits, categories} = result.lhr;
  return {
    performanceScore: Math.round((categories.performance.score ?? 0) * 100),
    lcp: audits['largest-contentful-paint'].numericValue,
    fcp: audits['first-contentful-paint'].numericValue,
    tbt: audits['total-blocking-time'].numericValue,
    cls: audits['cumulative-layout-shift'].numericValue,
    speedIndex: audits['speed-index'].numericValue,
    transferKb: (audits['total-byte-weight'].numericValue ?? 0) / 1024,
  };
}

async function measureMode({mode, port}, urls) {
  const server = await startPreview(mode, port);
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const perUrl = {};
    for (const url of urls) {
      const runs = [];
      for (let i = 0; i < RUNS_PER_URL; i++) {
        runs.push(await runLighthouse(`http://localhost:${port}${url}`, chrome.port));
      }
      perUrl[url] = Object.fromEntries(
        METRICS.map(({key}) => [key, median(runs.map((r) => r[key]))]),
      );
      log(
        `${mode} ${url} -> score ${perUrl[url].performanceScore}, ` +
          `LCP ${Math.round(perUrl[url].lcp)}ms`,
      );
    }
    return perUrl;
  } finally {
    await chrome.kill().catch(() => {});
    killTree(server);
  }
}

function formatValue(key, value) {
  if (value == null || Number.isNaN(value)) return 'n/a';
  if (key === 'cls') return value.toFixed(3);
  if (key === 'performanceScore') return String(Math.round(value));
  return String(Math.round(value));
}

function formatDelta(metric, baseline, optimized) {
  if (baseline == null || optimized == null || baseline === 0) return '—';
  const pct = ((optimized - baseline) / baseline) * 100;
  const improved = metric.better === 'down' ? pct < 0 : pct > 0;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(1)}% ${improved ? '✅' : '⚠️'}`;
}

function renderReport(urls, results, meta) {
  const lines = [
    '# Performance: baseline vs optimized',
    '',
    'Generated by `npm run perf`. Do not hand-edit.',
    '',
    `- Runs per URL: **${meta.runsPerUrl}** (median reported)`,
    `- Lighthouse profile: mobile, default throttling (4x CPU, Slow 4G)`,
    `- Node: ${meta.node} · platform: ${meta.platform}`,
    '',
    'What differs between the two modes is listed in',
    '[`app/lib/perf-mode.ts`](../../app/lib/perf-mode.ts) and explained in',
    '[ADR 0003](../adr/0003-baseline-vs-optimized-perf-modes.md).',
    '',
  ];

  for (const url of urls) {
    const b = results.baseline[url];
    const o = results.optimized[url];
    lines.push(`## \`${url}\``, '');
    lines.push('| Metric | baseline | optimized | change |');
    lines.push('|---|---:|---:|---:|');
    for (const metric of METRICS) {
      const unit = metric.unit ? ` ${metric.unit}` : '';
      lines.push(
        `| ${metric.label} | ${formatValue(metric.key, b?.[metric.key])}${unit} ` +
          `| ${formatValue(metric.key, o?.[metric.key])}${unit} ` +
          `| ${formatDelta(metric, b?.[metric.key], o?.[metric.key])} |`,
      );
    }
    lines.push('');
  }

  lines.push(
    '> Lighthouse is noisy. Treat these as the shape of the difference, not',
    '> precise figures — re-run on your own hardware to confirm.',
    '',
  );
  return lines.join('\n');
}

async function main() {
  if (!existsSync(path.join(ROOT, 'dist', 'server'))) {
    throw new Error('No build found. Run `npm run build` first.');
  }

  const urls = await discoverUrls();
  log(`measuring ${urls.length} URLs, ${RUNS_PER_URL} runs each, 2 modes`);

  const results = {};
  for (const target of MODES) {
    results[target.mode] = await measureMode(target, urls);
  }

  const meta = {
    runsPerUrl: RUNS_PER_URL,
    node: process.version,
    platform: process.platform,
  };

  await mkdir(OUT_DIR, {recursive: true});
  await writeFile(
    path.join(OUT_DIR, 'latest.json'),
    JSON.stringify({meta, urls, results}, null, 2) + '\n',
  );
  await writeFile(
    path.join(OUT_DIR, 'latest.md'),
    renderReport(urls, results, meta),
  );
  await rm(TMP_DIR, {recursive: true, force: true});

  log('wrote docs/perf/latest.md and docs/perf/latest.json');
}

main().catch((error) => {
  console.error('[perf] failed:', error.message);
  process.exitCode = 1;
});
