import type { MetadataRoute } from 'next';
import { serverEnv } from '@/server/env';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/seller/',
          '/kk/seller/',
          '/cart',
          '/favorites',
          '/account',
          '/design',
        ],
      },
    ],
    sitemap: `${serverEnv.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
  };
}
