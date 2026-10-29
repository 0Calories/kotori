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
ALTER TABLE "sense_notes" ADD CONSTRAINT "sense_notes_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;