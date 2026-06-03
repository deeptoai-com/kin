CREATE TYPE "public"."skill_category" AS ENUM('ai_engineering', 'research', 'writing', 'design_frontend', 'automation', 'learning', 'security');--> statement-breakpoint
CREATE TYPE "public"."skill_level" AS ENUM('L1', 'L2', 'L3', 'L4', 'L5');--> statement-breakpoint
CREATE TYPE "public"."skill_reusability" AS ENUM('ready', 'minor_adaptation', 'major_adaptation', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."skill_schema_status" AS ENUM('missing', 'valid', 'stale', 'failed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."skill_scope" AS ENUM('official', 'user');--> statement-breakpoint
CREATE TYPE "public"."skill_source" AS ENUM('curated', 'upstream', 'builtin');--> statement-breakpoint
CREATE TABLE "skill_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"title_zh" text,
	"summary_zh" text,
	"category" "skill_category",
	"level" "skill_level",
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reusability_status" "skill_reusability",
	"suitable_for_zh" text,
	"problem_zh" text,
	"first_task_zh" text,
	"risk_notes_zh" text,
	"icon_emoji" text,
	"sort_weight" integer DEFAULT 0 NOT NULL,
	"adds_count" text,
	"source" "skill_source" DEFAULT 'curated' NOT NULL,
	"upstream" jsonb,
	"install_command" text,
	"github_url" text,
	"skills_sh_url" text,
	"source_label" text,
	"source_icon" text,
	"scope" "skill_scope" DEFAULT 'official' NOT NULL,
	"owner_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_content_cache" (
	"catalog_id" uuid PRIMARY KEY NOT NULL,
	"skill_md" text,
	"files" jsonb,
	"content_hash" text,
	"upstream_scraped_at" text,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "skill_enablement" (
	"user_id" text NOT NULL,
	"catalog_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_enablement_user_id_catalog_id_pk" PRIMARY KEY("user_id","catalog_id")
);
--> statement-breakpoint
CREATE TABLE "skill_schema_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"catalog_id" uuid NOT NULL,
	"content_hash" text NOT NULL,
	"schema" jsonb,
	"status" "skill_schema_status" DEFAULT 'missing' NOT NULL,
	"generator_version" text,
	"last_error" text,
	"generated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "skill_catalog" ADD CONSTRAINT "skill_catalog_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_content_cache" ADD CONSTRAINT "skill_content_cache_catalog_id_skill_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."skill_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_enablement" ADD CONSTRAINT "skill_enablement_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_enablement" ADD CONSTRAINT "skill_enablement_catalog_id_skill_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."skill_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_schema_cache" ADD CONSTRAINT "skill_schema_cache_catalog_id_skill_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."skill_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_skill_catalog_official_slug" ON "skill_catalog" USING btree ("slug") WHERE scope = 'official';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_skill_catalog_user_slug" ON "skill_catalog" USING btree ("owner_user_id","slug") WHERE scope = 'user';--> statement-breakpoint
CREATE INDEX "idx_skill_catalog_category" ON "skill_catalog" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_skill_catalog_sort" ON "skill_catalog" USING btree ("sort_weight");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_skill_schema_catalog_hash" ON "skill_schema_cache" USING btree ("catalog_id","content_hash");