import type { MetadataRoute } from 'next';
import { productPath } from '@lastsize/contracts';
import { getCategories, getSitemapData } from '@/server/api';
import { serverEnv } from '@/server/env';

/** Public pages in both languages: catalog sections, stores and products. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = serverEnv.NEXT_PUBLIC_SITE_URL;
  const [data, categories] = await Promise.all([getSitemapData(), getCategories()]);
  const entry = (
    path: string,
    lastModified?: string,
    priority?: number,
  ): MetadataRoute.Sitemap[number] => ({
    url: `${site}${path}`,
    lastModified,
    priority,
    alternates: {
      languages: { ru: `${site}${path}`, kk: `${site}/kk${path === '/' ? '' : path}` },
    },
  });
  return [
    entry('/', undefined, 1),
    entry('/catalog', undefined, 0.9),
    ...['women', 'men', 'kids'].map((gender) => entry(`/catalog/${gender}`, undefined, 0.8)),
    ...categories
      .flatMap((root) => [root, ...root.children])
      .map((category) => entry(`/catalog/${category.slug}`, undefined, 0.7)),
    ...data.stores.map((store) => entry(`/store/${store.slug}`, store.updatedAt, 0.6)),
    ...data.products.map((product) => entry(productPath(product), product.updatedAt, 0.5)),
  ];
}

// Regenerated every 10 minutes, never at build time (the API is not reachable then).
export const revalidate = 600;
export const dynamic = 'force-dynamic';
