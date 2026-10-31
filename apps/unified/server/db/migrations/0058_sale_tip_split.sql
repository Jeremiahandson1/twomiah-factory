CREATE TABLE IF NOT EXISTS "sale_tip_split" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"stylist_id" text,
	"stylist_member_id" text,
	"share_bp" integer NOT NULL,
	"set_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_invoice_id_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoice"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_stylist_id_user_id_fk" FOREIGN KEY ("stylist_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_stylist_member_id_team_member_id_fk" FOREIGN KEY ("stylist_member_id") REFERENCES "public"."team_member"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_tip_split" ADD CONSTRAINT "sale_tip_split_set_by_user_id_user_id_fk" FOREIGN KEY ("set_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sale_tip_split_invoice_idx" ON "sale_tip_split" USING btree ("invoice_id");