CREATE TYPE "public"."model_auth_style" AS ENUM('bearer', 'x-api-key');--> statement-breakpoint
CREATE TYPE "public"."model_health_status" AS ENUM('healthy', 'unhealthy', 'unknown');--> statement-breakpoint
CREATE TABLE "model_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"base_url" text NOT NULL,
	"auth_style" "model_auth_style" DEFAULT 'bearer' NOT NULL,
	"token_env" text NOT NULL,
	"anthropic_version" text DEFAULT '2023-06-01' NOT NULL,
	"custom_headers" jsonb,
	"alias_opus" text,
	"alias_sonnet" text,
	"alias_haiku" text,
	"alias_subagent" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"connection_id" text NOT NULL,
	"model" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_health" (
	"model_id" text PRIMARY KEY NOT NULL,
	"health" "model_health_status" DEFAULT 'unknown' NOT NULL,
	"last_probe_at" timestamp with time zone,
	"probe_error" text,
	"latency_ms" integer
);
--> statement-breakpoint
ALTER TABLE "model_definition" ADD CONSTRAINT "model_definition_connection_id_model_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."model_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_health" ADD CONSTRAINT "model_health_model_id_model_definition_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."model_definition"("id") ON DELETE cascade ON UPDATE no action;