CREATE TABLE "blueprint_version" (
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
ALTER TABLE "blueprint_version" ADD CONSTRAINT "blueprint_version_blueprint_id_blueprint_id_fk" FOREIGN KEY ("blueprint_id") REFERENCES "public"."blueprint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD CONSTRAINT "blueprint_version_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint_version" ADD CONSTRAINT "blueprint_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
