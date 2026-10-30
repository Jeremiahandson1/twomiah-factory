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
ALTER TABLE "order_refunds" ADD COLUMN "credit_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_window_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "restocking_fee_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_shipping_fee_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "return_labels" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "store_settings" ADD COLUMN "shopper_returns" boolean DEFAULT true NOT NULL;--> statement-breakpoint
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
CREATE UNIQUE INDEX IF NOT EXISTS "store_returns_company_number_unique" ON "store_returns" USING btree ("company_id","return_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_returns_order_idx" ON "store_returns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "store_returns_company_status_idx" ON "store_returns" USING btree ("company_id","status");