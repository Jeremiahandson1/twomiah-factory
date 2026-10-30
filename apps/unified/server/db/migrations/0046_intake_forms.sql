CREATE TABLE IF NOT EXISTS "intake_form" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'intake' NOT NULL,
	"intro" text,
	"questions" json DEFAULT '[]'::json NOT NULL,
	"service_ids" json DEFAULT '[]'::json NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intake_response" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"form_id" text,
	"form_name" text NOT NULL,
	"form_kind" text DEFAULT 'intake' NOT NULL,
	"contact_id" text NOT NULL,
	"booking_token" text,
	"answers" json DEFAULT '[]'::json NOT NULL,
	"signed_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_form" ADD CONSTRAINT "intake_form_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_form_id_intake_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."intake_form"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "intake_response" ADD CONSTRAINT "intake_response_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_form_company_idx" ON "intake_form" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "intake_response_contact_idx" ON "intake_response" USING btree ("company_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "intake_response_once_idx" ON "intake_response" USING btree ("form_id","contact_id","booking_token");