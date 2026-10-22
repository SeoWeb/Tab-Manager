// Integration harness helpers for the pool-workers suite (task 5.2,
// openspec/cleanup-and-regression-tests).
//
// Contracts for later suites (5.3 IDOR matrix, 5.4 quota commit paths, 5.5
// concurrency):
//
// 1. Runtime guard — EVERY integration test file starts with:
//
//      const runtime = requireWorkersRuntime('<suite name>');
//      const d = runtime ? describe : describe.skip;
//      d('...', () => { ... });
//
//    If the file ever runs OUTSIDE workerd (config misroute, pool silently
//    falling back, someone running the file through the node project), the
//    suite is marked SKIPPED — never silently passed — behind a loud
//    `console.warn` banner. Never call bindings in module scope.
//
// 2. Bindings — call `getTestEnv()` inside `beforeAll`/tests (dynamic import:
//    module scope must stay node-import-safe for the guard above to work).
//    The returned Env is the real worker binding surface (D1_DATABASE,
//    PROJECT_ROOM, RATE_LIMITER, EMAIL, vars from wrangler.toml) with
//    JWT_SECRET guaranteed for suites that mint tokens or call handlers
//    directly. `makeTestEnv({ QUOTA_MAX_ENTITIES_PER_PROJECT: '3', ... })`
//    layers per-suite var overrides on top (only visible to code you call
//    with the returned object — worker-wide bindings stay untouched).
//
// 3. Isolation strategy — per-test-file: storage is isolated between test
//    files by the pool; within a file, state persists across tests, so seed
//    in `beforeAll` and treat mutation order as part of the file's contract
//    (see harness.test.ts "state persists across tests in this file").
//    `applyD1Migrations` (setup.ts) re-ensures the schema at the start of
//    every file via the `d1_migrations` tracking table.

import type { Env } from '../../../types';

/** Fixed secret for suites that mint/verify tokens or drive handlers
 * directly. The pool config also injects this worker-wide (see
 * vitest.config.ts miniflare.bindings); asserting it here keeps direct-handler
 * tests independent of binding-merge semantics. */
export const TEST_JWT_SECRET = 'integration-test-only-secret';

/**
 * True when the current file is executing inside the Workers runtime.
 * Uses the documented `navigator.userAgent` sentinel — no binding access, so
 * it is safe at module scope.
 */
export function isWorkersRuntime(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    navigator.userAgent === 'Cloudflare-Workers'
  );
}

const LOUD_SKIP_BANNER = [
  '█ BEGIN LOUD SKIP — integration harness unavailable ' + '█',
  '█ This integration suite is being SKIPPED, not passed.                          █',
  '█ Cause: the Workers runtime (workerd) was not detected.                        █',
  '█ Expected: the file runs under the `integration` vitest project                █',
  '█   (@cloudflare/vitest-pool-workers, see backend/vitest.config.ts).            █',
  '█ Fix: run `pnpm run test:backend` from the repo root and check the             █',
  '█   per-project counts — integration tests must appear as their own            █',
  '█   project, never folded into the plain-Node `unit` project.                   █',
  '█ END LOUD SKIP ' + '█',
].join('\n');

/**
 * Emit the banner on every channel that survives a vitest run. `console.warn`
 * is the design-mandated channel; module-scope warns outside test bodies can
 * be swallowed by vitest's console interception, so the skip path (which by
 * definition executes under Node, not workerd) also writes to stderr directly.
 */
function emitLoudSkip(text: string): void {
  console.warn(text);
  if (
    typeof process !== 'undefined' &&
    typeof process.stderr?.write === 'function'
  ) {
    process.stderr.write(`\n${text}\n`);
  }
}

/**
 * Module-scope guard for integration test files. Returns true when the
 * Workers runtime is present; otherwise emits the loud-skip banner (so the
 * reason is in CI logs) and the caller pairs the result with
 * `describe.skip` — the suite then reports as skipped, never as passed.
 */
export function requireWorkersRuntime(suiteName: string): boolean {
  if (isWorkersRuntime()) return true;
  emitLoudSkip(
    `\n${LOUD_SKIP_BANNER}\n` +
      `█ Skipping suite: ${suiteName}\n`
  );
  return false;
}

/**
 * Resolve the worker's binding surface. Dynamic import on purpose: the module
 * specifier only exists inside workerd, and integration files must stay
 * importable (guard-first) outside it.
 */
export async function getTestEnv(): Promise<Env> {
  const mod = (await import('cloudflare:workers')) as {
    env: unknown;
  };
  const env = mod.env as Partial<Env>;
  if (!env.D1_DATABASE) {
    throw new Error(
      'Integration harness: no D1_DATABASE binding on the runtime env — ' +
        'check the wrangler.toml configPath in vitest.config.ts.'
    );
  }
  return { JWT_SECRET: TEST_JWT_SECRET, ...env } as Env;
}

/**
 * Per-suite Env with var overrides layered on top (quota caps, rate limits,
 * SYNC_SERIAL_MODE, ...). Pass the returned object to lib functions called
 * directly (applyMutation, createProject, verifyLoginCode, ...); bindings are
 * shared with the worker, so writes go to the same D1.
 */
export function makeTestEnv(
  overrides: Partial<Record<string, string>> = {}
): Promise<Env> {
  return getTestEnv().then((env) => ({ ...env, ...overrides }));
}
