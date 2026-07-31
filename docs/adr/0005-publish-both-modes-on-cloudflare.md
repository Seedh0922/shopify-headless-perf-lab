# ADR 0005 — Publish both modes on Cloudflare so the numbers can be checked by a stranger

**Status:** Accepted

## Context

[ADR 0003](0003-baseline-vs-optimized-perf-modes.md) made the performance claim
reproducible: clone the repository, run `npm run perf`, get the same shape of
answer. That is a real improvement over a screenshot, and it still asks
something of the reader — a clone, an install, and twelve minutes.

Most people who look at this repository will not spend that. Recruiters and
hiring managers skim; merchants evaluating a contractor skim harder. The numbers
in `docs/perf/latest.md` were still measured on my hardware, so a reader who does
not run the harness is back to trusting me.

There is a version of the claim that asks nothing at all: **two public URLs**.
Anyone can paste them into PageSpeed Insights and have Google do the measuring.
The result is not mine, on my machine — it is a third party's, on theirs.

## Decision

Deploy both perf modes to Cloudflare Workers, as two workers differing only by
the `PERF_MODE` variable.

```
npm run deploy:optimized
npm run deploy:baseline
```

Oxygen remains the storefront's home and `npm run build` still targets it. This
is a second destination for the same artifact, not a migration.

It works because Oxygen and Workers are the same runtime underneath — workerd.
The built worker already exports a module `fetch` handler, and `caches.open()`
and `ctx.waitUntil()` mean the same thing on both platforms, so the Storefront
API sub-request cache — one of the six levers — behaves as it does on Oxygen.

Static assets are served by Cloudflare ahead of the worker via the `assets`
binding.

## Consequences

**Good**

- The comparison can be verified by someone who never opens the repository, with
  a tool they already trust more than they trust me.
- Both URLs run the same commit, so the only difference between them is the one
  environment variable — which is the property the whole comparison rests on.
- Serving assets at the platform layer sidesteps the loopback asset server the
  local preview uses, which is what breaks `npm run preview` on hosts without
  IPv6 loopback (see the README).
- Field-ish conditions: a real CDN, real TLS, real geography. Better evidence
  than a preview server on `127.0.0.1`.

**Bad, and accepted**

- **A second deployment target to keep working.** If Hydrogen changes something
  Oxygen-specific, this config is where it will break, and it will break quietly
  because nothing in CI deploys it.
- The public numbers will not match `docs/perf/latest.md` exactly. That file is
  measured on loopback with applied throttling; these URLs are measured across a
  network by whoever is asking. Same shape, different absolute values — and the
  report says which is which.
- Two workers is two things that can drift. They are deployed from the same
  commit by two commands, and nothing enforces that they were run together.
- **`wrangler dev` reads `.env`, and `.env` in this repo pins
  `PERF_MODE=optimized`.** So the baseline environment renders as optimized
  locally unless overridden with `--var PERF_MODE:baseline`. Deployment is
  unaffected — `wrangler deploy --dry-run --env baseline` confirms the config
  value is what ships — but it is a genuine trap and cost an hour to notice.

## Alternatives rejected

**Shopify Oxygen.** The native target, free, and zero configuration. Rejected
because deploying to it requires linking a Shopify store, and
[ADR 0001](0001-run-against-mock-shop.md) exists precisely so that no account is
needed to see this project work. Adding an account requirement at the deployment
step would undo that.

**Vercel.** Where the portfolio lives, so it would have been convenient.
Rejected on inspection: the Vercel edge runtime does not expose the Cache API,
and `caches.open('hydrogen')` in `app/lib/context.ts` is the Storefront API
cache — one of the six levers being measured. Replacing it with a KV store would
mean the deployed comparison no longer measured the same thing the repository
describes.

**Leave it as a repository only.** Honest, and what this was until now. Rejected
because the cost of the two URLs turned out to be one config file, and the
difference between "run this and see" and "click this and see" is most of the
audience.
