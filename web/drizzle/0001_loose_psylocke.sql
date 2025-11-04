CREATE TABLE "blueprint" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"created_by" text NOT NULL,
	"metadata" text,
	"workstation_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blueprint" ADD CONSTRAINT "blueprint_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blueprint" ADD CONSTRAINT "blueprint_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;