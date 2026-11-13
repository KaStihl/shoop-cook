import type { NextConfig } from 'next';

// NEXT_PUBLIC_STATIC=1 builds the server-less version for GitHub Pages (see scripts/build-static.mjs).
const isStatic = process.env.NEXT_PUBLIC_STATIC === '1';

const config: NextConfig = {
  serverExternalPackages: ['playwright'],
  eslint: { ignoreDuringBuilds: true },
  ...(isStatic
    ? { output: 'export' as const, distDir: 'out', basePath: process.env.NEXT_PUBLIC_BASE_PATH || '', trailingSlash: true, images: { unoptimized: true } }
    : {}),
};

export default config;
