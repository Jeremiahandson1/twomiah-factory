// Call tracking's queries: tracking numbers and the call log (moved from templates/crm/backend/src/services/
// calltracking.ts, which ran them as raw SQL). Each returns camelCase; the aggregates are mapped by name.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { rowsOf, camelRows, camelFirst } from '@twomiah/tenant-backend'

type Range = { startDate?: string; endDate?: string }

/** A new tracking number; the row as stored. */
export async function insertTrackingNumber(db: any, companyId: string, data: {
  phoneNumber: string; forwardTo?: string; source?: string; campaign?: string; medium?: string; name?: string; providerId?: string
}, provider: string | null) {
  return camelFirst(await db.execute(sql`
    INSERT INTO tracking_number (id, company_id, phone_number, forward_to, source, campaign, medium, name, active, provider_id, provider, created_at, updated_at)
    VALUES (
      ${createId()}, ${companyId}, ${data.phoneNumber}, ${data.forwardTo || null},
      ${data.source || null}, ${data.campaign || null}, ${data.medium || null}, ${data.name || null},
      true, ${data.providerId || null}, ${provider}, NOW(), NOW()
    )
    RETURNING *
  `))
}

/** This company's tracking numbers, each with how many calls came in on it. `active` null = all. */
export async function listTrackingNumbers(db: any, companyId: string, { source, active = true }: { source?: string; active?: boolean | null } = {}) {
  const conds = [sql`company_id = ${companyId}`]
  if (source) conds.push(sql`source = ${source}`)
  if (active !== null) conds.push(sql`active = ${active}`)
  const where = sql.join(conds, sql` AND `)
  return camelRows(await db.execute(sql`
    SELECT tn.*, (SELECT COUNT(*) FROM call_log cl WHERE cl.tracking_number_id = tn.id)::int as call_count
    FROM tracking_number tn
    WHERE ${where}
    ORDER BY source ASC
  `))
}

// The columns an edit may change. The template also listed whisper_message and recording_enabled, which are not
// columns of tracking_number, so an edit carrying either answered 500; they are left out.
const TRACKING_NUMBER_COLUMNS = ['name', 'phone_number', 'forward_to', 'source', 'active']

/** Change the allowed columns of one of this company's tracking numbers; camelCase keys in, unknown keys skipped. */
export async function updateTrackingNumber(db: any, numberId: string, companyId: string, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
    if (!TRACKING_NUMBER_COLUMNS.includes(colName)) continue
    await db.execute(sql`UPDATE tracking_number SET ${sql.raw(`"${colName}"`)} = ${value}, updated_at = NOW() WHERE id = ${numberId} AND company_id = ${companyId}`)
  }
}

/** The tracking number a call came in on, by its phone number. */
export async function findTrackingNumberByPhone(db: any, companyId: string, phoneNumber: string): Promise<{ id: string; source: string | null; campaign: string | null; medium: string | null } | null> {
  const row = rowsOf(await db.execute(sql`
    SELECT id, source, campaign, medium FROM tracking_number
    WHERE company_id = ${companyId} AND phone_number = ${phoneNumber}
    LIMIT 1
  `))[0]
  return row ? { id: row.id, source: row.source, campaign: row.campaign, medium: row.medium } : null
}

export interface CallLogRow {
  companyId: string; trackingNumberId: string | null; contactId: string | null
  /** The home-care client the caller is (CrmSettings.callers 'clients'); absent elsewhere. */
  clientId?: string | null
  callerNumber: string | null; callerName: string | null; callerCity: string | null; callerState: string | null
  source: string | null; campaign: string | null; medium: string | null; keyword: string | null; landingPage: string | null
  direction: string; status: string; duration: number; startTime: Date; endTime: Date | null
  recordingUrl: string | null; transcription: string | null; tags: unknown[]; notes: string | null
  firstTimeCaller: boolean; providerId: string | null
}

/** One call in the log; the row as stored. */
export async function insertCallLog(db: any, r: CallLogRow) {
  return camelFirst(await db.execute(sql`
    INSERT INTO call_log (
      id, company_id, tracking_number_id, contact_id, client_id,
      caller_number, caller_name, caller_city, caller_state,
      source, campaign, medium, keyword, landing_page,
      direction, status, duration,
      start_time, end_time,
      recording_url, transcription,
      tags, notes,
      first_time_caller, provider_id,
      created_at
    ) VALUES (
      ${createId()}, ${r.companyId}, ${r.trackingNumberId}, ${r.contactId}, ${r.clientId ?? null},
      ${r.callerNumber}, ${r.callerName}, ${r.callerCity}, ${r.callerState},
      ${r.source}, ${r.campaign}, ${r.medium}, ${r.keyword}, ${r.landingPage},
      ${r.direction}, ${r.status}, ${r.duration},
      ${r.startTime}, ${r.endTime},
      ${r.recordingUrl}, ${r.transcription},
      ${JSON.stringify(r.tags)}::json, ${r.notes},
      ${r.firstTimeCaller}, ${r.providerId},
      NOW()
    )
    RETURNING *
  `))
}

/** A page of this company's calls, newest first, with the tracking number's name and the contact's. */
export async function listCalls(db: any, companyId: string, f: {
  source?: string; status?: string; startDate?: string; endDate?: string; contactId?: string; clientId?: string; firstTimeOnly?: boolean; page?: number; limit?: number
} = {}) {
  const conds = [sql`cl.company_id = ${companyId}`]
  if (f.source) conds.push(sql`cl.source = ${f.source}`)
  if (f.status) conds.push(sql`cl.status = ${f.status}`)
  if (f.contactId) conds.push(sql`cl.contact_id = ${f.contactId}`)
  if (f.clientId) conds.push(sql`cl.client_id = ${f.clientId}`)
  if (f.firstTimeOnly) conds.push(sql`cl.first_time_caller = true`)
  if (f.startDate) conds.push(sql`cl.start_time >= ${new Date(f.startDate)}`)
  if (f.endDate) conds.push(sql`cl.start_time <= ${new Date(f.endDate)}`)
  const where = sql.join(conds, sql` AND `)

  const page = Number.isFinite(Number(f.page)) && Number(f.page) > 0 ? Math.floor(Number(f.page)) : 1
  const limit = Number.isFinite(Number(f.limit)) && Number(f.limit) > 0 ? Math.min(200, Math.floor(Number(f.limit))) : 50
  const offset = (page - 1) * limit

  const data = camelRows(await db.execute(sql`
    SELECT cl.*,
      tn.name as tracking_number_name, tn.source as tracking_number_source,
      c.id as contact_id_ref, c.name as contact_name,
      hc.id as client_id_ref, hc.first_name as client_first_name, hc.last_name as client_last_name
    FROM call_log cl
    LEFT JOIN tracking_number tn ON cl.tracking_number_id = tn.id
    LEFT JOIN contact c ON cl.contact_id = c.id
    LEFT JOIN clients hc ON cl.client_id = hc.id AND hc.company_id = cl.company_id
    WHERE ${where}
    ORDER BY cl.start_time DESC
    LIMIT ${limit} OFFSET ${offset}
  `))
  const total = Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int as total FROM call_log cl WHERE ${where}`))[0]?.total || 0)
  return { data, page, limit, total }
}

/** One of this company's calls, or null. */
export async function getCall(db: any, callId: string, companyId: string) {
  const rows = camelRows(await db.execute(sql`
    SELECT cl.*,
      tn.name as tracking_number_name, tn.source as tracking_number_source,
      c.id as contact_id_ref, c.name as contact_name,
      hc.id as client_id_ref, hc.first_name as client_first_name, hc.last_name as client_last_name
    FROM call_log cl
    LEFT JOIN tracking_number tn ON cl.tracking_number_id = tn.id
    LEFT JOIN contact c ON cl.contact_id = c.id
    LEFT JOIN clients hc ON cl.client_id = hc.id AND hc.company_id = cl.company_id
    WHERE cl.id = ${callId} AND cl.company_id = ${companyId}
    LIMIT 1
  `))
  return rows[0] || null
}

// client_id: home care files a call against a client (CrmSettings.callers).
const CALL_COLUMNS = ['notes', 'tags', 'is_lead', 'lead_value', 'contact_id', 'client_id', 'status']

/** Change the allowed columns of one of this company's calls; camelCase keys in, unknown keys skipped. */
export async function updateCall(db: any, callId: string, companyId: string, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
    if (!CALL_COLUMNS.includes(colName)) continue
    if (typeof value === 'object' && value !== null) {
      await db.execute(sql`UPDATE call_log SET ${sql.raw(`"${colName}"`)} = ${JSON.stringify(value)}::json WHERE id = ${callId} AND company_id = ${companyId}`)
    } else {
      await db.execute(sql`UPDATE call_log SET ${sql.raw(`"${colName}"`)} = ${value} WHERE id = ${callId} AND company_id = ${companyId}`)
    }
  }
}

/** Mark a call as a lead, with its value and a note. */
export async function tagCallAsLead(db: any, callId: string, companyId: string, { value, notes }: { value?: number; notes?: string }) {
  await db.execute(sql`
    UPDATE call_log SET
      is_lead = true,
      lead_value = ${value || null},
      notes = ${notes || null}
    WHERE id = ${callId} AND company_id = ${companyId}
  `)
}

function rangeWhere(companyId: string, { startDate, endDate }: Range) {
  const conds = [sql`company_id = ${companyId}`]
  if (startDate) conds.push(sql`start_time >= ${new Date(startDate)}`)
  if (endDate) conds.push(sql`start_time <= ${new Date(endDate)}`)
  return sql.join(conds, sql` AND `)
}

/** The attribution report's figures: calls and talk time per source, and the totals. */
export async function attributionFigures(db: any, companyId: string, range: Range = {}) {
  const where = rangeWhere(companyId, range)
  const bySource = rowsOf(await db.execute(sql`
    SELECT source, COUNT(*)::int as call_count, COALESCE(SUM(duration), 0)::int as total_duration
    FROM call_log WHERE ${where}
    GROUP BY source
  `)).map((s: any) => ({ source: s.source as string | null, callCount: s.call_count as number, totalDuration: s.total_duration as number }))
  const t = rowsOf(await db.execute(sql`
    SELECT COUNT(*)::int as total_calls, COALESCE(SUM(duration), 0)::int as total_duration, COALESCE(AVG(duration), 0)::int as avg_duration
    FROM call_log WHERE ${where}
  `))[0] as any
  const firstTimeCallers = Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int as cnt FROM call_log WHERE ${where} AND first_time_caller = true`))[0]?.cnt || 0)
  const leads = Number(rowsOf(await db.execute(sql`SELECT COUNT(*)::int as cnt FROM call_log WHERE ${where} AND is_lead = true`))[0]?.cnt || 0)
  const leadValue = Number(rowsOf(await db.execute(sql`SELECT COALESCE(SUM(lead_value), 0)::numeric as total_value FROM call_log WHERE ${where} AND is_lead = true`))[0]?.total_value || 0)
  return {
    bySource,
    totalCalls: t?.total_calls as number,
    totalDuration: t?.total_duration as number,
    avgDuration: t?.avg_duration as number,
    firstTimeCallers, leads, leadValue,
  }
}

/** Every call in the range: when it started, how long, and how it ended (the volume report groups them). */
export async function callTimes(db: any, companyId: string, range: Range = {}): Promise<{ startTime: any; duration: number | null; status: string }[]> {
  return rowsOf(await db.execute(sql`SELECT start_time, duration, status FROM call_log WHERE ${rangeWhere(companyId, range)}`))
    .map((r: any) => ({ startTime: r.start_time, duration: r.duration, status: r.status }))
}

/** The company's home-care client with this phone number (CrmSettings.callers 'clients'), or null. */
export async function clientByPhone(db: any, companyId: string, phone: string): Promise<{ id: string; email: string | null } | null> {
  return camelFirst(await db.execute(sql`SELECT id, email FROM clients WHERE company_id = ${companyId} AND phone = ${phone} LIMIT 1`)) ?? null
}

/** A home-care client made from a first call: the caller's name split in two, their number, the day of the call. */
export async function insertCallerClient(db: any, companyId: string, c: { firstName: string; lastName: string; phone: string; notes: string }) {
  await db.execute(sql`
    INSERT INTO clients (id, company_id, first_name, last_name, phone, notes)
    VALUES (${createId()}, ${companyId}, ${c.firstName}, ${c.lastName}, ${c.phone}, ${c.notes})`)
}
