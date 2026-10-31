// /api/ai-call-answering — live AI call answering (feature `ai_call_answering`, hidden until the owner's voice provider
// is in place; docs/parity/fieldservice-ai-call-answering.md).
//
// Mounted public for the provider's turn webhooks, which answer without a session and prove they ARE the provider
// (X-Twilio-Signature with the company's auth token, as every Twilio door here; unsigned/forged → 403). The call itself
// arrives on the AI Receptionist's voice webhook (/api/ai-receptionist/webhook/voice/:companyId), which hands it here
// when the assistant is answering and otherwise rings and takes a message as it always did. Everything after the
// webhooks signs the person in, needs the feature on, and asks the AI Receptionist's own permissions (ai-receptionist:read
// to see, :update to change the settings — the admin line Settings draws).
import { Hono } from 'hono'
import { parseTwilioBody, verifyTwilioRequest, twilioConfigFor, refuseUnverifiedWebhook } from '@twomiah/tenant-backend'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, list, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { createAiCallAnsweringService, callAnsweringSchema, type AiCallAnsweringService } from './aiCallAnsweringService.ts'
import { twilioVoiceProvider, type ReplyPaths, type VoiceProvider } from './voiceProvider.ts'
import { WORDING_KEYS, WORDING_LABELS, WORDING_VARIABLES, DEFAULT_WORDING } from './callDialogue.ts'

/** The provider's reply paths for a company (relative: the provider requests them on this same address). */
export const replyPaths = (companyId: string): ReplyPaths => ({
  turn: `/api/ai-call-answering/webhook/turn/${encodeURIComponent(companyId)}`,
  transferResult: `/api/ai-call-answering/webhook/transfer-result/${encodeURIComponent(companyId)}`,
  recording: `/api/ai-receptionist/webhook/recording/${encodeURIComponent(companyId)}`,
})

/** The address this request came in on (behind Render's proxy: the forwarded scheme and host), for an absolute callback URL. */
export function requestOrigin(c: any): string {
  let u: URL
  try { u = new URL(c.req.url) } catch { return '' }
  const host = c.req.header('x-forwarded-host') || c.req.header('host') || u.host
  const proto = c.req.header('x-forwarded-proto') || u.protocol.replace(':', '')
  return `${proto}://${host}`
}

export function createAiCallAnsweringRoutes(d: CrmDeps, opts: { provider?: VoiceProvider; service?: AiCallAnsweringService } = {}) {
  const { db } = d
  const { requirePermission } = d.permissions
  const provider = opts.provider ?? twilioVoiceProvider
  const service = opts.service ?? createAiCallAnsweringService({ ...d, provider })
  const app = new Hono<AppEnv>()

  const twilioTokenFor = async (id: string) => {
    const [row] = await db.select().from(company).where(eq(company.id, id)).limit(1)
    return twilioConfigFor(row || null).authToken
  }
  const signed = async (c: any, label: string) => {
    const companyId = c.req.param('companyId')
    const payload: any = await parseTwilioBody(c)
    const v = verifyTwilioRequest(c, payload, await twilioTokenFor(companyId))
    return v.ok ? { companyId, payload } : { refused: refuseUnverifiedWebhook(c, label, v.reason) }
  }
  const reply = (c: any, companyId: string, actions: any[]) => {
    const r = provider.render(actions, replyPaths(companyId))
    c.header('Content-Type', r.contentType)
    return c.body(r.body, 200)
  }

  // ── The provider's turns (no session; signed) ──

  // The caller's next line, or nothing heard.
  app.post('/webhook/turn/:companyId', async (c) => {
    const s = await signed(c, 'AI call turn webhook')
    if ('refused' in s) return s.refused
    const ev = provider.readTurn(s.payload)
    const actions = ev ? await service.turn(s.companyId, ev) : null
    // No live call with this id: a polite end rather than an error the caller hears as silence.
    return reply(c, s.companyId, actions ?? [{ kind: 'hangup' }])
  })

  // The transfer's outcome: picked up — done; not — the engine offers a message.
  app.post('/webhook/transfer-result/:companyId', async (c) => {
    const s = await signed(c, 'AI call transfer webhook')
    if ('refused' in s) return s.refused
    const ev = provider.readTransferResult(s.payload)
    const actions = ev ? await service.turn(s.companyId, ev) : null
    return reply(c, s.companyId, actions ?? [{ kind: 'hangup' }])
  })

  // ── Signed in, and the feature on ──
  app.use('*', d.authenticate)
  app.use('*', d.features.requireEnabledFeature('ai_call_answering'))

  const view = (s: any) => ({ ...s, wordingKeys: WORDING_KEYS, wordingLabels: WORDING_LABELS, wordingVariables: WORDING_VARIABLES, defaultWording: DEFAULT_WORDING })

  app.get('/settings', requirePermission('ai-receptionist:read'), async (c) => one(c, view(await service.getSettings(c.get('user').companyId))))

  app.put('/settings', requirePermission('ai-receptionist:update'), async (c) => {
    const parsed = callAnsweringSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    return one(c, view(await service.saveSettings(c.get('user').companyId, parsed.data)))
  })

  /** The services the assistant can name and book, as it sees them (the pricebook's customer-visible services). */
  app.get('/services', requirePermission('ai-receptionist:read'), async (c) => {
    const companyId = c.get('user').companyId
    return listAll(c, await service.services(companyId, await service.getSettings(companyId)))
  })

  /** Whether the assistant would pick up right now, in words for the page. */
  app.get('/status', requirePermission('ai-receptionist:read'), async (c) => {
    const companyId = c.get('user').companyId
    const s = await service.getSettings(companyId)
    const answering = s.enabled && await service.shouldAnswer(companyId)
    return one(c, { answering, label: !s.enabled ? 'Off' : answering ? 'Answering calls now' : 'On, but outside its hours right now' })
  })

  app.get('/calls', requirePermission('ai-receptionist:read'), async (c) => {
    const page = Math.max(1, Number(c.req.query('page')) || 1), limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 25))
    const r = await service.listCalls(c.get('user').companyId, page, limit)
    return list(c, r.rows, { page, limit, total: r.total })
  })

  app.get('/calls/:id', requirePermission('ai-receptionist:read'), async (c) => {
    const row = await service.getCall(c.get('user').companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Call not found')
    return one(c, row)
  })

  return app
}
