ALTER TABLE "orders" ADD COLUMN "label_shipment_id" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "label_voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "label_refund_status" text;--> statement-breakpoint
ALTER TABLE "store_returns" ADD COLUMN "label_shipment_id" text;--> statement-breakpoint
ALTER TABLE "store_returns" ADD COLUMN "label_voided_at" timestamp;--> statement-breakpoint
ALTER TABLE "store_returns" ADD COLUMN "label_refund_status" text;