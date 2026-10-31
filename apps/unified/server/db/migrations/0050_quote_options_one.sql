-- Good / Better / Best is one feature on the proposal-option model (docs/parity/quote-options-unify.md). Field service's
-- named option lines (quote_line_item.option_group) become real options: one quote_proposal_option row per name on a quote,
-- in the order the names first appear, chosen where its lines were picked, and the lines point at it. A quote that already
-- has proposal options keeps them and its named lines stay as plain optional lines. Then the name column goes.
WITH g AS (
  SELECT li.quote_id, li.option_group, min(li.sort_order) AS first_sort, bool_or(li.selected) AS picked
  FROM "quote_line_item" li
  WHERE li.option_group IS NOT NULL AND li.proposal_option_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM "quote_proposal_option" o WHERE o.quote_id = li.quote_id)
  GROUP BY li.quote_id, li.option_group
), made AS (
  INSERT INTO "quote_proposal_option" ("id", "quote_id", "name", "photos", "recommended", "chosen", "chosen_at", "sort_order", "created_at")
  SELECT gen_random_uuid()::text, g.quote_id, g.option_group, '[]'::json, false, g.picked, CASE WHEN g.picked THEN now() END,
    (row_number() OVER (PARTITION BY g.quote_id ORDER BY g.first_sort, g.option_group) - 1)::int, now()
  FROM g
  RETURNING "id", "quote_id", "name"
)
UPDATE "quote_line_item" li SET "proposal_option_id" = made.id, "optional" = true
FROM made WHERE li.quote_id = made.quote_id AND li.option_group = made.name AND li.proposal_option_id IS NULL;--> statement-breakpoint
ALTER TABLE "quote_line_item" DROP COLUMN IF EXISTS "option_group";
