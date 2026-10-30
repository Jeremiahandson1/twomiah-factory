CREATE TABLE IF NOT EXISTS "event_autopay" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"contact_id" text,
	"stripe_account" text NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"payment_method_id" text,
	"setup_intent_id" text,
	"brand" text,
	"last4" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"consent_at" timestamp,
	"consent_ip" text,
	"consent_text" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"public_token" text,
	"message" text,
	"terms" text,
	"options" json DEFAULT '[]'::json NOT NULL,
	"snapshot" json DEFAULT '{}'::json NOT NULL,
	"selections" json DEFAULT '{}'::json NOT NULL,
	"expires_at" timestamp,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"accepted_at" timestamp,
	"declined_at" timestamp,
	"decline_reason" text,
	"signature" text,
	"signed_by" text,
	"signed_at" timestamp,
	"signed_ip" text,
	"signed_user_agent" text,
	"signature_hash" text,
	"consent_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_space_minimum" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"label" text,
	"days_of_week" json DEFAULT '[]'::json NOT NULL,
	"season_start" text,
	"season_end" text,
	"category" text,
	"amount" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "event_waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"event_date" date NOT NULL,
	"start_time" text,
	"end_time" text,
	"contact_id" text,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"guest_count" integer,
	"notes" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"offered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "guarantee_override_reason" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "guarantee_overridden_at" timestamp;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "guarantee_overridden_by" text;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "guarantee_reminder_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "event" ADD COLUMN "booked_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_payment" ADD COLUMN "pay_token" text;--> statement-breakpoint
ALTER TABLE "event_payment" ADD COLUMN "reminder_before_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_payment" ADD COLUMN "reminder_due_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_payment" ADD COLUMN "reminder_overdue_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_payment" ADD COLUMN "autopay_attempted_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_payment" ADD COLUMN "autopay_status" text;--> statement-breakpoint
ALTER TABLE "event_payment" ADD COLUMN "autopay_error" text;--> statement-breakpoint
ALTER TABLE "event_space" ADD COLUMN "feed_token" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_autopay" ADD CONSTRAINT "event_autopay_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_autopay" ADD CONSTRAINT "event_autopay_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_autopay" ADD CONSTRAINT "event_autopay_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_proposal" ADD CONSTRAINT "event_proposal_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_proposal" ADD CONSTRAINT "event_proposal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_space_minimum" ADD CONSTRAINT "event_space_minimum_space_id_event_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."event_space"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_space_minimum" ADD CONSTRAINT "event_space_minimum_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_waitlist" ADD CONSTRAINT "event_waitlist_space_id_event_space_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."event_space"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_waitlist" ADD CONSTRAINT "event_waitlist_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "event_waitlist" ADD CONSTRAINT "event_waitlist_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_autopay_company_id_idx" ON "event_autopay" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_autopay_event_id_idx" ON "event_autopay" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_proposal_company_id_idx" ON "event_proposal" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_proposal_event_id_idx" ON "event_proposal" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_proposal_public_token_idx" ON "event_proposal" USING btree ("public_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_space_minimum_space_idx" ON "event_space_minimum" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_space_minimum_company_id_idx" ON "event_space_minimum" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_waitlist_company_id_idx" ON "event_waitlist" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_waitlist_space_date_idx" ON "event_waitlist" USING btree ("space_id","event_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_payment_pay_token_idx" ON "event_payment" USING btree ("pay_token");--> statement-breakpoint
UPDATE "event" SET "booked_at" = "updated_at" WHERE "status" IN ('confirmed', 'completed') AND "booked_at" IS NULL;
