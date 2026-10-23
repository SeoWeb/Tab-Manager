import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ViteUserConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import {
  cloudflareTest,
  readD1Migrations,
  type D1Migration,
} from '@cloudflare/vitest-pool-workers';

// ---------------------------------------------------------------------------
// Backend test config — TWO vitest projects in one config (vitest 4 `projects`):
//
//   unit        — the existing 300-test plain-Node suite (hand-rolled D1 mocks
//                 under src/lib/__tests__/cases/harness.ts). Unchanged behavior:
//                 node environment, everything except the integration directory.
//   integration — the miniflare/`@cloudflare/vitest-pool-workers` harness
//                 (tasks 5.2–5.5 of openspec/cleanup-and-regression-tests).
//                 Tests run INSIDE workerd against a migrations-applied local
//                 D1, with bindings derived from wrangler.toml.
//
// `pnpm run test:backend` (root) → `pnpm --filter tab-manager-cloudflare-backend
// run test` → `vitest run` executes both projects; the summary reports
// per-project file/test counts.
// ---------------------------------------------------------------------------

const backendRoot = path.dirname(fileURLToPath(import.meta.url));

// --- wrangler.toml is the single source of truth for bindings ----------------
// Parsed once at config load (Node side) with wrangler's own parser, so the
// D1 binding name and migrations directory stay in sync with the deploy config
// automatically. No hand-rolled TOML parsing.
type WranglerConfig = {
  d1_databases?: {
    binding: string;
    database_name: string;
    database_id: string;
    migrations_dir?: string;
  }[];
};

async function loadD1Config(): Promise<{
  binding: string;
  migrationsDir: string;
}> {
  const wrangler = (await import('wrangler')) as {
    unstable_readConfig(opts: { config: string }): WranglerConfig;
  };
  const config = wrangler.unstable_readConfig({
    config: path.resolve(backendRoot, 'wrangler.toml'),
  });
  const d1 = config.d1_databases?.[0];
  if (!d1) {
    throw new Error(
      'vitest.config.ts: no [[d1_databases]] block found in wrangler.toml — ' +
        'the integration harness needs a D1 binding to run against.'
    );
  }
  return {
    binding: d1.binding,
    migrationsDir: path.resolve(
      backendRoot,
      d1.migrations_dir ?? 'migrations'
    ),
  };
}

// Migrations are read + SQL-split ONCE here (Node side: workerd tests cannot
// touch the filesystem) and carried into the in-worker setup file through a
// virtual module. `readD1Migrations` reads every `*.sql` file in the directory
// ordered by numeric filename prefix, so new migration files are picked up
// automatically — no registration list to maintain.
const d1 = await loadD1Config();
const migrations: D1Migration[] = await readD1Migrations(d1.migrationsDir);

/** Exposes the pre-read migrations to in-worker code as
 * `import migrations from 'virtual:d1-migrations'`. */
function virtualD1Migrations(data: D1Migration[]): Plugin {
  const payload = JSON.stringify(data);
  return {
    name: 'tab-manager-d1-migrations-virtual',
    resolveId(id) {
      if (id === 'virtual:d1-migrations') return '\0virtual:d1-migrations';
    },
    load(id) {
      if (id === '\0virtual:d1-migrations') return `export default ${payload};`;
    },
  };
}

// --- integration pool options ------------------------------------------------
// * wrangler.configPath  → D1/DO/var/send_email bindings come from wrangler.toml
//   (`main` is inherited too, so the ProjectRoom/RateLimiter DO classes resolve).
// * remoteBindings: false — wrangler.toml declares `send_email` with
//   `remote = true`; without this the pool would try to open an authenticated
//   Cloudflare remote-proxy session for it. Tests run fully local; suites that
//   exercise the login flow mock the EMAIL binding instead.
// * miniflare.bindings pins the two vars tests rely on. JWT_SECRET is a secret
//   in every real deployment (never put it in wrangler.toml) and ALLOWED_ORIGINS
//   is restated so this override stays correct whether mergeWorkerOptions
//   deep-merges or replaces the wrangler-derived `bindings` object.
const integrationProject: ViteUserConfig = {
  plugins: [
    cloudflareTest({
      wrangler: { configPath: path.resolve(backendRoot, 'wrangler.toml') },
      remoteBindings: false,
      miniflare: {
        bindings: {
          JWT_SECRET: 'integration-test-only-secret',
          ALLOWED_ORIGINS: 'https://tabspace.ww0.dev',
        },
      },
    }),
    virtualD1Migrations(migrations),
  ],
  test: {
    name: 'integration',
    include: ['src/lib/__tests__/integration/**/*.test.ts'],
    setupFiles: ['src/lib/__tests__/integration/setup.ts'],
    // Determinism over speed (the design calls out pool-workers CI flakes as
    // the risk; version pinning + sequential file execution are mitigations).
    fileParallelism: false,
  },
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/lib/__tests__/integration/**'],
        },
      },
      integrationProject,
    ],
  },
});
