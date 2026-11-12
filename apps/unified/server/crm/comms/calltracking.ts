// /api/calltracking — tracking numbers, the call log, the attribution reports, the CallRail signing key, and the
// providers' call webhooks. Moved from templates/crm/backend/src/routes/calltracking.ts.
//
// Mounted public: the two provider webhooks answer without a session and prove they ARE the provider (signature
// checked before anything is read or written; unsigned/forged → 403). Everything after them signs the person in and
// needs Call Tracking switched on (or, where the vertical sells no Call Tracking, the AI Receptionist —
// CrmSettings.callTrackingSwitch) — here, inside the router, as the template ordered it, so a tenant with the switch
// off still logs the calls its providers send.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, verifyCallRailSignature, refuseUnverifiedWebhook } from '@twomiah/tenant-backend'
import { company, trackingNumber } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one, done, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { createCalltrackingService } from './calltrackingService.ts'
import { attachRecording, clearRecording, expiredRecordings, recordingOf } from '../../data/calltracking.ts'
import { DEFAULT_RECORDING_NOTICE, deleteRecordingAt, fetchCall, fetchRecordingAudio, parseRecordingUrl } from './recordings.ts'

const trackingNumberSchema = z.object({
  phoneNumber: z.string().trim().min(1, 'The tracking phone number is required'),
  forwardTo: z.string().optional(),
  source: z.string().optional(),
  campaign: z.string().optional(),
  medium: z.string().optional(),
  name: z.string().optional(),
  providerId: z.string().optional(),
})

const recordingSchema = z.object({
  callRecording: z.boolean().optional(),
  callRecordingNotice: z.string().max(300, 'Keep the notice under 300 characters').optional().nullable(),
  callRecordingKeepDays: z.union([z.literal(30), z.literal(90), z.literal(365), z.null()], { error: 'Keep recordings 30, 90 or 365 days, or until deleted' }).optional(),
})

/** A call as the screens get it: a Twilio recording is said to be there (and how long), never where. */
const forScreen = (r: any) => (r?.recordingSid ? { ...r, recordingSid: undefined, recordingUrl: null, recording: { seconds: r.recordingSeconds ?? null } } : { ...r, recording: null })

const xmlEscape = (s: string) => s.replace(/[<>&"']/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch]!))
const voiceXml = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`

export function createCalltrackingRoutes(d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const calltracking = createCalltrackingService(d)
  const app = new Hono<AppEnv>()

  // Recordings past the days the business keeps them are deleted at Twilio, then off the call: daily, first an hour after boot.
  const sweepRecordings = async () => {
    for (const r of await expiredRecordings(db)) {
      const [row] = await db.select().from(company).where(eq(company.id, r.companyId)).limit(1)
      if (await deleteRecordingAt(row, r.recordingUrl)) await clearRecording(db, r.companyId, r.id)
    }
  }
  const jobs = (d.services as any).eventJobs
  if (jobs) jobs.callRecordingSweep = sweepRecordings
  d.services.addJob?.(() => {
    const run = () => sweepRecordings().catch((e: any) => logger.warn('[calltracking] recording sweep failed', { error: e?.message }))
    const t1 = setTimeout(run, 60 * 60_000); (t1 as any).unref?.()
    const t2 = setInterval(run, 24 * 60 * 60_000); (t2 as any).unref?.()
  })

  /** Where Twilio and CallRail reach this app: the site's own address (https). */
  const webhookOrigin = (c: any) => String(process.env.FRONTEND_URL || new URL(c.req.url).origin).replace(/\/+$/, '').replace(/^http:\/\//, 'https://')

  /** The company row a webhook names — its CallRail signing key and its Twilio account. */
  const companyRowFor = async (id: string) => {
    const [row] = await db.select().from(company).where(eq(company.id, id)).limit(1)
    return row || null
  }

  // ── Webhooks (no session) ──

  // CallRail signs the RAW body: Signature = Base64(HMAC-SHA1(signing key, body)). Read as text, verify, then parse.
  app.post('/webhook/callrail/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const raw = await c.req.text()
    const row: any = await companyRowFor(companyId)
    const v = verifyCallRailSignature(raw, c.req.header('signature'), row?.callrailSigningKey || undefined)
    if (!v.ok) return refuseUnverifiedWebhook(c, 'CallRail call webhook', v.reason)
    let body: any
    try { body = JSON.parse(raw) } catch { return fail(c, 400, 'Body must be JSON') }
    try {
      await calltracking.handleCallRailWebhook(companyId, body)
    } catch (error: any) {
      logger.error('CallRail webhook error', { error: error?.message })
    }
    return c.body(null, 200)
  })

  /**
   * A request signed by Twilio — with the company's own account (Settings › Integrations), or Twomiah's (the platform's
   * TWILIO_AUTH_TOKEN), which owns the tracking numbers Twomiah sells: a company with its own Twilio still gets those calls.
   */
  const fromTwilio = (c: any, params: Record<string, string>, row: any) => {
    const own = verifyTwilioRequest(c, params, twilioConfigFor(row).authToken)
    if (own.ok || !process.env.TWILIO_AUTH_TOKEN || twilioConfigFor(row).authToken === process.env.TWILIO_AUTH_TOKEN) return own
    return verifyTwilioRequest(c, params, process.env.TWILIO_AUTH_TOKEN)
  }

  // Twilio posts application/x-www-form-urlencoded (JSON still read, for tools) and signs URL + sorted params with
  // the account's auth token — the company's own (Settings › Integrations) or the platform's TWILIO_AUTH_TOKEN.
  app.post('/webhook/twilio/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const params = await parseTwilioBody(c)
    const row = await companyRowFor(companyId)
    const v = fromTwilio(c, params, row)
    if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio call webhook', v.reason)
    try {
      await calltracking.handleTwilioWebhook(companyId, params)
    } catch (error: any) {
      logger.error('Twilio webhook error', { error: error?.message })
    }
    return c.body(null, 200)
  })

  /**
   * A call to a tracking number Twomiah sold (call_tracking_numbers — trackingLines.ts): Twilio asks what to do, and the
   * answer is to ring the business's own line, showing the caller's number, so the business answers as it always does.
   * Which ad it came from is the number that was dialled; the call is logged from the status callback above. A number
   * this company has no line for (given back, or not set up) says so and hangs up.
   */
  app.post('/voice/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const params = await parseTwilioBody(c)
    const row = await companyRowFor(companyId)
    if (!row) return c.notFound()
    const v = fromTwilio(c, params, row)
    if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio voice webhook', v.reason)
    const last10 = (x: unknown) => String(x ?? '').replace(/\D/g, '').slice(-10)
    const lines = await db.select({ phoneNumber: trackingNumber.phoneNumber, forwardTo: trackingNumber.forwardTo }).from(trackingNumber)
      .where(and(eq(trackingNumber.companyId, companyId), eq(trackingNumber.active, true)))
    const line = (lines as any[]).find((l) => last10(l.phoneNumber) === last10(params.To) && last10(l.forwardTo).length === 10)
    c.header('Content-Type', 'text/xml')
    if (!line) return c.body(voiceXml('<Say>This number is not in service.</Say><Hangup/>'))
    const caller = /^\+?\d{7,15}$/.test(params.From || '') ? ` callerId="${xmlEscape(params.From)}"` : ''
    // Call recording (CallRail's), where the business turned it on: the caller hears the notice first — some states need both
    // sides told — then both sides are recorded from the answer, each on its own channel; Twilio says when it is ready.
    const rec = (row as any).callRecording
      ? ` record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(`${webhookOrigin(c)}/api/calltracking/webhook/twilio-recording/${companyId}`)}" recordingStatusCallbackEvent="completed"`
      : ''
    const notice = (row as any).callRecording ? `<Say>${xmlEscape(String((row as any).callRecordingNotice || DEFAULT_RECORDING_NOTICE).slice(0, 300))}</Say>` : ''
    return c.body(voiceXml(`${notice}<Dial answerOnBridge="true"${caller}${rec}><Number>+1${last10(line.forwardTo)}</Number></Dial>`))
  })

  /**
   * A call's recording is ready (Twilio's recordingStatusCallback, signed like the calls). It is filed on its call; a recording
   * that comes in before the call's own report has the call read from Twilio and logged first. Anything but a finished
   * recording at a Twilio address is ignored.
   */
  app.post('/webhook/twilio-recording/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const params = await parseTwilioBody(c)
    const row = await companyRowFor(companyId)
    if (!row) return c.notFound()
    const v = fromTwilio(c, params, row)
    if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio recording webhook', v.reason)
    const where = parseRecordingUrl(params.RecordingUrl)
    if (params.RecordingStatus !== 'completed' || !where || !params.CallSid) return c.body(null, 200)
    const r = { sid: where.recordingSid, url: `https://api.twilio.com/2010-04-01/Accounts/${where.accountSid}/Recordings/${where.recordingSid}`, seconds: parseInt(params.RecordingDuration) || 0 }
    try {
      if (!(await attachRecording(db, companyId, params.CallSid, r))) {
        const call = await fetchCall(row, where.accountSid, params.CallSid)
        if (call) {
          await calltracking.handleTwilioWebhook(companyId, { CallSid: params.CallSid, From: call.from, To: call.to, CallStatus: call.status, CallDuration: call.duration, Direction: call.direction.startsWith('inbound') ? 'inbound' : 'outbound' })
          await attachRecording(db, companyId, params.CallSid, r)
        }
      }
    } catch (error: any) {
      logger.error('Twilio recording webhook error', { error: error?.message })
    }
    return c.body(null, 200)
  })

  // ── Signed in, and Call Tracking on (the AI Receptionist, where that is the switch) ──
  app.use('*', d.authenticate)
  app.use('*', d.features.requireEnabledFeature(d.settings?.callTrackingSwitch ?? 'call_tracking'))

  // Tracking numbers
  app.get('/numbers', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const active = c.req.query('active')
    const numbers = await calltracking.getTrackingNumbers(user.companyId, {
      source: c.req.query('source'),
      active: active === 'false' ? false : active === 'all' ? null : true,
    })
    return listAll(c, numbers)
  })

  app.post('/numbers', requirePermission('calltracking:create'), async (c) => {
    const user = c.get('user')
    // The number is required (the template inserted whatever came, and a missing one broke the INSERT: a 500).
    const parsed = trackingNumberSchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const number = await calltracking.createTrackingNumber(user.companyId, parsed.data)
    return one(c, number, 201)
  })

  app.put('/numbers/:id', requirePermission('calltracking:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    await calltracking.updateTrackingNumber(c.req.param('id'), user.companyId, body)
    return done(c)
  })

  // Calls
  app.get('/calls', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    // clientId: home care's call log filters by client (CrmSettings.callers).
    const { source, status, startDate, endDate, contactId, clientId, firstTimeOnly, page, limit } = c.req.query() as any
    const r = await calltracking.getCalls(user.companyId, {
      source, status, startDate, endDate, contactId, clientId,
      firstTimeOnly: firstTimeOnly === 'true',
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
    })
    return list(c, r.data.map(forScreen), { page: r.page, limit: r.limit, total: r.total })
  })

  app.get('/calls/:id', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const call = await calltracking.getCall(c.req.param('id'), user.companyId)
    if (!call) return fail(c, 404, 'Call not found')
    return one(c, forScreen(call))
  })

  /**
   * A call's recording, played here (calltracking:read): fetched from Twilio with the account's own credentials and passed on, never
   * kept by the browser (private, no-store). A CallRail recording is CallRail's link on the call, as before.
   */
  app.get('/calls/:id/recording', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const rec = await recordingOf(db, user.companyId, c.req.param('id'))
    if (!rec) return fail(c, 404, 'This call has no recording')
    const audio = await fetchRecordingAudio(await companyRowFor(user.companyId), rec.recordingUrl)
    if (!audio || !audio.body) return fail(c, 502, 'The recording could not be fetched from the phone company. Try again in a minute.', 'recording_unavailable')
    return new Response(audio.body, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, no-store', 'Content-Disposition': `inline; filename="call-${rec.id}.mp3"` } })
  })

  /** Delete a call's recording (calltracking:update): at Twilio, then off the call. */
  app.delete('/calls/:id/recording', requirePermission('calltracking:update'), async (c) => {
    const user = c.get('user')
    const rec = await recordingOf(db, user.companyId, c.req.param('id'))
    if (!rec) return fail(c, 404, 'This call has no recording')
    if (!(await deleteRecordingAt(await companyRowFor(user.companyId), rec.recordingUrl))) return fail(c, 502, 'The phone company did not delete the recording. Try again in a minute.', 'recording_not_deleted')
    await clearRecording(db, user.companyId, rec.id)
    await d.audit.log({ action: 'delete', entity: 'call_recording', entityId: rec.id, metadata: { description: 'Call recording deleted' }, req: c })
    return done(c)
  })

  app.put('/calls/:id', requirePermission('calltracking:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    await calltracking.updateCall(c.req.param('id'), user.companyId, body)
    return done(c)
  })

  app.post('/calls/:id/lead', requirePermission('calltracking:create'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    await calltracking.tagCallAsLead(c.req.param('id'), user.companyId, body)
    return done(c)
  })

  app.post('/calls', requirePermission('calltracking:create'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const call = await calltracking.logCall(user.companyId, body)
    return one(c, call, 201)
  })

  // Reports
  app.get('/reports/attribution', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const { startDate, endDate } = c.req.query() as any
    return one(c, await calltracking.getAttributionReport(user.companyId, { startDate, endDate }))
  })

  app.get('/reports/volume', requirePermission('calltracking:read'), async (c) => {
    const user = c.get('user')
    const { startDate, endDate, groupBy } = c.req.query() as any
    const report = await calltracking.getCallVolumeReport(user.companyId, { startDate, endDate, groupBy })
    return listAll(c, report)
  })

  // Settings — the CallRail signing key. Owner and admins (integrations:update). Write-only: GET answers whether one
  // is SET, never the key; without it, production refuses every CallRail webhook. And call recording (on the numbers Twomiah
  // sells): on or off, the notice the caller hears first, and how long a recording is kept.

  app.get('/settings', requirePermission('integrations:update'), async (c) => {
    const user = c.get('user')
    const row: any = await companyRowFor(user.companyId)
    return one(c, {
      callrailSigningKeySet: !!row?.callrailSigningKey,
      callrailWebhookUrl: `${webhookOrigin(c)}/api/calltracking/webhook/callrail/${user.companyId}`,
      callRecording: !!row?.callRecording,
      callRecordingNotice: row?.callRecordingNotice || DEFAULT_RECORDING_NOTICE,
      callRecordingKeepDays: row?.callRecordingKeepDays ?? null,
    })
  })

  app.put('/settings', requirePermission('integrations:update'), async (c) => {
    const user = c.get('user')
    const body = (await c.req.json().catch(() => null)) as any
    if (!body || typeof body !== 'object') return fail(c, 400, 'Send the settings to change')
    // Call recording: any of the three, each checked; the rest of the body is the CallRail key, as before.
    const rec = recordingSchema.safeParse(body)
    if (!rec.success) return invalid(c, rec.error)
    const recPatch: Record<string, unknown> = {}
    if (rec.data.callRecording !== undefined) recPatch.callRecording = rec.data.callRecording
    if (rec.data.callRecordingNotice !== undefined) recPatch.callRecordingNotice = rec.data.callRecordingNotice?.trim() || null
    if (rec.data.callRecordingKeepDays !== undefined) recPatch.callRecordingKeepDays = rec.data.callRecordingKeepDays
    if (Object.keys(recPatch).length) {
      const before: any = await companyRowFor(user.companyId)
      await db.update(company).set({ ...recPatch, updatedAt: new Date() } as any).where(eq(company.id, user.companyId))
      if (recPatch.callRecording !== undefined && !!before?.callRecording !== recPatch.callRecording) {
        await d.audit.log({ action: 'update', entity: 'company', entityId: user.companyId, metadata: { description: `Call recording turned ${recPatch.callRecording ? 'on' : 'off'}` }, req: c })
      }
    }
    if (!('callrailSigningKey' in body)) {
      const row: any = await companyRowFor(user.companyId)
      return one(c, { callrailSigningKeySet: !!row?.callrailSigningKey, callRecording: !!row?.callRecording, callRecordingNotice: row?.callRecordingNotice || DEFAULT_RECORDING_NOTICE, callRecordingKeepDays: row?.callRecordingKeepDays ?? null })
    }
    const v = body.callrailSigningKey
    let key: string | null = null
    if (v === null || (typeof v === 'string' && v.trim() === '')) key = null
    else if (typeof v === 'string' && /^[\x21-\x7e]{8,200}$/.test(v.trim())) key = v.trim()
    else return fail(c, 400, 'That is not a CallRail signing key — copy the signing key from the webhook settings in your CallRail account, 8 to 200 characters, no spaces')
    await db.update(company).set({ callrailSigningKey: key, updatedAt: new Date() } as any).where(eq(company.id, user.companyId))
    return one(c, { callrailSigningKeySet: !!key })
  })

  return app
}
