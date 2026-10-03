-- The two database backstops under "bill a visit once". (T41 BLOCKER)
--
-- T41 raced POST /api/visits/:id/invoice and got two 201s: 5 of 5 two-way races double-billed, a
-- four-way race produced three invoices, and twice the pair SHARED AN INVOICE NUMBER (INV-00061,
-- INV-00070). The visit links only the last one, so the others sit in AR for ever.
--
-- The route fix is the real one: the whole handler now runs in a transaction, locks the visit row
-- with SELECT … FOR UPDATE and re-checks invoice_id inside the lock. The report asked for four
-- things, and these are the other two — the constraints that make the invariant true in the
-- DATABASE rather than only in the code path that happens to be correct today:
--
--   1. one visit bills once        unique on visit.invoice_id
--   2. one invoice number per shop unique on (company_id, number)
--
-- WHY BOTH ARE PARTIAL INDEXES.
--
-- visit.invoice_id is null for every unbilled visit, and there are thousands of those; a plain
-- unique index treats nulls as distinct in Postgres so it would work, but WHERE … IS NOT NULL says
-- the intent and keeps the index to the billed rows.
--
-- The number index excludes voided invoices, and that is load-bearing rather than tidy: the race
-- ALREADY happened on the live tenant, and the duplicates it produced were resolved by voiding the
-- orphans (INV-00055, 56, 59, one of the two INV-00061, 62, 67, one of the two INV-00070). Those
-- rows still exist and still carry the duplicated numbers, so a constraint over all rows could not
-- be created on vettest at all. Excluding voided rows lets the constraint go on today and still
-- refuses a NEW duplicate — which is the thing that must not happen again. A voided invoice is a
-- record of something that was cancelled; it does not need to hold a unique number.
-- `--> statement-breakpoint` between every statement is the Drizzle convention, and it is not
-- cosmetic: both drizzle-kit migrate and the test harness's setup.ts split the file on it. Written
-- without it, this migration applied its FIRST statement and silently dropped the second — the
-- sandbox had visit_invoice_id_unique_idx (which boot reconcile also builds from schema.ts) and no
-- invoice number index at all. The test asserting both indexes exist by name is what caught it.
CREATE UNIQUE INDEX IF NOT EXISTS "visit_invoice_id_unique_idx"
  ON "visit" ("invoice_id") WHERE "invoice_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_company_number_live_unique_idx"
  ON "invoice" ("company_id", "number") WHERE "status" <> 'void';
