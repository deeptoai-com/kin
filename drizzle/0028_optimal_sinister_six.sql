ALTER TABLE "documents" ADD COLUMN "parse_method" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "parse_status" text DEFAULT 'ready' NOT NULL;