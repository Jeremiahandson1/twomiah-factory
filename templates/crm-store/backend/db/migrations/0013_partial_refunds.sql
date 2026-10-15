-- Partial refunds (E2E Run 2: "the store has no way to refund one item"). Each refund is its own row; the order keeps the
-- running total sent back and each line how many of its units have been refunded (routes/orders.ts refundPart).
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "refunded_cents" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "refunded_quantity" integer NOT NULL DEFAULT 0;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "order_refunds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
  "amount_cents" integer NOT NULL,
  "shipping_cents" integer NOT NULL DEFAULT 0,
  "items" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "restock" boolean NOT NULL DEFAULT false,
  "reason" text,
  "status" text NOT NULL DEFAULT 'pending',
  "money_back" text,
  "provider_refund_id" text,
  "error" text,
  "created_by" uuid,
  "created_by_name" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_refunds_order_idx" ON "order_refunds" ("order_id");--> statement-breakpoint
-- Orders refunded before this: the whole total went back, and every unit with it.
UPDATE "orders" SET "refunded_cents" = "total_cents" WHERE "status" = 'refunded' AND "refunded_cents" = 0;--> statement-breakpoint
UPDATE "order_items" SET "refunded_quantity" = "quantity"
  WHERE "refunded_quantity" = 0 AND "order_id" IN (SELECT "id" FROM "orders" WHERE "status" = 'refunded');
