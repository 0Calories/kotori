-- Destructive. Deletes every reverse-direction card (template 'produce') and the review
-- logs that belong to those cards. Recognize cards and their logs are not matched.
-- Logs go first so the foreign key is satisfied even without ON DELETE CASCADE.
-- A second run deletes nothing.
DELETE FROM "review_logs"
WHERE "card_id" IN (SELECT "id" FROM "cards" WHERE "template" = 'produce');
--> statement-breakpoint
DELETE FROM "cards" WHERE "template" = 'produce';
