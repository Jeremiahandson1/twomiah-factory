CREATE TABLE IF NOT EXISTS "roof_report" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE CASCADE,
  "contact_id" text REFERENCES "contact"("id") ON DELETE SET NULL,
  "address" text NOT NULL,
  "city" text NOT NULL,
  "state" text NOT NULL,
  "zip" text NOT NULL,
  "lat" real NOT NULL,
  "lng" real NOT NULL,
  "formatted_address" text,
  "total_area_sqft" real NOT NULL,
  "total_squares" real NOT NULL,
  "segment_count" integer NOT NULL,
  "imagery_quality" text NOT NULL,
  "imagery_date" text,
  "segments" json NOT NULL,
  "edges" json NOT NULL,
  "measurements" json NOT NULL,
  "raw_solar_data" json,
  "status" text NOT NULL DEFAULT 'paid',
  "stripe_payment_intent_id" text,
  "amount_charged" numeric(10,2) DEFAULT '9.99',
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "roof_report_company_id_idx" ON "roof_report" ("company_id");
CREATE INDEX IF NOT EXISTS "roof_report_contact_id_idx" ON "roof_report" ("contact_id");
