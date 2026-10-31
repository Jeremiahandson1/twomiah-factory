// Contract templates and the people who sign a proposal (restaurant-bar parity #1; Tripleseat contract templates with merge
// fields and several signers, Perfect Venue's signing order).
//
//   venue   /api/event-contracts   the venue's contract templates — text with {{merge fields}} — and a preview of one for an
//                                  event (read: invoices:read, write: settings:update, the permission the proposal terms ask)
//
// This file also holds what the proposal needs to use them (eventProposals.ts): the merge fields and how a contract is filled
// from the event's frozen snapshot and the guest's choices; the signers a coordinator drafts (client, a second client signer,
// the venue's countersignature) checked and put in their send order; and the words for each. Behind 'event_contracts'
// (not ready), gated on both sides: the routes by the registry, the screens by hasFeature, a proposal's contract and signers
// by the same feature on the server.
import { Hono } from 'hono'
import { and, asc, eq, ne } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { money } from '@twomiah/tenant-backend'
import { eventContractTemplate } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll, done } from '../../http/reply.ts'
import { eventDayWords } from './eventBooking.ts'

export const SIGNER_ROLES = ['client', 'client_second', 'venue'] as const
export type SignerRole = (typeof SIGNER_ROLES)[number]
/** What each signer is called on the page, the PDF and the emails — never the stored word. */
export const ROLE_LABEL: Record<SignerRole, string> = { client: 'Client', client_second: 'Second client signer', venue: 'Venue (countersignature)' }
export const roleLabel = (role: string) => ROLE_LABEL[role as SignerRole] || 'Signer'
export const MAX_SIGNERS = 5

export interface SignerPlanEntry { role: SignerRole; name: string | null; email: string }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * The signers a coordinator drafted, checked: the client always signs; a second client signer needs a name and an email; the venue
 * needs an email (the venue's own when none is typed). The ORDER given is the send order. Returns the first problem as a sentence.
 */
export function cleanSigners(raw: unknown, client: { name?: string | null; email?: string | null } | null, venueEmail: string | null): { ok: true; signers: SignerPlanEntry[] } | { ok: false; error: string } {
  const list = raw == null || (Array.isArray(raw) && raw.length === 0) ? [{ role: 'client' }] : raw
  if (!Array.isArray(list) || list.length > MAX_SIGNERS) return { ok: false, error: `Signers must be a list of at most ${MAX_SIGNERS} people.` }
  const out: SignerPlanEntry[] = []
  for (const s of list as any[]) {
    const role = s?.role
    if (!SIGNER_ROLES.includes(role)) return { ok: false, error: 'Every signer needs a role: the client, a second client signer, or the venue.' }
    if (out.some((x) => x.role === role)) return { ok: false, error: `${roleLabel(role)} is listed twice.` }
    const typedName = typeof s.name === 'string' ? s.name.trim().slice(0, 160) : ''
    const typedEmail = typeof s.email === 'string' ? s.email.trim().toLowerCase().slice(0, 200) : ''
    if (role === 'client') {
      if (!client?.email) return { ok: false, error: 'Add a client with an email address to this event first — they sign the proposal.' }
      out.push({ role, name: client.name || null, email: String(client.email).toLowerCase() })
    } else if (role === 'client_second') {
      if (!typedName) return { ok: false, error: 'The second client signer needs a name.' }
      if (!EMAIL.test(typedEmail)) return { ok: false, error: `${typedName} needs a valid email address to be sent the proposal.` }
      out.push({ role, name: typedName, email: typedEmail })
    } else {
      const email = typedEmail || (venueEmail || '').toLowerCase()
      if (!EMAIL.test(email)) return { ok: false, error: 'The venue’s countersignature needs an email address — type one, or add one to the business in Settings.' }
      out.push({ role, name: typedName || null, email })
    }
  }
  if (out[0].role !== 'client') return { ok: false, error: 'The client signs first: they make the choices the others then sign.' }
  return { ok: true, signers: out }
}

// ── Merge fields ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ContractContext {
  snap: any
  /** What the guest's choices add (priceWith), or the frozen figures. */
  priced: { lines: Array<{ description: string; quantity: number; unitPrice: number; total: number }>; minimum: { required: number; spend: number; shortfall: number } | null; chosen: Array<{ name: string; quantity: number; unitPrice: number; total: number }>; subtotal: number; tax: number; total: number }
  /** The signers' names, by role (the invited name until they sign). */
  names: Partial<Record<SignerRole, string>>
}

const hoursOf = (e: any) => (e.startTime ? `${e.startTime}${e.endTime ? ' – ' + e.endTime : ''}` : '')

export const MERGE_FIELDS: Array<{ id: string; label: string; example: string; value: (c: ContractContext) => string }> = [
  { id: 'client_name', label: 'Client’s name', example: 'Harper Diaz', value: (c) => c.snap.client?.name || '' },
  { id: 'client_email', label: 'Client’s email', example: 'harper@example.com', value: (c) => c.snap.client?.email || '' },
  { id: 'second_signer_name', label: 'Second client signer’s name', example: 'Sam Diaz', value: (c) => c.names.client_second || '' },
  { id: 'event_name', label: 'Event name', example: 'Diaz Rehearsal Dinner', value: (c) => c.snap.event.name },
  { id: 'event_type', label: 'Kind of event', example: 'Wedding', value: (c) => c.snap.event.type || '' },
  { id: 'event_date', label: 'Event date', example: 'Saturday, June 5, 2027', value: (c) => c.snap.event.dateWords },
  { id: 'event_hours', label: 'Start and end time', example: '17:00 – 21:00', value: (c) => hoursOf(c.snap.event) },
  { id: 'room_name', label: 'Room', example: 'The Loft', value: (c) => c.snap.space?.name || 'To be confirmed' },
  { id: 'room_capacity', label: 'Room capacity', example: '50 seated, 80 standing', value: (c) => [c.snap.space?.seatedCapacity ? `${c.snap.space.seatedCapacity} seated` : '', c.snap.space?.standingCapacity ? `${c.snap.space.standingCapacity} standing` : ''].filter(Boolean).join(', ') },
  { id: 'head_count', label: 'Head count', example: '40', value: (c) => String(c.snap.event.guestCount ?? '') },
  { id: 'menu', label: 'Menu and price lines', example: 'Welcome drink — 20 × $10.00 = $200.00', value: (c) => [...c.priced.lines, ...c.priced.chosen].map((l: any) => `${l.description ?? l.name} — ${l.quantity} × ${money(l.unitPrice)} = ${money(l.total)}`).join('\n') },
  { id: 'subtotal', label: 'Subtotal', example: '$1,000.00', value: (c) => money(c.priced.subtotal) },
  { id: 'tax', label: 'Sales tax', example: '$80.00', value: (c) => money(c.priced.tax) },
  { id: 'total', label: 'Total', example: '$1,080.00', value: (c) => money(c.priced.total) },
  { id: 'deposit_amount', label: 'Deposit (the first payment)', example: '$300.00', value: (c) => (c.snap.schedule?.length ? money(c.snap.schedule[0].amount) : 'No deposit is scheduled') },
  { id: 'deposit_schedule', label: 'Every scheduled payment', example: 'Deposit — $300.00, due March 3, 2027', value: (c) => (c.snap.schedule?.length ? c.snap.schedule.map((s: any) => `${s.label} — ${money(s.amount)}${s.dueDate ? ', due ' + eventDayWords(s.dueDate) : ''}`).join('\n') : 'No payments are scheduled yet.') },
  { id: 'guarantee_terms', label: 'Guest-count (guarantee) terms', example: 'The final guest count is due 7 days before the event…', value: (c) => (c.snap.guarantee
    ? `The final guest count is due ${c.snap.guarantee.days} days before the event (by ${eventDayWords(c.snap.guarantee.cutoff)}). After that only the venue can change it, and the venue may charge for the count it was given.`
    : 'No guest-count deadline applies.') },
  { id: 'minimum_terms', label: 'Minimum-spend terms', example: 'A food and beverage minimum of $2,000.00 applies…', value: (c) => (c.snap.minimum
    ? `A food and beverage minimum of ${money(c.snap.minimum.required)} applies to this room on this date. Any amount spent short of it is added to the bill${c.snap.shortfallTaxed === false ? '' : ', with sales tax'}.`
    : 'No minimum spend applies.') },
  { id: 'venue_name', label: 'Venue name', example: 'The Amber Inn', value: (c) => c.snap.brand?.name || '' },
  { id: 'venue_phone', label: 'Venue phone', example: '715-555-0100', value: (c) => c.snap.brand?.phone || '' },
  { id: 'venue_email', label: 'Venue email', example: 'events@example.com', value: (c) => c.snap.brand?.email || '' },
]
const FIELD_IDS = new Set(MERGE_FIELDS.map((f) => f.id))
const FIELD_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g

/** A contract's text checked: not empty, not too long, and every {{field}} one that exists. The first problem as a sentence. */
export function contractRefusal(name: unknown, body: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'Give the contract a name, like “Wedding contract”.'
  if (name.trim().length > 120) return 'The contract name must be 120 characters or fewer.'
  if (typeof body !== 'string' || !body.trim()) return 'The contract needs some text.'
  if (body.length > 30000) return 'The contract must be 30,000 characters or fewer.'
  for (const m of body.matchAll(FIELD_RE)) if (!FIELD_IDS.has(m[1])) return `“{{${m[1]}}}” is not a merge field. Pick the fields from the list beside the text.`
  if (/\{\{|\}\}/.test(body.replace(FIELD_RE, ''))) return 'A merge field is missing its closing or opening braces — write it like {{client_name}}.'
  return null
}

/** The contract as the guest and the PDF show it: each {{field}} replaced from the event as it was sent and the guest's choices. */
export function renderContract(body: string, ctx: ContractContext): string {
  const by = new Map(MERGE_FIELDS.map((f) => [f.id, f]))
  return body.replace(FIELD_RE, (_m, id: string) => by.get(id)?.value(ctx) ?? '')
}

const shape = (t: any) => ({ id: t.id, name: t.name, body: t.body, isDefault: t.isDefault, active: t.active, updatedAt: t.updatedAt })

/** The venue's default template (active), or null: what a proposal uses when its coordinator names none. */
export async function defaultContractTemplate(db: any, companyId: string) {
  const [t] = await db.select().from(eventContractTemplate).where(and(eq(eventContractTemplate.companyId, companyId), eq(eventContractTemplate.isDefault, true), eq(eventContractTemplate.active, true))).limit(1)
  return t || null
}

export function createEventContractRoutes(d: CrmDeps, previewFor: (companyId: string, eventId: string, body: string) => Promise<string | null>) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/fields', requirePermission('invoices:read'), (c) => listAll(c, MERGE_FIELDS.map((f) => ({ id: f.id, label: f.label, example: f.example }))))

  app.get('/', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const rows = await db.select().from(eventContractTemplate).where(eq(eventContractTemplate.companyId, u.companyId)).orderBy(asc(eventContractTemplate.name))
    return listAll(c, rows.map(shape))
  })

  app.post('/', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const problem = contractRefusal(b.name, b.body)
    if (problem) return fail(c, 400, problem)
    const row = await db.transaction(async (tx: any) => {
      if (b.isDefault === true) await tx.update(eventContractTemplate).set({ isDefault: false }).where(eq(eventContractTemplate.companyId, u.companyId))
      const [r] = await tx.insert(eventContractTemplate).values({ id: createId(), name: b.name.trim(), body: b.body, isDefault: b.isDefault === true, active: b.active !== false, createdBy: u.userId, companyId: u.companyId }).returning()
      return r
    })
    await audit.log({ action: 'create', entity: 'event_contract_template', entityId: row.id, entityName: row.name, req: { user: u } })
    return one(c, shape(row), 201)
  })

  app.put('/:id', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const [cur] = await db.select().from(eventContractTemplate).where(and(eq(eventContractTemplate.id, c.req.param('id')), eq(eventContractTemplate.companyId, u.companyId))).limit(1)
    if (!cur) return fail(c, 404, 'Contract template not found')
    const b = (await c.req.json().catch(() => null)) ?? ({} as any)
    const problem = contractRefusal('name' in b ? b.name : cur.name, 'body' in b ? b.body : cur.body)
    if (problem) return fail(c, 400, problem)
    const row = await db.transaction(async (tx: any) => {
      if (b.isDefault === true) await tx.update(eventContractTemplate).set({ isDefault: false }).where(and(eq(eventContractTemplate.companyId, u.companyId), ne(eventContractTemplate.id, cur.id)))
      const [r] = await tx.update(eventContractTemplate).set({
        ...('name' in b ? { name: b.name.trim() } : {}), ...('body' in b ? { body: b.body } : {}),
        ...('isDefault' in b ? { isDefault: b.isDefault === true } : {}), ...('active' in b ? { active: b.active !== false } : {}), updatedAt: new Date(),
      }).where(eq(eventContractTemplate.id, cur.id)).returning()
      return r
    })
    await audit.log({ action: 'update', entity: 'event_contract_template', entityId: row.id, entityName: row.name, changes: audit.diff(shape(cur), shape(row)), req: { user: u } })
    return one(c, shape(row))
  })

  // A proposal already sent keeps the words it was sent with, so removing a template changes nothing that was signed or is out.
  app.delete('/:id', requirePermission('settings:update'), async (c) => {
    const u = c.get('user') as any
    const gone = await db.delete(eventContractTemplate).where(and(eq(eventContractTemplate.id, c.req.param('id')), eq(eventContractTemplate.companyId, u.companyId))).returning({ id: eventContractTemplate.id, name: eventContractTemplate.name })
    if (!gone.length) return fail(c, 404, 'Contract template not found')
    await audit.log({ action: 'delete', entity: 'event_contract_template', entityId: gone[0].id, entityName: gone[0].name, req: { user: u } })
    return done(c)
  })

  // GET /:id/preview?eventId= — the contract filled from that event as it stands now.
  app.get('/:id/preview', requirePermission('invoices:read'), async (c) => {
    const u = c.get('user') as any
    const [t] = await db.select().from(eventContractTemplate).where(and(eq(eventContractTemplate.id, c.req.param('id')), eq(eventContractTemplate.companyId, u.companyId))).limit(1)
    if (!t) return fail(c, 404, 'Contract template not found')
    const eventId = c.req.query('eventId')
    if (!eventId) return fail(c, 400, 'Choose an event to preview it on.')
    const text = await previewFor(u.companyId, eventId, t.body)
    if (text == null) return fail(c, 404, 'Event not found')
    return one(c, { text })
  })
  return app
}
