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
      {
        source: '/:path*',
        headers: [
          // CSP to protect voiceprint data from XSS extraction
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.euron.one https://api.openweathermap.org https://maps.googleapis.com https://api.duckduckgo.com https://html.duckduckgo.com; media-src 'self' blob:; img-src 'self' data: blob:; worker-src 'self' blob:;",
          },
        ],
      },
    ];
  },
};
module.exports = nextConfig;
