CREATE TABLE "update_status" (
	"id" text PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"image" text,
	"current_sha" text,
	"latest_sha" text,
	"latest_digest" text,
	"update_available" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone,
	"error" text
);
