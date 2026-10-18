// Call tracking: tracking numbers per marketing source, the call log, the providers' call webhooks and the
// attribution reports. Moved from templates/crm/backend/src/services/calltracking.ts; its raw SQL is in
// server/data/calltracking.ts.
import { eq, and } from 'drizzle-orm'
import { mapCallRailPayload, insertLead } from '@twomiah/tenant-backend'
import { contact, lead } from '../../db/schema/index.ts'
import * as q from '../../data/calltracking.ts'
import type { CrmDeps } from '../deps.ts'

export interface CallInput {
  trackingNumber?: string; callerNumber?: string; callerName?: string; callerCity?: string; callerState?: string
  source?: string; campaign?: string; medium?: string; keyword?: string; landingPage?: string; direction?: string
  status?: string; duration?: number; startTime?: string; endTime?: string; recordingUrl?: string; transcription?: string
  tags?: string[]; notes?: string; providerId?: string; createContact?: boolean
}

function mapTwilioStatus(status: string): string {
  const map: Record<string, string> = { completed: 'completed', busy: 'missed', 'no-answer': 'missed', failed: 'failed' }
  return map[status] || status
}

export function createCalltrackingService(d: CrmDeps) {
  const { db } = d
  // Read at call time (the template read it at import), so a test or a redeploy sees the current value.
  const provider = () => process.env.CALL_TRACKING_PROVIDER || null

  /**
   * Log a call (a provider webhook, or one entered by hand). A first-time caller is filed in the Lead Inbox where
   * that is on — an enquiry nobody has answered yet — and as a Contact otherwise, as the CRM always did.
   */
  async function logCall(companyId: string, data: CallInput) {
    let trackingNumberId: string | null = null
    let trackingSource: string | null = data.source || null
    let trackingCampaign: string | null = data.campaign || null
    let trackingMedium: string | null = data.medium || null

    if (data.trackingNumber) {
      const tn = await q.findTrackingNumberByPhone(db, companyId, data.trackingNumber)
      if (tn) {
        trackingNumberId = tn.id
        trackingSource = tn.source || data.source || null
        trackingCampaign = tn.campaign || data.campaign || null
        trackingMedium = tn.medium || data.medium || null
      }
    }

    const toInbox = await d.features.isFeatureEnabled(companyId, 'lead_inbox')

    // Match the caller to a contact; with the inbox on, an unconverted inbox lead also makes the call "not first".
    let contactId: string | null = null
    let isFirstTimeCaller = true
    if (data.callerNumber) {
      const [c] = await db.select({ id: contact.id }).from(contact)
        .where(and(eq(contact.companyId, companyId), eq(contact.phone, data.callerNumber))).limit(1)
      if (c) {
        contactId = c.id
        isFirstTimeCaller = false
      } else if (toInbox) {
        const [l] = await db.select({ id: lead.id }).from(lead)
          .where(and(eq(lead.companyId, companyId), eq(lead.phone, data.callerNumber))).limit(1)
        if (l) isFirstTimeCaller = false
      }
    }

    const logged = await q.insertCallLog(db, {
      companyId, trackingNumberId, contactId,
      callerNumber: data.callerNumber || null, callerName: data.callerName || null, callerCity: data.callerCity || null, callerState: data.callerState || null,
      source: trackingSource, campaign: trackingCampaign, medium: trackingMedium, keyword: data.keyword || null, landingPage: data.landingPage || null,
      direction: data.direction || 'inbound', status: data.status || 'completed', duration: data.duration || 0,
      startTime: data.startTime ? new Date(data.startTime) : new Date(), endTime: data.endTime ? new Date(data.endTime) : null,
      recordingUrl: data.recordingUrl || null, transcription: data.transcription || null,
      tags: data.tags || [], notes: data.notes || null,
      firstTimeCaller: isFirstTimeCaller, providerId: data.providerId || null,
    })

    if (isFirstTimeCaller && data.callerNumber && data.createContact !== false && toInbox) {
      const row = await insertLead(db, lead, {
        companyId,
        sourceId: null,
        platform: 'phone',
        parsed: {
          name: data.callerName || 'Unknown Caller',
          phone: data.callerNumber,
          location: [data.callerCity, data.callerState].filter(Boolean).join(', '),
          description: [
            trackingSource && `Source: ${trackingSource}`,
            trackingCampaign && `Campaign: ${trackingCampaign}`,
            data.keyword && `Keyword: ${data.keyword}`,
            data.status && data.status !== 'completed' && `Call: ${data.status}`,
            data.transcription && `Transcription: ${data.transcription}`,
          ].filter(Boolean).join('\n'),
        },
        rawPayload: data,
      } as any)
      d.realtime.emitToCompany(companyId, d.realtime.EVENTS.LEAD_CREATED, { id: row.id, sourcePlatform: 'phone', homeownerName: row.homeownerName })
    } else if (isFirstTimeCaller && data.callerNumber && data.createContact !== false) {
      await db.insert(contact).values({
        companyId,
        name: data.callerName || 'Unknown Caller',
        phone: data.callerNumber,
        source: trackingSource || 'phone',
        notes: `First call: ${new Date().toLocaleDateString()}`,
      })
    }
    return logged
  }

  async function getAttributionReport(companyId: string, range: { startDate?: string; endDate?: string } = {}) {
    const f = await q.attributionFigures(db, companyId, range)
    return {
      bySource: f.bySource.map((s) => ({
        source: s.source || 'unknown',
        calls: s.callCount,
        totalDuration: s.totalDuration || 0,
        avgDuration: s.callCount > 0 ? Math.round((s.totalDuration || 0) / s.callCount) : 0,
      })),
      totals: {
        totalCalls: f.totalCalls,
        totalDuration: f.totalDuration || 0,
        avgDuration: Math.round(f.avgDuration || 0),
        firstTimeCallers: f.firstTimeCallers,
        leads: f.leads,
        leadValue: f.leadValue,
      },
    }
  }

  async function getCallVolumeReport(companyId: string, { startDate, endDate, groupBy = 'day' }: { startDate?: string; endDate?: string; groupBy?: string } = {}) {
    const calls = await q.callTimes(db, companyId, { startDate, endDate })
    const grouped: Record<string, { calls: number; answered: number; missed: number; duration: number }> = {}
    for (const call of calls) {
      let key: string
      const date = new Date(call.startTime)
      if (groupBy === 'hour') key = String(date.getHours())
      else if (groupBy === 'dayOfWeek') key = date.toLocaleDateString('en-US', { weekday: 'long' })
      else key = date.toISOString().split('T')[0]
      if (!grouped[key]) grouped[key] = { calls: 0, answered: 0, missed: 0, duration: 0 }
      grouped[key].calls++
      if (call.status === 'completed') grouped[key].answered++
      if (call.status === 'missed') grouped[key].missed++
      grouped[key].duration += call.duration || 0
    }
    return Object.entries(grouped).map(([period, data]) => ({
      period,
      ...data,
      avgDuration: data.answered > 0 ? Math.round(data.duration / data.answered) : 0,
      answerRate: data.calls > 0 ? Math.round(data.answered / data.calls * 100) : 0,
    }))
  }

  return {
    createTrackingNumber: (companyId: string, data: any) => q.insertTrackingNumber(db, companyId, data, provider()),
    getTrackingNumbers: (companyId: string, opts: { source?: string; active?: boolean | null }) => q.listTrackingNumbers(db, companyId, opts),
    updateTrackingNumber: (id: string, companyId: string, data: Record<string, unknown>) => q.updateTrackingNumber(db, id, companyId, data),
    logCall,
    getCalls: (companyId: string, f: Parameters<typeof q.listCalls>[2]) => q.listCalls(db, companyId, f),
    getCall: (id: string, companyId: string) => q.getCall(db, id, companyId),
    updateCall: (id: string, companyId: string, data: Record<string, unknown>) => q.updateCall(db, id, companyId, data),
    tagCallAsLead: (id: string, companyId: string, body: { value?: number; notes?: string }) => q.tagCallAsLead(db, id, companyId, body),
    /** CallRail's field names (customer_phone_number, customer_name, source_name …), mapped by the shared reader. */
    handleCallRailWebhook: (companyId: string, payload: any) => logCall(companyId, mapCallRailPayload(payload) as CallInput),
    handleTwilioWebhook: (companyId: string, payload: any) => logCall(companyId, {
      trackingNumber: payload.To,
      callerNumber: payload.From,
      callerCity: payload.FromCity,
      callerState: payload.FromState,
      direction: payload.Direction === 'inbound' ? 'inbound' : 'outbound',
      status: mapTwilioStatus(payload.CallStatus),
      duration: parseInt(payload.CallDuration) || 0,
      providerId: payload.CallSid,
      recordingUrl: payload.RecordingUrl,
    }),
    getAttributionReport,
    getCallVolumeReport,
  }
}

export type CalltrackingService = ReturnType<typeof createCalltrackingService>
