-- Who judged a loan's meaning is kept apart from who named the pair (dictionary enrichment, phase 8
-- review): a reseed names the pair again as JMDict's, and the verdict must stay Kotori's. Every
-- meaning set so far is Kotori's, as the loan import is the only writer of one, including those a
-- reseed relabelled as JMDict's.
ALTER TABLE "loan_links" ADD COLUMN "meaning_source" "source";--> statement-breakpoint
UPDATE "loan_links" SET "meaning_source" = 'kotori' WHERE "meaning" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "loan_links" ADD CONSTRAINT "loan_links_meaning_source" CHECK (("meaning" IS NULL) = ("meaning_source" IS NULL));
