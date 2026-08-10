CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"tool" text NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"detail_kind" text,
	"subject" text,
	"answer" text,
	"answered_by" text,
	"answered_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_device_idx" ON "approval" USING btree ("device_id");