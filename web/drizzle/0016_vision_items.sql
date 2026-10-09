CREATE TABLE "vision_item" (
	"id" text PRIMARY KEY NOT NULL,
	"workstation_id" text NOT NULL,
	"created_by" text NOT NULL,
	"device_id" text,
	"name" text NOT NULL,
	"samples" integer NOT NULL,
	"pos" text NOT NULL,
	"neg" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vision_item" ADD CONSTRAINT "vision_item_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_item" ADD CONSTRAINT "vision_item_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vision_item" ADD CONSTRAINT "vision_item_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "vision_item_name_unique" ON "vision_item" USING btree ("workstation_id","name");