ALTER TABLE "invoice" ADD COLUMN IF NOT EXISTS "event_id" text REFERENCES "event"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "invoice_event_id_idx" ON "invoice" ("event_id");--> statement-breakpoint
ALTER TABLE "event_menu_item" ADD COLUMN IF NOT EXISTS "space_id" text REFERENCES "event_space"("id") ON DELETE set null;
