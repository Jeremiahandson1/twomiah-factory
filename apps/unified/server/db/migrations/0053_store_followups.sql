CREATE TABLE IF NOT EXISTS "store_followups" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"segment_id" text,
	"first_order_on" boolean DEFAULT false NOT NULL,
	"first_order_days" integer DEFAULT 3 NOT NULL,
	"first_order_subject" text,
	"first_order_body" text,
	"cross_sell_on" boolean DEFAULT false NOT NULL,
	"cross_sell_days" integer DEFAULT 14 NOT NULL,
	"cross_sell_subject" text,
	"cross_sell_body" text,
	"replenish_on" boolean DEFAULT false NOT NULL,
	"replenish_subject" text,
	"replenish_body" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "replenish_after_days" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_followups" ADD CONSTRAINT "store_followups_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_followups" ADD CONSTRAINT "store_followups_segment_id_store_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."store_segments"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_followups_company_unique" ON "store_followups" USING btree ("company_id");--> statement-breakpoint
UPDATE "orders" SET "delivered_at" = COALESCE("picked_up_at", "updated_at") WHERE "status" IN ('delivered', 'picked_up') AND "delivered_at" IS NULL;
