-- Drafted entries live in the dictionary (ADR 0002), and a note is a dictionary entry.
--
-- Entries gain a review state; every entry so far was imported or approved.
CREATE TYPE "entry_review" AS ENUM('unreviewed', 'approved', 'discarded');--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "review" "entry_review" DEFAULT 'approved'::"entry_review" NOT NULL;--> statement-breakpoint
CREATE INDEX "entries_drafts" ON "entries" ("id") WHERE "review" <> 'approved';--> statement-breakpoint
-- Proposals point at the entry they answered with; a draft's standing is that entry's review state.
--   pending    its draft was never an entry: the proposal goes (with its asks), and the next ask
--              drafts it again, this time as an entry.
--   approved   drafted, naming the entry approval made (gone with that entry: the proposal goes too).
--   discarded  rejected, without the admin's words (meant for the admin, not the learner), so the
--              query stays turned down.
ALTER TABLE "proposals" RENAME COLUMN "linked_entry_id" TO "entry_id";--> statement-breakpoint
ALTER TABLE "proposals" RENAME CONSTRAINT "proposals_linked_entry_id_entries_id_fkey" TO "proposals_entry_id_entries_id_fkey";--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DELETE FROM "proposals" WHERE "status" = 'pending' OR ("status" = 'approved' AND "entry_id" IS NULL);--> statement-breakpoint
UPDATE "proposals" SET "status" = 'drafted' WHERE "status" = 'approved';--> statement-breakpoint
UPDATE "proposals" SET "status" = 'rejected', "reason" = NULL WHERE "status" = 'discarded';--> statement-breakpoint
DROP TYPE "proposal_status";--> statement-breakpoint
CREATE TYPE "proposal_status" AS ENUM('drafted', 'linked', 'rejected');--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "status" SET DATA TYPE "proposal_status" USING "status"::"proposal_status";--> statement-breakpoint
ALTER TABLE "proposals" DROP COLUMN "draft";--> statement-breakpoint
CREATE INDEX "proposals_entry" ON "proposals" ("entry_id");--> statement-breakpoint
-- Notes become one per learner and entry, read from the entry rather than frozen at save time.
-- Phrase notes have no entry and go, as do word notes whose entry went; their review logs cascade.
DELETE FROM "notes" WHERE "kind" = 'phrase' OR "entry_id" IS NULL;--> statement-breakpoint
-- A learner's notes on senses of one entry merge into one showing just those senses, in the
-- dictionary's order. The note furthest along keeps its schedule and takes the others' review logs.
ALTER TABLE "notes" ADD COLUMN "senses" integer[];--> statement-breakpoint
UPDATE "notes" AS n
SET "senses" = g."senses"
FROM (
  SELECT "user_id", "entry_id", array_agg(DISTINCT "sense" ORDER BY "sense") FILTER (WHERE "sense" IS NOT NULL) AS "senses"
  FROM "notes"
  GROUP BY "user_id", "entry_id"
) AS g
WHERE n."user_id" = g."user_id" AND n."entry_id" = g."entry_id";--> statement-breakpoint
CREATE TEMPORARY TABLE "merged_notes" AS
SELECT "id", first_value("id") OVER (PARTITION BY "user_id", "entry_id" ORDER BY "reps" DESC, "created_at", "id") AS "keep"
FROM "notes";--> statement-breakpoint
UPDATE "review_logs" AS l
SET "note_id" = m."keep"
FROM "merged_notes" AS m
WHERE l."note_id" = m."id" AND m."id" <> m."keep";--> statement-breakpoint
DELETE FROM "notes" AS n USING "merged_notes" AS m WHERE n."id" = m."id" AND m."id" <> m."keep";--> statement-breakpoint
DROP TABLE "merged_notes";--> statement-breakpoint
DROP INDEX "notes_word";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "content";--> statement-breakpoint
ALTER TABLE "notes" DROP COLUMN "sense";--> statement-breakpoint
DROP TYPE "note_kind";--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "entry_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT "notes_entry_id_entries_id_fkey", ADD CONSTRAINT "notes_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "notes_entry" ON "notes" ("user_id","entry_id");--> statement-breakpoint
CREATE INDEX "notes_entry_id" ON "notes" ("entry_id");
