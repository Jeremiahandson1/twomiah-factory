-- What a member of staff owes the business, as a ledger. (Salon RR9 — the receivable the
-- repayment alone could not represent.)
--
-- The expense sheet could record money ARRIVING after an over-reimbursement and nothing else, which
-- leaves out the state the business is in between finding the error and getting the money back:
-- "she was paid $50 for a $40 claim and owes $10". With no balance there is nothing to see, nothing
-- to chase, no way to take it off a pay run, and nothing to write off if it never comes back.
--
-- The same shape as client_account_entry, deliberately: a signed ledger whose balance is the SUM of
-- its movements, never a column someone increments. Positive is money the business holds for the
-- person; negative is money they owe it. One implementation of "balance" in this product, two
-- anchors — the client row and the user row.
CREATE TABLE IF NOT EXISTS "staff_account_entry" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL,
  "user_id" text NOT NULL,
  "amount" numeric(12, 2) NOT NULL,
  "source" text NOT NULL,
  "reason" text NOT NULL,
  "expense_id" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_account_entry_company_id_idx" ON "staff_account_entry" ("company_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "staff_account_entry_user_id_idx" ON "staff_account_entry" ("user_id");--> statement-breakpoint
-- …and what was held back from a claim to clear one of those balances, on the claim itself. A
-- reimbursement of $60 that paid $50 in cash and put $10 against what was owed has to be able to
-- say so, or the record reads as a short payment.
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "applied_to_owed" numeric(12, 2) DEFAULT '0' NOT NULL;
