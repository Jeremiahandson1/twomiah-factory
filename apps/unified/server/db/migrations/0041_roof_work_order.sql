CREATE TABLE IF NOT EXISTS "work_order" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"crew_id" text,
	"title" text NOT NULL,
	"scope" text,
	"address" text,
	"start_date" timestamp,
	"recipient_name" text NOT NULL,
	"recipient_phone" text NOT NULL,
	"material_lines" json DEFAULT '[]'::json NOT NULL,
	"photo_ids" json DEFAULT '[]'::json NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"public_token" text,
	"token_expires_at" timestamp,
	"sent_at" timestamp,
	"responded_at" timestamp,
	"responded_by_name" text,
	"reject_reason" text,
	"completed_at" timestamp,
	"completion_note" text,
	"completion_photo_ids" json DEFAULT '[]'::json NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_crew_id_crew_id_fk" FOREIGN KEY ("crew_id") REFERENCES "public"."crew"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "work_order" ADD CONSTRAINT "work_order_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_company_id_idx" ON "work_order" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_order_job_id_idx" ON "work_order" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "work_order_public_token_uniq" ON "work_order" USING btree ("public_token");