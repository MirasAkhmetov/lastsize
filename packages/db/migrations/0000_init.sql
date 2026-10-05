CREATE TYPE "public"."locale" AS ENUM('ru', 'kk');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('ACTIVE', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."store_member_role" AS ENUM('SELLER', 'SELLER_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'BLOCKED');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('WOMEN', 'MEN', 'UNISEX', 'KIDS');--> statement-breakpoint
CREATE TYPE "public"."product_condition" AS ENUM('NEW');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('DRAFT', 'ACTIVE', 'HIDDEN', 'FLAGGED', 'REMOVED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."inventory_transaction_type" AS ENUM('RESERVE', 'RELEASE', 'COMMIT', 'ADJUST', 'SYNC', 'RETURN');--> statement-breakpoint
CREATE TYPE "public"."price_change_source" AS ENUM('SELLER', 'IMPORT', 'ADMIN');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"device_token_hash" text NOT NULL,
	"name" text,
	"phone" text,
	"locale" "locale" DEFAULT 'ru' NOT NULL,
	"linked_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_code" text NOT NULL,
	"permission_code" text NOT NULL,
	CONSTRAINT "role_permissions_role_code_permission_code_pk" PRIMARY KEY("role_code","permission_code")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_code" text NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_code_pk" PRIMARY KEY("user_id","role_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"status" "user_status" DEFAULT 'ACTIVE' NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"telegram_user_id" bigint,
	"totp_secret_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_e164" CHECK ("users"."phone" ~ '^\+[1-9][0-9]{7,14}$')
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" smallint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_kk" text NOT NULL,
	CONSTRAINT "cities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "store_locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"city_id" smallint NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"schedule" jsonb NOT NULL,
	"phone" text NOT NULL,
	"pickup_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_locations_coordinates" CHECK (("store_locations"."latitude" IS NULL) = ("store_locations"."longitude" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "store_members" (
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "store_member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_members_store_id_user_id_pk" PRIMARY KEY("store_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"bin_iin" text NOT NULL,
	"status" "store_status" DEFAULT 'PENDING_VERIFICATION' NOT NULL,
	"description" text,
	"logo_key" text,
	"cover_key" text,
	"instagram" text,
	"commission_rate" numeric(5, 4) DEFAULT '0' NOT NULL,
	"rating" numeric(3, 2),
	"verified_at" timestamp with time zone,
	"verified_by" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_bin_iin_format" CHECK ("stores"."bin_iin" ~ '^[0-9]{12}$'),
	CONSTRAINT "stores_slug_format" CHECK ("stores"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "stores_commission_rate_range" CHECK ("stores"."commission_rate" >= 0 AND "stores"."commission_rate" < 1)
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" smallint PRIMARY KEY NOT NULL,
	"parent_id" smallint,
	"slug" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_kk" text NOT NULL,
	"size_chart_id" smallint,
	"position" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "categories_slug_format" CHECK ("categories"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "colors" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_kk" text NOT NULL,
	"hex" text,
	CONSTRAINT "colors_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"color_id" smallint,
	"storage_key" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"position" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"product_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"article" text,
	"barcode" text,
	"size_value_id" smallint,
	"color_id" smallint,
	"original_price" bigint NOT NULL,
	"sale_price" bigint NOT NULL,
	"reference_price" bigint,
	"external_price" bigint,
	"discount_percent" smallint GENERATED ALWAYS AS (((least(original_price, coalesce(reference_price, original_price), coalesce(external_price, original_price)) - sale_price) * 100 / least(original_price, coalesce(reference_price, original_price), coalesce(external_price, original_price)))::smallint) STORED NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_variants_sale_price_positive" CHECK ("product_variants"."sale_price" > 0),
	CONSTRAINT "product_variants_sale_below_original" CHECK ("product_variants"."sale_price" <= "product_variants"."original_price"),
	CONSTRAINT "product_variants_reference_positive" CHECK ("product_variants"."reference_price" IS NULL OR "product_variants"."reference_price" > 0),
	CONSTRAINT "product_variants_external_positive" CHECK ("product_variants"."external_price" IS NULL OR "product_variants"."external_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"short_id" text NOT NULL,
	"store_id" uuid NOT NULL,
	"brand_id" uuid,
	"category_id" smallint NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"composition" text,
	"gender" "gender" NOT NULL,
	"condition" "product_condition" DEFAULT 'NEW' NOT NULL,
	"status" "product_status" DEFAULT 'DRAFT' NOT NULL,
	"removed_reason" text,
	"removed_by" uuid,
	"removed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_short_id_format" CHECK ("products"."short_id" ~ '^[0-9a-z]{8}$'),
	CONSTRAINT "products_slug_format" CHECK ("products"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "products_removed_has_reason" CHECK ("products"."status" <> 'REMOVED' OR ("products"."removed_reason" IS NOT NULL AND "products"."removed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "size_charts" (
	"id" smallint PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ru" text NOT NULL,
	"name_kk" text NOT NULL,
	CONSTRAINT "size_charts_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "size_values" (
	"id" smallint PRIMARY KEY NOT NULL,
	"chart_id" smallint NOT NULL,
	"code" text NOT NULL,
	"position" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"available" integer GENERATED ALWAYS AS (quantity - reserved) STORED NOT NULL,
	"stock_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_variant_id_location_id_pk" PRIMARY KEY("variant_id","location_id"),
	CONSTRAINT "inventory_quantity_non_negative" CHECK ("inventory"."quantity" >= 0),
	CONSTRAINT "inventory_reserved_range" CHECK ("inventory"."reserved" >= 0 AND "inventory"."reserved" <= "inventory"."quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"type" "inventory_transaction_type" NOT NULL,
	"quantity_delta" integer NOT NULL,
	"reserved_delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reserved_after" integer NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"variant_id" uuid NOT NULL,
	"original_price" bigint NOT NULL,
	"sale_price" bigint NOT NULL,
	"source" "price_change_source" NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_linked_user_id_users_id_fk" FOREIGN KEY ("linked_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "public"."permissions"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_code_roles_code_fk" FOREIGN KEY ("role_code") REFERENCES "public"."roles"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_locations" ADD CONSTRAINT "store_locations_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_size_chart_id_size_charts_id_fk" FOREIGN KEY ("size_chart_id") REFERENCES "public"."size_charts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_color_id_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."colors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_size_value_id_size_values_id_fk" FOREIGN KEY ("size_value_id") REFERENCES "public"."size_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_color_id_colors_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."colors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "size_values" ADD CONSTRAINT "size_values_chart_id_size_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."size_charts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_location_id_store_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."store_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_device_token_hash_key" ON "customers" USING btree ("device_token_hash");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_telegram_user_id_key" ON "users" USING btree ("telegram_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_locations_store_id_key" ON "store_locations" USING btree ("store_id");--> statement-breakpoint
CREATE INDEX "store_members_user_id_idx" ON "store_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stores_slug_key" ON "stores" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "stores_status_idx" ON "stores" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_slug_key" ON "brands" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_name_key" ON "brands" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "categories_parent_slug_key" ON "categories" USING btree (coalesce("parent_id", 0),"slug");--> statement-breakpoint
CREATE UNIQUE INDEX "product_images_product_position_key" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_store_sku_key" ON "product_variants" USING btree ("store_id","sku");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_product_size_color_key" ON "product_variants" USING btree ("product_id",coalesce("size_value_id", 0),coalesce("color_id", 0));--> statement-breakpoint
CREATE INDEX "product_variants_product_id_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_short_id_key" ON "products" USING btree ("short_id");--> statement-breakpoint
CREATE INDEX "products_store_id_idx" ON "products" USING btree ("store_id","status");--> statement-breakpoint
CREATE INDEX "products_category_active_idx" ON "products" USING btree ("category_id","published_at" DESC NULLS LAST) WHERE "products"."status" IN ('ACTIVE', 'FLAGGED');--> statement-breakpoint
CREATE UNIQUE INDEX "size_values_chart_code_key" ON "size_values" USING btree ("chart_id","code");--> statement-breakpoint
CREATE INDEX "inventory_transactions_variant_idx" ON "inventory_transactions" USING btree ("variant_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_transactions_ref_idx" ON "inventory_transactions" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "price_history_variant_idx" ON "price_history" USING btree ("variant_id","created_at");