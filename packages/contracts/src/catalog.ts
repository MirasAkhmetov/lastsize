import { z } from 'zod';

export interface Category {
  id: number;
  slug: string;
  name: { ru: string; kk: string };
  sizeChart: string | null;
  children: Category[];
}

export const categorySchema: z.ZodType<Category> = z.lazy(() =>
  z.object({
    id: z.number().int(),
    slug: z.string(),
    name: z.object({ ru: z.string(), kk: z.string() }),
    sizeChart: z.string().nullable(),
    children: z.array(categorySchema),
  }),
);

export const categoryTreeSchema = z.array(categorySchema);
