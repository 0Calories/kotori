CREATE TYPE "source" AS ENUM('jmdict', 'jawiktionary', 'enwiktionary', 'tatoeba', 'kotori', 'user');--> statement-breakpoint
CREATE TYPE "caution_kind" AS ENUM('rude_upward', 'keigo_direction', 'set_phrase', 'particle_pattern', 'gendered_speech', 'wasei_eigo', 'textbook_english', 'directness', 'variety', 'confusable', 'collocation');--> statement-breakpoint
CREATE TYPE "loan_meaning" AS ENUM('true_loanword', 'wasei_eigo');--> statement-breakpoint
CREATE TABLE "labels" (
	"entry_id" integer,
	"sense" integer,
	"code" text,
	"source" "source" NOT NULL,
	CONSTRAINT "labels_pkey" PRIMARY KEY("entry_id","sense","code")
);
--> statement-breakpoint
CREATE TABLE "usage_patterns" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "usage_patterns_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" integer NOT NULL,
	"sense" integer NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"source" "source" NOT NULL,
	"about_entry_id" integer
);
--> statement-breakpoint
CREATE TABLE "cautions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cautions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" integer NOT NULL,
	"sense" integer,
	"rank" smallint NOT NULL,
	"kind" "caution_kind" NOT NULL,
	"text" text NOT NULL,
	"about_entry_id" integer,
	"source" "source" NOT NULL,
	CONSTRAINT "cautions_rank" UNIQUE("entry_id","rank"),
	CONSTRAINT "cautions_rank_range" CHECK ("rank" BETWEEN 1 AND 3)
);
--> statement-breakpoint
CREATE TABLE "entry_frequency" (
	"entry_id" integer PRIMARY KEY,
	"everyday" boolean DEFAULT false NOT NULL,
	"spoken_count" integer,
	"score" smallint
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
-- Existing rows are backfilled from their id ranges (see `entries.ts`); English words get a
-- placeholder that the next `kotori seed` corrects to the source each one came from.
ALTER TABLE "entries" ADD COLUMN "source" "source";--> statement-breakpoint
UPDATE "entries" SET "source" = CASE
  WHEN "id" >= 200000000 THEN 'kotori'::"source"
  WHEN "id" >= 100000000 THEN 'enwiktionary'::"source"
  ELSE 'jmdict'::"source"
END;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "source" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ADD COLUMN "origins" jsonb;--> statement-breakpoint
UPDATE "senses" SET "origins" = (
  SELECT jsonb_agg(jsonb_build_object('language', 'eng', 'word', s))
  FROM unnest("sources") AS s
) WHERE "sources" IS NOT NULL AND cardinality("sources") > 0;--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "source" "source" DEFAULT 'kotori'::"source" NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" DROP COLUMN "sources";--> statement-breakpoint
ALTER TABLE "examples" ALTER COLUMN "formality" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "examples" ALTER COLUMN "model" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "usage_patterns_sense" ON "usage_patterns" ("entry_id","sense","position");--> statement-breakpoint
CREATE INDEX "usage_patterns_about" ON "usage_patterns" ("about_entry_id") WHERE "about_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cautions_about" ON "cautions" ("about_entry_id") WHERE "about_entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "loan_links_katakana_entry" ON "loan_links" ("katakana_entry_id");--> statement-breakpoint
CREATE INDEX "loan_links_english_entry" ON "loan_links" ("english_entry_id");--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "usage_patterns" ADD CONSTRAINT "usage_patterns_about_entry_id_entries_id_fkey" FOREIGN KEY ("about_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "usage_patterns" ADD CONSTRAINT "usage_patterns_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cautions" ADD CONSTRAINT "cautions_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cautions" ADD CONSTRAINT "cautions_about_entry_id_entries_id_fkey" FOREIGN KEY ("about_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cautions" ADD CONSTRAINT "cautions_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_frequency" ADD CONSTRAINT "entry_frequency_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "loan_links" ADD CONSTRAINT "loan_links_katakana_entry_id_entries_id_fkey" FOREIGN KEY ("katakana_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "loan_links" ADD CONSTRAINT "loan_links_english_entry_id_entries_id_fkey" FOREIGN KEY ("english_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;