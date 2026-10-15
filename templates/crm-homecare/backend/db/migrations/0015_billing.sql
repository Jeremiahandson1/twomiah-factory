-- 0015_billing: the CVHC billing port (CVHC v37, v55, v58, v62, v16 claims columns).
--
-- ADDITIVE ONLY. Every statement is IF NOT EXISTS / guarded so a re-run is a no-op.
--
--   invoices.seq_number          v37  a friendly, never-reused number ("Invoice #42") beside the
--                                     random invoice_number, which stays the durable unique key
--   invoices.sent_at             v55  NULL = draft. The family portal and the public pay page only
--                                     show an invoice once it is sent, released or paid
--   invoice_line_items.*         v58  WHY a line is the number it is: billed_basis
--                                     ('scheduled' | 'clocked' | 'unscheduled') and both sides
--                                     (scheduled_minutes, clocked_minutes); start_time/end_time
--                                     identify the visit (date + scheduled start + caregiver) so the
--                                     visit's care note can print on the invoice
--   clients.billing_frequency_weeks / billed_through
--                                v62  per-client invoice cadence for "Create Due Invoices"
--   claims.*                     v16  the claim columns the claims engine writes and the template
--                                     lacked. Mapped onto existing template columns, not duplicated:
--                                     charge_amount -> billed_amount, submitted_date -> submission_date,
--                                     procedure_code -> service_code, units -> units_billed
--   referral_sources.claim_portal     the insurer-portal export settings for one payer (MIDAS for My
--                                     Choice Wisconsin is ONE such configuration, not a constant)

-- ── invoices: friendly sequential number ────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS invoice_seq_number_seq START WITH 1;
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "seq_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_seq_number_unique" ON "invoices" ("seq_number");
--> statement-breakpoint
-- Backfill in creation order, so the oldest invoice is #1.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
    FROM invoices
   WHERE seq_number IS NULL
)
UPDATE invoices i
   SET seq_number = ordered.rn + COALESCE((SELECT MAX(seq_number) FROM invoices), 0)
  FROM ordered
 WHERE i.id = ordered.id;
--> statement-breakpoint
-- Move the sequence past the highest number in use. On an empty table the sequence is left
-- uncalled, so the first invoice is #1 (setval(…, 1) with is_called=true would make it #2).
SELECT setval('invoice_seq_number_seq',
              GREATEST((SELECT COALESCE(MAX(seq_number), 0) FROM invoices), 1),
              (SELECT COALESCE(MAX(seq_number), 0) FROM invoices) > 0);
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "seq_number" SET DEFAULT nextval('invoice_seq_number_seq');
--> statement-breakpoint

-- ── invoices: draft until sent ──────────────────────────────────────────────────────────────────
ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "sent_at" timestamp;
--> statement-breakpoint
-- Existing invoices were already visible to families, so they are grandfathered in as sent; only
-- invoices created from now on start as drafts.
UPDATE invoices SET sent_at = created_at WHERE sent_at IS NULL;
--> statement-breakpoint

-- ── invoice line items: billed basis + the visit they bill ─────────────────────────────────────
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "billed_basis" text;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "scheduled_minutes" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "clocked_minutes" integer;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "start_time" time;
--> statement-breakpoint
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "end_time" time;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'invoice_line_items'::regclass
       AND conname  = 'invoice_line_items_billed_basis_check'
  ) THEN
    ALTER TABLE invoice_line_items
      ADD CONSTRAINT invoice_line_items_billed_basis_check
      CHECK (billed_basis IS NULL OR billed_basis IN ('scheduled', 'clocked', 'unscheduled'));
  END IF;
END $$;
--> statement-breakpoint
-- Existing lines: one tied to a time entry was billed off that punch, one without off the schedule.
-- A best-effort label only; the minute columns stay NULL because old rows never recorded both sides.
UPDATE invoice_line_items
   SET billed_basis = CASE WHEN time_entry_id IS NULL THEN 'scheduled' ELSE 'clocked' END
 WHERE billed_basis IS NULL;
--> statement-breakpoint

-- ── clients: billing cadence ────────────────────────────────────────────────────────────────────
-- How often this client is invoiced, in weeks (1-8). NULL = not auto-billed (invoice manually).
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "billing_frequency_weeks" integer;
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "billed_through" date;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_billing_frequency_weeks_check') THEN
    ALTER TABLE clients ADD CONSTRAINT clients_billing_frequency_weeks_check
      CHECK (billing_frequency_weeks IS NULL OR billing_frequency_weeks BETWEEN 1 AND 8);
  END IF;
END $$;
--> statement-breakpoint
-- Anchor: the last day already covered by an invoice. Auto-generation resumes the day after.
UPDATE clients c SET billed_through = i.max_end
  FROM (SELECT client_id, MAX(billing_period_end)::date AS max_end FROM invoices GROUP BY client_id) i
 WHERE i.client_id = c.id AND c.billed_through IS NULL;
--> statement-breakpoint
-- Default cadence, as CVHC's migration set it: every 2 weeks, only for active clients who already
-- get invoices. Everyone else stays manual until a cadence is picked in Billing.
UPDATE clients c SET billing_frequency_weeks = 2
 WHERE c.billing_frequency_weeks IS NULL
   AND c.is_active = true
   AND EXISTS (SELECT 1 FROM invoices i WHERE i.client_id = c.id);
--> statement-breakpoint

-- ── claims: the columns the claims engine writes ───────────────────────────────────────────────
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "invoice_id" text;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "modifier" text;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "diagnosis_code" text;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "service_date_from" date;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "service_date_to" date;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "place_of_service" text;
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "created_by_id" text;
--> statement-breakpoint
-- Set once when the claim's units are taken off its authorization; a retry never deducts twice.
ALTER TABLE "claims" ADD COLUMN IF NOT EXISTS "units_deducted_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "claims_invoice_id_idx" ON "claims" ("invoice_id");
--> statement-breakpoint

-- ── referral sources: insurer-portal export settings ───────────────────────────────────────────
-- { "name": "MIDAS", "evvCode": "S5125", "evvLabel": "...", "otherCode": "S5130", "otherLabel": "..." }
-- NULL = this payer has no portal export.
ALTER TABLE "referral_sources" ADD COLUMN IF NOT EXISTS "claim_portal" json;
