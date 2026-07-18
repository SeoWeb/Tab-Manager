import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'build',
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
