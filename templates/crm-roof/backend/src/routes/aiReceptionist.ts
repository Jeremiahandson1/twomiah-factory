import { Hono } from 'hono'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import aiReceptionist from '../services/aiReceptionist.ts'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, refuseUnverifiedWebhook } from '../shared/index.ts'

const app = new Hono()

// --- Twilio webhooks (no session — called by Twilio, so each one proves it IS Twilio) ---
//
// X-Twilio-Signature is checked BEFORE anything runs; a forged or unsigned request is answered 403 and
// nothing else happens. Until 10/15 these accepted any caller: anyone with a companyId could fire the AI
// receptionist's missed-call / after-hours rules (texts and emails to whatever number they named) or
// feed it a recording to transcribe. The token is the company's own Twilio account (Settings ›
// Integrations) or the platform's TWILIO_AUTH_TOKEN. With neither: refused in production, allowed
// outside it, and the 403 says which key is missing.

/** The Twilio auth token this company's calls are signed with. */
const twilioTokenFor = async (id: string) => {
  const [row] = await db.select().from(company).where(eq(company.id, id)).limit(1)
  return twilioConfigFor(row || null).authToken
}

app.post('/webhook/recording/:companyId', async (c) => {
  const companyId = c.req.param('companyId')
  // Twilio sends form-encoded data (JSON still read, for tools); the signature covers the parsed params
  const payload: any = await parseTwilioBody(c)
  const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))
  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio recording webhook', v.reason)

  // Process async -- don't block Twilio's webhook response
  aiReceptionist.processRecordingWebhook(companyId, payload).catch(err => {
    console.error('[AIReceptionist] Recording webhook error:', err.message)
  })

  return c.body(null, 200)
})

// --- Twilio Status Callback (tracks missed calls / voicemails) ---

app.post('/webhook/status/:companyId', async (c) => {
  const companyId = c.req.param('companyId')
  const payload: any = await parseTwilioBody(c)
  const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))
  if (!v.ok) return refuseUnverifiedWebhook(c, 'Twilio status webhook', v.reason)

  // If call was not answered, evaluate rules for missed_call / after_hours triggers
  if (payload.CallStatus === 'no-answer' || payload.CallStatus === 'busy' || payload.CallStatus === 'failed') {
    const callStatus = payload.CallStatus === 'no-answer' ? 'missed' : payload.CallStatus

    aiReceptionist.evaluateRules(companyId, {
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
app.use('*', authenticate)

// --- Rules CRUD ---

app.get('/rules', async (c) => {
  const user = c.get('user') as any
  const rules = await aiReceptionist.getRules(user.companyId)
  return c.json({ data: rules })
})

/**
 * M1: these routes read the body raw and handed it straight to the database. Four junk payloads
 * stored with a 201, and two more came back as 500s — which were not crashes in any interesting
 * sense, just NOT NULL violations on name / trigger / channel / message_template surfacing as
 * "Internal server error" instead of "you left the message template out".
 *
 * The trigger and channel lists are the ones the column comments in schema.ts already document; a
 * rule with a trigger outside them simply never fires, which is the worst kind of silence for a
 * feature whose whole job is to answer when nobody else can.
 */
// The object and the cross-field rule are kept apart on purpose: superRefine returns a ZodEffects,
// which has no `.partial()`, so folding them together would make the PUT below throw at runtime.
const ruleFields = z.object({
  name: z.string().trim().min(1),
  trigger: z.enum(['after_hours', 'missed_call', 'voicemail', 'new_lead', 'booking_request', 'keyword']),
  channel: z.enum(['sms', 'email', 'both']),
  messageTemplate: z.string().trim().min(1),
  delayMinutes: z.number().int().min(0).max(10080).optional(),
  isActive: z.boolean().optional(),
  keywordMatch: z.string().optional(),
})

const ruleSchema = ruleFields.superRefine((r, ctx) => {
  // a keyword rule with no keyword matches nothing at all
  if (r.trigger === 'keyword' && !r.keywordMatch?.trim())
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywordMatch'], message: 'a keyword trigger needs a keyword to match' })
})

app.post('/rules', requirePermission('ai-receptionist:create'), async (c) => {
  const user = c.get('user') as any
  const body = ruleSchema.parse(await c.req.json())
  const rule = await aiReceptionist.createRule(user.companyId, body)
  return c.json(rule, 201)
})

app.put('/rules/:id', requirePermission('ai-receptionist:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  // an edit may send one field; the keyword cross-check only applies to a whole rule
  const body = ruleFields.partial().parse(await c.req.json())
  const rule = await aiReceptionist.updateRule(id, user.companyId, body)
  if (!rule) return c.json({ error: 'Rule not found' }, 404)
  return c.json(rule)
})

app.delete('/rules/:id', requirePermission('ai-receptionist:delete'), async (c) => {
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

app.put('/settings', requirePermission('ai-receptionist:update'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const settings = await aiReceptionist.upsertSettings(user.companyId, body)
  return c.json(settings)
})

// --- Manual transcribe (admin can trigger on existing call) ---

app.post('/transcribe/:callId', requirePermission('ai-receptionist:create'), async (c) => {
  const user = c.get('user') as any
  const callId = c.req.param('callId')

  const result = await aiReceptionist.transcribeExistingCall(user.companyId, callId)
  if (!result.ok) return c.json({ error: result.error }, result.error === 'Call not found' ? 404 : 400)
  return c.json({ message: 'Transcription complete', callId, transcription: result.transcription, summary: result.summary })
})

export default app
