// Integration-harness setup file — runs INSIDE the Workers runtime (workerd)
// once per test file, before any test in src/lib/__tests__/integration/ runs.
//
// It applies every D1 migration that `readD1Migrations` collected from the
// wrangler.toml `migrations_dir` at config-load time (carried here through the
// `virtual:d1-migrations` module). `applyD1Migrations` records state in the
// `d1_migrations` table — the same tracking table `wrangler d1 migrations
// apply` uses — so re-running is idempotent and only un-applied files run.
//
// The migration set is NOT hard-coded: new `*.sql` files dropped into
// src/db/migrations/ are picked up automatically on the next run.

import { applyD1Migrations } from 'cloudflare:test';
import { env as runtimeEnv } from 'cloudflare:workers';
import type { Env } from '../../../types';
import migrations from 'virtual:d1-migrations';

/** The worker's real bindings, cast to the app's `Env` interface. */
export const env: Env = runtimeEnv as unknown as Env;

await applyD1Migrations(env.D1_DATABASE, migrations);
