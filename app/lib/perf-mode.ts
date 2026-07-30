/**
 * Two rendering modes for the same storefront, so the performance claims in
 * this repo can be reproduced instead of screenshotted.
 *
 * - `optimized` is how the storefront should ship.
 * - `baseline` reproduces the five patterns that most often wreck Core Web
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
   * Without a `sizes` hint the browser picks the widest candidate in the
   * srcset, so mobile downloads a desktop-sized image.
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
    heroSizes: '100vw',
    gridSizes: '100vw',
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
 * app/routes/perf-sim.blocking-app[.js].tsx so the delay is measurable as real
 * network time rather than faked in the client.
 */
export const BLOCKING_SCRIPT_PATH = '/perf-sim/blocking-app.js';
