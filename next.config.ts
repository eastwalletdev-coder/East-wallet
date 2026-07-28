import type { NextConfig } from 'next';

// Telegram Mini Apps are loaded inside an iframe on web.telegram.org, so we
// can't use a blanket X-Frame-Options: DENY/SAMEORIGIN — frame-ancestors in
// the CSP below does the same job while still allowing Telegram to embed us.
const csp = [
  "default-src 'self'",
  // 'unsafe-inline' is still needed here for Next.js's hydration script and
  // this codebase's inline style={{}} usage — this header is a baseline
  // (blocks arbitrary third-party script/frame injection), not a fully
  // strict CSP. Tightening further to a nonce-based policy is a separate,
  // bigger change that needs real device testing before shipping.
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self' https: wss:",
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
          // Camera stays enabled (self) for the QR scanner; everything else off.
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
