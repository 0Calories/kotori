CREATE TYPE "cast_by" AS ENUM('rules', 'jev', 'manual');--> statement-breakpoint
CREATE TYPE "sentence_medium" AS ENUM('conversation', 'announcement', 'narration');--> statement-breakpoint
CREATE TYPE "sentence_tone" AS ENUM('neutral', 'cheerful', 'serious', 'gentle', 'rough');--> statement-breakpoint
CREATE TYPE "speaker_age" AS ENUM('child', 'youth', 'adult', 'middle-aged', 'older', 'unspecified');--> statement-breakpoint
CREATE TYPE "speaker_gender" AS ENUM('masculine', 'feminine', 'unspecified');--> statement-breakpoint
ALTER TABLE "audio" ADD COLUMN "voice" text;--> statement-breakpoint
ALTER TABLE "example_audio" ADD COLUMN "cast_by" "cast_by";--> statement-breakpoint
ALTER TABLE "example_audio" ADD COLUMN "score" double precision;--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "speaker_gender" "speaker_gender";--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "speaker_age" "speaker_age";--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "medium" "sentence_medium";--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "variety" text;--> statement-breakpoint
ALTER TABLE "examples" ADD COLUMN "tone" "sentence_tone";--> statement-breakpoint
ALTER TABLE "entry_audio" DROP CONSTRAINT "entry_audio_pkey";--> statement-breakpoint
ALTER TABLE "entry_audio" ADD PRIMARY KEY ("entry_id","audio_key");--> statement-breakpoint
UPDATE "audio" SET "voice" = 'ja-kyoko' WHERE "voice_id" = '4lOQ7A2l7HPuG7UIHiKA';--> statement-breakpoint
UPDATE "audio" SET "voice" = 'en-sarah' WHERE "voice_id" = 'EXAVITQu4vr4xnSDxMaL';
