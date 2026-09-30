-- Who submitted an expense, who approved it, who paid it. (Salon RR6 E1/E7, and N1 depends on it)
--
-- The expense table had no submitter at all, so the server could not tell whose expense it was.
-- Three findings follow from that one gap: a manager could approve and reimburse their own expense
-- (the whole chain the time module closes), a stylist saw every expense in the company, and the
-- Edit/Delete offered on their own row always answered 403 because ownership could not be checked.
--
-- Nullable on purpose: existing rows have no submitter and must stay editable by a manager rather
-- than becoming nobody problem. The self-approval rule only bites where a submitter is recorded.
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "submitted_by_id" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "approved_by_id" text;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "expense" ADD COLUMN IF NOT EXISTS "reimbursed_by_id" text;
