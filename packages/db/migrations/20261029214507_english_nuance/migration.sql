CREATE TABLE "english_nuance" (
	"entry_id" integer,
	"sense" integer,
	"nuance" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"loan_word" text,
	"loan_trap" text,
	"model" text NOT NULL,
	"questions_version" integer NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "english_nuance_pkey" PRIMARY KEY("entry_id","sense")
);
--> statement-breakpoint
ALTER TABLE "english_nuance" ADD CONSTRAINT "english_nuance_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;