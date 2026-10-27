CREATE TYPE "form_kind" AS ENUM('kanji', 'kana');--> statement-breakpoint
CREATE TYPE "difference" AS ENUM('more_casual', 'more_formal', 'more_literary', 'more_colloquial', 'respectful', 'humble', 'more_specific', 'more_general', 'different_feeling', 'different_usage');--> statement-breakpoint
CREATE TYPE "formality" AS ENUM('vulgar', 'casual', 'neutral', 'polite', 'formal');--> statement-breakpoint
CREATE TYPE "job_kind" AS ENUM('nuance', 'examples', 'audio');--> statement-breakpoint
CREATE TYPE "job_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "language" AS ENUM('en', 'ja');--> statement-breakpoint
CREATE TYPE "account_status" AS ENUM('pending', 'approved', 'archived');--> statement-breakpoint
CREATE TYPE "card_queue" AS ENUM('new', 'learning', 'review', 'relearning');--> statement-breakpoint
CREATE TYPE "card_template" AS ENUM('recognize', 'produce');--> statement-breakpoint
CREATE TYPE "note_kind" AS ENUM('word', 'phrase');--> statement-breakpoint
CREATE TYPE "rating" AS ENUM('again', 'hard', 'good', 'easy');--> statement-breakpoint
CREATE TYPE "user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "entries" (
	"id" integer PRIMARY KEY,
	"headword" text NOT NULL,
	"reading" text NOT NULL,
	"common" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forms" (
	"entry_id" integer,
	"kind" "form_kind",
	"position" integer,
	"text" text COLLATE "C" NOT NULL,
	"common" boolean DEFAULT false NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"priorities" text[] DEFAULT '{}'::text[] NOT NULL,
	"restrictions" text[] DEFAULT '{}'::text[] NOT NULL,
	"no_kanji" boolean DEFAULT false NOT NULL,
	CONSTRAINT "forms_pkey" PRIMARY KEY("entry_id","kind","position")
);
--> statement-breakpoint
CREATE TABLE "glosses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "glosses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" integer NOT NULL,
	"sense" integer NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL,
	"type" text,
	"norm" text NOT NULL,
	"document" tsvector GENERATED ALWAYS AS (to_tsvector('english', "glosses"."text")) STORED NOT NULL
);
--> statement-breakpoint
CREATE TABLE "senses" (
	"entry_id" integer,
	"position" integer,
	"pos" text[] DEFAULT '{}'::text[] NOT NULL,
	"misc" text[] DEFAULT '{}'::text[] NOT NULL,
	"fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"dialects" text[] DEFAULT '{}'::text[] NOT NULL,
	"info" text[] DEFAULT '{}'::text[] NOT NULL,
	"stagk" text[] DEFAULT '{}'::text[] NOT NULL,
	"stagr" text[] DEFAULT '{}'::text[] NOT NULL,
	"xrefs" text[] DEFAULT '{}'::text[] NOT NULL,
	"antonyms" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "senses_pkey" PRIMARY KEY("entry_id","position")
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"code" text PRIMARY KEY,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio" (
	"key" text PRIMARY KEY,
	"text" text NOT NULL,
	"language" "language" NOT NULL,
	"voice_id" text NOT NULL,
	"model_id" text NOT NULL,
	"characters" integer NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_files" (
	"key" text PRIMARY KEY,
	"data" bytea NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_audio" (
	"entry_id" integer PRIMARY KEY,
	"audio_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "example_audio" (
	"example_id" integer,
	"language" "language",
	"audio_key" text NOT NULL,
	CONSTRAINT "example_audio_pkey" PRIMARY KEY("example_id","language")
);
--> statement-breakpoint
CREATE TABLE "examples" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "examples_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"entry_id" integer NOT NULL,
	"sense" integer NOT NULL,
	"position" integer NOT NULL,
	"ja" text NOT NULL,
	"furigana" text NOT NULL,
	"en" text NOT NULL,
	"formality" "formality" NOT NULL,
	"note" text,
	"model" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" "job_kind" NOT NULL,
	"entry_id" integer NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"status" "job_status" DEFAULT 'queued'::"job_status" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"run_after" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_kind_entry" UNIQUE("kind","entry_id")
);
--> statement-breakpoint
CREATE TABLE "sense_nuance" (
	"entry_id" integer,
	"sense" integer,
	"nuance" jsonb NOT NULL,
	"answers" jsonb NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sense_nuance_pkey" PRIMARY KEY("entry_id","sense")
);
--> statement-breakpoint
CREATE TABLE "similar_words" (
	"entry_id" integer,
	"sense" integer,
	"similar_id" integer,
	"similarity" double precision NOT NULL,
	"difference" "difference" NOT NULL,
	"confidence" double precision NOT NULL,
	CONSTRAINT "similar_words_pkey" PRIMARY KEY("entry_id","sense","similar_id")
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"note_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"template" "card_template" NOT NULL,
	"queue" "card_queue" DEFAULT 'new'::"card_queue" NOT NULL,
	"due" timestamp(3) with time zone NOT NULL,
	"interval" integer DEFAULT 0 NOT NULL,
	"ease" double precision DEFAULT 0 NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"reps" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"leech" boolean DEFAULT false NOT NULL,
	"last_review" timestamp(3) with time zone,
	"seed" integer NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_cache" (
	"key" text PRIMARY KEY,
	"result" jsonb NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coach_usage" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "coach_usage_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"kind" "note_kind" NOT NULL,
	"content" jsonb NOT NULL,
	"entry_id" integer,
	"sense" integer,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_logs" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "review_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"card_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" "rating" NOT NULL,
	"queue_before" "card_queue" NOT NULL,
	"interval_before" integer NOT NULL,
	"interval" integer NOT NULL,
	"ease_before" double precision NOT NULL,
	"ease" double precision NOT NULL,
	"delay_ms" integer NOT NULL,
	"duration_ms" integer,
	"reviewed_at" timestamp(3) with time zone NOT NULL,
	"study_day" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY,
	"status" "account_status" DEFAULT 'pending'::"account_status" NOT NULL,
	"role" "user_role" DEFAULT 'user'::"user_role" NOT NULL,
	"native_language" "language" DEFAULT 'en'::"language" NOT NULL,
	"target_language" "language" DEFAULT 'ja'::"language" NOT NULL,
	"onboarded_at" timestamp(3) with time zone,
	"display_name" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"daily_new_limit" integer DEFAULT 20 NOT NULL,
	"daily_review_limit" integer DEFAULT 200 NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "entries_priority" ON "entries" ("priority" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "forms_text" ON "forms" ("text");--> statement-breakpoint
CREATE INDEX "glosses_sense" ON "glosses" ("entry_id","sense");--> statement-breakpoint
CREATE INDEX "glosses_norm" ON "glosses" ("norm");--> statement-breakpoint
CREATE INDEX "glosses_document" ON "glosses" USING gin ("document");--> statement-breakpoint
CREATE INDEX "examples_sense" ON "examples" ("entry_id","sense","position");--> statement-breakpoint
CREATE INDEX "jobs_pending" ON "jobs" ("status","priority" DESC NULLS LAST,"run_after");--> statement-breakpoint
CREATE INDEX "cards_queue" ON "cards" ("user_id","queue","due");--> statement-breakpoint
CREATE INDEX "cards_note" ON "cards" ("note_id");--> statement-breakpoint
CREATE INDEX "coach_usage_user" ON "coach_usage" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notes_user" ON "notes" ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_word" ON "notes" ("user_id","entry_id","sense") WHERE "entry_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "review_logs_user_day" ON "review_logs" ("user_id","study_day");--> statement-breakpoint
CREATE INDEX "users_status" ON "users" ("status");--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "glosses" ADD CONSTRAINT "glosses_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "senses" ADD CONSTRAINT "senses_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audio_files" ADD CONSTRAINT "audio_files_key_audio_key_fkey" FOREIGN KEY ("key") REFERENCES "audio"("key") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_audio" ADD CONSTRAINT "entry_audio_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "entry_audio" ADD CONSTRAINT "entry_audio_audio_key_audio_key_fkey" FOREIGN KEY ("audio_key") REFERENCES "audio"("key");--> statement-breakpoint
ALTER TABLE "example_audio" ADD CONSTRAINT "example_audio_example_id_examples_id_fkey" FOREIGN KEY ("example_id") REFERENCES "examples"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "example_audio" ADD CONSTRAINT "example_audio_audio_key_audio_key_fkey" FOREIGN KEY ("audio_key") REFERENCES "audio"("key");--> statement-breakpoint
ALTER TABLE "examples" ADD CONSTRAINT "examples_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sense_nuance" ADD CONSTRAINT "sense_nuance_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "similar_words" ADD CONSTRAINT "similar_words_similar_id_entries_id_fkey" FOREIGN KEY ("similar_id") REFERENCES "entries"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "similar_words" ADD CONSTRAINT "similar_words_entry_id_sense_senses_entry_id_position_fkey" FOREIGN KEY ("entry_id","sense") REFERENCES "senses"("entry_id","position") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_note_id_notes_id_fkey" FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "coach_usage" ADD CONSTRAINT "coach_usage_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_entry_id_entries_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "entries"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_card_id_cards_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review_logs" ADD CONSTRAINT "review_logs_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;