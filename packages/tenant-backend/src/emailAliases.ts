import { Hono } from 'hono'
import type { EmailAliasesDeps } from './types'

// Email alias CRUD — vendored into each tenant backend at generation.
// Stays schema-agnostic by accepting the Drizzle table ref as a dep.
// Every write is mirrored to the factory via factoryApiClient.syncEmailAlias
// so Cloudflare Email Routing reflects the current state. Failures to sync
// are logged but don't roll back the local DB change — the tenant's data is
// authoritative and the factory can re-sync later via the admin "Resync" action.

interface AliasInput {
  localPart: string
  routingMode: 'forward' | 'crm'
  forwardTo?: string | null
  enabled?: boolean
}

function validate(input: any): { ok: true; value: AliasInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid body' }
  const localPart = typeof input.localPart === 'string' ? input.localPart.trim().toLowerCase() : ''
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(localPart)) return { ok: false, error: 'Invalid local part (letters, numbers, dot, hyphen, underscore)' }
  const routingMode = input.routingMode === 'crm' ? 'crm' : 'forward'
  const forwardTo = typeof input.forwardTo === 'string' ? input.forwardTo.trim() : null
  if (routingMode === 'forward' && (!forwardTo || !forwardTo.includes('@'))) return { ok: false, error: 'forwardTo email required when routingMode is forward' }
  const enabled = input.enabled === false ? false : true
  return { ok: true, value: { localPart, routingMode, forwardTo: routingMode === 'forward' ? forwardTo : null, enabled } }
}

export function createEmailAliasesRoutes(deps: EmailAliasesDeps): Hono {
  const app = new Hono()
  const { db, emailAliasesTable, factoryApiClient } = deps

  app.get('/', async (c) => {
    try {
      const rows = await db.select().from(emailAliasesTable)
      return c.json({ aliases: rows })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const v = validate(body)
      if (!v.ok) return c.json({ error: v.error }, 400)
      const [inserted] = await db.insert(emailAliasesTable).values({
        localPart: v.value.localPart,
        routingMode: v.value.routingMode,
        forwardTo: v.value.forwardTo,
        enabled: v.value.enabled,
      }).returning()
      // Fire-and-forget factory sync so a Cloudflare outage doesn't block alias creation
      factoryApiClient.syncEmailAlias({
        localPart: v.value.localPart,
        routingMode: v.value.routingMode,
        forwardTo: v.value.forwardTo,
        enabled: v.value.enabled ?? true,
      }).catch(e => console.warn('[emailAliases] factory sync failed:', e?.message))
      return c.json({ alias: inserted }, 201)
    } catch (err: any) {
      // Drizzle's unique-index violation comes through as code 23505
      if (String(err.code) === '23505') return c.json({ error: 'An alias with that local part already exists' }, 409)
      return c.json({ error: err.message }, 500)
    }
  })

  app.patch('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const body = await c.req.json().catch(() => ({}))
      const patch: Record<string, any> = {}
      if (body.routingMode === 'forward' || body.routingMode === 'crm') patch.routingMode = body.routingMode
      if (typeof body.forwardTo === 'string') patch.forwardTo = body.forwardTo.trim() || null
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
      if (Object.keys(patch).length === 0) return c.json({ error: 'No valid fields to update' }, 400)
      // Require forwardTo to be valid when flipping TO forward mode
      if (patch.routingMode === 'forward' && 'forwardTo' in patch && (!patch.forwardTo || !String(patch.forwardTo).includes('@'))) {
        return c.json({ error: 'forwardTo email required when routingMode is forward' }, 400)
      }
      patch.updatedAt = new Date()
      // Drizzle's `eq` import path varies by version — use SQL fragment via string to stay schema-agnostic.
      // Instead, use the `where` builder that the consumer's drizzle exports.
      const { eq } = await import('drizzle-orm')
      const [updated] = await db.update(emailAliasesTable).set(patch).where(eq(emailAliasesTable.id, id)).returning()
      if (!updated) return c.json({ error: 'Alias not found' }, 404)
      factoryApiClient.syncEmailAlias({
        localPart: updated.localPart,
        routingMode: updated.routingMode,
        forwardTo: updated.forwardTo,
        enabled: updated.enabled,
      }).catch(e => console.warn('[emailAliases] factory sync failed:', e?.message))
      return c.json({ alias: updated })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  app.delete('/:id', async (c) => {
    try {
      const id = c.req.param('id')
      const { eq } = await import('drizzle-orm')
      const [deleted] = await db.delete(emailAliasesTable).where(eq(emailAliasesTable.id, id)).returning()
      if (!deleted) return c.json({ error: 'Alias not found' }, 404)
      // Fire a disabled sync so Cloudflare removes the rule
      factoryApiClient.syncEmailAlias({
        localPart: deleted.localPart,
        routingMode: deleted.routingMode,
        forwardTo: deleted.forwardTo,
        enabled: false,
      }).catch(e => console.warn('[emailAliases] factory sync failed (delete):', e?.message))
      return c.json({ success: true })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  return app
}
