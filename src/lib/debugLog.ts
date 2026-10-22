/**
 * Debug-gated page-context diagnostics.
 *
 * Replaces ad-hoc `console.log` calls in page contexts: output is emitted via
 * `console.debug` only when a debug flag is set, so production console output
 * stays clean. Enable with `NEXT_PUBLIC_DEBUG=1` (inlined by Next.js at build
 * time) or `DEBUG=1` (Node/test contexts).
 *
 * The background service worker keeps its own debug/error conventions and
 * intentionally does not use this helper.
 */

/** True when debug diagnostics are enabled in the current context. */
export function isDebugLoggingEnabled(): boolean {
  try {
    return process.env.NEXT_PUBLIC_DEBUG === '1' || process.env.DEBUG === '1';
  } catch {
    return false;
  }
}

/**
 * Emit a diagnostic via `console.debug` when debug logging is enabled; a
 * no-op otherwise. Arguments are still evaluated at the call site — if an
 * argument is expensive to compute, guard the call with
 * `isDebugLoggingEnabled()` instead.
 */
export function debugLog(...args: unknown[]): void {
  if (isDebugLoggingEnabled()) {
    console.debug(...args);
  }
}
