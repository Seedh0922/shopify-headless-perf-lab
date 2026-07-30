# Shopify Headless Perf Lab

A headless Shopify storefront built on **Hydrogen + React Router 7**, running on
the Oxygen worker runtime — where every performance claim is a command you can
re-run, not a screenshot.

The same storefront ships in two modes. `optimized` is how it should go out.
`baseline` re-introduces five specific regressions that real app-heavy Shopify
themes have. Both are measured by one script, so the difference between them is
an observation rather than an assertion.

```bash
git clone <this-repo>
cd shopify-headless-perf-lab
npm install
npm run dev            # http://localhost:3000
```

**No Shopify account. No API token. No dev store.** The storefront runs against
[`mock.shop`](https://mock.shop), Shopify's public Storefront API mock, so it
works on a clean machine in under a minute — including in CI, with no secrets.
([ADR 0001](docs/adr/0001-run-against-mock-shop.md))

---

## Architecture

```mermaid
flowchart LR
  subgraph Edge["Oxygen worker (edge)"]
    RR["React Router 7<br/>SSR + streaming"]
    HC["Hydrogen<br/>Storefront client"]
    CACHE["Sub-request cache<br/>CacheLong / CacheShort / CacheNone"]
  end

  Browser["Browser"] -->|"document request"| RR
  RR --> HC
  HC --> CACHE
  CACHE -->|"GraphQL"| SF["Storefront API<br/>(mock.shop)"]
  RR -->|"streamed HTML, deferred below-fold"| Browser
  Browser -->|"cart handoff"| CO["Shopify hosted checkout<br/>(PCI scope stays here)"]

  PM["app/lib/perf-mode.ts"] -.->|"selects traits"| RR
```

Critical above-the-fold data is awaited; everything below the fold is deferred
and streamed, which is why the footer and recommended products do not block
time-to-first-byte.

Checkout is deliberately *not* headless — see
[ADR 0002](docs/adr/0002-keep-checkout-on-shopify.md).

---

## The two perf modes

Selected at runtime by `PERF_MODE`. Every difference between them lives in one
table in [`app/lib/perf-mode.ts`](app/lib/perf-mode.ts) — deliberately, so the
comparison can be audited rather than taken on trust.

| Lever | `optimized` | `baseline` | Why it matters |
|---|---|---|---|
| CDN preconnect | present | removed | A TLS round trip before the LCP image can start |
| Hero image | `eager` + `fetchpriority=high` | `lazy` + `auto` | Lazy-loading the LCP element defeats the preload scanner |
| `sizes` hint | viewport-aware | hardcoded `1600px` | Mobile downloads a desktop-width image |
| Layout reservation | aspect ratio set | absent | The usual cause of a bad CLS score |
| Third-party app script | absent | synchronous in `<head>` | Reviews / popup / upsell bundles — the biggest real-world cost |
| Storefront API cache | `CacheLong` / `CacheShort` | `CacheNone` | Warm vs cold TTFB |

Reproduce the comparison:

```bash
npm run build
npm run perf           # both modes, 3 Lighthouse runs per URL, median
```

Results are written to `docs/perf/latest.md` and `docs/perf/latest.json`.
Mobile emulation at 4× CPU and Slow 4G — desktop numbers flatter every
storefront and hide exactly the main-thread cost this comparison is about.

The throttling is *applied*, not Lighthouse's default simulation. Simulation
replays the trace against a modelled network graph and put first paint after
work that had really run before it, reporting `0 ms` of Total Blocking Time in
both modes while the trace held a 722 ms task from the third-party script.
Applied throttling is slower to run and noisier; it also measures what this
comparison claims to be about.

To see a single mode in a browser, set `PERF_MODE` in `.env` and run
`npm run preview`. The rendered mode is visible as `<html data-perf-mode="…">`.

---

## Budgets are enforced, not admired

[`.github/workflows/lighthouse.yml`](.github/workflows/lighthouse.yml) runs
Lighthouse CI on every pull request against the thresholds in
[`lighthouserc.json`](lighthouserc.json):

| Assertion | Threshold | Level |
|---|---|---|
| Performance category | ≥ 0.90 | error |
| Accessibility category | ≥ 0.95 | error |
| SEO category | ≥ 0.95 | error |
| LCP | ≤ 2500 ms | error |
| CLS | ≤ 0.10 | error |
| Total Blocking Time | ≤ 300 ms | error |
| Unsized images | none | error |

A regression fails the pull request. That is the point — a budget nobody
enforces is a preference.

---

## Decision records

Short, and each one names what was given up.

- [0001 — Run against mock.shop, not a private dev store](docs/adr/0001-run-against-mock-shop.md)
- [0002 — Keep checkout on Shopify](docs/adr/0002-keep-checkout-on-shopify.md)
- [0003 — Ship two perf modes so the numbers can be reproduced](docs/adr/0003-baseline-vs-optimized-perf-modes.md)
- [0004 — Commit `.env`](docs/adr/0004-commit-the-env-file.md)

---

## Stack

TypeScript · React · Hydrogen (Oxygen worker runtime) · React Router 7 ·
Storefront API (GraphQL) with generated types · Vite · Lighthouse CI ·
GitHub Actions

```
app/
  lib/perf-mode.ts          the two modes, in one auditable table
  routes/                   file-based routes (flatRoutes)
    perf-sim.blocking-app[.js].tsx   simulated third-party app bundle
  components/
scripts/perf-compare.mjs    measures both modes, writes docs/perf/
docs/adr/                   decision records
lighthouserc.json           enforced budgets
```

---

## Limits, and what I would do differently at scale

Worth stating plainly, because a project that lists no limits usually has not
looked for them.

- **`mock.shop` is read-only.** Cart mutations render and behave correctly on
  the client, but no checkout can complete. Customer Accounts, Markets, and
  Shopify Functions need a real store and are not exercised here.
- **The catalog is tiny.** Nothing here demonstrates behaviour at 100k SKUs,
  where collection pagination, faceted filtering, and sitemap generation become
  the actual problems.
- **The third-party script is a stand-in.** It reproduces the two costs that
  matter — network latency before the parser continues, and main-thread time on
  execution — but not any specific vendor's behaviour.
- **One of the six levers does not show up in the numbers.** `baseline` emits a
  hero `<img>` carrying no width, height, or aspect ratio, and CLS still comes
  back 0.000 in both modes: mock.shop's images are small and loopback is fast,
  so the hero decodes before first paint and nothing is laid out twice. Against
  a real image origin it would shift. The lever stays because the budget has to
  hold there, but the report shows a `—` rather than a win, which is the honest
  reading.
- **Lighthouse is noisy.** The harness takes the median of several runs, which
  is enough to show the shape of a difference and not enough to call a 3%
  change a regression. Field data (CrUX / RUM) is what a production storefront
  should be governed by; lab numbers are a pre-merge gate, not a substitute.
- **Production branches for measurement.** `perf-mode.ts` is complexity that
  exists only to demonstrate a difference. On a client codebase this would be
  the wrong trade — there, the baseline is the site you are replacing.

---

## Development notes

- `npm run typecheck` — route typegen, then `tsc --noEmit`
- `npm run codegen` — regenerate Storefront API types after editing a query
- React is pinned to 18.x to match what Hydrogen 2026.4 is tested against.
- **If every `/assets/*` request returns 500 while pages still render:** the
  host cannot reach IPv6 loopback. mini-oxygen does not serve static files from
  the worker — it runs a second Node server and has the worker fetch it over
  `http://localhost:<port>`. `localhost` resolves to `::1` first, and when that
  connect is refused the worker throws instead of retrying over IPv4, so HTML
  keeps working and every asset fails. Confirm it in one line:

  ```bash
  node -e "require('net').connect({host:'::1',port:45999}).on('error',e=>console.log(e.code))"
  ```

  `ECONNREFUSED` is healthy. `EACCES` means IPv6 loopback is blocked
  machine-wide, usually by a firewall, VPN client, or endpoint-security policy.
  On such a host:

  - `npm run dev` works. Vite would otherwise bind `::1` only and be
    unreachable at any address, so `server.host` is pinned to `127.0.0.1` in
    [`vite.config.ts`](vite.config.ts).
  - `npm run perf` works. It detects the broken hop, serves `dist/client` over
    IPv4 itself, and records that it did so in the generated report.
  - `npm run preview` does **not**. The document routes answer on
    `http://127.0.0.1:3000`, but static assets 500 and there is no fallback —
    use `npm run dev`, or WSL2.
