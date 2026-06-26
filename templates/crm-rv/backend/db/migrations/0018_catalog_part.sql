CREATE TABLE IF NOT EXISTS "catalog_part" (
	"id" text PRIMARY KEY NOT NULL,
	"part_number" text NOT NULL,
	"name" text NOT NULL,
	"oem" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Parts' NOT NULL,
	"price" numeric(10, 2) DEFAULT '0' NOT NULL,
	"cost" numeric(10, 2),
	"msrp" numeric(10, 2),
	"availability" text DEFAULT 'Order from OEM' NOT NULL,
	"superseded_by" text,
	"fitment" text,
	"diagram" text,
	"source" text DEFAULT 'import' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"company_id" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "catalog_part" ADD CONSTRAINT "catalog_part_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "catalog_part_company_pn_oem_key" ON "catalog_part" ("company_id","part_number","oem");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_part_company_oem_idx" ON "catalog_part" ("company_id","oem");
