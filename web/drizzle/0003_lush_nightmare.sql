CREATE TABLE "automation_job" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"step_index" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"locked_at" timestamp,
	"locked_by" text,
	"available_at" timestamp NOT NULL,
	"last_error" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "automation_run_step" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"index" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"type" text NOT NULL,
	"name" text,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_run" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"automation_version_id" text NOT NULL,
	"workstation_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger_id" text,
	"input" jsonb,
	"started_at" timestamp,
	"finished_at" timestamp,
	"step_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"workstation_id" text NOT NULL,
	"type" text NOT NULL,
	"key" text NOT NULL,
	"config" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "automation_version" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"version" integer NOT NULL,
	"editor_graph" jsonb NOT NULL,
	"definition" jsonb,
	"compiled_plan" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_version" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp,
	"created_by" text NOT NULL,
	"metadata" text,
	"workstation_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" text PRIMARY KEY NOT NULL,
	"blueprint_id" text,
	"device_id" text,
	"action" text NOT NULL,
	"direction" text NOT NULL,
	"status" text NOT NULL,
	"version_before" integer,
	"version_after" integer,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workstation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"device_token" text NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true,
	CONSTRAINT "device_device_token_unique" UNIQUE("device_token")
);
--> statement-breakpoint
CREATE TABLE "idempotency_key" (
	"key" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"response" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nonce" (
	"value" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "sync_status" text DEFAULT 'synced';--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "blueprint" ADD COLUMN "device_id" text;--> statement-breakpoint
ALTER TABLE "automation_job" ADD CONSTRAINT "automation_job_run_id_automation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_step" ADD CONSTRAINT "automation_run_step_run_id_automation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_version_id_automation_version_id_fk" FOREIGN KEY ("automation_version_id") REFERENCES "public"."automation_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_trigger" ADD CONSTRAINT "automation_trigger_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_trigger" ADD CONSTRAINT "automation_trigger_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_version" ADD CONSTRAINT "automation_version_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_version" ADD CONSTRAINT "automation_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device" ADD CONSTRAINT "device_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_key" ADD CONSTRAINT "idempotency_key_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nonce" ADD CONSTRAINT "nonce_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint" ADD CONSTRAINT "blueprint_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;