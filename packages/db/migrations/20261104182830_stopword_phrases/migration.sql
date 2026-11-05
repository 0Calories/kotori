ALTER TABLE "glosses" DROP COLUMN "document";--> statement-breakpoint
ALTER TABLE "glosses" ADD COLUMN "document" tsvector GENERATED ALWAYS AS (CASE WHEN length(to_tsvector('english', "glosses"."text")) = 0 THEN to_tsvector('simple', "glosses"."text") ELSE to_tsvector('english', "glosses"."text") END) STORED;--> statement-breakpoint
ALTER TABLE "forms" DROP COLUMN "document";--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "document" tsvector GENERATED ALWAYS AS (CASE WHEN length(to_tsvector('english', "forms"."text")) = 0 THEN to_tsvector('simple', "forms"."text") ELSE to_tsvector('english', "forms"."text") END) STORED;--> statement-breakpoint
CREATE INDEX "glosses_document" ON "glosses" USING gin ("document");--> statement-breakpoint
CREATE INDEX "forms_document" ON "forms" USING gin ("document");