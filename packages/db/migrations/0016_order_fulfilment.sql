CREATE TYPE "public"."refund_method" AS ENUM('CASH', 'KASPI', 'CARD');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('ACCEPTED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "return_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "return_status" NOT NULL,
	"reason" text,
	"refund_method" "refund_method",
	"processed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "return_items_quantity_positive" CHECK ("return_items"."quantity" > 0),
	CONSTRAINT "return_items_decision" CHECK (("return_items"."status" = 'ACCEPTED' AND "return_items"."refund_method" IS NOT NULL) OR ("return_items"."status" = 'REJECTED' AND "return_items"."reason" IS NOT NULL))
);
--> statement-breakpoint
DROP INDEX "seller_orders_expiry_idx";--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "courier_tracking_url" text;--> statement-breakpoint
ALTER TABLE "seller_orders" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "return_items_order_item_idx" ON "return_items" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "seller_orders_expiry_idx" ON "seller_orders" USING btree ("expires_at") WHERE "seller_orders"."status" IN ('NEW', 'READY_FOR_PICKUP');