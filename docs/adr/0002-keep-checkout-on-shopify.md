# ADR 0002 — Keep checkout on Shopify

**Status:** Accepted

## Context

Going headless raises an immediate question: how far does headless go? The
storefront is now a React application that owns routing, rendering, and the
cart. Checkout is the obvious next candidate, and it is tempting, because
checkout is where the brand's design system currently stops.

It is also where every hard problem lives: PCI scope, payment method coverage,
tax and duty calculation per market, fraud analysis, address validation,
Shop Pay's accelerated flow, wallet integrations, and post-purchase upsells.

## Decision

Move product discovery — home, collections, product pages, search, content —
onto the headless frontend. **Hand off to Shopify's hosted checkout at the cart.**

## Consequences

**Good**

- PCI scope stays with Shopify. The frontend never touches card data, which
  removes an entire compliance surface from the project.
- Shop Pay works, and its one-tap flow converts materially better than any
  first-party checkout a team of this size would build.
- Payment methods, taxes, and duties stay correct per market without the
  frontend modelling any of it.
- The riskiest part of the funnel keeps running on infrastructure that is
  tested at a volume no individual project can reproduce.

**Bad, and accepted**

- There is a visual seam at checkout. Branding is limited to what Checkout
  Extensibility exposes.
- Cross-domain analytics needs care: the session has to be stitched across the
  handoff or the funnel double-counts. This is exactly the class of bug that
  makes marketing distrust the numbers.

The seam is real and it is the correct trade. Conversion is worth more than
visual continuity, and Shop Pay is a conversion advantage that a custom
checkout starts out losing.

## Alternatives rejected

**Headless checkout via the Cart and Checkout APIs.** Full design control, and
it is genuinely achievable. Rejected because it puts the project in PCI scope,
gives up Shop Pay, and makes the team responsible for tax and fraud logic —
paying a permanent maintenance cost to remove a seam most customers never
mention.

**Stay fully on Liquid to avoid the seam entirely.** No handoff, no
cross-domain analytics problem. Rejected because it gives up the thing this
project exists to demonstrate: that the discovery experience can be fast and
independently deployable. The seam is the price of that, and it is affordable.
