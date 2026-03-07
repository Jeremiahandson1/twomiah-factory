/**
 * Call Tracking Service (Drizzle)
 *
 * Track inbound calls for marketing attribution:
 * - Tracking phone numbers per marketing source
 * - Call logging and recording links
 * - Integration with CallRail, CallTrackingMetrics, etc.
 * - Attribution reporting
 *
 * NOTE: trackingNumber and callLog tables are not in the current Drizzle schema.
 * This uses raw SQL for those tables. Add them to db/schema.ts for full support.
 */

import { db } from '../../db/index.ts';
import { contact } from '../../db/schema.ts';
import { eq, and, sql, count } from 'drizzle-orm';

/** Extract rows array from db.execute() result (node-postgres returns { rows } object) */
function rows(result: any): any[] {
  return Array.isArray(result) ? result : (result?.rows || [])
}

// Provider configuration
const PROVIDER = process.env.CALL_TRACKING_PROVIDER;
const CALLRAIL_API_KEY = process.env.CALLRAIL_API_KEY;
const CALLRAIL_ACCOUNT_ID = process.env.CALLRAIL_ACCOUNT_ID;

// ============================================
// TRACKING NUMBERS
// ============================================

/**
 * Create tracking number
 */
export async function createTrackingNumber(companyId: string, data: {
  phoneNumber: string;
  forwardTo?: string;
  source?: string;
  campaign?: string;
  medium?: string;
  name?: string;
  providerId?: string;
}) {
  await db.execute(sql`
    INSERT INTO tracking_number (id, company_id, phone_number, forward_to, source, campaign, medium, name, active, provider_id, provider, created_at, updated_at)
    VALUES (
      gen_random_uuid(), ${companyId}, ${data.phoneNumber}, ${data.forwardTo || null},
      ${data.source || null}, ${data.campaign || null}, ${data.medium || null}, ${data.name || null},
      true, ${data.providerId || null}, ${PROVIDER || null}, NOW(), NOW()
    )
  `);
}

/**
 * Get tracking numbers
 */
export async function getTrackingNumbers(companyId: string, { source, active = true }: { source?: string; active?: boolean | null } = {}) {
  let whereClause = `company_id = '${companyId}'`;
  if (source) whereClause += ` AND source = '${source}'`;
  if (active !== null) whereClause += ` AND active = ${active}`;

  return rows(await db.execute(sql.raw(`
    SELECT tn.*, (SELECT COUNT(*) FROM call_log cl WHERE cl.tracking_number_id = tn.id)::int as call_count
    FROM tracking_number tn
    WHERE ${whereClause}
    ORDER BY source ASC
  `)));
}

/**
 * Update tracking number
 */
export async function updateTrackingNumber(numberId: string, companyId: string, data: Record<string, unknown>) {
  const sets: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    sets.push(`${colName} = '${value}'`);
  }
  if (sets.length > 0) {
    await db.execute(sql.raw(`UPDATE tracking_number SET ${sets.join(', ')}, updated_at = NOW() WHERE id = '${numberId}' AND company_id = '${companyId}'`));
  }
}

// ============================================
// CALL LOGGING
// ============================================

/**
 * Log incoming call (from webhook)
 */
export async function logCall(companyId: string, data: {
  trackingNumber?: string;
  callerNumber?: string;
  callerName?: string;
  callerCity?: string;
  callerState?: string;
  source?: string;
  campaign?: string;
  medium?: string;
  keyword?: string;
  landingPage?: string;
  direction?: string;
  status?: string;
  duration?: number;
  startTime?: string;
  endTime?: string;
  recordingUrl?: string;
  transcription?: string;
  tags?: string[];
  notes?: string;
  providerId?: string;
  createContact?: boolean;
}) {
  // Find tracking number
  let trackingNumberId: string | null = null;
  let trackingSource: string | null = data.source || null;
  let trackingCampaign: string | null = data.campaign || null;
  let trackingMedium: string | null = data.medium || null;

  if (data.trackingNumber) {
    const tnRows = rows(await db.execute(sql`
      SELECT id, source, campaign, medium FROM tracking_number
      WHERE company_id = ${companyId} AND phone_number = ${data.trackingNumber}
      LIMIT 1
    `));
    if (tnRows[0]) {
      trackingNumberId = tnRows[0].id;
      trackingSource = tnRows[0].source || data.source || null;
      trackingCampaign = tnRows[0].campaign || data.campaign || null;
      trackingMedium = tnRows[0].medium || data.medium || null;
    }
  }

  // Try to match caller to contact
  let contactId: string | null = null;
  let isFirstTimeCaller = true;
  if (data.callerNumber) {
    const [c] = await db.select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.companyId, companyId), eq(contact.phone, data.callerNumber)))
      .limit(1);
    if (c) {
      contactId = c.id;
      isFirstTimeCaller = false;
    }
  }

  await db.execute(sql`
    INSERT INTO call_log (
      id, company_id, tracking_number_id, contact_id,
      caller_number, caller_name, caller_city, caller_state,
      source, campaign, medium, keyword, landing_page,
      direction, status, duration,
      start_time, end_time,
      recording_url, transcription,
      tags, notes,
      first_time_caller, provider_id,
      created_at
    ) VALUES (
      gen_random_uuid(), ${companyId}, ${trackingNumberId}, ${contactId},
      ${data.callerNumber || null}, ${data.callerName || null}, ${data.callerCity || null}, ${data.callerState || null},
      ${trackingSource}, ${trackingCampaign}, ${trackingMedium}, ${data.keyword || null}, ${data.landingPage || null},
      ${data.direction || 'inbound'}, ${data.status || 'completed'}, ${data.duration || 0},
      ${data.startTime ? new Date(data.startTime) : new Date()}, ${data.endTime ? new Date(data.endTime) : null},
      ${data.recordingUrl || null}, ${data.transcription || null},
      ${JSON.stringify(data.tags || [])}::jsonb, ${data.notes || null},
      ${isFirstTimeCaller}, ${data.providerId || null},
      NOW()
    )
  `);

  // If new caller, optionally create contact
  if (isFirstTimeCaller && data.callerNumber && data.createContact !== false) {
    await db.insert(contact).values({
      companyId,
      name: data.callerName || 'Unknown Caller',
      phone: data.callerNumber,
      source: trackingSource || 'phone',
      notes: `First call: ${new Date().toLocaleDateString()}`,
    });
  }
}

/**
 * Get calls
 */
export async function getCalls(companyId: string, {
  source,
  status,
  startDate,
  endDate,
  contactId,
  firstTimeOnly,
  page = 1,
  limit = 50,
}: {
  source?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  contactId?: string;
  firstTimeOnly?: boolean;
  page?: number;
  limit?: number;
} = {}) {
  let whereClause = `cl.company_id = '${companyId}'`;
  if (source) whereClause += ` AND cl.source = '${source}'`;
  if (status) whereClause += ` AND cl.status = '${status}'`;
  if (contactId) whereClause += ` AND cl.contact_id = '${contactId}'`;
  if (firstTimeOnly) whereClause += ` AND cl.first_time_caller = true`;
  if (startDate) whereClause += ` AND cl.start_time >= '${new Date(startDate).toISOString()}'`;
  if (endDate) whereClause += ` AND cl.start_time <= '${new Date(endDate).toISOString()}'`;

  const offset = (page - 1) * limit;

  const callData = rows(await db.execute(sql.raw(`
    SELECT cl.*,
      tn.name as tracking_number_name, tn.source as tracking_number_source,
      c.id as contact_id_ref, c.name as contact_name
    FROM call_log cl
    LEFT JOIN tracking_number tn ON cl.tracking_number_id = tn.id
    LEFT JOIN contact c ON cl.contact_id = c.id
    WHERE ${whereClause}
    ORDER BY cl.start_time DESC
    LIMIT ${limit} OFFSET ${offset}
  `)));
  const total = Number(rows(await db.execute(sql.raw(`
    SELECT COUNT(*)::int as total FROM call_log cl WHERE ${whereClause}
  `)))[0]?.total || 0);

  return { data: callData, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/**
 * Get single call
 */
export async function getCall(callId: string, companyId: string) {
  const callRows = rows(await db.execute(sql`
    SELECT cl.*,
      tn.name as tracking_number_name, tn.source as tracking_number_source,
      c.id as contact_id_ref, c.name as contact_name
    FROM call_log cl
    LEFT JOIN tracking_number tn ON cl.tracking_number_id = tn.id
    LEFT JOIN contact c ON cl.contact_id = c.id
    WHERE cl.id = ${callId} AND cl.company_id = ${companyId}
    LIMIT 1
  `));
  return callRows[0] || null;
}

/**
 * Update call (add notes, tags, etc.)
 */
export async function updateCall(callId: string, companyId: string, data: Record<string, unknown>) {
  const sets: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    if (typeof value === 'object' && value !== null) {
      sets.push(`${colName} = '${JSON.stringify(value)}'::jsonb`);
    } else {
      sets.push(`${colName} = '${value}'`);
    }
  }
  if (sets.length > 0) {
    await db.execute(sql.raw(`UPDATE call_log SET ${sets.join(', ')} WHERE id = '${callId}' AND company_id = '${companyId}'`));
  }
}

/**
 * Tag call as lead/opportunity
 */
export async function tagCallAsLead(callId: string, companyId: string, { value, notes }: { value?: number; notes?: string }) {
  await db.execute(sql`
    UPDATE call_log SET
      is_lead = true,
      lead_value = ${value || null},
      notes = ${notes || null}
    WHERE id = ${callId} AND company_id = ${companyId}
  `);
}

// ============================================
// WEBHOOKS
// ============================================

/**
 * Handle CallRail webhook
 */
export async function handleCallRailWebhook(companyId: string, payload: any) {
  const data = {
    trackingNumber: payload.tracking_phone_number,
    callerNumber: payload.caller_phone_number,
    callerName: payload.caller_name,
    callerCity: payload.caller_city,
    callerState: payload.caller_state,
    source: payload.source,
    campaign: payload.campaign,
    medium: payload.medium,
    keyword: payload.keywords,
    landingPage: payload.landing_page_url,
    direction: payload.direction,
    status: mapCallRailStatus(payload.answered ? 'answered' : 'missed'),
    duration: payload.duration,
    startTime: payload.start_time,
    recordingUrl: payload.recording,
    providerId: payload.id,
  };

  return logCall(companyId, data);
}

function mapCallRailStatus(status: string): string {
  const map: Record<string, string> = {
    answered: 'completed',
    missed: 'missed',
    voicemail: 'voicemail',
  };
  return map[status] || status;
}

/**
 * Handle Twilio webhook
 */
export async function handleTwilioWebhook(companyId: string, payload: any) {
  const data = {
    trackingNumber: payload.To,
    callerNumber: payload.From,
    callerCity: payload.FromCity,
    callerState: payload.FromState,
    direction: payload.Direction === 'inbound' ? 'inbound' : 'outbound',
    status: mapTwilioStatus(payload.CallStatus),
    duration: parseInt(payload.CallDuration) || 0,
    providerId: payload.CallSid,
    recordingUrl: payload.RecordingUrl,
  };

  return logCall(companyId, data);
}

function mapTwilioStatus(status: string): string {
  const map: Record<string, string> = {
    completed: 'completed',
    busy: 'missed',
    'no-answer': 'missed',
    failed: 'failed',
  };
  return map[status] || status;
}

// ============================================
// REPORTING
// ============================================

/**
 * Get call attribution report
 */
export async function getAttributionReport(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string } = {}) {
  let whereClause = `company_id = '${companyId}'`;
  if (startDate) whereClause += ` AND start_time >= '${new Date(startDate).toISOString()}'`;
  if (endDate) whereClause += ` AND start_time <= '${new Date(endDate).toISOString()}'`;

  const bySource = rows(await db.execute(sql.raw(`
    SELECT source, COUNT(*)::int as call_count, COALESCE(SUM(duration), 0)::int as total_duration
    FROM call_log WHERE ${whereClause}
    GROUP BY source
  `)));

  const totals = rows(await db.execute(sql.raw(`
    SELECT COUNT(*)::int as total_calls, COALESCE(SUM(duration), 0)::int as total_duration, COALESCE(AVG(duration), 0)::int as avg_duration
    FROM call_log WHERE ${whereClause}
  `)))[0] as any;

  const firstTimers = Number(rows(await db.execute(sql.raw(`
    SELECT COUNT(*)::int as cnt FROM call_log WHERE ${whereClause} AND first_time_caller = true
  `)))[0]?.cnt || 0);

  const leads = Number(rows(await db.execute(sql.raw(`
    SELECT COUNT(*)::int as cnt FROM call_log WHERE ${whereClause} AND is_lead = true
  `)))[0]?.cnt || 0);

  const leadValue = Number(rows(await db.execute(sql.raw(`
    SELECT COALESCE(SUM(lead_value), 0)::numeric as total_value FROM call_log WHERE ${whereClause} AND is_lead = true
  `)))[0]?.total_value || 0);

  return {
    bySource: bySource.map((s: any) => ({
      source: s.source || 'unknown',
      calls: s.call_count,
      totalDuration: s.total_duration || 0,
      avgDuration: s.call_count > 0 ? Math.round((s.total_duration || 0) / s.call_count) : 0,
    })),
    totals: {
      totalCalls: totals.total_calls,
      totalDuration: totals.total_duration || 0,
      avgDuration: Math.round(totals.avg_duration || 0),
      firstTimeCallers: firstTimers,
      leads,
      leadValue,
    },
  };
}

/**
 * Get call volume by hour/day
 */
export async function getCallVolumeReport(companyId: string, { startDate, endDate, groupBy = 'day' }: { startDate?: string; endDate?: string; groupBy?: string } = {}) {
  let whereClause = `company_id = '${companyId}'`;
  if (startDate) whereClause += ` AND start_time >= '${new Date(startDate).toISOString()}'`;
  if (endDate) whereClause += ` AND start_time <= '${new Date(endDate).toISOString()}'`;

  const calls = rows(await db.execute(sql.raw(`
    SELECT start_time, duration, status FROM call_log WHERE ${whereClause}
  `)));

  const grouped: Record<string, { calls: number; answered: number; missed: number; duration: number }> = {};

  for (const call of calls as any[]) {
    let key: string;
    const date = new Date(call.start_time);

    if (groupBy === 'hour') {
      key = String(date.getHours());
    } else if (groupBy === 'dayOfWeek') {
      key = date.toLocaleDateString('en-US', { weekday: 'long' });
    } else {
      key = date.toISOString().split('T')[0];
    }

    if (!grouped[key]) {
      grouped[key] = { calls: 0, answered: 0, missed: 0, duration: 0 };
    }

    grouped[key].calls++;
    if (call.status === 'completed') grouped[key].answered++;
    if (call.status === 'missed') grouped[key].missed++;
    grouped[key].duration += call.duration || 0;
  }

  return Object.entries(grouped).map(([period, data]) => ({
    period,
    ...data,
    avgDuration: data.answered > 0 ? Math.round(data.duration / data.answered) : 0,
    answerRate: data.calls > 0 ? Math.round(data.answered / data.calls * 100) : 0,
  }));
}

export default {
  createTrackingNumber,
  getTrackingNumbers,
  updateTrackingNumber,
  logCall,
  getCalls,
  getCall,
  updateCall,
  tagCallAsLead,
  handleCallRailWebhook,
  handleTwilioWebhook,
  getAttributionReport,
  getCallVolumeReport,
};
