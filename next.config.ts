import type { NextConfig } from 'next';

// Telegram Mini Apps embed us; Login Widget embeds oauth.telegram.org in an iframe.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://telegram.org https://*.telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https: blob:",
  "connect-src 'self' https: wss:",
  // REQUIRED for Telegram Login Widget (iframe) — without this the gray box stays empty
  "frame-src 'self' https://oauth.telegram.org https://telegram.org https://*.telegram.org",
  "child-src 'self' https://oauth.telegram.org https://telegram.org",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/trustwallet/assets/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
