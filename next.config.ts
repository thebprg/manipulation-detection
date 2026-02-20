import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Increase API route timeout for video processing
  serverExternalPackages: ['@deepgram/sdk'],
  
  // Configure for Vercel deployment
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  
  // Configure API routes
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
    ];
  },
};

export default nextConfig;
