CREATE TABLE IF NOT EXISTS "bar_tip_payout" (
	"id" text PRIMARY KEY NOT NULL,
	"business_day" text NOT NULL,
	"closeout_id" text,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"hours_x100" integer DEFAULT 0 NOT NULL,
	"tips_cents" integer DEFAULT 0 NOT NULL,
	"sales_cents" integer DEFAULT 0 NOT NULL,
	"kept_cents" integer DEFAULT 0 NOT NULL,
	"tip_out_paid_cents" integer DEFAULT 0 NOT NULL,
	"tip_out_received_cents" integer DEFAULT 0 NOT NULL,
	"pool_share_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_payout" ADD CONSTRAINT "bar_tip_payout_closeout_id_bar_closeout_id_fk" FOREIGN KEY ("closeout_id") REFERENCES "public"."bar_closeout"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_payout" ADD CONSTRAINT "bar_tip_payout_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bar_tip_payout" ADD CONSTRAINT "bar_tip_payout_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bar_tip_payout_day_user_key" ON "bar_tip_payout" USING btree ("company_id","business_day","user_id");