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
CREATE TABLE IF NOT EXISTS "ai_draft_uses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"feature" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopper_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"label" text,
	"name" text NOT NULL,
	"phone" text,
	"address" json NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopper_logins" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text,
	"email" text,
	"token_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shopper_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_books" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"bank_account_id" text,
	"bank_account_name" text,
	"refs" json DEFAULT '{}'::json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"provider_payout_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"arrived_at" timestamp NOT NULL,
	"lines" json DEFAULT '[]'::json NOT NULL,
	"qb_deposit_id" text,
	"qb_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"order_id" text NOT NULL,
	"contact_id" text,
	"return_number" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"started_by" text DEFAULT 'shopper' NOT NULL,
	"started_by_name" text,
	"resolution" text DEFAULT 'refund' NOT NULL,
	"reason" text DEFAULT 'other' NOT NULL,
	"note" text,
	"wanted" text,
	"prefer_credit" boolean DEFAULT false NOT NULL,
	"staff_note" text,
	"decline_reason" text,
	"items" json DEFAULT '[]'::json NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"line_value_cents" integer DEFAULT 0 NOT NULL,
	"restocking_fee_cents" integer DEFAULT 0 NOT NULL,
	"return_shipping_fee_cents" integer DEFAULT 0 NOT NULL,
	"refund_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"label_url" text,
	"label_tracking" text,
	"label_carrier" text,
	"label_cost_cents" integer,
	"label_claimed_at" timestamp,
	"refund_row_id" text,
	"exchange_order_id" text,
	"decided_at" timestamp,
	"decided_by_name" text,
	"received_at" timestamp,
	"received_by_name" text,
	"restocked_at" timestamp,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "qb_sync_run" ADD COLUMN "orders" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "qb_sync_run" ADD COLUMN "refunds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "qb_sync_run" ADD COLUMN "payouts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qb_sales_receipt_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "qb_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD COLUMN "qb_refund_receipt_id" text;--> statement-breakpoint
ALTER TABLE "order_refunds" ADD COLUMN "credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "low_stock_at" integer;--> statement-breakpoint
ALTER TABLE "product_variants" ADD COLUMN "cost_cents" integer;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_window_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "restocking_fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_shipping_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_labels" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "shopper_returns" boolean DEFAULT true NOT NULL;--> statement-breakpoint
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
DO $$ BEGIN
 ALTER TABLE "ai_draft_uses" ADD CONSTRAINT "ai_draft_uses_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_addresses" ADD CONSTRAINT "shopper_addresses_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_addresses" ADD CONSTRAINT "shopper_addresses_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_logins" ADD CONSTRAINT "shopper_logins_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_logins" ADD CONSTRAINT "shopper_logins_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_sessions" ADD CONSTRAINT "shopper_sessions_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shopper_sessions" ADD CONSTRAINT "shopper_sessions_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_books" ADD CONSTRAINT "store_books_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_payouts" ADD CONSTRAINT "store_payouts_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_returns" ADD CONSTRAINT "store_returns_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_returns" ADD CONSTRAINT "store_returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_returns" ADD CONSTRAINT "store_returns_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_company_unique" ON "marketing_automation" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_automation_send_unique" ON "marketing_automation_send" USING btree ("contact_id","kind","marker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "marketing_automation_send_company_idx" ON "marketing_automation_send" USING btree ("company_id","kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_draft_uses_company_idx" ON "ai_draft_uses" USING btree ("company_id","feature","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopper_addresses_contact_idx" ON "shopper_addresses" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopper_logins_token_unique" ON "shopper_logins" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopper_logins_contact_idx" ON "shopper_logins" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopper_logins_email_idx" ON "shopper_logins" USING btree ("company_id","email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shopper_sessions_token_unique" ON "shopper_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shopper_sessions_contact_idx" ON "shopper_sessions" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_books_company_unique" ON "store_books" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_payouts_company_payout_unique" ON "store_payouts" USING btree ("company_id","provider_payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_returns_company_number_unique" ON "store_returns" USING btree ("company_id","return_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_returns_order_idx" ON "store_returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_returns_company_status_idx" ON "store_returns" USING btree ("company_id","status");