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
import {mkdir, writeFile, rm, readdir, stat} from 'node:fs/promises';
import {createReadStream, existsSync} from 'node:fs';
import {createServer, request as httpRequest} from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP_DIR = path.join(ROOT, '.perf-tmp');
const OUT_DIR = path.join(ROOT, 'docs', 'perf');
const CLIENT_DIR = path.join(ROOT, 'dist', 'client');

/**
 * Everything here addresses the preview server over IPv4 rather than
 * `localhost`. On a host where IPv6 loopback is unavailable, `localhost`
 * resolves to `::1` first and every request pays a failed connect before
 * falling back — see `startStaticFront`.
 */
const LOOPBACK = '127.0.0.1';

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
      const res = await fetch(`http://${LOOPBACK}:${port}/`, {
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

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Confirms the preview server can serve its own build output.
 *
 * mini-oxygen does not serve static files from the worker: it runs a second
 * Node server and has the worker fetch it over `http://localhost:<port>/…`.
 * Where IPv6 loopback is unavailable that hop raises `connect EACCES ::1`
 * inside the worker, and every asset comes back 500 while HTML routes keep
 * working — so Lighthouse would score a page with no CSS and no JS and the
 * comparison would be meaningless rather than merely wrong.
 */
async function assetsAreServed(port) {
  const assetsDir = path.join(CLIENT_DIR, 'assets');
  const [sample] = await readdir(assetsDir).catch(() => []);
  if (!sample) return true; // nothing to check against; let the run proceed

  try {
    const res = await fetch(`http://${LOOPBACK}:${port}/assets/${sample}`, {
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * An IPv4-only front for the preview server, used only when the check above
 * fails. Static files are served from the build output and everything else is
 * proxied to the worker — the same order, and the same headers, mini-oxygen's
 * own handler uses (`assets.fetch` first, fall through to the worker on 404).
 *
 * The worker still renders every document, so both modes are measured under
 * identical conditions and the levers in `app/lib/perf-mode.ts` are unaffected.
 * What is lost is fidelity to mini-oxygen's asset server specifically, which is
 * not what Oxygen uses in production anyway — there a CDN serves these files.
 */
function startStaticFront(workerPort, frontPort) {
  const server = createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];

    const serveFromDisk = async () => {
      if (req.method !== 'GET' || pathname.includes('..')) return false;
      const filePath = path.join(CLIENT_DIR, decodeURIComponent(pathname));
      const info = await stat(filePath).catch(() => null);
      if (!info?.isFile()) return false;

      res.writeHead(200, {
        'Content-Type':
          MIME_TYPES[path.extname(filePath).toLowerCase()] ??
          'application/octet-stream',
        'Content-Length': info.size,
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      });
      createReadStream(filePath).pipe(res);
      return true;
    };

    serveFromDisk()
      .catch(() => false)
      .then((handled) => {
        if (handled) return;
        const upstream = httpRequest(
          {
            host: LOOPBACK,
            port: workerPort,
            path: req.url,
            method: req.method,
            headers: {...req.headers, host: `${LOOPBACK}:${workerPort}`},
          },
          (proxied) => {
            res.writeHead(proxied.statusCode ?? 502, proxied.headers);
            proxied.pipe(res);
          },
        );
        upstream.on('error', () => {
          if (!res.headersSent) res.writeHead(502, {'Content-Type': 'text/plain'});
          res.end('upstream unavailable');
        });
        req.pipe(upstream);
      });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(frontPort, LOOPBACK, () => resolve(server));
  });
}

async function runLighthouse(url, chromePort) {
  const result = await lighthouse(
    url,
    {port: chromePort, output: 'json', logLevel: 'error'},
    {
      extends: 'lighthouse:default',
      settings: {
        // Mobile emulation with 4x CPU / Slow 4G. Desktop numbers flatter
        // every storefront and hide exactly the main-thread cost this
        // comparison is about.
        formFactor: 'mobile',
        onlyCategories: ['performance'],

        // Applied throttling rather than Lighthouse's default simulation.
        // Simulation replays the trace against a modelled network graph, which
        // pushes FCP out past work that really ran before it — on this
        // storefront it reported TBT as 0 ms in both modes while the trace
        // contained a 722 ms task from the third-party script. Applied
        // throttling costs wall-clock time and is noisier, but it measures the
        // thing this repo is claiming to measure.
        throttlingMethod: 'devtools',
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
  let front;
  let origin = `http://${LOOPBACK}:${port}`;

  if (!(await assetsAreServed(port))) {
    front = await startStaticFront(port, port + 500);
    origin = `http://${LOOPBACK}:${port + 500}`;
    log(
      `preview server cannot reach its own asset server (IPv6 loopback is ` +
        `unavailable on this host); serving dist/client over IPv4 on ` +
        `:${port + 500} instead`,
    );
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  try {
    const perUrl = {};
    for (const url of urls) {
      const runs = [];
      for (let i = 0; i < RUNS_PER_URL; i++) {
        runs.push(await runLighthouse(`${origin}${url}`, chrome.port));
      }
      perUrl[url] = Object.fromEntries(
        METRICS.map(({key}) => [key, median(runs.map((r) => r[key]))]),
      );
      log(
        `${mode} ${url} -> score ${perUrl[url].performanceScore}, ` +
          `LCP ${Math.round(perUrl[url].lcp)}ms`,
      );
    }
    return {perUrl, staticFront: Boolean(front)};
  } finally {
    await chrome.kill().catch(() => {});
    front?.closeAllConnections();
    front?.close();
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
    `- Lighthouse profile: mobile, applied throttling (4x CPU, Slow 4G)`,
    `- Node: ${meta.node} · platform: ${meta.platform}`,
    ...(meta.staticFront
      ? [
          '- Static files were served from `dist/client` over IPv4 rather than',
          '  by mini-oxygen\'s asset server, because IPv6 loopback is unavailable',
          '  on the measuring host. Documents are still rendered by the worker,',
          '  and both modes ran under this condition.',
        ]
      : []),
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
  let staticFront = false;
  for (const target of MODES) {
    const measured = await measureMode(target, urls);
    results[target.mode] = measured.perUrl;
    staticFront ||= measured.staticFront;
  }

  const meta = {
    runsPerUrl: RUNS_PER_URL,
    node: process.version,
    platform: process.platform,
    staticFront,
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
