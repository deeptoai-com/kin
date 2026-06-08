-- 0023 REPAIR: re-journal the P13 message_attachment table.
--
-- Background: two migrations were both generated as `0018` on different branches
-- (0018_acoustic_shinko_yamashiro = P2-1 usage record, 0018_helpful_red_skull =
-- P13 message_attachment). Only the `acoustic` tag made it into meta/_journal.json,
-- so `0018_helpful_red_skull.sql` was orphaned and `message_attachment` was never
-- created by `drizzle-kit migrate` — even though the meta snapshots (0018+) already
-- model the table. Result: createMessageAttachment() failed at runtime (relation
-- does not exist), swallowed by a try/catch, so uploaded-file chips never rendered.
--
-- This migration re-applies the table creation as a proper journaled tail entry.
-- It is idempotent (IF NOT EXISTS) so it is a safe no-op where the table already exists.
CREATE TABLE IF NOT EXISTS "message_attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"session_id" uuid NOT NULL,
	"message_id" text NOT NULL,
	"original_name" text NOT NULL,
	"file_path" text NOT NULL,
	"mime_type" text,
	"file_size" integer,
	"uploaded" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone,
	"referenced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "idx_message_attachment_session" ON "message_attachment"("session_id");
CREATE INDEX IF NOT EXISTS "idx_message_attachment_message" ON "message_attachment"("message_id");
CREATE INDEX IF NOT EXISTS "idx_message_attachment_session_message" ON "message_attachment"("session_id", "message_id");
