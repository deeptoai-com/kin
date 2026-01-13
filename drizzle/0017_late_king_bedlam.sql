ALTER TABLE "user" ADD COLUMN "system_role" text DEFAULT 'user' NOT NULL;

-- Add check constraint
ALTER TABLE "user" ADD CONSTRAINT "user_system_role_check" CHECK (system_role IN ('admin', 'user'));

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS "idx_user_system_role" ON "user"(system_role);

-- Add comment
COMMENT ON COLUMN "user".system_role IS 'System-level role: admin (系统管理员) | user (普通用户)';
