/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Maxxortho: in self-hosted mode skip the marketing page and billing screens.
  async redirects() {
    if (process.env.NEXT_PUBLIC_SELF_HOSTED !== 'true') return [];
    return [
      { source: '/', destination: '/dashboard', permanent: false },
      { source: '/dashboard/billing/:path*', destination: '/dashboard', permanent: false },
    ];
  },
};

module.exports = nextConfig;