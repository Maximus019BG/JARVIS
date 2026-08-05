-- `blueprint_version` already exists: 0006_blueprint_versioning created it, but that
-- migration was hand-written with no drizzle snapshot, so the generator believed the
-- table was new. Only the three commit columns are actually missing. Written IF NOT
-- EXISTS so a database that somehow skipped 0006 still converges.
CREATE TABLE IF NOT EXISTS "blueprint_version" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint_id" text NOT NULL,
	"version" integer NOT NULL,
	"metadata" text NOT NULL,
	"hash" text,
	"device_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD COLUMN IF NOT EXISTS "commit_sha" text;--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD COLUMN IF NOT EXISTS "parent_sha" text;--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD COLUMN IF NOT EXISTS "message" text;--> statement-breakpoint
CREATE TABLE "device_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"blueprint_id" text,
	"mode" text DEFAULT 'write' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_link" (
	"user_code" text PRIMARY KEY NOT NULL,
	"device_code_hash" text NOT NULL,
	"name" text NOT NULL,
	"fingerprint" text NOT NULL,
	"platform" text,
	"expires_at" timestamp NOT NULL,
	"last_polled_at" timestamp,
	"approved_device_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_link_device_code_hash_unique" UNIQUE("device_code_hash")
);
--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "device_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "token_prefix" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "approved_at" timestamp;--> statement-breakpoint
-- Same story as the table above: 0006 already added these three. Postgres has no
-- `ADD CONSTRAINT IF NOT EXISTS`, so swallow the duplicate rather than fail the migration.
DO $$ BEGIN
	ALTER TABLE "blueprint_version" ADD CONSTRAINT "blueprint_version_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blueprint_version" ADD CONSTRAINT "blueprint_version_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "blueprint_version" ADD CONSTRAINT "blueprint_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
ALTER TABLE "device_grant" ADD CONSTRAINT "device_grant_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_grant" ADD CONSTRAINT "device_grant_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_grant" ADD CONSTRAINT "device_grant_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_link" ADD CONSTRAINT "device_link_approved_device_id_device_id_fk" FOREIGN KEY ("approved_device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_version_commit_unique" ON "blueprint_version" USING btree ("blueprint_id","commit_sha");--> statement-breakpoint
CREATE UNIQUE INDEX "device_grant_blueprint_unique" ON "device_grant" USING btree ("device_id","blueprint_id") WHERE "device_grant"."blueprint_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "device_grant_all_unique" ON "device_grant" USING btree ("device_id") WHERE "device_grant"."blueprint_id" is null;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;