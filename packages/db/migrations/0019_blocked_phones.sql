CREATE TABLE "blocked_phones" (
	"phone" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"blocked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
