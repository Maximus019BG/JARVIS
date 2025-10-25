ALTER TABLE "organization" RENAME TO "workstation";--> statement-breakpoint
ALTER TABLE "workstation" DROP CONSTRAINT "organization_slug_unique";--> statement-breakpoint
ALTER TABLE "workstation" DROP CONSTRAINT "organization_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "workstation" ADD CONSTRAINT "workstation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstation" ADD CONSTRAINT "workstation_slug_unique" UNIQUE("slug");