import { Hono } from 'hono'
import crypto from 'node:crypto'
import type { AliasMember, EmailAliasesDeps } from './types'

// Email alias CRUD — vendored into each tenant backend at generation.
// Stays schema-agnostic by accepting the Drizzle table ref as a dep.
// Every write is mirrored to the factory via factoryApiClient.syncEmailAlias
// so Cloudflare Email Routing reflects the current state. Failures to sync
// are logged but don't roll back the local DB change — the tenant's data is
// authoritative: the Factory reads it back (createEmailAliasesInternalRoute, below) and
// reconciles Cloudflare when a domain is connected, when it goes active, each hour, and each
// time the addresses page asks for their status. An address saved before there is a domain is
// therefore set up once there is one (E2E Run 5: the per-change sync 400'd and nothing replayed it).
//
// An address can belong to a TEAM MEMBER (billy@ → Billy, when deps.members is given; 10/30). It forwards to the email
// they sign in with and follows it when it changes. Once they are switched off — or their login is removed — it goes to
// the owner, so a business's mail never keeps reaching someone who has left (the way Google Workspace and Microsoft 365
// hand a leaver's mail to a manager). The stored forwardTo is then empty: the member's email is read when it is needed.

interface AliasInput {
  localPart: string
  routingMode: 'forward' | 'crm'
  forwardTo?: string | null
  userId?: string | null
  enabled?: boolean
}

/** Where a forwarding address's mail goes today, and why. */
export interface Delivery {
  email: string | null
  member?: { id: string; name: string; active: boolean }
  /** 'off': its team member is switched off; 'removed': their login is gone. Both go to the owner. */
  fallback?: 'off' | 'removed'
}

export function deliversTo(row: any, members: AliasMember[] | null): Delivery {
  if (row.routingMode === 'crm') return { email: null }
  if (!members) return { email: row.forwardTo ?? null }
  const owner = members.find((m) => m.owner && m.active) || null
  if (row.userId) {
    const m = members.find((x) => x.id === row.userId)
    if (m && m.active) return { email: m.email, member: { id: m.id, name: m.name, active: true } }
    if (m) return { email: owner?.email ?? null, member: { id: m.id, name: m.name, active: false }, fallback: 'off' }
    return { email: owner?.email ?? null, fallback: 'removed' }
  }
  // Neither a member nor an inbox: the member it was assigned to was removed (the column is cleared with them).
  if (!row.forwardTo) return { email: owner?.email ?? null, fallback: 'removed' }
  return { email: row.forwardTo }
}

function validate(input: any, members: AliasMember[] | null): { ok: true; value: AliasInput } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Invalid body' }
  const localPart = typeof input.localPart === 'string' ? input.localPart.trim().toLowerCase() : ''
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(localPart)) return { ok: false, error: 'Invalid local part (letters, numbers, dot, hyphen, underscore)' }
  const routingMode = input.routingMode === 'crm' ? 'crm' : 'forward'
  const enabled = input.enabled === false ? false : true
  const userId = typeof input.userId === 'string' && input.userId ? input.userId : null
  if (routingMode === 'forward' && userId) {
    const refused = memberRefusal(userId, members)
    if (refused) return { ok: false, error: refused }
    return { ok: true, value: { localPart, routingMode, forwardTo: null, userId, enabled } }
  }
  const forwardTo = typeof input.forwardTo === 'string' ? input.forwardTo.trim() : null
  if (routingMode === 'forward' && (!forwardTo || !forwardTo.includes('@'))) return { ok: false, error: 'forwardTo email required when routingMode is forward' }
  return { ok: true, value: { localPart, routingMode, forwardTo: routingMode === 'forward' ? forwardTo : null, ...(members ? { userId: null } : {}), enabled } }
}

/** Why this team member cannot be an address's owner, or null when they can. */
function memberRefusal(userId: string, members: AliasMember[] | null): string | null {
  if (!members) return 'Addresses cannot be given to a team member here'
  const m = members.find((x) => x.id === userId)
  if (!m) return 'That team member was not found'
  if (!m.active) return `${m.name} is switched off. Choose someone still on the team.`
  return null
}

/** What the page shows for a row: the row, where it delivers, and to whom. */
const shown = (row: any, members: AliasMember[] | null) => {
  const d = deliversTo(row, members)
  return { ...row, deliversTo: d.email, member: d.member ?? null, fallback: d.fallback ?? null }
}

export function createEmailAliasesRoutes(deps: EmailAliasesDeps): Hono {
  const app = new Hono()
  const { db, emailAliasesTable, factoryApiClient } = deps
  const team = async () => (deps.members ? await deps.members() : null)
  const push = (row: any, members: AliasMember[] | null, enabled = row.enabled) =>
    factoryApiClient.syncEmailAlias({
      localPart: row.localPart,
      routingMode: row.routingMode,
      forwardTo: deliversTo(row, members).email,
      enabled,
    }).catch(e => console.warn('[emailAliases] factory sync failed:', e?.message))

  app.get('/', async (c) => {
    try {
      const rows = await db.select().from(emailAliasesTable)
      const members = await team()
      // The picker's list: the people still on the team. Their emails are shown only to whoever may manage addresses
      // (this router sits behind the admin gate).
      return c.json({
        aliases: rows.map((r: any) => shown(r, members)),
        ...(members ? { members: members.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, email: m.email })) } : {}),
      })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  // Where each address stands on the domain (and a reconcile on the way). Never a 500 for the page: a
  // Factory that cannot be reached is a state the page names, not a broken list.
  app.get('/status', async (c) => {
    if (!factoryApiClient.getEmailAliasStatus) return c.json({ state: 'error', domain: null, aliases: [], detail: 'Status is not available in this build' })
    try {
      return c.json(await factoryApiClient.getEmailAliasStatus())
    } catch (err: any) {
      return c.json({ state: 'error', domain: null, aliases: [], detail: err?.message || 'The Factory did not answer' })
    }
  })

  // Send Cloudflare's confirmation email to a destination again.
  app.post('/resend-confirmation', async (c) => {
    const body = await c.req.json().catch(() => ({}))
    const destination = typeof body?.destination === 'string' ? body.destination.trim().toLowerCase() : ''
    if (!destination.includes('@')) return c.json({ error: 'destination email is required' }, 400)
    // Only an address one of this CRM's aliases forwards to — never an arbitrary inbox.
    const rows = await db.select().from(emailAliasesTable)
    const members = await team()
    if (!rows.some((r: any) => String(deliversTo(r, members).email || '').trim().toLowerCase() === destination)) {
      return c.json({ error: 'No address here forwards to ' + destination }, 404)
    }
    if (!factoryApiClient.resendEmailAliasConfirmation) return c.json({ error: 'Not available in this build' }, 501)
    try {
      return c.json(await factoryApiClient.resendEmailAliasConfirmation(destination))
    } catch (err: any) {
      return c.json({ error: err?.message || 'The Factory did not answer' }, err?.status && err.status < 500 ? err.status : 502)
    }
  })

  app.post('/', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const members = await team()
      const v = validate(body, members)
      if (!v.ok) return c.json({ error: v.error }, 400)
      const [inserted] = await db.insert(emailAliasesTable).values({
        localPart: v.value.localPart,
        routingMode: v.value.routingMode,
        forwardTo: v.value.forwardTo,
        ...(members ? { userId: v.value.userId ?? null } : {}),
        enabled: v.value.enabled,
      }).returning()
      // Fire-and-forget factory sync so a Cloudflare outage doesn't block alias creation
      push(inserted, members, v.value.enabled ?? true)
      return c.json({ alias: shown(inserted, members) }, 201)
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
      const members = await team()
      const patch: Record<string, any> = {}
      if (body.routingMode === 'forward' || body.routingMode === 'crm') patch.routingMode = body.routingMode
      if (typeof body.forwardTo === 'string') patch.forwardTo = body.forwardTo.trim() || null
      if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
      // One or the other: giving the address to a team member clears the typed inbox, and typing an inbox takes it
      // back from the member.
      if (typeof body.userId === 'string' && body.userId) {
        const refused = memberRefusal(body.userId, members)
        if (refused) return c.json({ error: refused }, 400)
        patch.userId = body.userId
        patch.forwardTo = null
        patch.routingMode = 'forward'
      } else if (members && 'forwardTo' in patch && patch.forwardTo) patch.userId = null
      if (Object.keys(patch).length === 0) return c.json({ error: 'No valid fields to update' }, 400)
      // Require forwardTo to be valid when flipping TO forward mode
      if (patch.routingMode === 'forward' && !patch.userId && 'forwardTo' in patch && (!patch.forwardTo || !String(patch.forwardTo).includes('@'))) {
        return c.json({ error: 'forwardTo email required when routingMode is forward' }, 400)
      }
      patch.updatedAt = new Date()
      // Drizzle's `eq` import path varies by version — use SQL fragment via string to stay schema-agnostic.
      // Instead, use the `where` builder that the consumer's drizzle exports.
      const { eq } = await import('drizzle-orm')
      const [updated] = await db.update(emailAliasesTable).set(patch).where(eq(emailAliasesTable.id, id)).returning()
      if (!updated) return c.json({ error: 'Alias not found' }, 404)
      push(updated, members)
      return c.json({ alias: shown(updated, members) })
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
      push(deleted, await team(), false)
      return c.json({ success: true })
    } catch (err: any) {
      return c.json({ error: err.message }, 500)
    }
  })

  return app
}

/**
 * After a team member's email changes, or they are switched off or removed: every address is pushed again, so the ones
 * that are theirs follow at once (their new inbox, or the owner's) instead of at the Factory's next hourly pass.
 */
export async function resyncAliasesAfterTeamChange(deps: EmailAliasesDeps): Promise<void> {
  if (!deps.members) return
  const rows = await deps.db.select().from(deps.emailAliasesTable)
  const members = await deps.members()
  for (const r of rows) {
    if (r.routingMode === 'crm') continue
    await deps.factoryApiClient.syncEmailAlias({ localPart: r.localPart, routingMode: r.routingMode, forwardTo: deliversTo(r, members).email, enabled: r.enabled })
      .catch((e: any) => console.warn('[emailAliases] factory sync failed (team change):', e?.message))
  }
}

const keyMatches = (got: string, want: string) =>
  got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))

/**
 * GET /api/internal/email-aliases — the Factory reads this CRM's addresses (X-Factory-Key against
 * FACTORY_SYNC_KEY) to create their Cloudflare forwarding once the domain is connected and active.
 * Mount WITHOUT user auth, beside /api/internal/sync-subscription. Read-only; only what a rule needs:
 * forwardTo is where the mail goes today (a team member's address resolved to their inbox, or the owner's).
 */
export function createEmailAliasesInternalRoute(deps: { db: any; emailAliasesTable: any; members?: () => Promise<AliasMember[]> }): Hono {
  const app = new Hono()
  app.get('/', async (c) => {
    const key = process.env.FACTORY_SYNC_KEY
    if (!key) return c.json({ error: 'Sync not configured' }, 503)
    if (!keyMatches(String(c.req.header('X-Factory-Key') || ''), key)) return c.json({ error: 'Unauthorized' }, 401)
    const rows = await deps.db.select().from(deps.emailAliasesTable)
    const members = deps.members ? await deps.members() : null
    return c.json({
      aliases: rows.map((r: any) => ({
        localPart: r.localPart, routingMode: r.routingMode === 'crm' ? 'crm' : 'forward',
        forwardTo: deliversTo(r, members).email, enabled: r.enabled !== false,
      })),
    })
  })
  return app
}
