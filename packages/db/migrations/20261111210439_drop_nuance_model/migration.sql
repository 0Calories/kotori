-- The old enrichment model goes (dictionary enrichment, phase 7): Jev's per-sense nuance, its
-- similar words, English words' katakana loan verdicts and warnings, and Claude's sense notes.
-- Nothing is carried into labels, cautions or loan links: none of it was evaluated, and inference
-- comes back only through reviewed, eval-gated passes. The nuance job kind goes with its table, so
-- its queued and finished jobs are deleted before the enum loses the value.
DROP TABLE "sense_nuance";--> statement-breakpoint
DROP TABLE "similar_words";--> statement-breakpoint
DROP TABLE "loan_words";--> statement-breakpoint
DROP TABLE "sense_notes";--> statement-breakpoint
DELETE FROM "jobs" WHERE "kind" = 'nuance';--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "job_kind";--> statement-breakpoint
CREATE TYPE "job_kind" AS ENUM('examples', 'audio');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "kind" SET DATA TYPE "job_kind" USING "kind"::"job_kind";--> statement-breakpoint
DROP TYPE "difference";
