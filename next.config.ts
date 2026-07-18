import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  distDir: 'build',
  /* config options here */
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
