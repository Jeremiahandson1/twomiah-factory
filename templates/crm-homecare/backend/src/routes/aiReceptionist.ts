import { Hono } from 'hono'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import aiReceptionist from '../services/aiReceptionist.ts'
import { aiRuleCreateSchema, aiRuleUpdateSchema, aiSettingsSchema } from '../shared/index.ts'
import { requireEnabledFeature } from '../middleware/enabledFeature.ts'
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
// AI Receptionist switched off for this agency → its endpoints are refused, not only hidden in the menu (AdminDashboard
// FEATURE_FOR_ITEM). Registered after the Twilio webhooks above, which stay reachable — signature-checked — so a call
// in flight is still answered. Reads the column and the settings blob, as the screens do (middleware/enabledFeature.ts).
app.use('*', requireEnabledFeature('ai_receptionist'))

// --- Rules CRUD ---

// Rule and settings bodies: the ONE shared schema (packages/tenant-backend/src/integrations/aiReceptionistSchemas.ts).
// A malformed create is a 400 naming the field, not a NOT NULL 500; unknown keys are dropped before the service,
// which keeps only RULE_FIELDS / SETTINGS_FIELDS on top. (10/16)

app.get('/rules', async (c) => {
  const user = c.get('user') as any
  const rules = await aiReceptionist.getRules(user.companyId)
  return c.json({ data: rules })
})

app.post('/rules', async (c) => {
  const user = c.get('user') as any
  const body = aiRuleCreateSchema.parse(await c.req.json())
  const rule = await aiReceptionist.createRule(user.companyId, body as any)
  return c.json(rule, 201)
})

app.put('/rules/:id', async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  // an edit may send one field (the toggle sends { isActive }); the keyword cross-check applies to a whole rule
  const body = aiRuleUpdateSchema.parse(await c.req.json())
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
  const body = aiSettingsSchema.parse(await c.req.json())
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
