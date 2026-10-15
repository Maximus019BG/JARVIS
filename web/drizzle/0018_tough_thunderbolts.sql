ALTER TABLE "automation_job" DROP CONSTRAINT "automation_job_run_id_automation_run_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_run_step" DROP CONSTRAINT "automation_run_step_run_id_automation_run_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_automation_id_automation_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_automation_version_id_automation_version_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_run" DROP CONSTRAINT "automation_run_workstation_id_workstation_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_trigger" DROP CONSTRAINT "automation_trigger_automation_id_automation_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_trigger" DROP CONSTRAINT "automation_trigger_workstation_id_workstation_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_version" DROP CONSTRAINT "automation_version_automation_id_automation_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_version" DROP CONSTRAINT "automation_version_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "automation" DROP CONSTRAINT "automation_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "automation" DROP CONSTRAINT "automation_workstation_id_workstation_id_fk";
--> statement-breakpoint
ALTER TABLE "automation_job" ADD CONSTRAINT "automation_job_run_id_automation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run_step" ADD CONSTRAINT "automation_run_step_run_id_automation_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_version_id_automation_version_id_fk" FOREIGN KEY ("automation_version_id") REFERENCES "public"."automation_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_trigger" ADD CONSTRAINT "automation_trigger_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_trigger" ADD CONSTRAINT "automation_trigger_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_version" ADD CONSTRAINT "automation_version_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_version" ADD CONSTRAINT "automation_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_job_status_available_idx" ON "automation_job" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_run_step_run_index_unique" ON "automation_run_step" USING btree ("run_id","index");--> statement-breakpoint
CREATE INDEX "automation_run_automation_created_idx" ON "automation_run" USING btree ("automation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_trigger_key_unique" ON "automation_trigger" USING btree ("key");--> statement-breakpoint
CREATE INDEX "automation_workstation_idx" ON "automation" USING btree ("workstation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blueprint_version_version_unique" ON "blueprint_version" USING btree ("blueprint_id","version");--> statement-breakpoint
CREATE INDEX "blueprint_workstation_idx" ON "blueprint" USING btree ("workstation_id");--> statement-breakpoint
CREATE INDEX "sync_log_device_created_idx" ON "sync_log" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "device_workstation_idx" ON "device" USING btree ("workstation_id");