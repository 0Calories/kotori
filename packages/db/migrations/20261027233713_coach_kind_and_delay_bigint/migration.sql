CREATE TYPE "coach_kind" AS ENUM('naturalness', 'how-to-say', 'speak');--> statement-breakpoint
ALTER TABLE "coach_usage" ALTER COLUMN "kind" SET DATA TYPE "coach_kind" USING "kind"::"coach_kind";--> statement-breakpoint
ALTER TABLE "review_logs" ALTER COLUMN "delay_ms" SET DATA TYPE bigint USING "delay_ms"::bigint;