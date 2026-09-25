CREATE TABLE "code_project" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"workstation_id" text NOT NULL,
	"created_by" text NOT NULL,
	"device_id" text,
	"head_sha" text,
	"version" integer DEFAULT 0 NOT NULL,
	"files" text DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_version" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"commit_sha" text NOT NULL,
	"base_sha" text,
	"message" text,
	"bundle" text NOT NULL,
	"device_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "code_project" ADD CONSTRAINT "code_project_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_project" ADD CONSTRAINT "code_project_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_project" ADD CONSTRAINT "code_project_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_version" ADD CONSTRAINT "code_version_project_id_code_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."code_project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_version" ADD CONSTRAINT "code_version_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "code_version_commit_unique" ON "code_version" USING btree ("project_id","commit_sha");