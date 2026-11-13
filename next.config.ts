import type { NextConfig } from 'next';

const config: NextConfig = {
  serverExternalPackages: ['playwright'],
  eslint: { ignoreDuringBuilds: true },
};

export default config;
