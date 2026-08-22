-- Purchase orders + vendor bills (accounts payable), document version
-- history, and plan markup annotations.

CREATE TABLE IF NOT EXISTS "job_purchase_order" (
  "id" text PRIMARY KEY NOT NULL,
  "number" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "issue_date" timestamp DEFAULT now() NOT NULL,
  "expected_date" timestamp,
  "ship_to" text,
  "subtotal" numeric(12, 2) DEFAULT '0' NOT NULL,
  "tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
  "tax_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "notes" text,
  "vendor_acknowledged_at" timestamp,
  "vendor_declined_reason" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
  "vendor_id" text REFERENCES "contact"("id") ON DELETE set null,
  "project_id" text REFERENCES "project"("id") ON DELETE set null,
  "job_id" text REFERENCES "job"("id") ON DELETE set null,
  "created_by_id" text REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_purchase_order_company_id_idx" ON "job_purchase_order" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_purchase_order_vendor_id_idx" ON "job_purchase_order" ("vendor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_purchase_order_job_id_idx" ON "job_purchase_order" ("job_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_purchase_order_line" (
  "id" text PRIMARY KEY NOT NULL,
  "description" text NOT NULL,
  "quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
  "unit_cost" numeric(12, 2) DEFAULT '0' NOT NULL,
  "total" numeric(12, 2) DEFAULT '0' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "purchase_order_id" text NOT NULL REFERENCES "job_purchase_order"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "job_purchase_order_line_po_idx" ON "job_purchase_order_line" ("purchase_order_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_bill" (
  "id" text PRIMARY KEY NOT NULL,
  "number" text,
  "status" text DEFAULT 'open' NOT NULL,
  "bill_date" timestamp DEFAULT now() NOT NULL,
  "due_date" timestamp,
  "amount" numeric(12, 2) NOT NULL,
  "amount_paid" numeric(12, 2) DEFAULT '0' NOT NULL,
  "paid_at" timestamp,
  "file_url" text,
  "notes" text,
  "source" text DEFAULT 'manual' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
  "vendor_id" text REFERENCES "contact"("id") ON DELETE set null,
  "project_id" text REFERENCES "project"("id") ON DELETE set null,
  "job_id" text REFERENCES "job"("id") ON DELETE set null,
  "purchase_order_id" text REFERENCES "job_purchase_order"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_bill_company_id_idx" ON "vendor_bill" ("company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_bill_vendor_id_idx" ON "vendor_bill" ("vendor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_bill_job_id_idx" ON "vendor_bill" ("job_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "document_version" (
  "id" text PRIMARY KEY NOT NULL,
  "version_number" integer NOT NULL,
  "filename" text NOT NULL,
  "original_name" text NOT NULL,
  "mime_type" text,
  "size" integer,
  "path" text NOT NULL,
  "url" text NOT NULL,
  "note" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "document_id" text NOT NULL REFERENCES "document"("id") ON DELETE cascade,
  "uploaded_by_id" text REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_version_document_id_idx" ON "document_version" ("document_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "plan_markup" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text DEFAULT 'Markup' NOT NULL,
  "data" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "document_id" text NOT NULL REFERENCES "document"("id") ON DELETE cascade,
  "created_by_id" text REFERENCES "user"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "plan_markup_document_id_idx" ON "plan_markup" ("document_id");
