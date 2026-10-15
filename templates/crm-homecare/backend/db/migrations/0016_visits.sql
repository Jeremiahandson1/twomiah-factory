-- Visits: the schedule, the punch, and everything that changes a visit.
--
-- Ported from the CVHC home care CRM (migrations v24, v27, v36, v41, v50, v53, v54, v56, v57,
-- v63, v65, v69, v71 and the two job tables its crons create on first use). Template naming
-- wins: ids are text, "who" columns end in _by_id, and nothing here duplicates a column the
-- template already holds (open_shifts.date is CVHC's shift_date, created_by_id its created_by,
-- shift_swaps.reviewed_by_id/reviewed_at its admin_approved_by/admin_approved_at).
--
-- Additive. The two partial UNIQUE indexes are created only when the live data already
-- satisfies them, so a tenant carrying a historical duplicate keeps migrating (a failed
-- statement here would roll back this migration and every one after it).

-- ── schedules ────────────────────────────────────────────────────────────────────────────
-- v50 training shift: paid through payroll, never billed to the client.
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "is_training" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_is_training" ON "schedules" ("is_training") WHERE "is_training" = true;
--> statement-breakpoint
-- v54 suspend service: occurrences on/after this date stop generating; NULL = active.
ALTER TABLE "schedules" ADD COLUMN IF NOT EXISTS "suspended_from" date;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedules_suspended_from" ON "schedules" ("suspended_from") WHERE "suspended_from" IS NOT NULL;
--> statement-breakpoint
-- v36: a recurring pattern with no effective_date expanded backwards without limit and
-- back-billed / back-paid phantom visits. Give every such row the date it was entered.
UPDATE "schedules" SET "effective_date" = "created_at"::date
 WHERE "day_of_week" IS NOT NULL AND "effective_date" IS NULL;
--> statement-breakpoint
-- v53: at most one ACTIVE, not-ended recurring pattern per caregiver + client + weekday + times.
-- schedules.start_time / end_time are timestamps in this template; the wall-clock time is what
-- identifies the shift, so the index is on the ::time of each.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "schedules"
     WHERE "is_active" = true AND "day_of_week" IS NOT NULL AND "end_date" IS NULL
     GROUP BY "caregiver_id", "client_id", "day_of_week", ("start_time"::time), ("end_time"::time)
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "uniq_active_recurring_schedule"
      ON "schedules" ("caregiver_id", "client_id", "day_of_week", ("start_time"::time), ("end_time"::time))
      WHERE "is_active" = true AND "day_of_week" IS NOT NULL AND "end_date" IS NULL;
  END IF;
END $$;
--> statement-breakpoint

-- ── schedule_exceptions (v63) ────────────────────────────────────────────────────────────
-- Why the occurrence was cancelled: client_refused, client_not_home, client_hospital,
-- client_cancelled, caregiver_callout, admin_cancelled, other. NULL = no reason recorded.
ALTER TABLE "schedule_exceptions" ADD COLUMN IF NOT EXISTS "cancel_reason" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_schedule_exceptions_cancel_reason" ON "schedule_exceptions" ("exception_date")
  WHERE "exception_type" = 'cancelled' AND "cancel_reason" IS NOT NULL;
--> statement-breakpoint

-- ── time_entries (v27, v56) ──────────────────────────────────────────────────────────────
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "needs_approval" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approval_reason" text;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approved_by_id" text REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approved_billable_minutes" integer;
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "approval_notes" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_time_entries_needs_approval" ON "time_entries" ("needs_approval") WHERE "needs_approval" = true;
--> statement-breakpoint
-- v56: one open time entry per caregiver. Two concurrent taps of the same clock-in used to
-- insert twin entries that billed the visit twice; the index makes the second insert lose.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "time_entries" WHERE "end_time" IS NULL GROUP BY "caregiver_id" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "uniq_open_time_entry_per_caregiver"
      ON "time_entries" ("caregiver_id") WHERE "end_time" IS NULL;
  END IF;
END $$;
--> statement-breakpoint

-- ── open_shifts (v8 columns the template never had, v71 visibility) ─────────────────────
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "schedule_id" text REFERENCES "schedules"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "care_type_id" text;
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "hourly_rate" numeric(10, 2);
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "bonus_amount" numeric(10, 2) DEFAULT '0';
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "urgency" text DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "claimed_by_id" text REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "claimed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "approved_by_id" text REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "approved_at" timestamp;
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "broadcast_sent" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- The caregivers the office offered the shift to (NULL = everyone) and whether the first of
-- them to accept gets it with no approval step.
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "visible_to" text[];
--> statement-breakpoint
ALTER TABLE "open_shifts" ADD COLUMN IF NOT EXISTS "auto_assign" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shifts_schedule_id_idx" ON "open_shifts" ("schedule_id");
--> statement-breakpoint
-- Who accepted an open shift. Caregivers are users (v65: the FK points at users, never at
-- caregiver_profiles).
CREATE TABLE IF NOT EXISTS "open_shift_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "open_shift_id" text NOT NULL REFERENCES "open_shifts"("id") ON DELETE CASCADE,
  "caregiver_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "notes" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "open_shift_claims_open_shift_id_idx" ON "open_shift_claims" ("open_shift_id");
--> statement-breakpoint

-- ── shift_swaps: the target caregiver's answer ───────────────────────────────────────────
ALTER TABLE "shift_swaps" ADD COLUMN IF NOT EXISTS "responded_at" timestamp;
--> statement-breakpoint
ALTER TABLE "shift_swaps" ADD COLUMN IF NOT EXISTS "notes" text;
--> statement-breakpoint

-- ── visit change requests (v24, v57) ─────────────────────────────────────────────────────
-- A cancel or reschedule asked for by the client (portal), the caregiver (their phone) or the
-- office. One queue, one resolve endpoint.
CREATE TABLE IF NOT EXISTS "visit_change_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "caregiver_id" text NOT NULL REFERENCES "users"("id"),
  "request_type" text NOT NULL,
  "visit_id" text,
  "schedule_id" text REFERENCES "schedules"("id") ON DELETE SET NULL,
  "visit_date" date NOT NULL,
  "original_start_time" time NOT NULL,
  "original_end_time" time NOT NULL,
  "cancel_reason" text,
  "proposed_date" date,
  "proposed_start_time" time,
  "proposed_end_time" time,
  "counter_date" date,
  "counter_start_time" time,
  "counter_end_time" time,
  "counter_message" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "requested_by" text DEFAULT 'client' NOT NULL,
  "request_reason" text,
  "applied_schedule_id" text REFERENCES "schedules"("id") ON DELETE SET NULL,
  "resolved_at" timestamp,
  "resolved_by_id" text REFERENCES "users"("id"),
  "admin_notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_client_id_idx" ON "visit_change_requests" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_caregiver_id_idx" ON "visit_change_requests" ("caregiver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_status_created_idx" ON "visit_change_requests" ("status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_change_requests_visit_date_idx" ON "visit_change_requests" ("visit_date");
--> statement-breakpoint
-- The portal's per-visit rows: the family's own note, and which schedule row a visit came from.
ALTER TABLE "scheduled_visits" ADD COLUMN IF NOT EXISTS "client_notes" text;
--> statement-breakpoint
ALTER TABLE "scheduled_visits" ADD COLUMN IF NOT EXISTS "source_schedule_id" text REFERENCES "schedules"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- ── visit photos (v41) ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "visit_photos" (
  "id" text PRIMARY KEY NOT NULL,
  "time_entry_id" text NOT NULL REFERENCES "time_entries"("id") ON DELETE CASCADE,
  "caregiver_id" text REFERENCES "users"("id") ON DELETE SET NULL,
  "client_id" text REFERENCES "clients"("id") ON DELETE SET NULL,
  "caption" text,
  "category" text,
  "image_base64" text NOT NULL,
  "image_size" integer,
  "taken_at" timestamp DEFAULT now() NOT NULL,
  "uploaded_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "visit_photo_size_cap" CHECK ("image_size" IS NULL OR "image_size" <= 5000000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_photos_time_entry_id_idx" ON "visit_photos" ("time_entry_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_photos_client_id_idx" ON "visit_photos" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_photos_taken_at_idx" ON "visit_photos" ("taken_at");
--> statement-breakpoint

-- ── visit documentation (v69) ────────────────────────────────────────────────────────────
-- One office-entered care note per visit. A visit is client + date + scheduled start +
-- caregiver. tasks is a snapshot [{ taskId, taskName, done }] so renaming a care task never
-- rewrites what a past note said.
CREATE TABLE IF NOT EXISTS "visit_documentation" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "caregiver_id" text NOT NULL REFERENCES "users"("id"),
  "visit_date" date NOT NULL,
  "start_time" time NOT NULL,
  "end_time" time NOT NULL,
  "schedule_id" text REFERENCES "schedules"("id") ON DELETE SET NULL,
  "tasks" json DEFAULT '[]'::json NOT NULL,
  "note" text,
  "entered_by_id" text REFERENCES "users"("id"),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "visit_documentation_visit_idx" ON "visit_documentation" ("client_id", "visit_date", "start_time", "caregiver_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visit_documentation_client_date_idx" ON "visit_documentation" ("client_id", "visit_date");
--> statement-breakpoint

-- ── the two background jobs' once-only logs ──────────────────────────────────────────────
-- "Shift in 1 hour" is sent at most once per schedule per day.
CREATE TABLE IF NOT EXISTS "shift_reminder_log" (
  "schedule_id" text NOT NULL,
  "shift_date" date NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("schedule_id", "shift_date")
);
--> statement-breakpoint
-- Each over-visit-length threshold (+5 / +30 / +60 min) fires at most once per time entry.
-- sent = false marks a lower threshold a delayed scan skipped over.
CREATE TABLE IF NOT EXISTS "overtime_alert_log" (
  "time_entry_id" text NOT NULL,
  "threshold_min" integer NOT NULL,
  "sent" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  PRIMARY KEY ("time_entry_id", "threshold_min")
);
