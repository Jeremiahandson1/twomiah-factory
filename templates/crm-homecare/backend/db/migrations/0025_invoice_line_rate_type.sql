-- invoice_line_items.rate_type: the unit a line's rate is in, so the invoice prints quantity x rate = amount
-- in ONE unit. 'hourly' = hours x rate; '15min' = (hours x 4) units x rate. Every writer now stamps the
-- rate_type of the rate that priced the line (services/invoiceEngine.ts insertLineItems refuses a line
-- without one). A per-15-minute line used to print "Hours 2.00, Rate 7.50, Amount 60.00".
ALTER TABLE "invoice_line_items" ADD COLUMN IF NOT EXISTS "rate_type" text;
--> statement-breakpoint
-- Lines written before this migration: the unit is read from the line's own numbers. A line whose amount
-- is its 15-minute units x rate (and not hours x rate) was priced per 15 minutes; every other line was
-- priced per hour (a $0 or 0-hour line multiplies the same either way).
UPDATE "invoice_line_items"
   SET "rate_type" = CASE
         WHEN "rate" > 0 AND "hours" > 0
          AND ABS("amount" - ROUND(ROUND("hours" * 4, 2) * "rate", 2)) < 0.01
          AND ABS("amount" - ROUND("hours" * "rate", 2)) >= 0.01
         THEN '15min' ELSE 'hourly' END
 WHERE "rate_type" IS NULL;
