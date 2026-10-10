-- Category slugs become URL paths (/catalog/shoes), so they must be unique across the tree.
-- "Туфли" shared the slug "shoes" with the "Обувь" root.
UPDATE categories SET slug = 'classic-shoes' WHERE slug = 'shoes' AND parent_id IS NOT NULL;
