CREATE UNIQUE INDEX "product_images_product_media_key" ON "product_images" USING btree ("product_id","media_id");--> statement-breakpoint
ALTER TABLE "product_images" DROP COLUMN "storage_key";--> statement-breakpoint
ALTER TABLE "product_images" DROP COLUMN "width";--> statement-breakpoint
ALTER TABLE "product_images" DROP COLUMN "height";