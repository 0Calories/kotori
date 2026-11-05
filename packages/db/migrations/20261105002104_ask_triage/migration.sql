CREATE TYPE "proposal_route" AS ENUM('lookup', 'sentence', 'name', 'other_language', 'garbage');--> statement-breakpoint
ALTER TYPE "coach_kind" ADD VALUE 'triage';--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "route" "proposal_route";--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "triage" jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "contested" boolean DEFAULT false NOT NULL;