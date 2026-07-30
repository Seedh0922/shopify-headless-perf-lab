import type {Route} from './+types/perf-sim.blocking-app';

/**
 * Stand-in for the third-party app bundle that accumulates on a mature Shopify
 * theme: reviews widget, popup, upsell, back-in-stock.
 *
 * The path deliberately carries no `.js` suffix. mini-oxygen routes any request
 * whose extension looks static to its asset server first and only falls back to
 * the worker on a 404, so a worker route ending in `.js` is one broken hop away
 * from never executing — which is exactly the failure that would silently zero
 * out this lever. The `Content-Type` below is what makes the browser run it.
 *
 * It is only referenced when PERF_MODE=baseline. The point is to make the cost
 * of a synchronous <head> script measurable with the same tooling that measures
 * everything else, so the baseline number is something Lighthouse observed
 * rather than something this repo asserts.
 *
 * Three costs are reproduced, all of which show up in a real trace:
 *   1. Network latency before the parser can continue (server delay below).
 *   2. Main-thread time at parse (`BOOT_BUDGET_MS`) — this lands before first
 *      paint, so it delays FCP rather than appearing in Total Blocking Time.
 *   3. Main-thread time on `load` (`INIT_BUDGET_MS`). Widgets that measure the
 *      DOM — reviews, upsell, back-in-stock — wait for it, and because this
 *      falls inside Lighthouse's FCP-to-TTI window it is what TBT actually
 *      sees. Doing all the work at parse time would leave TBT at zero and make
 *      the lever look free.
 */

const SERVER_DELAY_MS = 250;
const BOOT_BUDGET_MS = 60;
const INIT_BUDGET_MS = 180;

// Roughly the transfer size of a small review widget once minified.
const PADDING_BYTES = 90_000;

const PAYLOAD = `/* simulated third-party storefront app */
(function () {
  function burn(ms) {
    var start = Date.now();
    var sink = 0;
    while (Date.now() - start < ms) {
      sink += Math.sqrt(sink + 1);
    }
    return sink;
  }

  // Parse config and register globals. Synchronous by design - this is what
  // the real bundles do, and it is why they are told not to sit in <head>.
  var sink = burn(${BOOT_BUDGET_MS});

  // The expensive half: measure the DOM and build widget templates once the
  // page has actually rendered.
  window.addEventListener('load', function () {
    sink += burn(${INIT_BUDGET_MS});
    window.__perfSimApp = {initialized: true, sink: sink};
  });
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
