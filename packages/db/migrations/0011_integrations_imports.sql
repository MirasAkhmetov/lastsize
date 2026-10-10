CREATE TYPE "public"."import_mapping_kind" AS ENUM('CATEGORY', 'COLOR', 'SIZE');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('READY', 'NEEDS_ATTENTION', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('WILDBERRIES', 'KASPI_XML', 'FILE');--> statement-breakpoint
CREATE TYPE "public"."integration_provider" AS ENUM('WILDBERRIES', 'KASPI_XML');--> statement-breakpoint
CREATE TYPE "public"."integration_status" AS ENUM('ACTIVE', 'ERROR');--> statement-breakpoint
CREATE TABLE "external_listings" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"integration_id" uuid NOT NULL,
	"external_product_id" text NOT NULL,
	"external_size_id" text,
	"barcode" text,
	"last_external_stock" integer,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"created_by" uuid,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_mappings" (
	"store_id" uuid NOT NULL,
	"kind" "import_mapping_kind" NOT NULL,
	"source_value" text NOT NULL,
	"target_id" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_mappings_store_id_kind_source_value_pk" PRIMARY KEY("store_id","kind","source_value")
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"job_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"external_id" text NOT NULL,
	"data" jsonb NOT NULL,
	"category_id" smallint,
	"gender" "gender",
	"color_id" smallint,
	"size_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"original_price" bigint,
	"sale_price" bigint,
	"external_price" bigint,
	"status" "import_row_status" DEFAULT 'NEEDS_ATTENTION' NOT NULL,
	"issues" text[] DEFAULT '{}'::text[] NOT NULL,
	"product_id" uuid,
	"media_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_credentials" (
	"integration_id" uuid PRIMARY KEY NOT NULL,
	"ciphertext" text NOT NULL,
	"fingerprint" text NOT NULL,
	"key_version" smallint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"store_id" uuid NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"status" "integration_status" DEFAULT 'ACTIVE' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_listings" ADD CONSTRAINT "external_listings_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_listings_integration_idx" ON "external_listings" USING btree ("integration_id","external_product_id");--> statement-breakpoint
CREATE INDEX "import_jobs_store_idx" ON "import_jobs" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "import_rows_job_position_key" ON "import_rows" USING btree ("job_id","position");--> statement-breakpoint
CREATE INDEX "import_rows_job_status_idx" ON "import_rows" USING btree ("job_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_store_provider_key" ON "integrations" USING btree ("store_id","provider");