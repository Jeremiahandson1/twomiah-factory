CREATE TABLE IF NOT EXISTS "project_sign_request" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"signed_name" text,
	"signature_image" text,
	"signed_at" timestamp,
	"signer_ip" text,
	"signer_user_agent" text,
	"document_hash" text,
	"signed_document_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_sign_request" ADD CONSTRAINT "project_sign_request_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_sign_request" ADD CONSTRAINT "project_sign_request_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_sign_request" ADD CONSTRAINT "project_sign_request_document_id_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."document"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "project_sign_request" ADD CONSTRAINT "project_sign_request_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_sign_request_project_id_idx" ON "project_sign_request" USING btree ("project_id");