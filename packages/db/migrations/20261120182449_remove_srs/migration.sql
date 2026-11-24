DROP TABLE "review_logs";--> statement-breakpoint
DROP INDEX "notes_word";--> statement-breakpoint
DROP INDEX "notes_due";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "sense";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "retention_stage";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "due";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "interval";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "ease";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "step";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "reps";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "lapses";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "leech";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "last_review";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "seed";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "position";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "daily_new_limit";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "daily_review_limit";--> statement-breakpoint
DELETE FROM "notes" WHERE "entry_id" IS NULL;--> statement-breakpoint
DELETE FROM "notes" AS a USING "notes" AS b WHERE a."user_id" = b."user_id" AND a."entry_id" = b."entry_id" AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "entry_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_entry" ON "notes" ("user_id","entry_id");--> statement-breakpoint
CREATE INDEX "notes_entry_id" ON "notes" ("entry_id");--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT "notes_entry_id_entries_id_fkey", ADD CONSTRAINT "notes_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP TYPE "retention_stage";--> statement-breakpoint
DROP TYPE "note_kind";--> statement-breakpoint
DROP TYPE "rating";