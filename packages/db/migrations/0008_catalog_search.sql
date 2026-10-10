-- Substring search for the storefront ("air max", "найк", part of an article) on the fields
-- buyers type. Trigram indexes keep ILIKE '%…%' fast on tens of thousands of products.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX products_title_trgm_idx ON products USING gin (lower(title) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX brands_name_trgm_idx ON brands USING gin (lower(name) gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX product_variants_article_trgm_idx ON product_variants USING gin (lower(coalesce(article, '') || ' ' || sku) gin_trgm_ops);
--> statement-breakpoint
-- Public catalog: only published products of verified stores are read, newest first.
CREATE INDEX products_public_published_idx ON products (published_at DESC, id)
  WHERE status IN ('ACTIVE', 'FLAGGED');
--> statement-breakpoint
CREATE INDEX product_variants_size_active_idx ON product_variants (size_value_id, product_id) WHERE is_active;
