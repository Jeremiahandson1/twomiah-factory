// The admin side of Apps & integrations (parity row 8, 2026-10-31). Three mounts, each behind its own hidden feature and the
// permission the Menu row asks (integrations:update — the seat that connects the shop's other accounts):
//   /api/admin/store-webhooks  (store_webhooks)
//     GET /                         the addresses, the events they can ask for, and the recent deliveries
//     POST /                        { url, events[] } → the address, with its signing secret — shown this once
//     PATCH /:id                    { url?, events?, active? }
//     POST /:id/secret              a new signing secret, shown this once (the old one stops working at once)
//     POST /:id/test                a test message, sent now: what the address answered
//     DELETE /:id                   the address and its log
//     GET /deliveries?webhookId=&status=   the log;  GET /deliveries/:id  one, with the exact body sent
//     POST /deliveries/:id/send-again      one more try now
//   /api/admin/store-api-keys  (store_api)
//     GET / the keys (never the key itself) and the scopes;  POST / { name, scopes[] } → the key, shown this once;  DELETE /:id revokes
//   /api/admin/apps            (store_apps)
//     GET /                         the catalogue: each app's connect state, its settings in brief, and where to manage it
import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'
import { and, count, desc, eq } from 'drizzle-orm'
import { storeApiKey, storeWebhook, storeWebhookDelivery } from '../../../db/schema/store.ts'
import { encrypt } from '../../../core/crypto.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { StoreCore } from '../core.ts'
import { API_SCOPES, API_SCOPE_LABELS, keyView, type ApiKeys, type ApiScope } from './apiKeys.ts'
import { appsCatalogue } from './catalogue.ts'
import type { StoreEventHub } from './events.ts'
import { MAX_ATTEMPTS, newSecret, RETRY_MINUTES, STORE_EVENTS, STORE_EVENT_LABELS } from './webhooks.ts'

const MAX_WEBHOOKS = 20
const MAX_KEYS = 20
const eventLabel = (e: string) => (STORE_EVENT_LABELS as Record<string, string>)[e] ?? (e === 'webhook.test' ? 'Test message' : e)
const STATUS_LABEL: Record<string, string> = { pending: 'Waiting to retry', delivered: 'Delivered', dead: 'Gave up', stopped: 'Stopped' }

const webhookView = (w: typeof storeWebhook.$inferSelect) => ({
  id: w.id, url: w.url, events: (w.events as string[]).map((e) => ({ id: e, label: eventLabel(e) })), active: w.active,
  lastDeliveryAt: w.lastDeliveryAt, lastStatus: w.lastStatus, failureCount: w.failureCount, createdAt: w.createdAt,
})
const deliveryView = (r: typeof storeWebhookDelivery.$inferSelect) => ({
  id: r.id, webhookId: r.webhookId, eventId: r.eventId, event: r.event, eventLabel: eventLabel(r.event), status: r.status, statusLabel: STATUS_LABEL[r.status] ?? r.status,
  attempts: r.attempts, responseStatus: r.responseStatus, error: r.error, nextAttemptAt: r.nextAttemptAt, lastAttemptAt: r.lastAttemptAt, deliveredAt: r.deliveredAt, createdAt: r.createdAt,
})

const eventsSchema = z.array(z.enum(STORE_EVENTS)).min(1, 'Choose at least one event').max(STORE_EVENTS.length)
const createSchema = z.object({ url: z.string().trim().min(1).max(500), events: eventsSchema }).strict()
const patchSchema = z.object({ url: z.string().trim().min(1).max(500).optional(), events: eventsSchema.optional(), active: z.boolean().optional() }).strict()

export function createWebhookRoutes(d: CrmDeps, hub: StoreEventHub) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = (c: Context) => (c as any).get('user').companyId as string
  app.use('*', requirePermission('integrations:update'))
  const mine = async (c: Context) => (await db.select().from(storeWebhook).where(and(eq(storeWebhook.id, String(c.req.param('id'))), eq(storeWebhook.companyId, own(c)))).limit(1))[0] as typeof storeWebhook.$inferSelect | undefined
  const urlProblem = async (c: Context, url: string) => {
    const p = await hub.webhooks.checkUrl(url)
    return p ? fail(c, 400, p, 'validation_failed', { url: p }) : null
  }
  const invalid = (c: Context, e: z.ZodError) => fail(c, 400, e.issues[0]?.message || 'Check what you entered.', 'validation_failed')

  app.get('/', async (c) => {
    const hooks = await db.select().from(storeWebhook).where(eq(storeWebhook.companyId, own(c))).orderBy(desc(storeWebhook.createdAt))
    const log = await db.select().from(storeWebhookDelivery).where(eq(storeWebhookDelivery.companyId, own(c))).orderBy(desc(storeWebhookDelivery.createdAt)).limit(50)
    return one(c, {
      webhooks: hooks.map(webhookView), events: STORE_EVENTS.map((id) => ({ id, label: STORE_EVENT_LABELS[id] })), deliveries: log.map(deliveryView),
      retryNote: `A delivery that fails is tried again ${RETRY_MINUTES.length} more times (after ${RETRY_MINUTES.map((m) => (m >= 60 ? `${m / 60} h` : `${m} min`)).join(', ')}), then it is marked "Gave up" here.`,
    })
  })

  app.post('/', async (c) => {
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const [{ n }] = await db.select({ n: count() }).from(storeWebhook).where(eq(storeWebhook.companyId, own(c)))
    if (Number(n) >= MAX_WEBHOOKS) return fail(c, 409, `A shop can have ${MAX_WEBHOOKS} webhook addresses. Remove one first.`, 'limit_reached')
    const bad = await urlProblem(c, parsed.data.url); if (bad) return bad
    const secret = newSecret()
    const [w] = await db.insert(storeWebhook).values({ companyId: own(c), url: parsed.data.url, secretEnc: encrypt(secret), events: [...new Set(parsed.data.events)] }).returning()
    await d.audit.log({ action: 'create', entity: 'store_webhook', entityId: w.id, entityName: w.url, companyId: own(c), req: c })
    return one(c, { webhook: webhookView(w), secret }, 201)
  })

  app.patch('/:id', async (c) => {
    const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const w = await mine(c); if (!w) return fail(c, 404, 'Not found')
    if (parsed.data.url && parsed.data.url !== w.url) { const bad = await urlProblem(c, parsed.data.url); if (bad) return bad }
    const [u] = await db.update(storeWebhook).set({
      ...(parsed.data.url ? { url: parsed.data.url } : {}), ...(parsed.data.events ? { events: [...new Set(parsed.data.events)] } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active, ...(parsed.data.active ? { failureCount: 0 } : {}) } : {}), updatedAt: new Date(),
    }).where(eq(storeWebhook.id, w.id)).returning()
    await d.audit.log({ action: 'update', entity: 'store_webhook', entityId: w.id, entityName: u.url, companyId: own(c), req: c, metadata: { description: parsed.data.active === false ? 'Switched off' : parsed.data.active === true ? 'Switched on' : 'Changed' } })
    return one(c, { webhook: webhookView(u) })
  })

  app.post('/:id/secret', async (c) => {
    const w = await mine(c); if (!w) return fail(c, 404, 'Not found')
    const secret = newSecret()
    await db.update(storeWebhook).set({ secretEnc: encrypt(secret), updatedAt: new Date() }).where(eq(storeWebhook.id, w.id))
    await d.audit.log({ action: 'update', entity: 'store_webhook', entityId: w.id, entityName: w.url, companyId: own(c), req: c, metadata: { description: 'Signing secret replaced' } })
    return one(c, { secret })
  })

  app.post('/:id/test', async (c) => {
    const w = await mine(c); if (!w) return fail(c, 404, 'Not found')
    const r = await hub.webhooks.sendTest(own(c), w.id)
    return one(c, { ok: !!r?.ok, status: r?.status ?? null, error: r?.error ?? null })
  })

  app.delete('/:id', async (c) => {
    const w = await mine(c); if (!w) return fail(c, 404, 'Not found')
    await db.delete(storeWebhook).where(eq(storeWebhook.id, w.id))
    await d.audit.log({ action: 'delete', entity: 'store_webhook', entityId: w.id, entityName: w.url, companyId: own(c), req: c })
    return done(c)
  })

  app.get('/deliveries', async (c) => {
    const status = c.req.query('status'), hookId = c.req.query('webhookId')
    const rows = await db.select().from(storeWebhookDelivery)
      .where(and(eq(storeWebhookDelivery.companyId, own(c)), status ? eq(storeWebhookDelivery.status, status) : undefined, hookId ? eq(storeWebhookDelivery.webhookId, hookId) : undefined))
      .orderBy(desc(storeWebhookDelivery.createdAt)).limit(Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50)))
    return one(c, { deliveries: rows.map(deliveryView) })
  })
  app.get('/deliveries/:id', async (c) => {
    const [r] = await db.select().from(storeWebhookDelivery).where(and(eq(storeWebhookDelivery.id, String(c.req.param('id'))), eq(storeWebhookDelivery.companyId, own(c)))).limit(1)
    return r ? one(c, { delivery: deliveryView(r), body: r.payload, maxAttempts: MAX_ATTEMPTS }) : fail(c, 404, 'Not found')
  })
  app.post('/deliveries/:id/send-again', async (c) => {
    const r = await hub.webhooks.sendAgain(own(c), String(c.req.param('id')))
    if (!r) return fail(c, 404, 'Not found')
    const [row] = await db.select().from(storeWebhookDelivery).where(eq(storeWebhookDelivery.id, String(c.req.param('id')))).limit(1)
    return one(c, { ok: r.ok, status: r.status, error: r.error, delivery: row ? deliveryView(row) : null })
  })
  return app
}

const keySchema = z.object({
  name: z.string().trim().min(1, 'Give the key a name, so you know what uses it').max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Choose at least one thing the key may do').max(API_SCOPES.length),
}).strict()

export function createApiKeyRoutes(d: CrmDeps, keys: ApiKeys) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const own = (c: Context) => (c as any).get('user').companyId as string
  app.use('*', d.permissions.requirePermission('integrations:update'))

  app.get('/', async (c) => one(c, { keys: (await keys.list(own(c))).map(keyView), scopes: API_SCOPES.map((id) => ({ id, label: API_SCOPE_LABELS[id] })) }))

  app.post('/', async (c) => {
    const parsed = keySchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Check what you entered.', 'validation_failed')
    const [{ n }] = await db.select({ n: count() }).from(storeApiKey).where(eq(storeApiKey.companyId, own(c)))
    if (Number(n) >= MAX_KEYS * 5) return fail(c, 409, 'There are too many keys on this shop. Ask support to clear the revoked ones.', 'limit_reached')
    if ((await keys.list(own(c))).filter((k) => !k.revokedAt).length >= MAX_KEYS) return fail(c, 409, `A shop can have ${MAX_KEYS} live keys. Revoke one first.`, 'limit_reached')
    const { row, key } = await keys.create(own(c), parsed.data.name, [...new Set(parsed.data.scopes)] as ApiScope[])
    await d.audit.log({ action: 'create', entity: 'store_api_key', entityId: row.id, entityName: row.name, companyId: own(c), req: c, metadata: { description: `Store API key "${row.name}" made (${row.scopes.join(', ')})` } })
    return one(c, { key: keyView(row), secret: key }, 201)
  })

  app.delete('/:id', async (c) => {
    const row = await keys.revoke(own(c), String(c.req.param('id')))
    if (!row) return fail(c, 404, 'Not found')
    await d.audit.log({ action: 'delete', entity: 'store_api_key', entityId: row.id, entityName: row.name, companyId: own(c), req: c, metadata: { description: `Store API key "${row.name}" revoked` } })
    return one(c, { key: keyView(row) })
  })
  return app
}

export function createAppsRoutes(d: CrmDeps, core: StoreCore) {
  const app = new Hono<AppEnv>()
  app.get('/', d.permissions.requirePermission('integrations:update'), async (c) => one(c, await appsCatalogue(d, core, (c as any).get('user').companyId)))
  return app
}
