-- What a quote line COSTS to deliver, and which pricebook item it came from. (T41)
--
-- Job costing reported 100% margin on quoted work, and the reason was written in the code:
-- estimatedCostsByQuote summed each line's `total`, which is the price to the CUSTOMER, because a
-- quote line had no cost field at all. Its own comment said so — "making it a true estimated cost
-- needs a cost column on quote lines and a screen to enter it, and inventing a margin assumption to
-- fill the gap is exactly the fault being fixed elsewhere in here."
--
-- The pricebook already records `cost` per item alongside `price`, so the figure exists; there was
-- simply nowhere for it to land when a line was put on a quote. These two columns are that place:
--
--   unit_cost          what the company pays, per unit, for this line
--   pricebook_item_id  the catalogue item it was taken from, so a later price/cost revision is
--                      traceable and the picker can show what changed
--
-- Both are NULLABLE and both are ignored when null: a line typed by hand with no cost still behaves
-- exactly as it did before, and every quote already in the system keeps its current meaning rather
-- than suddenly reporting a 100% margin as a 0% one.
ALTER TABLE "quote_line_item" ADD COLUMN IF NOT EXISTS "unit_cost" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "quote_line_item" ADD COLUMN IF NOT EXISTS "pricebook_item_id" text;
--> statement-breakpoint
-- No FK on pricebook_item_id, deliberately: retiring a catalogue item must not be blocked by, or
-- cascade into, quotes that were priced from it. The id is kept as provenance.
CREATE INDEX IF NOT EXISTS "quote_line_item_pricebook_item_id_idx" ON "quote_line_item" ("pricebook_item_id");
