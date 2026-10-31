CREATE TABLE IF NOT EXISTS "client_credential" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_id" text NOT NULL,
	"credential_type" text NOT NULL,
	"issuing_body" text,
	"issue_date" date,
	"expiry_date" date,
	"document_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_credential_reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"client_credential_id" text NOT NULL,
	"stage" text NOT NULL,
	"expiry_date" date NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_credential" ADD CONSTRAINT "client_credential_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_credential" ADD CONSTRAINT "client_credential_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_credential_reminder" ADD CONSTRAINT "client_credential_reminder_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_credential_reminder" ADD CONSTRAINT "client_credential_reminder_client_credential_id_client_credential_id_fk" FOREIGN KEY ("client_credential_id") REFERENCES "public"."client_credential"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_credential_company_idx" ON "client_credential" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_credential_client_idx" ON "client_credential" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_credential_reminder_key" ON "client_credential_reminder" USING btree ("client_credential_id","expiry_date","stage");