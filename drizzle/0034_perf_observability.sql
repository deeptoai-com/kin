CREATE TABLE "perf_metric_hourly" (
	"id" text PRIMARY KEY NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"metric" text NOT NULL,
	"route" text,
	"model" text,
	"scenario" text DEFAULT 'runtime' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"avg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"p50" numeric(18, 3) DEFAULT '0' NOT NULL,
	"p95" numeric(18, 3) DEFAULT '0' NOT NULL,
	"max" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "perf_sample" (
	"id" text PRIMARY KEY NOT NULL,
	"metric" text NOT NULL,
	"value" numeric(18, 3) NOT NULL,
	"unit" text DEFAULT 'ms' NOT NULL,
	"route" text,
	"user_id" text,
	"session_id" text,
	"model" text,
	"scenario" text DEFAULT 'runtime' NOT NULL,
	"run_id" text,
	"attrs" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "perf_hourly_bucket_metric_idx" ON "perf_metric_hourly" USING btree ("bucket_start","metric");--> statement-breakpoint
CREATE INDEX "perf_hourly_metric_idx" ON "perf_metric_hourly" USING btree ("metric");--> statement-breakpoint
CREATE INDEX "perf_sample_metric_created_idx" ON "perf_sample" USING btree ("metric","created_at");--> statement-breakpoint
CREATE INDEX "perf_sample_created_at_idx" ON "perf_sample" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "perf_sample_scenario_idx" ON "perf_sample" USING btree ("scenario");