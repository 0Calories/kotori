CREATE TYPE "review_state" AS ENUM('approved', 'unreviewed', 'discarded');--> statement-breakpoint
CREATE TYPE "entry_search_kind" AS ENUM('form', 'gloss');--> statement-breakpoint
CREATE TABLE "entry_search" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "entry_search_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" text NOT NULL,
	"kind" "entry_search_kind" NOT NULL,
	"language" "language" NOT NULL,
	"review_state" "review_state" DEFAULT 'approved'::"review_state" NOT NULL,
	"common" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"form_kind" "form_kind",
	"text" text COLLATE "C" NOT NULL,
	"folded" text COLLATE "C",
	"norm" text,
	"sense" integer,
	"position" integer,
	"gloss_count" integer,
	"tags" text[],
	"misc" text[],
	"cjk_tokens" text[]
);
--> statement-breakpoint
ALTER TABLE "glosses" DROP CONSTRAINT "glosses_entry_id_sense_senses_entry_id_position_fkey";--> statement-breakpoint
ALTER TABLE "examples" DROP CONSTRAINT "examples_entry_id_sense_senses_entry_id_position_fkey";--> statement-breakpoint
ALTER TABLE "labels" DROP CONSTRAINT "labels_entry_id_sense_senses_entry_id_position_fkey";--> statement-breakpoint
ALTER TABLE "usage_patterns" DROP CONSTRAINT "usage_patterns_entry_id_sense_senses_entry_id_position_fkey";--> statement-breakpoint
ALTER TABLE "cautions" DROP CONSTRAINT "cautions_entry_id_sense_senses_entry_id_position_fkey";--> statement-breakpoint
DROP TABLE "forms";--> statement-breakpoint
DROP TABLE "glosses";--> statement-breakpoint
DROP TABLE "senses";--> statement-breakpoint
DROP TABLE "examples";--> statement-breakpoint
DROP TABLE "labels";--> statement-breakpoint
DROP TABLE "usage_patterns";--> statement-breakpoint
DROP TABLE "cautions";--> statement-breakpoint
DROP TABLE "entry_frequency";--> statement-breakpoint
DROP TABLE "loan_links";--> statement-breakpoint
ALTER TABLE "notes" DROP CONSTRAINT "notes_entry_id_entries_id_fkey";--> statement-breakpoint
ALTER TABLE "proposals" DROP CONSTRAINT "proposals_linked_entry_id_entries_id_fkey";--> statement-breakpoint
UPDATE "notes" SET "entry_id" = NULL;--> statement-breakpoint
UPDATE "proposals" SET "linked_entry_id" = NULL;--> statement-breakpoint
DELETE FROM "entries";--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "review_state" "review_state" DEFAULT 'approved'::"review_state" NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "redirect_to" text;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "base" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "enrichment" jsonb;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" ADD COLUMN "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "entries" DROP COLUMN "headword";--> statement-breakpoint
ALTER TABLE "entries" DROP COLUMN "reading";--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "id" SET DATA TYPE text USING "id"::text;--> statement-breakpoint
ALTER TABLE "notes" ALTER COLUMN "entry_id" SET DATA TYPE text USING "entry_id"::text;--> statement-breakpoint
ALTER TABLE "proposals" ALTER COLUMN "linked_entry_id" SET DATA TYPE text USING "linked_entry_id"::text;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_linked_entry_id_entries_id_fkey" FOREIGN KEY ("linked_entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX "entries_review_state" ON "entries" ("review_state");--> statement-breakpoint
CREATE INDEX "entry_search_entry_id" ON "entry_search" ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_search_form_text" ON "entry_search" ("text") WHERE "kind" = 'form' AND "language" = 'ja';--> statement-breakpoint
CREATE INDEX "entry_search_form_folded" ON "entry_search" ("folded") WHERE "kind" = 'form' AND "language" = 'en';--> statement-breakpoint
CREATE INDEX "entry_search_form_doc" ON "entry_search" USING gin ((coalesce(nullif(to_tsvector('english', "text"), ''::tsvector), to_tsvector('simple', "text")))) WHERE "kind" = 'form' AND "language" = 'en' AND "form_kind" = 'spelling';--> statement-breakpoint
CREATE INDEX "entry_search_form_trgm" ON "entry_search" USING gin ("text" gin_trgm_ops) WHERE "kind" = 'form' AND "language" = 'en' AND "form_kind" = 'spelling';--> statement-breakpoint
CREATE INDEX "entry_search_gloss_norm" ON "entry_search" ("language","norm") WHERE "kind" = 'gloss';--> statement-breakpoint
CREATE INDEX "entry_search_gloss_doc" ON "entry_search" USING gin ((coalesce(nullif(to_tsvector('english', "text"), ''::tsvector), to_tsvector('simple', "text")))) WHERE "kind" = 'gloss' AND "language" = 'ja';--> statement-breakpoint
CREATE INDEX "entry_search_gloss_trgm" ON "entry_search" USING gin ("norm" gin_trgm_ops) WHERE "kind" = 'gloss';--> statement-breakpoint
CREATE INDEX "entry_search_cjk_tokens" ON "entry_search" USING gin ("cjk_tokens") WHERE "kind" = 'gloss' AND "language" = 'en';--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_redirect_to_entries_id_fkey" FOREIGN KEY ("redirect_to") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "entry_search" ADD CONSTRAINT "entry_search_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
DROP TYPE "caution_kind";--> statement-breakpoint
DROP TYPE "loan_meaning";