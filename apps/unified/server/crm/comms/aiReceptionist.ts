// /api/ai-receptionist — the AI receptionist's rules and settings, a manual transcription, and Twilio's recording and
// status callbacks. Moved from templates/crm/backend/src/routes/aiReceptionist.ts.
//
// Mounted public: the two Twilio callbacks answer without a session and prove they ARE Twilio (X-Twilio-Signature
// checked before anything runs; unsigned/forged → 403). Everything after them signs the person in and needs the AI
// Receptionist switched on — inside the router, as the template ordered it, so inbound calls keep working.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, refuseUnverifiedWebhook, aiRuleCreateSchema, aiRuleUpdateSchema, aiSettingsSchema } from '@twomiah/tenant-backend'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, done, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { createAiReceptionistService } from './aiReceptionistService.ts'
import { createAiCallAnsweringService, type AiCallAnsweringService } from './aiCallAnsweringService.ts'
import { twilioVoiceProvider, type VoiceProvider } from './voiceProvider.ts'
import { replyPaths, requestOrigin } from './aiCallAnswering.ts'

export function createAiReceptionistRoutes(d: CrmDeps, opts: { callAnswering?: AiCallAnsweringService; provider?: VoiceProvider } = {}) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const aiReceptionist = createAiReceptionistService(d)
  // Live AI call answering (ai_call_answering): when it is on and inside its hours, the assistant takes the call instead of
  // the ring-then-voicemail line below (./aiCallAnsweringService.ts; the provider renders what it says).
  const provider = opts.provider ?? twilioVoiceProvider
  const callAnswering = opts.callAnswering ?? createAiCallAnsweringService({ ...d, provider })
  const app = new Hono<AppEnv>()

  /** The Twilio auth token this company's calls are signed with. */
  const twilioTokenFor = async (id: string) => {
    const [row] = await db.select().from(company).where(eq(company.id, id)).limit(1)
    return twilioConfigFor(row || null).authToken
  }

  // ── Twilio callbacks (no session) ──

  app.post('/webhook/recording/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const payload: any = await parseTwilioBody(c)
    const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))
    if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio recording webhook', v.reason)
    // Processed after the reply: Twilio's callback is not held while the recording is transcribed.
    aiReceptionist.processRecordingWebhook(companyId, payload).catch((err: any) => {
      logger.error('[AIReceptionist] Recording webhook error', { error: err?.message })
    })
    return c.body(null, 200)
  })

  // Status callback: a call not answered runs the missed-call / after-hours rules.
  app.post('/webhook/status/:companyId', async (c) => {
    const companyId = c.req.param('companyId')
    const payload: any = await parseTwilioBody(c)
    const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))
    if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio status webhook', v.reason)
    // A call the live assistant was on has ended (the caller hung up mid-way): its transcript is closed; no missed-call rule.
    if (payload.CallSid && ['completed', 'no-answer', 'busy', 'failed', 'canceled'].includes(payload.CallStatus) && await callAnswering.hangup(companyId, payload.CallSid)) return c.body(null, 200)
    if (payload.CallStatus === 'no-answer' || payload.CallStatus === 'busy' || payload.CallStatus === 'failed') {
      const callStatus = payload.CallStatus === 'no-answer' ? 'missed' : payload.CallStatus
      aiReceptionist.evaluateRules(companyId, {
        callLogId: '', // not looked up by CallSid (the template's gap): the "AI responded" mark matches no row
        callerNumber: payload.From,
        status: callStatus,
      }).catch((err: any) => {
        logger.error('[AIReceptionist] Status webhook error', { error: err?.message })
      })
    }
    return c.body(null, 200)
  })

  // ── The phone line: Twilio's voice webhooks (no session; signed). TwiML out. ──
  // Twilio's voice URL for the business's number is /api/ai-receptionist/webhook/voice/<company id> (Twomiah sets it when
  // the line is connected). The paths in the TwiML are relative: Twilio requests them on this same address.
  const xml = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  const twiml = (c: any, body: string) => { c.header('Content-Type', 'text/xml'); return c.body(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, 200) }
  /** The greeting, then a message of up to two minutes; the recording comes back to /webhook/recording. */
  const voicemail = (companyId: string, greeting: string) =>
    `<Say voice="alice">${xml(greeting)}</Say>` +
    `<Record maxLength="120" playBeep="true" timeout="5" action="/api/ai-receptionist/webhook/voicemail-done/${xml(companyId)}" method="POST" recordingStatusCallback="/api/ai-receptionist/webhook/recording/${xml(companyId)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/>` +
    `<Say voice="alice">We did not get a message. Goodbye.</Say>`
  const signed = async (c: any, label: string) => {
    const companyId = c.req.param('companyId')
    const payload: any = await parseTwilioBody(c)
    const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))
    return v.ok ? { companyId, payload } : { refused: refuseUnverifiedWebhook(c, label, v.reason) }
  }

  // A call arrives: the live assistant answers when it is on and inside its hours; else ring the forwarding number for
  // 20 seconds; with none, straight to the greeting and voicemail.
  app.post('/webhook/voice/:companyId', async (c) => {
    const s = await signed(c, 'Twilio voice webhook')
    if ('refused' in s) return s.refused
    const incoming = provider.readIncoming(s.payload)
    if (incoming && await callAnswering.shouldAnswer(s.companyId)) {
      const paths = replyPaths(s.companyId)
      const actions = await callAnswering.incoming(s.companyId, incoming, { provider, callbackUrl: `${requestOrigin(c)}${paths.recording}` })
      const r = provider.render(actions, paths)
      c.header('Content-Type', r.contentType)
      return c.body(r.body, 200)
    }
    const line = await aiReceptionist.callArrived(s.companyId, s.payload)
    if (line.forwardTo) {
      return twiml(c, `<Dial timeout="20" action="/api/ai-receptionist/webhook/dial-result/${xml(s.companyId)}" method="POST">${xml(line.forwardTo)}</Dial>`)
    }
    const after = await aiReceptionist.dialEnded(s.companyId, { ...s.payload, DialCallStatus: 'no-answer' })
    return twiml(c, voicemail(s.companyId, after.greeting))
  })

  // The forwarded ring ended: picked up — done; not — the missed-call replies go, and the caller gets voicemail.
  app.post('/webhook/dial-result/:companyId', async (c) => {
    const s = await signed(c, 'Twilio dial-result webhook')
    if ('refused' in s) return s.refused
    const after = await aiReceptionist.dialEnded(s.companyId, s.payload)
    return twiml(c, after.answered ? '<Hangup/>' : voicemail(s.companyId, after.greeting))
  })

  // The message has been left (the recording itself arrives at /webhook/recording).
  app.post('/webhook/voicemail-done/:companyId', async (c) => {
    const s = await signed(c, 'Twilio voicemail webhook')
    if ('refused' in s) return s.refused
    return twiml(c, '<Say voice="alice">Thank you. Goodbye.</Say><Hangup/>')
  })

  // ── Signed in, and the AI Receptionist on ──
  app.use('*', d.authenticate)
  app.use('*', d.features.requireEnabledFeature('ai_receptionist'))

  app.get('/rules', requirePermission('ai-receptionist:read'), async (c) => {
    const rules = await aiReceptionist.getRules(c.get('user').companyId)
    return listAll(c, rules)
  })

  // Rule and settings bodies: the one shared schema (packages/tenant-backend/src/integrations/aiReceptionistSchemas.ts).
  // A malformed body is a 400 naming the field; unknown keys are dropped, and the service keeps only its field lists.
  app.post('/rules', requirePermission('ai-receptionist:create'), async (c) => {
    const parsed = aiRuleCreateSchema.safeParse(await c.req.json())
    if (!parsed.success) return invalid(c, parsed.error)
    const rule = await aiReceptionist.createRule(c.get('user').companyId, parsed.data as any)
    return one(c, rule, 201)
  })

  app.put('/rules/:id', requirePermission('ai-receptionist:update'), async (c) => {
    const parsed = aiRuleUpdateSchema.safeParse(await c.req.json())
    if (!parsed.success) return invalid(c, parsed.error)
    const rule = await aiReceptionist.updateRule(c.req.param('id'), c.get('user').companyId, parsed.data as any)
    if (!rule) return fail(c, 404, 'Rule not found')
    return one(c, rule)
  })

  app.delete('/rules/:id', requirePermission('ai-receptionist:delete'), async (c) => {
    // An id that is not this company's (or not there at all) is a 404, not a success that deleted nothing (live role check, 2026-10-23).
    if (!(await aiReceptionist.deleteRule(c.req.param('id'), c.get('user').companyId))) return fail(c, 404, 'Rule not found')
    return done(c)
  })

  app.get('/settings', requirePermission('ai-receptionist:read'), async (c) => {
    return one(c, await aiReceptionist.getSettings(c.get('user').companyId))
  })

  app.put('/settings', requirePermission('ai-receptionist:update'), async (c) => {
    const parsed = aiSettingsSchema.safeParse(await c.req.json())
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    // The zone is the business's (Settings › Company). Sending back the one shown is fine; another is refused in words.
    if (parsed.data.timezone !== undefined && parsed.data.timezone !== (await aiReceptionist.getSettings(companyId)).timezone) {
      return fail(c, 400, 'The AI Receptionist keeps time on your business’s time zone. Change it under Settings › Company.', 'timezone_is_the_company_s')
    }
    // The forwarding number is dialled: a number that cannot be rung is refused here, not discovered on a missed call.
    const fwd = parsed.data.forwardingNumber
    if (fwd && String(fwd).trim() && !aiReceptionist.forwardTo({ forwardingNumber: fwd })) {
      return fail(c, 400, 'The forwarding number must be a 10-digit US phone number, like (608) 555-0123.', 'validation_failed', { forwardingNumber: 'Enter a 10-digit US phone number' })
    }
    return one(c, await aiReceptionist.upsertSettings(companyId, parsed.data as any))
  })

  // A manual transcription of a call already in the log.
  app.post('/transcribe/:callId', requirePermission('ai-receptionist:create'), async (c) => {
    const callId = c.req.param('callId')
    const result = await aiReceptionist.transcribeExistingCall(c.get('user').companyId, callId)
    if (!result.ok) return fail(c, result.error === 'Call not found' ? 404 : 400, result.error)
    return one(c, { message: 'Transcription complete', callId, transcription: result.transcription, summary: result.summary })
  })

  return app
}
