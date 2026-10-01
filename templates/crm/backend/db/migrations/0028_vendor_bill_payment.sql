-- A ledger for money paid to vendors. (T32 B4)
--
-- vendor_bill carried a running `amount_paid` and nothing else, so a payment had no date, no method,
-- no reference and no row. When five concurrent payments raced and three were lost to a read-then-write,
-- there was no trace of them at all — the only record was a total that disagreed with what had been
-- acknowledged. A total without a ledger cannot be reconciled, and cannot be audited.
--
-- Mirrors the shape of `payment` (the invoice side) so both halves of the money read the same way.
CREATE TABLE IF NOT EXISTS "vendor_bill_payment" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "company"("id") ON DELETE cascade,
  "vendor_bill_id" text NOT NULL REFERENCES "vendor_bill"("id") ON DELETE cascade,
  "amount" numeric(12, 2) NOT NULL,
  "method" text,
  "reference" text,
  "notes" text,
  "paid_at" timestamp DEFAULT now() NOT NULL,
  "recorded_by_id" text REFERENCES "user"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_bill_payment_bill_idx" ON "vendor_bill_payment" ("vendor_bill_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_bill_payment_company_idx" ON "vendor_bill_payment" ("company_id");
