ALTER TABLE "english_nuance" ADD COLUMN "gloss" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "english_nuance" DROP CONSTRAINT "english_nuance_pkey";--> statement-breakpoint
ALTER TABLE "english_nuance" ADD PRIMARY KEY ("entry_id","sense","gloss");