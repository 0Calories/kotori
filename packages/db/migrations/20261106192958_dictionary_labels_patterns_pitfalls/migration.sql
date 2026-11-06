CREATE TYPE "source" AS ENUM('jmdict', 'jawiktionary', 'enwiktionary', 'tatoeba', 'kotori', 'user');--> statement-breakpoint
CREATE TYPE "pitfall_kind" AS ENUM('rude_upward', 'keigo_direction', 'set_phrase', 'particle_pattern', 'gendered_speech', 'false_friend', 'textbook_english', 'directness', 'variety', 'confusable', 'collocation');--> statement-breakpoint
CREATE TYPE "loan_meaning" AS ENUM('same', 'divergent');--> statement-breakpoint
CREATE TABLE "labels" (
	"entry_id" integer,
	"sense" integer,
	"code" text,
	"source" "source" NOT NULL,
	CONSTRAINT "labels_pkey" PRIMARY KEY("entry_id","sense","code")
);
--> statement-breakpoint
CREATE TABLE "patterns" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "patterns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" integer NOT NULL,
	"sense" integer NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"source" "source" NOT NULL,
	"about_entry_id" integer
);
--> statement-breakpoint
CREATE TABLE "pitfalls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pitfalls_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" integer NOT NULL,
	"sense" integer,
	"rank" smallint NOT NULL,
	"kind" "pitfall_kind" NOT NULL,
	"text" text NOT NULL,
	"about_entry_id" integer,
	"source" "source" NOT NULL,
	CONSTRAINT "pitfalls_rank" UNIQUE("entry_id","rank"),
	CONSTRAINT "pitfalls_rank_range" CHECK ("rank" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "usage_evidence" (
	"entry_id" integer PRIMARY KEY,
	"everyday" boolean DEFAULT false NOT NULL,
	"spoken_count" integer,
	"familiarity" smallint
);
--> statement-breakpoint
CREATE TABLE "loan_links" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "loan_links_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"katakana" text NOT NULL,
	"katakana_entry_id" integer,
	"english" text NOT NULL,
	"english_entry_id" integer,
	"meaning" "loan_meaning",
	"source" "source" NOT NULL,
	CONSTRAINT "loan_links_pair" UNIQUE("katakana","english")
);
--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "source" "source" DEFAULT 'kotori'::"source" NOT NULL;--> statement-breakpoint
ALTER TABLE "examples" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "patterns_sense" ON "patterns" ("entry_id","sense","position");--> statement-breakpoint
CREATE INDEX "loan_links_katakana_entry" ON "loan_links" ("katakana_entry_id");--> statement-breakpoint
CREATE INDEX "loan_links_english_entry" ON "loan_links" ("english_entry_id");--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "patterns" ADD CONSTRAINT "patterns_about_entry_id_entries_id_fkey" FOREIGN KEY ("about_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "patterns" ADD CONSTRAINT "patterns_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pitfalls" ADD CONSTRAINT "pitfalls_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pitfalls" ADD CONSTRAINT "pitfalls_about_entry_id_entries_id_fkey" FOREIGN KEY ("about_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "pitfalls" ADD CONSTRAINT "pitfalls_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "usage_evidence" ADD CONSTRAINT "usage_evidence_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "loan_links" ADD CONSTRAINT "loan_links_katakana_entry_id_entries_id_fkey" FOREIGN KEY ("katakana_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "loan_links" ADD CONSTRAINT "loan_links_english_entry_id_entries_id_fkey" FOREIGN KEY ("english_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;