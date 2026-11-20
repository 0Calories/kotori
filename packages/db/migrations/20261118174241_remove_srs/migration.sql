DROP TABLE "review_logs";--> statement-breakpoint
DROP INDEX "notes_due";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "timezone";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "daily_new_limit";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "daily_review_limit";--> statement-breakpoint
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
ALTER TABLE "notes" DROP COLUMN "senses";--> statement-breakpoint
DROP TYPE "retention_stage";--> statement-breakpoint
DROP TYPE "rating";