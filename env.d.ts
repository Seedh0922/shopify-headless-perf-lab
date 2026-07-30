/// <reference types="vite/client" />
/// <reference types="react-router" />
/// <reference types="@shopify/oxygen-workers-types" />
/// <reference types="@shopify/hydrogen/react-router-types" />

// Enhance TypeScript's built-in typings.
import '@total-typescript/ts-reset';

declare global {
  /**
   * Project-specific environment variables, merged into the Env interface that
   * Hydrogen declares for the Oxygen worker.
   */
  interface Env {
    /** "optimized" (default) or "baseline". See app/lib/perf-mode.ts */
    PERF_MODE?: string;
  }
}
