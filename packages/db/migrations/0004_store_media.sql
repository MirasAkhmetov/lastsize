CREATE TABLE "store_media" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"uploaded_by" uuid,
	"base_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_media_base_key_unique" UNIQUE("base_key")
);
--> statement-breakpoint
ALTER TABLE "product_images" ADD COLUMN "media_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "flag_reason" text;--> statement-breakpoint
ALTER TABLE "store_media" ADD CONSTRAINT "store_media_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_media" ADD CONSTRAINT "store_media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "store_media_store_idx" ON "store_media" USING btree ("store_id","created_at");--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_id_store_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."store_media"("id") ON DELETE no action ON UPDATE no action;