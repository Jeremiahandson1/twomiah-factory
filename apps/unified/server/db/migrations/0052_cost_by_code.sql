ALTER TABLE "expense" ADD COLUMN "cost_code" text;--> statement-breakpoint
ALTER TABLE "time_entry" ADD COLUMN "cost_code" text;--> statement-breakpoint
ALTER TABLE "vendor_bill" ADD COLUMN "cost_code" text;