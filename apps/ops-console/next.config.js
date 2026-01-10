/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    // This repo uses a shared ESLint config not tailored for Next.js yet.
    // Avoid blocking builds on lint until Next-specific ESLint config is adopted.
    ignoreDuringBuilds: true
  },
  experimental: {
    typedRoutes: true
  }
};

module.exports = nextConfig;

