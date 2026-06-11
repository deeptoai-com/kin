CREATE TABLE "rag_search_trace" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"query" text NOT NULL,
	"params" jsonb,
	"visible_doc_count" integer,
	"vector_ids" jsonb,
	"bm25_ids" jsonb,
	"fused_ids" jsonb,
	"reranked_ids" jsonb,
	"returned_ids" jsonb,
	"degraded" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_rag_search_trace_user" ON "rag_search_trace" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_rag_search_trace_created" ON "rag_search_trace" USING btree ("created_at");