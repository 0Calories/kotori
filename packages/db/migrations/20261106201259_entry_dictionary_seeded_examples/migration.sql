-- Existing rows are backfilled from their id ranges (see `entries.ts`); English words get a
-- placeholder that the next `kotori seed` corrects to the source each one came from.
ALTER TABLE "entries" ADD COLUMN "dictionary" "source";--> statement-breakpoint
UPDATE "entries" SET "dictionary" = CASE
  WHEN "id" >= 200000000 THEN 'kotori'::"source"
  WHEN "id" >= 100000000 THEN 'enwiktionary'::"source"
  ELSE 'jmdict'::"source"
END;--> statement-breakpoint
ALTER TABLE "entries" ALTER COLUMN "dictionary" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "examples" ALTER COLUMN "formality" DROP NOT NULL;
