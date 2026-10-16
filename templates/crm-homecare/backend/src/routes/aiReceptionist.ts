import { Hono } from 'hono'
import { z } from 'zod'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import aiReceptionist from '../services/aiReceptionist.ts'
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, refuseUnverifiedWebhook } from '../shared/index.ts'

const app = new Hono()

// --- Twilio webhooks (no session — called by Twilio, so each one proves it IS Twilio) ---
//
// X-Twilio-Signature is checked BEFORE anything runs; a forged or unsigned request is answered 403 and
// nothing else happens. Until 10/15 these accepted any caller: anyone with a agencyId could fire the AI
// receptionist's missed-call / after-hours rules (texts and emails to whatever number they named) or
// feed it a recording to transcribe. The token is the agency's own Twilio account (Settings ›
// Integrations) or the platform's TWILIO_AUTH_TOKEN. With neither: refused in production, allowed
// outside it, and the 403 says which key is missing.

/** The Twilio auth token this agency's calls are signed with. */
const twilioTokenFor = async (id: string) => {
  const [row] = await db.select().from(agencies).where(eq(agencies.id, id)).limit(1)
  return twilioConfigFor(row || null).authToken
}

app.post('/webhook/recording/:agencyId', async (c) => {
  const agencyId = c.req.param('agencyId')
  // Twilio sends form-encoded data (JSON still read, for tools); the signature covers the parsed params
  const payload: any = await parseTwilioBody(c)
  const v = verifyTwilioRequest(c, payload, await twilioTokenFor(agencyId))
  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio recording webhook', v.reason)

  // Process async -- don't block Twilio's webhook response
  aiReceptionist.processRecordingWebhook(agencyId, payload).catch(err => {
    console.error('[AIReceptionist] Recording webhook error:', err.message)
  })

  return c.body(null, 200)
})

// --- Twilio Status Callback (tracks missed calls / voicemails) ---

app.post('/webhook/status/:agencyId', async (c) => {
  const agencyId = c.req.param('agencyId')
  const payload: any = await parseTwilioBody(c)
  const v = verifyTwilioRequest(c, payload, await twilioTokenFor(agencyId))
  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio status webhook', v.reason)

  // If call was not answered, evaluate rules for missed_call / after_hours triggers
  if (payload.CallStatus === 'no-answer' || payload.CallStatus === 'busy' || payload.CallStatus === 'failed') {
    const callStatus = payload.CallStatus === 'no-answer' ? 'missed' : payload.CallStatus

    aiReceptionist.evaluateRules(agencyId, {
      callLogId: '', // Will need to look up by CallSid
      callerNumber: payload.From,
      status: callStatus,
    }).catch(err => {
      console.error('[AIReceptionist] Status webhook error:', err.message)
    })
  }

  return c.body(null, 200)
})

// --- Authenticated Routes ---
// Everything below is the AI receptionist's configuration and call log: the office's. (The Twilio webhooks above stay public.)
// The agency is the token's companyId (routes/auth.ts signs { userId, email, role, companyId: agency.id }).
// These handlers read user.agencyId, which no homecare token carries: the id bound as undefined and
// every statement failed ("syntax error at or near ORDER" on the call log).
app.use('*', authenticate, requireAdmin)

// --- Rules CRUD ---

/**
 * A rule's body is checked before it reaches the database (crm-roof's schema, T-series M1). Without it a missing
 * name / trigger / channel / message became a NOT NULL violation answered as a 500, and a trigger outside the list
 * simply never fired. The keyword is nullable here: the screen sends null for a rule that is not a keyword rule.
 * Unknown keys are dropped by zod, and the service keeps only its own field list on top (RULE_FIELDS).
 */
const ruleFields = z.object({
  name: z.string().trim().min(1),
  trigger: z.enum(['after_hours', 'missed_call', 'voicemail', 'new_lead', 'booking_request', 'keyword']),
  channel: z.enum(['sms', 'email', 'both']),
  messageTemplate: z.string().trim().min(1),
  delayMinutes: z.number().int().min(0).max(10080).optional(),
  isActive: z.boolean().optional(),
  keywordMatch: z.string().nullable().optional(),
})
// The object and the cross-field rule are kept apart: superRefine returns a ZodEffects, which has no .partial().
const ruleSchema = ruleFields.superRefine((r, ctx) => {
  if (r.trigger === 'keyword' && !r.keywordMatch?.trim())
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordMatch'], message: 'a keyword trigger needs a keyword to match' })
})
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const settingsSchema = z.object({
  isEnabled: z.boolean().optional(),
  businessHoursStart: z.string().regex(HHMM, 'office hours are HH:MM').optional(),
  businessHoursEnd: z.string().regex(HHMM, 'office hours are HH:MM').optional(),
  timezone: z.string().min(1).max(64).optional(),
  greetingText: z.string().max(2000).nullable().optional(),
  forwardingNumber: z.string().max(40).nullable().optional(),
})

app.get('/rules', async (c) => {
  const user = c.get('user') as any
  const rules = await aiReceptionist.getRules(user.companyId)
  return c.json({ data: rules })
})

app.post('/rules', async (c) => {
  const user = c.get('user') as any
  const body = ruleSchema.parse(await c.req.json())
  const rule = await aiReceptionist.createRule(user.companyId, body as any)
  return c.json(rule, 201)
})

app.put('/rules/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  // an edit may send one field (the toggle sends { isActive }); the keyword cross-check applies to a whole rule
  const body = ruleFields.partial().parse(await c.req.json())
  const rule = await aiReceptionist.updateRule(id, user.companyId, body as any)
  if (!rule) return c.json({ error: 'Rule not found' }, 404)
  return c.json(rule)
})

app.delete('/rules/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  await aiReceptionist.deleteRule(id, user.companyId)
  return c.json({ success: true })
})

// --- Settings ---

app.get('/settings', async (c) => {
  const user = c.get('user') as any
  const settings = await aiReceptionist.getSettings(user.companyId)
  return c.json(settings)
})

app.put('/settings', async (c) => {
  const user = c.get('user') as any
  const body = settingsSchema.parse(await c.req.json())
  const settings = await aiReceptionist.upsertSettings(user.companyId, body as any)
  return c.json(settings)
})

// --- Manual transcribe (admin can trigger on existing call) ---

app.post('/transcribe/:callId', async (c) => {
  const user = c.get('user') as any
  const callId = c.req.param('callId')

  // This would look up the call's recording URL and run transcription
  // For now, return a message indicating the feature
  return c.json({ message: 'Transcription queued', callId })
})

export default app
