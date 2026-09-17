CREATE TABLE IF NOT EXISTS "rental_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"unit_label" text NOT NULL,
	"customer_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer NOT NULL,
	"daily_rate" numeric(10, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"unit_id" text,
	"contact_id" text,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_reservation" ADD CONSTRAINT "rental_reservation_unit_id_unit_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_reservation" ADD CONSTRAINT "rental_reservation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rental_reservation" ADD CONSTRAINT "rental_reservation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_reservation_company_id_idx" ON "rental_reservation" USING btree ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rental_reservation_unit_id_start_date_idx" ON "rental_reservation" USING btree ("unit_id","start_date");
