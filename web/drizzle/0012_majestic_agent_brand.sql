CREATE TABLE "gateway_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text,
	"user_id" text NOT NULL,
	"workstation_id" text NOT NULL,
	"requested_model" text NOT NULL,
	"upstream_name" text DEFAULT '' NOT NULL,
	"upstream_model" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"streamed" boolean DEFAULT false NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micros" integer DEFAULT 0 NOT NULL,
	"upstream_status" integer,
	"latency_ms" integer,
	"attempts" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateway_usage" ADD CONSTRAINT "gateway_usage_device_id_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_usage" ADD CONSTRAINT "gateway_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_usage" ADD CONSTRAINT "gateway_usage_workstation_id_workstation_id_fk" FOREIGN KEY ("workstation_id") REFERENCES "public"."workstation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gateway_usage_device_created_idx" ON "gateway_usage" USING btree ("device_id","created_at");--> statement-breakpoint
CREATE INDEX "gateway_usage_user_created_idx" ON "gateway_usage" USING btree ("user_id","created_at");