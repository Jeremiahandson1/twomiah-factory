-- The T41 bill-once constraint was never created on the live tenant, and one row is why. (T58d)
--
--   Owner: "INV-00053 is still duplicated."
--
-- It is, and the significant part is not the duplicate — it is what the duplicate prevented.
-- Migration 0029 creates
--
--   CREATE UNIQUE INDEX IF NOT EXISTS invoice_company_number_live_unique_idx
--     ON invoice (company_id, number) WHERE status <> 'void'
--
-- and its own comment lists the duplicates the T41 clean-up had resolved by voiding the orphan:
-- "INV-00055, 56, 59, one of the two INV-00061, 62, 67, one of the two INV-00070". INV-00053 is not
-- in that list. It was missed.
--
-- So on vettest the CREATE UNIQUE INDEX had two live rows sharing (company_id, 'INV-00053') and
-- could not be built. Measured today: INV-00070 and INV-00061 are each 1 live + 1 void, exactly as
-- the clean-up intended — and INV-00053 is TWO LIVE DRAFTS. The index is absent, which means the
-- database backstop under "bill a visit once" is not in place on the one tenant it was written for,
-- while the suite passes because a fresh sandbox has clean data.
--
-- A constraint that silently fails to be created is worse than no constraint, because everything
-- downstream believes it is there.
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
