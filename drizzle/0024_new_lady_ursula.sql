CREATE TYPE "public"."project_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" text NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"description" text,
	"instructions" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "project_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_project_id_user_id_pk" PRIMARY KEY("project_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_owner" ON "project" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_project_one_default_per_owner" ON "project" USING btree ("owner_user_id") WHERE "project"."is_default" = true;--> statement-breakpoint
CREATE INDEX "idx_project_member_user" ON "project_member" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_session_project" ON "agent_session" USING btree ("project_id");