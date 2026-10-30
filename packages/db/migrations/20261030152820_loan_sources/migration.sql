ALTER TABLE "senses" ADD COLUMN "sources" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ADD COLUMN "wasei" boolean DEFAULT false NOT NULL;