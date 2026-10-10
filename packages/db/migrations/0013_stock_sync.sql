CREATE TYPE "public"."sync_run_status" AS ENUM('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('SCHEDULE', 'MANUAL', 'STOCK_CHANGE');--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"integration_id" uuid NOT NULL,
	"trigger" "sync_trigger" NOT NULL,
	"status" "sync_run_status" DEFAULT 'RUNNING' NOT NULL,
	"pulled" integer DEFAULT 0 NOT NULL,
	"pushed" integer DEFAULT 0 NOT NULL,
	"conflicts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "sync_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "last_sync_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_runs_integration_idx" ON "sync_runs" USING btree ("integration_id","started_at");