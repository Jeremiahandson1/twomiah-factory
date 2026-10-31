ALTER TABLE "card_fee_charge" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refunded_at" timestamp;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refund_id" text;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refunded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "card_fee_charge" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "no_show_fee_new_cents" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "no_show_fee_new_percent" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "late_cancel_fee_new_cents" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "late_cancel_fee_new_percent" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "min_booking_value_cents" integer;--> statement-breakpoint
ALTER TABLE "card_policy" ADD COLUMN "auto_charge_no_show" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "no_show_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "no_show_fee_percent" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "late_cancel_fee_cents" integer;--> statement-breakpoint
ALTER TABLE "service_menu" ADD COLUMN "late_cancel_fee_percent" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_fee_charge" ADD CONSTRAINT "card_fee_charge_refunded_by_user_id_user_id_fk" FOREIGN KEY ("refunded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
