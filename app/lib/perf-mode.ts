/**
 * Two rendering modes for the same storefront, so the performance claims in
 * this repo can be reproduced instead of screenshotted.
 *
 * - `optimized` is how the storefront should ship.
 * - `baseline` reproduces the six patterns that most often wreck Core Web
 *   Vitals on an app-heavy Shopify theme. Each one is a real regression that
 *   Lighthouse can see, not a synthetic delay bolted onto the render.
 *
 * Keeping every lever in one table is deliberate: a reviewer can read this file
 * and know the complete list of differences between the two runs. Scattering
 * `if (baseline)` checks through components would make the comparison
 * unfalsifiable.
 *
 * See docs/adr/0003-baseline-vs-optimized-perf-modes.md
 */

export type PerfMode = 'baseline' | 'optimized';

export function resolvePerfMode(value?: string | null): PerfMode {
  return String(value).toLowerCase() === 'baseline' ? 'baseline' : 'optimized';
}

export interface PerfTraits {
  /**
   * Warms the TLS handshake to the Shopify image CDN. Missing preconnect costs
   * roughly a round trip before the LCP image can even start downloading.
   */
  preconnectCdn: boolean;

  /**
   * The hero image is the LCP element on the homepage. Lazy-loading it (a very
   * common copy-paste mistake) pushes LCP past the point the browser could have
   * started the fetch during preload scanning.
   */
  heroLoading: 'eager' | 'lazy';
  heroFetchPriority: 'high' | 'auto';

  /**
   * `sizes` is what lets the browser pick the right srcset candidate before
   * layout exists. A viewport-aware value gets a phone a phone-sized image; a
   * hardcoded desktop width — the common copy-paste — makes a 412px-wide
   * viewport download a 1600px candidate and throw most of it away.
   *
   * Note that `100vw` is *correct* for a full-bleed hero and is not the
   * regression being modelled here.
   */
  heroSizes: string;
  gridSizes: string;

  /**
   * Explicit intrinsic dimensions reserve layout space. Omitting them is the
   * usual source of a bad CLS score on collection grids.
   */
  reserveImageAspectRatio: boolean;

  /**
   * Simulates the review widget / popup / upsell app stack that accumulates on
   * a mature Plus theme, loaded synchronously in <head>.
   */
  blockingThirdPartyScript: boolean;

  /**
   * Storefront API responses are cacheable at the edge. Serving them
   * uncached is the difference between a warm and a cold TTFB.
   */
  cacheStorefrontQueries: boolean;
}

const TRAITS: Record<PerfMode, PerfTraits> = {
  optimized: {
    preconnectCdn: true,
    heroLoading: 'eager',
    heroFetchPriority: 'high',
    heroSizes: '(min-width: 45em) 50vw, 100vw',
    gridSizes: '(min-width: 45em) 20vw, 50vw',
    reserveImageAspectRatio: true,
    blockingThirdPartyScript: false,
    cacheStorefrontQueries: true,
  },
  baseline: {
    preconnectCdn: false,
    heroLoading: 'lazy',
    heroFetchPriority: 'auto',
    heroSizes: '1600px',
    gridSizes: '800px',
    reserveImageAspectRatio: false,
    blockingThirdPartyScript: true,
    cacheStorefrontQueries: false,
  },
};

export function perfTraits(mode: PerfMode): PerfTraits {
  return TRAITS[mode];
}

/**
 * Path of the simulated third-party app bundle. Served by
 * app/routes/perf-sim.blocking-app.tsx so the delay is measurable as real
 * network time rather than faked in the client. No `.js` suffix — see the note
 * in that file.
 */
export const BLOCKING_SCRIPT_PATH = '/perf-sim/blocking-app';
