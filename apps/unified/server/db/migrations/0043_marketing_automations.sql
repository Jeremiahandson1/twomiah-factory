CREATE TABLE IF NOT EXISTS "marketing_automation" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"win_back_days" integer,
	"win_back_subject" text,
	"win_back_body" text,
	"welcome_on" boolean DEFAULT false NOT NULL,
	"welcome_subject" text,
	"welcome_body" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "marketing_automation_send" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"kind" text NOT NULL,
	"marker" text NOT NULL,
	"status" text DEFAULT 'claimed' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "marketing_automation" ADD CONSTRAINT "marketing_automation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "marketing_automation_send" ADD CONSTRAINT "marketing_automation_send_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "marketing_automation_send" ADD CONSTRAINT "marketing_automation_send_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_company_unique" ON "marketing_automation" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_send_unique" ON "marketing_automation_send" USING btree ("contact_id","kind","marker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_automation_send_company_idx" ON "marketing_automation_send" USING btree ("company_id","kind");