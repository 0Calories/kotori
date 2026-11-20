DROP TABLE "entry_audio";--> statement-breakpoint
DROP TABLE "example_audio";--> statement-breakpoint
DROP TABLE "jobs";--> statement-breakpoint
CREATE INDEX "audio_language_text" ON "audio" ("language","text");--> statement-breakpoint
DROP TYPE "job_kind";--> statement-breakpoint
DROP TYPE "job_status";--> statement-breakpoint
DROP TYPE "cast_by";--> statement-breakpoint
DELETE FROM "examples" WHERE "source" = 'kotori';--> statement-breakpoint
UPDATE "examples" SET "formality" = NULL, "casting" = NULL WHERE "formality" IS NOT NULL OR "casting" IS NOT NULL;--> statement-breakpoint
DELETE FROM "cautions" WHERE "source" = 'kotori' AND "entry_id" IN (SELECT "id" FROM "entries" WHERE "source" <> 'kotori');--> statement-breakpoint
DELETE FROM "labels" WHERE "source" = 'kotori' AND "entry_id" IN (SELECT "id" FROM "entries" WHERE "source" <> 'kotori');--> statement-breakpoint
DELETE FROM "usage_patterns" WHERE "source" = 'kotori' AND "entry_id" IN (SELECT "id" FROM "entries" WHERE "source" <> 'kotori');--> statement-breakpoint
DELETE FROM "loan_links" WHERE "source" = 'kotori';--> statement-breakpoint
UPDATE "loan_links" SET "meaning" = NULL, "meaning_source" = NULL WHERE "meaning_source" = 'kotori';
