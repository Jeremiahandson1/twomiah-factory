-- Why a sale was voided, kept on the sale itself. (T52 M5)
--
-- Cancelling an order removed money and stock from the day and recorded no reason anywhere: the
-- status route parsed { status } only, so a reason sent with the request was dropped before anything
-- could store or audit it. A refund has carried refund_reason since the first migration; a void is
-- the same kind of event and had nothing.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cancelled_by" text;
