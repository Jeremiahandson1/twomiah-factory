ALTER TABLE "expenses" ADD COLUMN "vendor" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "payment_method" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tax_deductible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "reimbursable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_codes" ADD COLUMN "revenue_code" text;--> statement-breakpoint
ALTER TABLE "service_codes" ADD COLUMN "requires_auth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "service_codes" ADD COLUMN "notes" text;