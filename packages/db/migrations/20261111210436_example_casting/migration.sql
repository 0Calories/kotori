-- An example sentence's casting signals move from five columns into one nullable JSONB
-- (`Casting` in examples.ts); the next migration drops the columns. Every value is carried over,
-- nothing is inferred:
--   speaker_gender, speaker_age  -> speakerGender, speakerAge ('unspecified' where null)
--   medium, variety, tone        -> as they were, null where null
-- A sentence with none of them (written before voice casting, or seeded) keeps a null `casting`.
-- Rows already carried over are left alone, so this can run twice.
ALTER TABLE "examples" ADD COLUMN IF NOT EXISTS "casting" jsonb;--> statement-breakpoint
UPDATE "examples"
SET "casting" = jsonb_build_object(
  'speakerGender', coalesce("speaker_gender"::text, 'unspecified'),
  'speakerAge', coalesce("speaker_age"::text, 'unspecified'),
  'medium', "medium"::text,
  'variety', "variety",
  'tone', "tone"::text
)
WHERE "casting" IS NULL
  AND ("speaker_gender" IS NOT NULL OR "speaker_age" IS NOT NULL OR "medium" IS NOT NULL OR "variety" IS NOT NULL OR "tone" IS NOT NULL);
