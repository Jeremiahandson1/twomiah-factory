-- Money that came BACK against a reimbursed expense. (Salon RR8/X6 — the repayment the
-- refusal used to admit it could not record.)
--
-- A claim paid at $50 that should have been $40 leaves the salon $10 out of pocket, and the product
-- had no way to record the stylist handing it back. Rewriting the amount is refused on purpose — it
-- is the record of a payment that really happened — and "add a new expense for the difference" only
-- works in the direction where the difference is positive. So the correction is its own fact:
-- cumulative, like every other money-came-back figure in this codebase (orders.refunded_amount).
--
-- The expense stays reimbursed and keeps the amount it was paid at. What changes is that the sheet
-- can now say "of that $50, $10 came back", and the totals can be honest about what the business
-- actually spent.
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "repaid_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "repaid_at" timestamp;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "repaid_by_id" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "repaid_reason" text;
