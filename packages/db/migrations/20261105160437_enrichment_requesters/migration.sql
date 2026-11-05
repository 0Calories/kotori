ALTER TYPE "coach_kind" ADD VALUE 'enrich';--> statement-breakpoint
ALTER TABLE "audio" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "requested_by" uuid;--> statement-breakpoint
CREATE INDEX "audio_user" ON "audio" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "audio" ADD CONSTRAINT "audio_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL;