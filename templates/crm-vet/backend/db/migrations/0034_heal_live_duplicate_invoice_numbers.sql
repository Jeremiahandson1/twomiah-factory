-- The T41 bill-once constraint is not on the live tenant, and this migration both heals the data and
-- creates it. (T58d)
--
--   Owner: "INV-00053 is still duplicated."
--
-- Measured on vettest: INV-00070 and INV-00061 are each 1 live + 1 void, exactly as the T41 clean-up
-- intended — and INV-00053 is TWO LIVE DRAFTS, same company_id, both created 2026-09-23 01:50:03,
-- nothing paid against either. The clean-up's own list ("INV-00055, 56, 59, one of the two
-- INV-00061, 62, 67, one of the two INV-00070") does not include 00053. It was missed.
--
-- WHY THE INDEX IS ABSENT, corrected. The first version of this file said the duplicate had stopped
-- CREATE UNIQUE INDEX from being built. That was a reasonable guess and it was wrong, and it is
-- worth leaving the correction here because the wrong version of this sentence cost three deploys.
--
-- 0029 never ran at all. Its explanatory comment quoted the statement separator in full, drizzle cut
-- the file there without knowing it was inside a comment, and Postgres was handed the second half of
-- a sentence: `syntax error at or near "`" `. A run is one transaction, so 0029 through 0034 all
-- rolled back, on every boot, from 2026-10-03 to 2026-10-07. The service came up anyway — the start
-- command continues past a failed migrate and `drizzle-kit push --force` then reconciles whatever
-- schema.ts declares — so the tenant looked healthy and the only trace was one log line that
-- migrate.ts labelled "Connection failed".
--
-- That is why this file now owns the index as well as the heal: the heal must happen BEFORE the
-- index exists, so they cannot live in two migrations where the index comes first.
-- scripts/check-migration-statements-parse.ts is the guard for the cause.
--
-- WHAT THIS DOES, and what it deliberately refuses to do.
--
-- For each company, for each number held by more than one LIVE invoice: the oldest row keeps the
-- number. The others are renumbered — but ONLY if they are still drafts.
--
--   a DRAFT has not been sent, printed or paid. Nobody has seen its number, so changing it costs
--   nothing and makes the data honest.
--
--   anything else — sent, partial, paid, overdue — keeps its number and is LEFT ALONE. Renumbering
--   a bill a client is holding is a worse fault than the duplicate, and silently editing a sent
--   invoice is not something a migration should do. If one exists, the index below will fail to
--   create and the failure will name the row, which is the correct outcome: a human decides.
--
-- The new number is taken from above the company's current maximum, so it cannot collide with
-- anything, including rows voided earlier.
-- The new number is computed in a CTE, not in SET: Postgres refuses a window function in UPDATE
-- ("window functions are not allowed in UPDATE"), so ROW_NUMBER() has to run in a SELECT and the
-- UPDATE just reads the result.
WITH live_dupes AS (
  SELECT id, company_id, number, created_at,
         ROW_NUMBER() OVER (PARTITION BY company_id, number ORDER BY created_at, id) AS seq
    FROM invoice
   WHERE status <> 'void'
), next_num AS (
  SELECT company_id,
         COALESCE(MAX(NULLIF(regexp_replace(number, '\D', '', 'g'), '')::bigint), 0) AS high
    FROM invoice
   GROUP BY company_id
), renumber AS (
  SELECT d.id,
         'INV-' || LPAD(
           (n.high + ROW_NUMBER() OVER (PARTITION BY d.company_id ORDER BY d.created_at, d.id))::text,
           5, '0'
         ) AS new_number
    FROM live_dupes d
    JOIN invoice i   ON i.id = d.id
    JOIN next_num n  ON n.company_id = d.company_id
   WHERE d.seq > 1
     AND i.status = 'draft'
)
UPDATE invoice i
   SET number = r.new_number,
       updated_at = NOW()
  FROM renumber r
 WHERE i.id = r.id;
--> statement-breakpoint
-- …and now it can be built. IF NOT EXISTS, so a tenant that already has it is untouched.
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_company_number_live_unique_idx"
  ON "invoice" ("company_id", "number") WHERE "status" <> 'void';
