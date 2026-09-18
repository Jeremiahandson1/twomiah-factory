-- Roster-only crew (team_member rows with no login) can be assigned work. job.assigned_to_id stays the
-- LOGIN user; this column carries a roster member instead. Exactly one of the two is set. (Landscaping T21 M12)
ALTER TABLE "job" ADD COLUMN IF NOT EXISTS "assigned_to_member_id" text REFERENCES "team_member"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "job_assigned_to_member_id_idx" ON "job" ("assigned_to_member_id");
