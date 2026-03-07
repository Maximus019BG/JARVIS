CREATE TABLE "script_file" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'python' NOT NULL,
	"source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hash" text,
	"sync_status" text DEFAULT 'synced',
	"last_synced_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp,
	"workstation_id" text NOT NULL,
	"created_by" text NOT NULL,
	"device_id" text
);--> statement-breakpoint
ALTER TABLE "script_file" ADD CONSTRAINT "script_file_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_file" ADD CONSTRAINT "script_file_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_file" ADD CONSTRAINT "script_file_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;
