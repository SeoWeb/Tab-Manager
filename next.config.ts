import type { NextConfig } from 'next';

// Debug-only routes (`src/app/debug-favicons/page.debug.tsx`,
// `src/app/favicon-migration/page.debug.tsx`) are excluded from production
// builds: their `page.debug.tsx` extension only resolves to a route while
// `debug.tsx` is listed in `pageExtensions` below.
//
// Commands:
// - Production build (debug routes excluded): `pnpm run build`
// - Static build WITH debug routes:           `INCLUDE_DEBUG_ROUTES=1 pnpm run build`
// - Dev server WITH debug routes:             `INCLUDE_DEBUG_ROUTES=1 pnpm exec next dev`
const includeDebugRoutes = process.env.INCLUDE_DEBUG_ROUTES === '1';

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'build',
  pageExtensions: includeDebugRoutes
    ? ['tsx', 'ts', 'jsx', 'js', 'debug.tsx']
    : ['tsx', 'ts', 'jsx', 'js'],
  env: {
    // Inlined into every bundle at build time (DefinePlugin): the client-side
    // link to the debug-only /favicon-migration route
    // (src/components/views/SettingsView.tsx) is dead-branch-eliminated from
    // production bundles when the flag is unset.
    INCLUDE_DEBUG_ROUTES: process.env.INCLUDE_DEBUG_ROUTES ?? '',
  },
  /* config options here */
  images: {
    unoptimized: true,
  },
  eslint: {
    // Linting is handled by the standalone `eslint .` step in the build script,
    // so skip Next.js's built-in (legacy) ESLint pass to avoid a duplicate run
    // and its "Next.js plugin was not detected" flat-config warning.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
