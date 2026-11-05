CREATE TYPE "proposal_status" AS ENUM('pending', 'linked', 'rejected', 'approved', 'discarded');--> statement-breakpoint
ALTER TYPE "coach_kind" ADD VALUE 'ask';--> statement-breakpoint
CREATE TABLE "proposal_asks" (
	"proposal_id" integer,
	"user_id" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_asks_pkey" PRIMARY KEY("proposal_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "proposals_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"language" "language" NOT NULL,
	"query" text NOT NULL,
	"status" "proposal_status" NOT NULL,
	"draft" jsonb,
	"linked_entry_id" integer,
	"reason" text,
	"model" text NOT NULL,
	"requested_by" uuid,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp(3) with time zone,
	CONSTRAINT "proposals_query" UNIQUE("language","query")
);
--> statement-breakpoint
CREATE INDEX "proposal_asks_user" ON "proposal_asks" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "proposals_status" ON "proposals" ("status","created_at");--> statement-breakpoint
ALTER TABLE "proposal_asks" ADD CONSTRAINT "proposal_asks_proposal_id_proposals_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "proposal_asks" ADD CONSTRAINT "proposal_asks_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_linked_entry_id_entries_id_fkey" FOREIGN KEY ("linked_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_requested_by_users_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE SET NULL;