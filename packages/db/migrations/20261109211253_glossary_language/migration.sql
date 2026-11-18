-- Folds each note's review schedule, which lived in "cards", into the note itself, and renames
-- tag labels to names. Nothing a learner saved or reviewed is lost: schedules and review logs
-- move to their note. Destructive only in that "cards" and its ids go away.

ALTER TABLE "tags" RENAME COLUMN "label" TO "name";--> statement-breakpoint

-- Retention stage, not queue.
ALTER TYPE "card_queue" RENAME TO "retention_stage";--> statement-breakpoint
ALTER TABLE "review_logs" RENAME COLUMN "queue_before" TO "retention_stage_before";--> statement-breakpoint

-- A note carries its own schedule. The three columns without a default stay nullable until filled.
ALTER TABLE "notes" ADD COLUMN "retention_stage" "retention_stage" DEFAULT 'new'::"retention_stage" NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "due" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "interval" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "ease" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "step" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "reps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "lapses" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "leech" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "last_review" timestamp(3) with time zone;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "seed" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "position" integer;--> statement-breakpoint

-- Each note has one card since the reverse cards were dropped; should one have more, the
-- 'recognize' card (first in the enum) is the one kept, and any reviews of discarded cards go away
-- with them so they don't mix into the kept schedule's history.
DELETE FROM "review_logs"
WHERE "card_id" NOT IN (
  SELECT DISTINCT ON ("note_id") "id" FROM "cards" ORDER BY "note_id", "template", "created_at", "id"
);--> statement-breakpoint
UPDATE "notes" SET
  "retention_stage" = c."queue",
  "due" = c."due",
  "interval" = c."interval",
  "ease" = c."ease",
  "step" = c."step",
  "reps" = c."reps",
  "lapses" = c."lapses",
  "leech" = c."leech",
  "last_review" = c."last_review",
  "seed" = c."seed",
  "position" = c."position"
FROM (
  SELECT DISTINCT ON ("note_id") * FROM "cards" ORDER BY "note_id", "template", "created_at", "id"
) c
WHERE c."note_id" = "notes"."id";--> statement-breakpoint

-- A note that never had a card starts as new, due when it was saved, after the user's others.
UPDATE "notes" SET
  "due" = "notes"."created_at",
  "seed" = floor(random() * 2147483647)::integer,
  "position" = f."position"
FROM (
  SELECT
    x."id",
    coalesce((SELECT max(m."position") FROM "notes" m WHERE m."user_id" = x."user_id"), -1)
      + row_number() OVER (PARTITION BY x."user_id" ORDER BY x."created_at", x."id") AS "position"
  FROM "notes" x
  WHERE x."due" IS NULL
) f
WHERE f."id" = "notes"."id";--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "due" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "seed" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "notes_due" ON "notes" ("user_id","retention_stage","due");--> statement-breakpoint

-- A review is of a note.
ALTER TABLE "review_logs" ADD COLUMN "note_id" uuid;--> statement-breakpoint
UPDATE "review_logs" SET "note_id" = c."note_id" FROM "cards" c WHERE c."id" = "review_logs"."card_id";--> statement-breakpoint
ALTER TABLE "review_logs" ALTER COLUMN "note_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_logs" DROP COLUMN "card_id";--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_note_id_notes_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP TABLE "cards";--> statement-breakpoint
DROP TYPE "card_template";
