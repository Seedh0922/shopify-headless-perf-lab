import type {Route} from './+types/perf-sim.blocking-app[.js]';

/**
 * Stand-in for the third-party app bundle that accumulates on a mature Shopify
 * theme: reviews widget, popup, upsell, back-in-stock.
 *
 * It is only referenced when PERF_MODE=baseline. The point is to make the cost
 * of a synchronous <head> script measurable with the same tooling that measures
 * everything else, so the baseline number is something Lighthouse observed
 * rather than something this repo asserts.
 *
 * Two costs are reproduced, both of which show up in a real trace:
 *   1. Network latency before the parser can continue (server delay below).
 *   2. Main-thread time once it arrives (the init loop in the payload).
 */

const SERVER_DELAY_MS = 250;
const MAIN_THREAD_BUDGET_MS = 120;

// Roughly the transfer size of a small review widget once minified.
const PADDING_BYTES = 90_000;

const PAYLOAD = `/* simulated third-party storefront app */
(function () {
  var start = Date.now();
  // Widget bootstrapping: parse config, measure the DOM, build templates.
  // Synchronous by design - this is what the real bundles do.
  var sink = 0;
  while (Date.now() - start < ${MAIN_THREAD_BUDGET_MS}) {
    sink += Math.sqrt(sink + 1);
  }
  window.__perfSimApp = {initialized: true, cost: Date.now() - start, sink: sink};
})();
/* ${'x'.repeat(PADDING_BYTES)} */
`;

export async function loader({context}: Route.LoaderArgs) {
  if (context.env.PERF_MODE?.toLowerCase() !== 'baseline') {
    return new Response('Not found', {status: 404});
  }

  await new Promise((resolve) => setTimeout(resolve, SERVER_DELAY_MS));

  return new Response(PAYLOAD, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // Uncached on purpose: an app script that never gets a far-future
      // expiry is part of the problem being measured.
      'Cache-Control': 'no-store',
    },
  });
}
