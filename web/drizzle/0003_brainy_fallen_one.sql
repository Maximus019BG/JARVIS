ALTER TABLE "verification" RENAME COLUMN "token" TO "value";--> statement-breakpoint
ALTER TABLE "verification" DROP CONSTRAINT "verification_token_unique";--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updated_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "verification" DROP COLUMN "type";