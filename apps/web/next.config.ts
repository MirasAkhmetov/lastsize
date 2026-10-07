import path from 'node:path';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Content Security Policy for the storefront. Pages are statically generated for speed and SEO,
 * so per-request nonces are not available; inline scripts emitted by Next.js are allowed, while
 * everything else is locked down: no foreign scripts, frames, plugins or form targets.
 * The primary XSS defence remains React's escaping of all rendered data.
 */
const isDev = process.env.NODE_ENV === 'development';
// Before the domain is bought the site runs over plain HTTP by IP; upgrading would break every asset.
const servedOverHttps = (process.env.NEXT_PUBLIC_SITE_URL ?? '').startsWith('https://');

const contentSecurityPolicy = [
  "default-src 'self'",
  // React needs eval() for debugging features in development only; production never uses it.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(servedOverHttps ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  output: 'standalone',
  // Trace dependencies from the monorepo root so the standalone bundle includes workspace packages.
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@lastsize/ui'],
  poweredByHeader: false,
  reactStrictMode: true,
  // Source maps are never shipped to browsers: no backend or business code is exposed.
  productionBrowserSourceMaps: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  /**
   * The browser always talks to its own origin. In production Caddy routes /api to the API
   * before requests reach Next.js; in development this rewrite does the same.
   */
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default withNextIntl(config);
