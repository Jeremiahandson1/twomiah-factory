// Home care — clients and care: the raw SQL of the clients group (server/crm/homecare/clients/). Moved from
// templates/crm-homecare/backend/src/routes/{clients,carePlans,careTasks,medications,adl,forms,documents,emergency}.ts,
// which ran these against their one-agency database. One named function per query, each scoped to the company and
// returning camelCase (RULEBOOK §2); `users` is `"user"`. The reads the query builder can say are in the routers.
import { sql, type SQL } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, camelFirst, rowsOf } from '@twomiah/tenant-backend'
import { servedBy, localDate, occurrencesCte, agencyClock, dayStartUtc, dayEndUtc, type Q } from './homecareCore.ts'
import { weekCte, visitMinutesSql } from './homecareEvv.ts'

/** A transaction-scoped lock on a name (one company's first-read seeding, so two first reads write one library). */
export async function lockFor(q: Q, key: string): Promise<void> {
  await q.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`)
}

// ── Clients (routes/clients.ts) ──────────────────────────────────────────────────────────────

// What a caregiver's phone needs about the clients they serve — never their identifiers.
const CAREGIVER_CLIENT_COLS = sql.raw(`c.id, c.first_name, c.last_name, c.address, c.city, c.state, c.zip, c.phone,
  c.latitude, c.longitude, c.is_active, c.care_type_id, c.assistance_needs, c.allergies, c.service_type`)

/** The active clients this caregiver serves (core/caregiverAccess.ts's rule), by name. */
export async function caregiverClientList(q: Q, companyId: string, caregiverId: string): Promise<any[]> {
  const { today } = await agencyClock(q, companyId)
  return camelRows(await q.execute(sql`SELECT ${CAREGIVER_CLIENT_COLS} FROM clients c
    WHERE c.company_id = ${companyId} AND c.is_active = true AND ${servedBy(companyId, caregiverId, today)}
    ORDER BY c.last_name, c.first_name`))
}

/** The ids of every client (active or not) this caregiver serves. */
export async function clientIdsServedBy(q: Q, companyId: string, caregiverId: string): Promise<string[]> {
  const { today } = await agencyClock(q, companyId)
  return rowsOf(await q.execute(sql`SELECT c.id FROM clients c WHERE c.company_id = ${companyId} AND ${servedBy(companyId, caregiverId, today)}`))
    .map((r: any) => String(r.id))
}

/** One client this caregiver serves, in the caregiver's columns; null when not theirs. */
export async function caregiverClientOne(q: Q, companyId: string, caregiverId: string, clientId: string): Promise<any | null> {
  const { today } = await agencyClock(q, companyId)
  return camelFirst(await q.execute(sql`SELECT ${CAREGIVER_CLIENT_COLS} FROM clients c
    WHERE c.company_id = ${companyId} AND c.id = ${clientId} AND ${servedBy(companyId, caregiverId, today)}`)) ?? null
}

/**
 * This Sun–Sat week's Sandata (EVV) minutes per Sandata client: the weekly allowance in units, the minutes already sent
 * and the visits, on the agency's clock. The same counting rule as evvWeekUsageRow (data/homecareEvv.ts).
 */
export async function evvWeekRows(q: Q, companyId: string, clientId: string | null, tz: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${weekCte(null, tz)},
         used AS (
           SELECT te.client_id,
                  SUM(${visitMinutesSql(sql`now()`)}) AS minutes,
                  COUNT(*) AS visits
             FROM time_entries te, w
            WHERE te.company_id = ${companyId}
              AND ((te.start_time AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date BETWEEN w.ws AND w.ws + 6
              AND COALESCE(te.sandata_required, true) = true
            GROUP BY te.client_id)
    SELECT c.id AS client_id, c.first_name, c.last_name, c.evv_weekly_units,
           to_char(w.ws, 'YYYY-MM-DD') AS week_start, to_char(w.ws + 6, 'YYYY-MM-DD') AS week_end,
           ROUND(COALESCE(used.minutes, 0))::int AS used_minutes,
           COALESCE(used.visits, 0)::int AS sandata_visits
      FROM clients c
      CROSS JOIN w
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id AND rs.company_id = c.company_id
      LEFT JOIN used ON used.client_id = c.id
     WHERE c.company_id = ${companyId}
       AND c.is_active = true AND COALESCE(c.is_private_pay, false) = false
       AND rs.sandata_evv_required = true
       AND TRIM(COALESCE(c.medicaid_id, '')) ~ '^[0-9]{10,12}$'
       AND (${clientId}::text IS NULL OR c.id = ${clientId}::text)
     ORDER BY c.last_name, c.first_name`))
}

/** The caregiver's client card: care information only (no SSN, Medicaid id, insurance, pay or portal fields). */
export async function clientCaregiverCard(q: Q, companyId: string, clientId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT c.id, c.first_name, c.last_name, to_char(c.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
           c.phone, c.email, c.address, c.city, c.state, c.zip,
           COALESCE(ec.name, c.emergency_contact_name) AS emergency_contact_name,
           COALESCE(NULLIF(ec.phone, ''), c.emergency_contact_phone) AS emergency_contact_phone,
           COALESCE(NULLIF(ec.relationship, ''), c.emergency_contact_relationship) AS emergency_contact_relationship,
           c.medical_conditions, c.medications, c.allergies, c.medical_notes, c.care_preferences,
           c.assistance_needs AS mobility_assistance_needs, c.preferred_caregivers, c.notes
      FROM clients c
      LEFT JOIN LATERAL (SELECT e.name, e.phone, e.relationship FROM client_emergency_contacts e
                          WHERE e.client_id = c.id AND e.company_id = c.company_id
                          ORDER BY e.is_primary DESC, e.created_at LIMIT 1) ec ON true
     WHERE c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}

/**
 * The client's notes, newest first, 100 at most: card notes (client_visit_notes), visit-documentation notes and
 * clock-out notes; the system's auto-close markers are not notes.
 */
export async function clientVisitNoteFeed(q: Q, companyId: string, clientId: string, systemMarkers: string[]): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT n.id, n.note, n.created_at, n.source,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM (
        SELECT vn.id, vn.note, vn.created_at, vn.caregiver_id, 'manual' AS source
          FROM client_visit_notes vn WHERE vn.client_id = ${clientId} AND vn.company_id = ${companyId}
        UNION ALL
        SELECT vd.id, vd.note, vd.updated_at, COALESCE(vd.entered_by_id, vd.caregiver_id), 'visit' AS source
          FROM visit_documentation vd
         WHERE vd.client_id = ${clientId} AND vd.company_id = ${companyId} AND vd.note IS NOT NULL AND TRIM(vd.note) <> ''
        UNION ALL
        SELECT te.id, te.notes AS note, te.start_time AS created_at, te.caregiver_id, 'clock_out' AS source
          FROM time_entries te
         WHERE te.client_id = ${clientId} AND te.company_id = ${companyId} AND te.is_complete = true
           AND te.notes IS NOT NULL AND TRIM(te.notes) <> ''
           AND te.notes NOT IN (${sql.join(systemMarkers.map((m) => sql`${m}`), sql`, `)})
      ) n
      LEFT JOIN "user" u ON n.caregiver_id = u.id
     ORDER BY n.created_at DESC
     LIMIT 100`))
}

/** A general note on the client's card (not on a visit). */
export async function insertClientCardNote(q: Q, companyId: string, clientId: string, caregiverId: string, note: string): Promise<any> {
  return camelFirst(await q.execute(sql`
    INSERT INTO client_visit_notes (id, company_id, client_id, caregiver_id, note, created_at, updated_at)
    VALUES (${createId()}, ${companyId}, ${clientId}, ${caregiverId}, ${note}, NOW(), NOW())
    RETURNING id, client_id, caregiver_id, note, created_at`))
}

// ── Care plans (routes/carePlans.ts) ─────────────────────────────────────────────────────────

/** The office summary's three groupings: all plans, by service type, by client. */
export async function carePlanSummaryCounts(q: Q, companyId: string): Promise<{ total: number; byServiceType: any[]; byClient: any[] }> {
  const [total, byServiceType, byClient] = await Promise.all([
    q.execute(sql`SELECT COUNT(*)::int AS total_plans FROM care_plans WHERE company_id = ${companyId}`),
    q.execute(sql`SELECT service_type, COUNT(*)::int AS count FROM care_plans WHERE company_id = ${companyId}
                  GROUP BY service_type ORDER BY count DESC`),
    q.execute(sql`SELECT cl.id, cl.first_name || ' ' || cl.last_name AS client_name, COUNT(cp.id)::int AS plan_count
                    FROM clients cl LEFT JOIN care_plans cp ON cl.id = cp.client_id AND cp.company_id = cl.company_id
                   WHERE cl.company_id = ${companyId}
                   GROUP BY cl.id, cl.first_name, cl.last_name HAVING COUNT(cp.id) > 0 ORDER BY plan_count DESC`),
  ])
  return { total: Number(rowsOf(total)[0]?.total_plans ?? 0), byServiceType: camelRows(byServiceType), byClient: camelRows(byClient) }
}

/** A plan's prior versions, newest first, with who changed each. */
export async function carePlanRevisionRows(q: Q, companyId: string, carePlanId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT cpr.*, to_char(cpr.start_date, 'YYYY-MM-DD') AS start_date, to_char(cpr.end_date, 'YYYY-MM-DD') AS end_date,
           to_char(cpr.visit_schedule_as_of, 'YYYY-MM-DD') AS visit_schedule_as_of,
           u.first_name AS changed_by_first, u.last_name AS changed_by_last
      FROM care_plan_revisions cpr
      LEFT JOIN "user" u ON cpr.changed_by_id = u.id
     WHERE cpr.care_plan_id = ${carePlanId} AND cpr.company_id = ${companyId}
     ORDER BY cpr.revision_number DESC`))
}

/** The next revision number of a plan (call with the plan row locked). */
export async function nextCarePlanRevision(q: Q, companyId: string, carePlanId: string): Promise<number> {
  return Number(rowsOf(await q.execute(sql`SELECT COALESCE(MAX(revision_number), 0) + 1 AS n FROM care_plan_revisions
    WHERE care_plan_id = ${carePlanId} AND company_id = ${companyId}`))[0]?.n ?? 1)
}

// ── Care tasks (routes/careTasks.ts) ─────────────────────────────────────────────────────────

/** The client's active checklist, in order. */
export async function clientTaskRows(q: Q, companyId: string, clientId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT id, client_id, task_name, description, category, allotted_minutes,
           weekly_frequency, days_of_week, time_of_day, assessment_source, cadence, is_required,
           sort_order, is_active, created_at, updated_at
      FROM client_task_templates
     WHERE client_id = ${clientId} AND company_id = ${companyId} AND is_active = true
     ORDER BY sort_order, created_at`))
}

/** The sort order after the client's last task. */
export async function nextTaskSortOrder(q: Q, companyId: string, clientId: string): Promise<number> {
  return Number(rowsOf(await q.execute(sql`SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM client_task_templates
    WHERE client_id = ${clientId} AND company_id = ${companyId}`))[0]?.next ?? 0)
}

/** Per active task over the last `days`: completed / skipped / refused and the last completion, with the shift count. */
export async function taskAdherence(q: Q, companyId: string, clientId: string, days: number): Promise<{ totalShifts: number; tasks: any[] }> {
  const since = sql`NOW() - (${String(days)} || ' days')::interval`
  const totalShifts = Number(rowsOf(await q.execute(sql`
    SELECT COUNT(*)::int AS n FROM time_entries WHERE client_id = ${clientId} AND company_id = ${companyId} AND start_time >= ${since}`))[0]?.n || 0)
  const tasks = camelRows(await q.execute(sql`
    SELECT t.id AS task_id, t.task_name, t.category, t.cadence,
           COUNT(*) FILTER (WHERE sc.status = 'completed' AND te.start_time >= ${since})::int AS completed,
           COUNT(*) FILTER (WHERE sc.status = 'skipped'   AND te.start_time >= ${since})::int AS skipped,
           COUNT(*) FILTER (WHERE sc.status = 'refused'   AND te.start_time >= ${since})::int AS refused,
           MAX(sc.completed_at) FILTER (WHERE te.start_time >= ${since}) AS last_completed
      FROM client_task_templates t
      LEFT JOIN shift_task_completions sc ON sc.task_template_id = t.id AND sc.company_id = t.company_id
      LEFT JOIN time_entries te ON te.id = sc.time_entry_id
     WHERE t.client_id = ${clientId} AND t.company_id = ${companyId} AND t.is_active = true
     GROUP BY t.id, t.task_name, t.category, t.cadence, t.sort_order
     ORDER BY t.sort_order, t.task_name`))
  return { totalShifts, tasks }
}

/**
 * One shift's checklist: each active task of the shift's client with this shift's mark (pending when none) and whether
 * it was completed on any shift since Monday 00:00 of the agency's week.
 */
export async function shiftChecklist(q: Q, companyId: string, timeEntryId: string, clientId: string, tz: string): Promise<any[]> {
  const weekStart = sql`((date_trunc('week', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')`
  return camelRows(await q.execute(sql`
    SELECT t.id AS task_id, t.task_name, t.description, t.category, t.allotted_minutes,
           t.weekly_frequency, t.days_of_week, t.time_of_day, t.sort_order, t.cadence, t.is_required,
           sc.id AS completion_id, COALESCE(sc.status, 'pending') AS status,
           sc.notes, sc.completed_at, sc.updated_at,
           EXISTS (
             SELECT 1 FROM shift_task_completions sc2
               JOIN time_entries te2 ON te2.id = sc2.time_entry_id
              WHERE sc2.task_template_id = t.id
                AND sc2.status = 'completed'
                AND te2.start_time >= ${weekStart}
           ) AS done_this_week
      FROM client_task_templates t
      LEFT JOIN shift_task_completions sc ON sc.task_template_id = t.id AND sc.time_entry_id = ${timeEntryId}
     WHERE t.client_id = ${clientId} AND t.company_id = ${companyId} AND t.is_active = true
     ORDER BY t.sort_order, t.created_at`))
}

/**
 * The required tasks of this shift's client that are still open: no mark, or a mark that is not "done" and not a skip /
 * refusal that carries a reason. A weekly task already completed on another shift this week is not open. (Item 12.)
 */
export async function pendingRequiredTasks(q: Q, companyId: string, timeEntryId: string, clientId: string, tz: string): Promise<{ taskId: string; taskName: string }[]> {
  const weekStart = sql`((date_trunc('week', NOW() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AT TIME ZONE 'UTC')`
  return camelRows(await q.execute(sql`
    SELECT t.id AS task_id, t.task_name
      FROM client_task_templates t
      LEFT JOIN shift_task_completions sc ON sc.task_template_id = t.id AND sc.time_entry_id = ${timeEntryId}
     WHERE t.client_id = ${clientId} AND t.company_id = ${companyId} AND t.is_active = true AND t.is_required = true
       AND NOT (COALESCE(sc.status, 'pending') = 'completed'
                OR (COALESCE(sc.status, 'pending') IN ('skipped', 'refused') AND COALESCE(TRIM(sc.notes), '') <> ''))
       AND NOT (t.cadence = 'weekly' AND EXISTS (
             SELECT 1 FROM shift_task_completions sc2
               JOIN time_entries te2 ON te2.id = sc2.time_entry_id
              WHERE sc2.task_template_id = t.id AND sc2.status = 'completed' AND te2.start_time >= ${weekStart}))
     ORDER BY t.sort_order, t.created_at`)) as any
}

// ── Medications and the MAR (routes/medications.ts) ──────────────────────────────────────────

/** Per active medication over the window: doses given, refused, missed, held, and every entry. */
export async function medicationAdherence(q: Q, companyId: string, clientId: string, from: string, to: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT m.name AS medication_name,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'given')::int AS administered_count,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'refused')::int AS refused_count,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'missed')::int AS missed_count,
           COUNT(ml.id) FILTER (WHERE COALESCE(ml.effective_status, ml.status) = 'held')::int AS held_count,
           COUNT(ml.id)::int AS total_entries
      FROM medications m
      LEFT JOIN medication_logs ml ON ml.medication_id = m.id AND ml.company_id = m.company_id
       AND ml.administered_at >= ${from}::date AND ml.administered_at < (${to}::date + 1)
     WHERE m.client_id = ${clientId} AND m.company_id = ${companyId} AND m.status = 'active'
     GROUP BY m.id, m.name
     ORDER BY m.name`))
}

/** Today on the agency's calendar (the MAR's discontinue date) — the database's CURRENT_DATE was UTC's day. */
export async function databaseToday(q: Q, companyId: string): Promise<string> {
  return (await agencyClock(q, companyId)).today
}

// ── ADL (routes/adl.ts) ──────────────────────────────────────────────────────────────────────

/** Per ADL category over the window (default the last 30 days): entries by status. */
export async function adlCompletion(q: Q, companyId: string, clientId: string, from: string | null, to: string | null): Promise<any[]> {
  // The window is the agency's days: from its midnight on the first to the end of the last (the default: the last 30).
  const { today, tz } = await agencyClock(q, companyId)
  const ymd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
  const lastDay = ymd(to) ?? today
  const firstDay = ymd(from) ?? new Date(Date.parse(`${today}T00:00:00Z`) - 30 * 86_400_000).toISOString().slice(0, 10)
  return camelRows(await q.execute(sql`
    SELECT al.adl_category,
           COUNT(*)::int AS total_entries,
           COUNT(*) FILTER (WHERE al.status = 'completed')::int AS completed_count,
           COUNT(*) FILTER (WHERE al.status = 'partial')::int AS partial_count,
           COUNT(*) FILTER (WHERE al.status = 'refused')::int AS refused_count,
           COUNT(*) FILTER (WHERE al.status = 'not_needed')::int AS not_needed_count
      FROM adl_logs al
     WHERE al.client_id = ${clientId} AND al.company_id = ${companyId}
       AND al.performed_at >= ${dayStartUtc(firstDay, tz)}
       AND al.performed_at < ${dayEndUtc(lastDay, tz)}
     GROUP BY al.adl_category
     ORDER BY al.adl_category`))
}

// ── Forms (routes/forms.ts) ──────────────────────────────────────────────────────────────────

/** The company's form templates offered in its state (a template for another state is not), with who made each and its submission count. */
export async function formTemplateRows(q: Q, companyId: string, opts: { state: string | null; active: 'true' | 'false' | 'all'; category?: string }): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ft.*, u.first_name AS created_by_first, u.last_name AS created_by_last,
           (SELECT COUNT(*)::int FROM form_submissions fs WHERE fs.template_id = ft.id AND fs.company_id = ft.company_id) AS submission_count
      FROM form_templates ft
      LEFT JOIN "user" u ON ft.created_by_id = u.id
     WHERE ft.company_id = ${companyId}
       AND ${opts.state ? sql`(ft.state IS NULL OR upper(ft.state) = ${opts.state})` : sql`ft.state IS NULL`}
       ${opts.active === 'all' ? sql`` : sql`AND ft.is_active = ${opts.active === 'true'}`}
       ${opts.category ? sql`AND ft.category = ${opts.category}` : sql``}
     ORDER BY ft.category, ft.name`))
}

const SUBMISSION_SELECT = sql`fs.*, COALESCE(fs.template_name, ft.name) AS template_name, ft.category,
  COALESCE(NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''), fs.submitted_by_name) AS submitted_by_name,
  CASE fs.entity_type
    WHEN 'client'    THEN (SELECT cl.first_name || ' ' || cl.last_name FROM clients cl WHERE cl.id = fs.entity_id AND cl.company_id = fs.company_id)
    WHEN 'caregiver' THEN (SELECT e.first_name || ' ' || e.last_name FROM "user" e WHERE e.id = fs.entity_id AND e.company_id = fs.company_id)
  END AS entity_name`

/** Submissions, newest first: the office's all; anyone else's only the ones they filled in (`submittedBy`). */
export async function formSubmissionRows(q: Q, companyId: string, f: { submittedBy: string | null; entityType?: string; entityId?: string; templateId?: string; status?: string; limit: number }): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ${SUBMISSION_SELECT}
      FROM form_submissions fs
      LEFT JOIN form_templates ft ON fs.template_id = ft.id
      LEFT JOIN "user" u ON fs.submitted_by_id = u.id
     WHERE fs.company_id = ${companyId}
       ${f.submittedBy ? sql`AND fs.submitted_by_id = ${f.submittedBy}` : sql``}
       ${f.entityType ? sql`AND fs.entity_type = ${f.entityType}` : sql``}
       ${f.entityId ? sql`AND fs.entity_id = ${f.entityId}` : sql``}
       ${f.templateId ? sql`AND fs.template_id = ${f.templateId}` : sql``}
       ${f.status ? sql`AND fs.status = ${f.status}` : sql``}
     ORDER BY fs.created_at DESC
     LIMIT ${f.limit}`))
}

/** One submission with its template's fields, description and signature rule; null when absent. */
export async function formSubmissionOne(q: Q, companyId: string, id: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`
    SELECT ${SUBMISSION_SELECT}, ft.fields AS template_fields, ft.description, ft.requires_signature
      FROM form_submissions fs
      LEFT JOIN form_templates ft ON fs.template_id = ft.id
      LEFT JOIN "user" u ON fs.submitted_by_id = u.id
     WHERE fs.id = ${id} AND fs.company_id = ${companyId}`)) ?? null
}

// ── The document store (routes/documents.ts) ────────────────────────────────────────────────

const DOC_SELECT = sql`d.id, d.entity_type, d.entity_id, d.document_type, d.document_type AS category,
  d.name, d.name AS document_name, d.description, d.file_name, d.file_type, d.file_size,
  d.requires_signature, d.expiration_date::text AS expiration_date, d.is_confidential, d.uploaded_by_id,
  d.signed_at, d.signed_by_id, d.signature_typed_name, d.created_at, d.created_at AS uploaded_at, d.updated_at,
  u.first_name AS uploaded_by_first, u.last_name AS uploaded_by_last,
  CASE d.entity_type
    WHEN 'caregiver' THEN (SELECT e.first_name FROM "user" e WHERE e.id = d.entity_id AND e.company_id = d.company_id)
    WHEN 'client'    THEN (SELECT cl.first_name FROM clients cl WHERE cl.id = d.entity_id AND cl.company_id = d.company_id)
  END AS entity_first_name,
  CASE d.entity_type
    WHEN 'caregiver' THEN (SELECT e.last_name FROM "user" e WHERE e.id = d.entity_id AND e.company_id = d.company_id)
    WHEN 'client'    THEN (SELECT cl.last_name FROM clients cl WHERE cl.id = d.entity_id AND cl.company_id = d.company_id)
  END AS entity_last_name,
  CASE d.entity_type
    WHEN 'caregiver' THEN (SELECT e.first_name || ' ' || e.last_name FROM "user" e WHERE e.id = d.entity_id AND e.company_id = d.company_id)
    WHEN 'client'    THEN (SELECT cl.first_name || ' ' || cl.last_name FROM clients cl WHERE cl.id = d.entity_id AND cl.company_id = d.company_id)
    ELSE 'Company'
  END AS entity_name`

/**
 * The company's documents, newest first, never the file bytes. `filter`: the office list (entity / type), the expiring
 * report (within `expiringDays`), a caregiver's to-sign list (`unsignedFor`) or one person's documents.
 */
export async function documentRows(q: Q, companyId: string, filter: {
  entityType?: string; entityId?: string; documentType?: string; expiringDays?: number; unsignedFor?: string
}): Promise<any[]> {
  const { today } = await agencyClock(q, companyId) // the agency's day (CURRENT_DATE was the database's, UTC)
  const where: SQL[] = [sql`d.company_id = ${companyId}`]
  if (filter.entityType) where.push(sql`d.entity_type = ${filter.entityType}`)
  if (filter.entityId) where.push(sql`d.entity_id = ${filter.entityId}`)
  if (filter.documentType) where.push(sql`d.document_type = ${filter.documentType}`)
  if (filter.expiringDays !== undefined) {
    where.push(sql`d.expiration_date IS NOT NULL AND d.expiration_date <= ${today}::date + ${filter.expiringDays}::int AND d.expiration_date >= ${today}::date`)
  }
  if (filter.unsignedFor) {
    // A COMPANY document stays on a caregiver's list until THEY have signed it; their own until it is signed.
    where.push(sql`d.requires_signature = true AND (
      (d.entity_type = 'company'
         AND NOT EXISTS (SELECT 1 FROM document_signatures ds WHERE ds.document_id = d.id AND ds.signed_by_id = ${filter.unsignedFor}))
      OR (d.entity_type = 'caregiver' AND d.entity_id = ${filter.unsignedFor} AND d.signed_at IS NULL))`)
  }
  return camelRows(await q.execute(sql`
    SELECT ${DOC_SELECT} FROM documents d LEFT JOIN "user" u ON d.uploaded_by_id = u.id
     WHERE ${sql.join(where, sql` AND `)}
     ORDER BY ${filter.expiringDays !== undefined ? sql`d.expiration_date ASC` : sql`d.created_at DESC`}`))
}

/** Every signature on a document, newest first; only `signedBy`'s when given. */
export async function documentSignatureRows(q: Q, companyId: string, documentId: string, signedBy: string | null): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT ds.id, ds.signer_role, ds.signer_typed_name, ds.signed_at, ds.ip_address, ds.signed_by_id,
           u.first_name, u.last_name, u.email
      FROM document_signatures ds LEFT JOIN "user" u ON ds.signed_by_id = u.id
     WHERE ds.document_id = ${documentId} AND ds.company_id = ${companyId}
       ${signedBy ? sql`AND ds.signed_by_id = ${signedBy}` : sql``}
     ORDER BY ds.signed_at DESC`))
}

// ── Call-outs and coverage (routes/emergency.ts) ─────────────────────────────────────────────

// The caregiver seat: 'caregiver' on a moved tenant, 'field' on a new one (verticals/homecare/settings.ts).
const CAREGIVER_ROLE = sql.raw(`u.role IN ('caregiver', 'field')`)

/** A visit is WORKED once its caregiver has a punch for that client on that agency day. */
const workedSql = (companyId: string, tz: string, caregiverCol: SQL, clientCol: SQL, dateCol: SQL) => sql`EXISTS (
  SELECT 1 FROM time_entries te
   WHERE te.company_id = ${companyId} AND te.caregiver_id = ${caregiverCol} AND te.client_id = ${clientCol}
     AND ${localDate(sql`te.start_time`, tz)} = ${dateCol})`

/** The occurrence of a schedule on a date (resolved caregiver, client and times), or null. */
export async function occurrenceOn(q: Q, companyId: string, scheduleId: string, date: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT occ.caregiver_id, occ.client_id, to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time
      FROM occ WHERE occ.schedule_id = ${scheduleId} AND occ.occ_date = ${date}::date`)) ?? null
}

/** Was this caregiver's visit to this client on this agency day worked (a clock-in exists)? */
export async function visitWorked(q: Q, companyId: string, tz: string, caregiverId: string, clientId: string, date: string): Promise<boolean> {
  const r = rowsOf(await q.execute(sql`SELECT ${workedSql(companyId, tz, sql`${caregiverId}`, sql`${clientId}`, sql`${date}::date`)} AS w`))[0]
  return r?.w === true
}

/** A schedule pattern with its client's name and its own times; null when absent. */
export async function scheduleWithClient(q: Q, companyId: string, scheduleId: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT s.id, s.client_id, s.caregiver_id, to_char(s.start_time, 'HH24:MI:SS') AS start_time,
      to_char(s.end_time, 'HH24:MI:SS') AS end_time, c.first_name AS client_first_name, c.last_name AS client_last_name
    FROM schedules s LEFT JOIN clients c ON s.client_id = c.id AND c.company_id = s.company_id
    WHERE s.id = ${scheduleId} AND s.company_id = ${companyId}`)) ?? null
}

/** A call-out: the absence row. */
export async function insertCallOut(q: Q, companyId: string, v: { id: string; caregiverId: string; clientId: string | null; date: string; reason: string; notes: string }): Promise<void> {
  await q.execute(sql`INSERT INTO absences (id, company_id, caregiver_id, client_id, date, type, reason, coverage_needed, notes, status, created_at)
    VALUES (${v.id}, ${companyId}, ${v.caregiverId}, ${v.clientId}, ${v.date}::date, 'call_out', ${v.reason}, true, ${v.notes}, 'reported', NOW())`)
}

/** Cancel one occurrence (or re-mark an existing exception cancelled) with a reason; returns the exception. */
export async function cancelOccurrence(q: Q, companyId: string, v: { scheduleId: string; date: string; notes: string; createdBy: string; cancelReason: string; clearTimes?: boolean }): Promise<any> {
  return camelFirst(await q.execute(sql`
    INSERT INTO schedule_exceptions (id, company_id, schedule_id, exception_date, exception_type, override_notes, created_by, cancel_reason, created_at)
    VALUES (${createId()}, ${companyId}, ${v.scheduleId}, ${v.date}::date, 'cancelled', ${v.notes}, ${v.createdBy}, ${v.cancelReason}, NOW())
    ON CONFLICT (schedule_id, exception_date) DO UPDATE SET
      exception_type = 'cancelled',
      ${v.clearTimes ? sql`override_start_time = NULL, override_end_time = NULL,` : sql``}
      override_notes = EXCLUDED.override_notes, cancel_reason = EXCLUDED.cancel_reason
    RETURNING id, schedule_id, to_char(exception_date, 'YYYY-MM-DD') AS exception_date, exception_type, override_notes, cancel_reason`))
}

/** An urgent open shift for a call-out. */
export async function insertCoverageOpenShift(q: Q, companyId: string, v: { id: string; clientId: string; scheduleId: string | null; date: string; startTime: string; endTime: string; notes: string; createdById: string; absenceId: string }): Promise<void> {
  await q.execute(sql`INSERT INTO open_shifts (id, company_id, client_id, schedule_id, date, start_time, end_time, notes, urgency, created_by_id,
                                              source_absence_id, auto_created, status, created_at, updated_at)
    VALUES (${v.id}, ${companyId}, ${v.clientId}, ${v.scheduleId}, ${v.date}::date, ${v.startTime}::time, ${v.endTime}::time,
            ${v.notes}, 'urgent', ${v.createdById}, ${v.absenceId}, true, 'open', NOW(), NOW())`)
}

/** Active caregivers free on a date between two times: no overlapping visit, not on approved time off; 30 at most. */
export async function freeCaregiversFor(q: Q, companyId: string, date: string, startTime: string, endTime: string, exceptId: string): Promise<{ id: string }[]> {
  return camelRows(await q.execute(sql`WITH ${occurrencesCte(companyId, date, date)}
    SELECT u.id FROM "user" u
     WHERE u.company_id = ${companyId} AND ${CAREGIVER_ROLE} AND u.is_active = true AND u.id <> ${exceptId}
       AND NOT EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
                        AND (occ.start_time, occ.end_time) OVERLAPS (${startTime}::time, ${endTime}::time))
       AND NOT EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.company_id = ${companyId} AND t.caregiver_id = u.id AND t.status = 'approved'
                        AND ${date}::date BETWEEN t.start_date AND t.end_date)
     LIMIT 30`))
}

/** Record that a caregiver was told of an open shift (once per shift and caregiver). */
export async function insertOpenShiftNotice(q: Q, companyId: string, openShiftId: string, caregiverId: string): Promise<void> {
  await q.execute(sql`INSERT INTO open_shift_notifications (id, company_id, open_shift_id, caregiver_id, notification_type, notified_at)
    VALUES (${createId()}, ${companyId}, ${openShiftId}, ${caregiverId}, 'push', NOW()) ON CONFLICT (open_shift_id, caregiver_id) DO NOTHING`)
}

/** How many caregivers an open shift reached. */
export async function setOpenShiftNotifiedCount(q: Q, companyId: string, openShiftId: string, n: number): Promise<void> {
  await q.execute(sql`UPDATE open_shifts SET notified_caregiver_count = ${n} WHERE id = ${openShiftId} AND company_id = ${companyId}`)
}

/** Call-outs on or after `today` still needing coverage, with the caregiver and client. */
export async function openCallOuts(q: Q, companyId: string, today: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT a.id, a.caregiver_id, a.client_id, to_char(a.date, 'YYYY-MM-DD') AS date, a.type, a.reason, a.notes,
           a.coverage_needed, a.coverage_assigned_to, a.created_at,
           u.first_name, u.last_name, u.phone, u.email,
           c.first_name AS client_first_name, c.last_name AS client_last_name
      FROM absences a
      JOIN "user" u ON a.caregiver_id = u.id
      LEFT JOIN clients c ON a.client_id = c.id AND c.company_id = a.company_id
     WHERE a.company_id = ${companyId}
       AND a.type = 'call_out' AND a.coverage_needed = true AND a.coverage_assigned_to IS NULL
       AND a.date >= ${today}::date
     ORDER BY a.date ASC, a.created_at ASC`))
}

/** Who can cover a visit: free that day and time, not called out; their week's scheduled hours, last worked day and rating. */
export async function coverageCandidates(q: Q, companyId: string, v: { date: string; startTime: string; endTime: string; weekStart: string; weekEnd: string }): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, v.date, v.date)}, ${occurrencesCte(companyId, v.weekStart, v.weekEnd, 'wk')}
    SELECT u.id, u.first_name, u.last_name, u.phone, u.email, u.certifications,
           ca.weekly_availability, ca.status AS availability_status,
           COALESCE((SELECT SUM(wk.hours) FROM wk WHERE wk.caregiver_id = u.id), 0) AS scheduled_hours_this_week,
           (SELECT to_char(MAX(te.start_time), 'YYYY-MM-DD') FROM time_entries te WHERE te.company_id = ${companyId} AND te.caregiver_id = u.id AND te.is_complete = true) AS last_worked,
           COALESCE((SELECT ROUND(AVG(pr.satisfaction_score)::numeric, 1) FROM performance_ratings pr WHERE pr.company_id = ${companyId} AND pr.caregiver_id = u.id), 0) AS avg_rating
      FROM "user" u
      LEFT JOIN caregiver_availability ca ON ca.caregiver_id = u.id AND ca.company_id = ${companyId}
     WHERE u.company_id = ${companyId} AND ${CAREGIVER_ROLE} AND u.is_active = true
       AND NOT EXISTS (SELECT 1 FROM occ WHERE occ.caregiver_id = u.id
                        AND (occ.start_time, occ.end_time) OVERLAPS (${v.startTime}::time, ${v.endTime}::time))
       AND NOT EXISTS (SELECT 1 FROM caregiver_time_off t WHERE t.company_id = ${companyId} AND t.caregiver_id = u.id AND t.status = 'approved'
                        AND ${v.date}::date BETWEEN t.start_date AND t.end_date)
       AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.company_id = ${companyId} AND a.caregiver_id = u.id AND a.date = ${v.date}::date AND a.type IN ('call_out', 'no_show'))`))
}

/** The absence is covered by this caregiver. */
export async function markCoverageAssigned(q: Q, companyId: string, absenceId: string, caregiverId: string): Promise<void> {
  await q.execute(sql`UPDATE absences SET coverage_assigned_to = ${caregiverId}, coverage_needed = false WHERE id = ${absenceId} AND company_id = ${companyId}`)
}

/** A one-time coverage visit (schedules.start_time / end_time hold the wall-clock time on the visit's date). */
export async function insertCoverageVisit(q: Q, companyId: string, v: { id: string; caregiverId: string; clientId: string; date: string; startTs: string; endTs: string; notes: string }): Promise<void> {
  await q.execute(sql`INSERT INTO schedules (id, company_id, caregiver_id, client_id, schedule_type, date, start_time, end_time, notes, is_active, status, frequency, created_at, updated_at)
    VALUES (${v.id}, ${companyId}, ${v.caregiverId}, ${v.clientId}, 'one-time', ${v.date}::date, ${v.startTs}::timestamp, ${v.endTs}::timestamp,
            ${v.notes}, true, 'active', 'weekly', NOW(), NOW())`)
}

/**
 * The caregiver's next visits that can still be called out of (the next `days` agency days): dated occurrences from the
 * schedule engine, not worked, and not one of today's that has already ended. 14 at most.
 */
export async function callableShifts(q: Q, companyId: string, caregiverId: string, v: { today: string; until: string; nowTime: string; tz: string }): Promise<any[]> {
  return camelRows(await q.execute(sql`
    WITH ${occurrencesCte(companyId, v.today, v.until)}
    SELECT occ.schedule_id AS id, occ.schedule_id, to_char(occ.occ_date, 'YYYY-MM-DD') AS date,
           EXTRACT(DOW FROM occ.occ_date)::int AS day_of_week,
           to_char(occ.start_time, 'HH24:MI:SS') AS start_time, to_char(occ.end_time, 'HH24:MI:SS') AS end_time,
           occ.client_id, c.first_name AS client_first_name, c.last_name AS client_last_name, c.address AS client_address
      FROM occ JOIN clients c ON occ.client_id = c.id AND c.company_id = ${companyId}
     WHERE occ.caregiver_id = ${caregiverId}
       AND NOT ${workedSql(companyId, v.tz, sql`occ.caregiver_id`, sql`occ.client_id`, sql`occ.occ_date`)}
       AND NOT (occ.occ_date = ${v.today}::date AND occ.end_time > occ.start_time AND occ.end_time <= ${v.nowTime}::time)
     ORDER BY occ.occ_date ASC, occ.start_time ASC
     LIMIT 14`))
}

/** An occurrence already cancelled on a date (its pattern's caregiver or the cover, the client, the times); null when none. */
export async function cancelledOccurrenceOn(q: Q, companyId: string, scheduleId: string, date: string): Promise<any | null> {
  return camelFirst(await q.execute(sql`SELECT COALESCE(se.override_caregiver_id, s.caregiver_id) AS caregiver_id, s.client_id,
      to_char(s.start_time, 'HH24:MI:SS') AS start_time, to_char(s.end_time, 'HH24:MI:SS') AS end_time
    FROM schedule_exceptions se JOIN schedules s ON s.id = se.schedule_id
    WHERE s.company_id = ${companyId} AND se.schedule_id = ${scheduleId} AND se.exception_date = ${date}::date AND se.exception_type = 'cancelled'`)) ?? null
}
