# ADR 0004 — Commit `.env`

**Status:** Accepted

## Context

The Hydrogen skeleton ships `.env` in `.gitignore`, which is the correct default
for essentially every project: `.env` is where credentials live, and committing
credentials is how they leak.

This project has no credentials. `PUBLIC_STORE_DOMAIN` is `mock.shop`, a public
unauthenticated endpoint ([ADR 0001](0001-run-against-mock-shop.md)).
`SESSION_SECRET` signs a local MiniOxygen cookie for a storefront with no
accounts and no orders. `PERF_MODE` selects a rendering mode.

Keeping the default costs something specific. A reviewer clones the repository,
runs `npm install && npm run dev`, and the app fails to boot because
`SESSION_SECRET` is missing. They then have to find `.env.example`, copy it,
and try again — a small friction, applied at the exact moment a reviewer decides
whether to keep going.

## Decision

Commit `.env`, and say why in `.gitignore` so the exception is visible at the
point where someone would otherwise "fix" it.

## Consequences

**Good**

- `git clone && npm install && npm run dev` works. No setup step, no
  `.env.example` ritual.
- CI needs no secret configuration, so pull requests from forks run the full
  Lighthouse job.

**Bad, and accepted**

- It contradicts a rule that is worth following almost everywhere. Anyone
  copying this repository as a starting point could carry the habit into a
  project that *does* have secrets, which would be a real security problem.

That risk is the reason the exception is documented in three places — here, in
`.gitignore`, and in the README — rather than left as a silently deleted line.

**The rule this does not break:** the moment this project gains a private
Storefront token, an Admin API key, or a Customer Account credential, `.env`
goes back into `.gitignore` and `.env.example` comes back. The decision is
conditional on the project having nothing worth hiding, not on the friction
being annoying.

## Alternatives rejected

**`.env.example` plus a `postinstall` copy step.** Keeps the conventional
layout and still yields a working clone. Rejected because the hook runs on every
install, silently overwrites nothing, and is one more moving part to explain —
more machinery than the problem deserves when the file has no secrets.

**Default the values in code when env vars are absent.** No `.env` at all.
Rejected because it hides configuration inside the application and makes the
real deployment path — where these values *do* come from the environment —
less obvious to a reader.
