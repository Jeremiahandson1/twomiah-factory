ALTER TABLE "salon_terminal_charge" ALTER COLUMN "reader_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "salon_terminal_charge" ADD COLUMN "source" text DEFAULT 'reader' NOT NULL;