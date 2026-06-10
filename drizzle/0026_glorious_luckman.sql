ALTER TABLE "document_chunks" ALTER COLUMN "embedding" SET DATA TYPE vector(1024);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "document_id" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "section_path" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_start" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "page_end" integer;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "parent_chunk_id" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "context_prefix" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ingest_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "ingest_progress" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "token_estimate" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "rag_tier" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "toc" jsonb;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "embed_model" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "embed_dim" integer;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_parent_chunk_id_document_chunks_id_fk" FOREIGN KEY ("parent_chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_bases" ADD CONSTRAINT "knowledge_bases_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_chunks_document" ON "document_chunks" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_content_hash" ON "document_chunks" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_document_chunks_embedding_hnsw" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_documents_project" ON "documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_documents_user" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_knowledge_bases_project" ON "knowledge_bases" USING btree ("project_id");