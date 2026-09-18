-- Reminders left no trace. A shot was chased, the owner got the text, and the due list looked exactly the
-- same the next morning — so nobody could tell what had already been done, and the same client could be
-- texted about the same vaccine every day. These stamps are what "already reminded" means. (Vet T12 M9)
ALTER TABLE "vaccination" ADD COLUMN IF NOT EXISTS "last_reminded_at" timestamp;
ALTER TABLE "vaccination" ADD COLUMN IF NOT EXISTS "reminder_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "contact" ADD COLUMN IF NOT EXISTS "last_reminded_at" timestamp;
