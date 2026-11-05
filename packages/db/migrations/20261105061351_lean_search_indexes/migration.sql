-- Takes the place of 20261104182830_stopword_phrases, which re-added the stored `document` columns and
-- so rewrote both tables: production never applied it, and dev databases may have. Either way this ends
-- in the same schema, and it rewrites no table: dropping a column only marks it dropped, and old indexes
-- go before the new, smaller ones are built.
DROP INDEX IF EXISTS "forms_document";--> statement-breakpoint
DROP INDEX IF EXISTS "glosses_document";--> statement-breakpoint
DROP INDEX IF EXISTS "forms_trgm";--> statement-breakpoint
DROP INDEX IF EXISTS "forms_folded";--> statement-breakpoint
ALTER TABLE "forms" DROP COLUMN IF EXISTS "document";--> statement-breakpoint
ALTER TABLE "glosses" DROP COLUMN IF EXISTS "document";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forms_folded" ON "forms" (lower("text")) WHERE "kind" IN ('spelling', 'inflection');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forms_trgm" ON "forms" USING gin ("text" gin_trgm_ops) WHERE "kind" = 'spelling';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forms_document" ON "forms" USING gin ((coalesce(nullif(to_tsvector('english', "text"), ''::tsvector), to_tsvector('simple', "text")))) WHERE "kind" = 'spelling';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "glosses_document" ON "glosses" USING gin ((coalesce(nullif(to_tsvector('english', "text"), ''::tsvector), to_tsvector('simple', "text")))) WHERE ("entry_id" < 100000000 OR "entry_id" >= 200000000);
