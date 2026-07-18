import type { NextConfig } from 'next';

/**
 * Web (Cloudflare Pages) Next.js config.
 *
 * Differs from the extension's next.config.ts in two ways:
 *  - `experimental.externalDir` lets us import the extension source from
 *    `../src` (required for the shadowing to reach the real files).
 *  - `env.NEXT_PUBLIC_IS_WEB` exposes a clean build-time flag for components
 *    that need to branch between extension and web behaviour.
 *
 * It deliberately omits everything the extension's `post-build.js` +
 * `scripts/build-background.mjs` do (manifest copy, `_next/` → `./next/`
 * rewriting, CSP injection, background service-worker bundling): none of that
 * applies to a static web export.
 */
const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'build',
  images: {
    unoptimized: true,
  },
  experimental: {
    // Required to import TypeScript/TSX from outside this project's root
    // (the extension source under ../src).
    externalDir: true,
  },
  env: {
    NEXT_PUBLIC_IS_WEB: '1',
  },
};

export default nextConfig;
