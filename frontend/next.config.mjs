import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {import('next').NextConfig} */
const FASTAPI_URL = process.env.FASTAPI_BACKEND_URL || 'http://127.0.0.1:8000';
const OMNIPOST_URL = process.env.OMNIPOST_BACKEND_URL || 'http://127.0.0.1:3000';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: __dirname,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.ytimg.com',
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${FASTAPI_URL}/api/v1/:path*`,
      },
      {
        source: '/clips/:path*',
        destination: `${FASTAPI_URL}/clips/:path*`,
      },
      {
        source: '/assets/:path*',
        destination: `${FASTAPI_URL}/assets/:path*`,
      },
      {
        source: '/api/omnipost/:path*',
        destination: `${OMNIPOST_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
