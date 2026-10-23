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

export function createAiReceptionistRoutes(d: CrmDeps) {
  const { db, logger } = d
  const { requirePermission } = d.permissions
  const aiReceptionist = createAiReceptionistService(d)
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
    await aiReceptionist.deleteRule(c.req.param('id'), c.get('user').companyId)
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
