CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "document" tsvector GENERATED ALWAYS AS (to_tsvector('english', "forms"."text")) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "forms_document" ON "forms" USING gin ("document");--> statement-breakpoint
CREATE INDEX "forms_trgm" ON "forms" USING gin ("text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "glosses_trgm" ON "glosses" USING gin ("norm" gin_trgm_ops);
