-- IF NOT EXISTS on purpose: the shared dev DB gets this column applied by hand before
-- the migrate container ever runs 0029 (local runs use AUTO_MIGRATE=false) — same
-- pattern as the 0023 fix. Additive nullable column, safe for older app images.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "page_map" jsonb;
