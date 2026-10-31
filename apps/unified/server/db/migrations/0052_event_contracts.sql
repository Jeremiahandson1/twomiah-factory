CREATE TABLE IF NOT EXISTS "event_contract_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_proposal_signer" (
	"id" text PRIMARY KEY NOT NULL,
	"proposal_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"status" text DEFAULT 'waiting' NOT NULL,
	"sent_at" timestamp,
	"signature" text,
	"signed_by" text,
	"signed_at" timestamp,
	"signed_ip" text,
	"signed_user_agent" text,
	"signature_hash" text,
	"consent_at" timestamp,
	"consent_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "contract_template_id" text;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "contract_name" text;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "contract_body" text;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD COLUMN "signer_plan" json DEFAULT '[]'::json NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_contract_template" ADD CONSTRAINT "event_contract_template_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_proposal_signer" ADD CONSTRAINT "event_proposal_signer_proposal_id_event_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."event_proposal"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_proposal_signer" ADD CONSTRAINT "event_proposal_signer_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_contract_template_company_id_idx" ON "event_contract_template" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "event_proposal_signer_position_idx" ON "event_proposal_signer" USING btree ("proposal_id","position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_proposal_signer_token_idx" ON "event_proposal_signer" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_proposal_signer_company_id_idx" ON "event_proposal_signer" USING btree ("company_id");