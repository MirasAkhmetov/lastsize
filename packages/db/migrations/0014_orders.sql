CREATE TYPE "public"."fulfillment_type" AS ENUM('PICKUP', 'DELIVERY');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('UNPAID', 'PAID_TO_SELLER');--> statement-breakpoint
CREATE TYPE "public"."seller_order_status" AS ENUM('NEW', 'CONFIRMED', 'READY_FOR_PICKUP', 'COURIER_REQUESTED', 'HANDED_TO_COURIER', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE SEQUENCE "public"."order_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 10001 CACHE 1;--> statement-breakpoint
CREATE TABLE "cart_items" (
	"customer_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"price_snapshot" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_customer_id_variant_id_pk" PRIMARY KEY("customer_id","variant_id"),
	CONSTRAINT "cart_items_quantity_range" CHECK ("cart_items"."quantity" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_short_id" text NOT NULL,
	"product_slug" text NOT NULL,
	"title" text NOT NULL,
	"brand" text,
	"sku" text NOT NULL,
	"size" text,
	"color_id" integer,
	"image_key" text,
	"original_price" bigint NOT NULL,
	"unit_price" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_prices_positive" CHECK ("order_items"."unit_price" > 0 AND "order_items"."original_price" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" bigint DEFAULT nextval('order_number_seq') NOT NULL,
	"customer_id" uuid NOT NULL,
	"contact_name" text NOT NULL,
	"contact_phone" text NOT NULL,
	"access_token_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"items_total" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"seller_order_id" uuid NOT NULL,
	"from_status" "seller_order_status",
	"to_status" "seller_order_status" NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"status" "seller_order_status" DEFAULT 'NEW' NOT NULL,
	"fulfillment" "fulfillment_type" NOT NULL,
	"payment_status" "payment_status" DEFAULT 'UNPAID' NOT NULL,
	"location_snapshot" jsonb NOT NULL,
	"delivery_address" text,
	"delivery_comment" text,
	"courier_fee" bigint,
	"items_total" bigint NOT NULL,
	"platform_fee" bigint DEFAULT 0 NOT NULL,
	"cancel_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_orders_delivery_address" CHECK ("seller_orders"."fulfillment" = 'PICKUP' OR "seller_orders"."delivery_address" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "store_locations" ADD COLUMN "delivery_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_order_status_history" ADD CONSTRAINT "seller_order_status_history_seller_order_id_seller_orders_id_fk" FOREIGN KEY ("seller_order_id") REFERENCES "public"."seller_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_items_seller_order_idx" ON "order_items" USING btree ("seller_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_key" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_customer_idempotency_key" ON "orders" USING btree ("customer_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_phone_idx" ON "orders" USING btree ("contact_phone");--> statement-breakpoint
CREATE INDEX "seller_order_status_history_order_idx" ON "seller_order_status_history" USING btree ("seller_order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "seller_orders_order_store_key" ON "seller_orders" USING btree ("order_id","store_id");--> statement-breakpoint
CREATE INDEX "seller_orders_store_idx" ON "seller_orders" USING btree ("store_id","status","created_at");--> statement-breakpoint
CREATE INDEX "seller_orders_expiry_idx" ON "seller_orders" USING btree ("expires_at") WHERE "seller_orders"."status" = 'NEW';