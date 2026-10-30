CREATE TABLE IF NOT EXISTS "mortgage_check" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"job_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"mortgage_company" text NOT NULL,
	"loan_number" text,
	"check_number" text,
	"amount" numeric(10, 2) NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"received_at" timestamp,
	"sent_at" timestamp,
	"tracking_number" text,
	"endorsed_at" timestamp,
	"deposited_at" timestamp,
	"notes" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "depreciation_reminded_at" timestamp;--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "completion_certificate_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "depreciation_recovered_amount" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "insurance_claim" ADD COLUMN "depreciation_recovered_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_job_id_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."job"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_claim_id_insurance_claim_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."insurance_claim"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mortgage_check" ADD CONSTRAINT "mortgage_check_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mortgage_check_company_id_idx" ON "mortgage_check" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mortgage_check_claim_id_idx" ON "mortgage_check" USING btree ("claim_id");