CREATE TABLE "loan_words" (
	"entry_id" integer PRIMARY KEY,
	"word" text,
	"verdict" jsonb,
	"answers" jsonb NOT NULL,
	"trap" text,
	"model" text NOT NULL,
	"questions_version" integer NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sense_notes" (
	"entry_id" integer,
	"sense" integer,
	"note" text,
	"note_ja" text,
	"model" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sense_notes_pkey" PRIMARY KEY("entry_id","sense")
);
--> statement-breakpoint
ALTER TABLE "senses" ADD COLUMN "sources" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ADD COLUMN "wasei" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sense_nuance" ADD COLUMN "questions_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_words" ADD CONSTRAINT "loan_words_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sense_notes" ADD CONSTRAINT "sense_notes_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;