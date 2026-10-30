ALTER TYPE "form_kind" ADD VALUE 'spelling';--> statement-breakpoint
ALTER TYPE "form_kind" ADD VALUE 'inflection';--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "language" "language" DEFAULT 'ja'::"language" NOT NULL;--> statement-breakpoint
DROP INDEX "entries_priority";--> statement-breakpoint
CREATE INDEX "entries_priority" ON "entries" ("language","priority" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "forms_folded" ON "forms" (lower("text"));