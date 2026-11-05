ALTER TABLE "forms" ALTER COLUMN "tags" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "tags" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "priorities" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "priorities" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "restrictions" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "forms" ALTER COLUMN "restrictions" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "pos" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "pos" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "misc" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "misc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "fields" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "fields" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "dialects" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "dialects" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "info" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "info" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "stagk" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "stagk" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "stagr" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "stagr" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "xrefs" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "xrefs" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "antonyms" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "antonyms" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "sources" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "senses" ALTER COLUMN "sources" DROP NOT NULL;