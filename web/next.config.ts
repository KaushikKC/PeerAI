import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Proxy /api/* → the local deai-node daemon at port 4002
  // This avoids CORS issues when the browser talks to the daemon.
  async rewrites() {
    return [
      {
        source:      '/api/daemon/:path*',
        destination: 'http://localhost:4002/:path*',
      },
    ];
  },
};

export default nextConfig;
