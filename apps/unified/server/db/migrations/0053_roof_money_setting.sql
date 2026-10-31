CREATE TABLE IF NOT EXISTS "roof_money_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"min_profit_kind" text,
	"min_profit_value" numeric(12, 2),
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "roof_money_setting" ADD CONSTRAINT "roof_money_setting_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roof_money_setting_company_id_idx" ON "roof_money_setting" USING btree ("company_id");