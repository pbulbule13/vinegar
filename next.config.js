/** @type {import('next').NextConfig} */
const nextConfig = {
  // Security headers + CORS for LAN access
  async headers() {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://192.168.1.15:8080';
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: allowedOrigin },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
