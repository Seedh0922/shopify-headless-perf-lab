# ADR 0003 — Ship two perf modes so the numbers can be reproduced

**Status:** Accepted

## Context

Every storefront project claims a performance win. "Cut LCP by 22%." The claim
is almost always unverifiable, for a structural reason: the slow version was a
client's production site, it is behind a login or has since been replaced, and
what remains is a screenshot of a Lighthouse score with no way to tell what was
measured, on what hardware, against what network profile, or how many runs were
discarded to get it.

A screenshot is an assertion. This repository needed the claim to be a
**reproducible measurement** — something a reader can re-run on their own
machine and get the same shape of answer.

That requires a slow version that still exists and still runs.

## Decision

Ship the same storefront in two modes, selected at runtime by the `PERF_MODE`
environment variable, and provide a script that measures both in one command:

```
npm run perf
```

`optimized` is how the storefront should ship. `baseline` re-introduces six
specific regressions, each one drawn from a pattern that actually shows up on
app-heavy Shopify themes:

| Lever | `optimized` | `baseline` | Why it matters |
|---|---|---|---|
| CDN preconnect | present | removed | Costs a TLS round trip before the LCP image can start |
| Hero image loading | `eager` + `fetchpriority=high` | `lazy` + `auto` | Lazy-loading the LCP element defeats the preload scanner |
| Image `sizes` hint | viewport-aware | hardcoded `1600px` | Mobile downloads a desktop-width image |
| Layout reservation | aspect ratio set | absent | The usual source of a bad CLS score |
| Third-party app script | absent | synchronous in `<head>` | Reviews/popup/upsell bundles, the single biggest real-world cost |
| Storefront API cache | `CacheLong` / `CacheShort` | `CacheNone` | Warm vs cold TTFB |

All six levers live in a single table in
[`app/lib/perf-mode.ts`](../../app/lib/perf-mode.ts). That is deliberate. If the
differences were scattered through components as `if (baseline)` branches, a
reader could not audit what was actually being compared, and the comparison
would be worth as little as the screenshot it replaced.

## Consequences

**Good**

- The performance claim in the README is a command, not a screenshot.
- Lighthouse runs in CI on every pull request with budgets that fail the build,
  so a regression is caught at review time rather than discovered in production.
- The baseline doubles as documentation. "Why does `fetchpriority` matter?" has
  a measured answer in this repository rather than a link to someone's blog.

**Bad, and accepted**

- Production code carries branches that exist only for measurement. This is real
  complexity for no user-facing benefit, and on a client codebase it would be
  the wrong trade. It is justified here because demonstrating the difference *is*
  the product.
- The simulated third-party script is a stand-in, not a real vendor bundle. It
  reproduces the two costs that matter (network latency before the parser
  continues, main-thread time on execution) but cannot reproduce a specific
  vendor's behaviour.
- Lighthouse is noisy. The harness runs each URL several times and reports the
  median; single runs should not be read as precise.
- One lever does not show up in the numbers. `baseline` emits a hero `<img>`
  with no width, height, or aspect ratio, and both modes still measure a CLS of
  0.000 — mock.shop's images are small enough, and a preview server on loopback
  fast enough, that the hero decodes before first paint and nothing is ever laid
  out twice. The lever is kept because the CLS budget still has to hold against
  a real image origin, but this repository does not demonstrate it, and the
  generated report says so rather than quietly reporting a win.

## Alternatives rejected

**Commit Lighthouse JSON from a real client site.** Highest realism, and
impossible: the data is not mine to publish, and the site cannot be re-measured
by a reader.

**Two long-lived git branches, `slow` and `fast`.** A reader could diff them,
which is appealing. Rejected because the branches drift the moment either side
gets a commit, and comparing them means building and serving two checkouts. A
runtime flag keeps both paths on one commit, so they cannot silently diverge.

**Throttle the optimized build to fake a baseline.** Trivial to implement and
completely worthless — it measures the throttle, not the regression. The whole
point is that each lever is a real change a real theme actually has.
