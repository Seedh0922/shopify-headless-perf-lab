# ADR 0001 — Run against mock.shop, not a private dev store

**Status:** Accepted

## Context

A headless storefront needs a Storefront API to talk to. The obvious choice is a
Shopify Partner development store with a Storefront API access token.

That choice has a cost that only shows up later: the repository stops being
runnable by anyone except its author. A reviewer clones it, runs `npm install`,
starts the dev server, and gets an authentication error. To see the project they
would have to create a Partner account, create a dev store, seed products,
generate a token, and paste it into `.env`. Most reviewers will not, and the
project quietly becomes a screenshot gallery.

The repository also has a second audience: CI. Lighthouse runs on every pull
request (see [ADR 0003](0003-baseline-vs-optimized-perf-modes.md)), which means
the data source has to be reachable from a GitHub Actions runner without a
secret. Storing a Storefront API token in repository secrets works, but it makes
the performance history depend on a credential that expires, on a store whose
catalog someone may edit, which quietly invalidates comparisons across time.

## Decision

Point the storefront at **`mock.shop`**, Shopify's public, unauthenticated mock
Storefront API, via `PUBLIC_STORE_DOMAIN=mock.shop`.

## Consequences

**Good**

- `git clone && npm install && npm run dev` works with no account, no token, and
  no setup step. That is the single largest factor in whether anyone actually
  looks at the project.
- CI needs no secrets, so pull requests from forks get the same Lighthouse run
  as branches.
- The catalog is fixed and shared, so a Lighthouse number from six months ago is
  still comparable to one from today. Performance work is only meaningful
  against a stable baseline.

**Bad, and accepted**

- `mock.shop` is read-only. Cart mutations and checkout cannot complete against
  it, so the cart route demonstrates the client-side flow but cannot produce a
  real checkout. This is called out in the README rather than hidden.
- Customer Accounts, Markets, and Functions cannot be exercised. Those need a
  real store.
- No control over catalog size, so this cannot demonstrate behaviour at
  100k-SKU scale.

The read-only limit is the real cost. It is worth paying because the alternative
trades away the property that makes the repository useful to a stranger.

## Alternatives rejected

**Partner dev store with a committed token.** Storefront API tokens are public
by design — they ship to the browser — so committing one is not the security
problem it first appears to be. Rejected anyway: dev stores are deleted for
inactivity, and the repository would rot silently.

**A local mock server (MSW, a JSON fixture).** Full control, no network, and the
catalog would be pinned exactly. Rejected because it stops proving anything about
the Storefront API. The value of this project is that the GraphQL layer, the
caching, and the image CDN behaviour are real. Replacing Shopify with a fixture
removes precisely the part worth showing.
