-- P13: Message Attachment Persistence
-- Links user-uploaded attachments to specific chat messages
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

-- Index for finding all attachments in a session
CREATE INDEX IF NOT EXISTS "idx_message_attachment_session" ON "message_attachment"("session_id");

-- Index for finding all attachments for a message
CREATE INDEX IF NOT EXISTS "idx_message_attachment_message" ON "message_attachment"("message_id");

-- Compound index for session + message lookup
CREATE INDEX IF NOT EXISTS "idx_message_attachment_session_message" ON "message_attachment"("session_id", "message_id");

-- Add comments
COMMENT ON TABLE "message_attachment" IS 'Links user-uploaded attachments to chat messages (P13)';
COMMENT ON COLUMN "message_attachment"."id" IS 'Primary key UUID';
COMMENT ON COLUMN "message_attachment"."session_id" IS 'Reference to agent session (cascade delete)';
COMMENT ON COLUMN "message_attachment"."message_id" IS 'Message UUID from chat';
COMMENT ON COLUMN "message_attachment"."original_name" IS 'Original file name as uploaded';
COMMENT ON COLUMN "message_attachment"."file_path" IS 'File path relative to workspace root';
COMMENT ON COLUMN "message_attachment"."mime_type" IS 'MIME type of the file';
COMMENT ON COLUMN "message_attachment"."file_size" IS 'File size in bytes';
COMMENT ON COLUMN "message_attachment"."uploaded" IS 'Whether file was successfully uploaded';
COMMENT ON COLUMN "message_attachment"."uploaded_at" IS 'When the file was uploaded';
COMMENT ON COLUMN "message_attachment"."referenced" IS 'Whether file has been referenced by agent';
