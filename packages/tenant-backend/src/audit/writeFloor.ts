/**
 * EVERY WRITE LEAVES A TRACE. (T59 — the shared form of crm's middleware/auditWrites.ts)
 *
 * crm measured it first (T58): of 163 write endpoints, 17 wrote an audit row. Outside crm it was no
 * better — most DELETE handlers wrote nothing at all (crm-basic and crm-fieldservice 7 of 7, the shared
 * jobs module's DELETE among them), and creates and edits the same. Hand-writing an audit call into
 * every handler leaves the next one without it, which is how this started. So this is a floor: after
 * any mutating request that SUCCEEDED, one row saying who did what to which record — unless the handler
 * wrote its own (richer) entry, which still wins.
 *
 * WHAT IT RECORDS: the action (read from the path where REST puts it — /approve, /payments — else the
 * HTTP verb), the entity, the record id, a sentence ("Switched off — portal"), and the record's NAME:
 *   · for a DELETE, read from the row BEFORE the handler removes it (a DELETE answers 204 with no body,
 *     and afterwards there is nothing left to read);
 *   · otherwise, from the JSON the handler sent back (number / name / title / email), and for a create
 *     the new record's id from there too.
 * NOT the request body: bodies carry passwords, keys, provider secrets and customer PII, and an audit
 * log is read by more people than the data it describes.
 *
 * HOW IT KNOWS THE HANDLER LOGGED. Each template's audit.log() marks the request's requestScope store
 * (`logged = true`); this runs inside that scope and checks the mark after the handler returns.
 *
 * IT CANNOT FAIL THE REQUEST. The response is settled before anything is written; every step is wrapped.
 */
import { eq } from 'drizzle-orm'

export interface WriteFloorDeps {
  db: any
  /** The template's db/schema.ts, as a namespace (`import * as schema`). */
  schema: Record<string, any>
  /** The template's audit.log. */
  log: (entry: any) => any
  /** The template's requestScope (AsyncLocalStorage) — audit.log marks `logged` on its store. */
  scope: { getStore: () => any }
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Never logged here, each for its own reason. The first five are crm's list; the rest are telemetry —
 * the mobile app reports a location every minute and a sign screen pings, and a row per ping would
 * bury every real change under thousands that say nothing.
 *   /api/auth  credentials, and auth records its own sign-in events    /api/internal  factory sync
 *   /api/audit reading the log is not a change      webhooks  no actor   /api/support/ai-chat  a message
 *   …/location  …/heartbeat  …/track   pings            …/preview   renders a draft, changes nothing
 */
const SKIP = [
  /^\/api\/auth(\/|$)/, /^\/api\/internal(\/|$)/, /^\/api\/audit(\/|$)/, /\/webhook(s)?(\/|$)/, /^\/api\/support\/ai-chat$/,
  /\/location$/, /\/heartbeat$/, /\/track$/, /\/preview(\/|$)/,
]

const STATUS_WORDS = [
  'approve', 'reject', 'submit', 'dismiss', 'enable', 'disable', 'complete', 'cancel', 'void',
  'archive', 'restore', 'supersede', 'file', 'review', 'status', 'mark-paid', 'activate',
  'deactivate', 'close', 'reopen', 'publish', 'sign', 'deny', 'decline',
]
const ACTION_WORDS: Record<string, string> = {
  payments: 'payment', payment: 'payment', pay: 'payment',
  refund: 'refund', refunds: 'refund', credit: 'credit', credits: 'credit',
  convert: 'convert', assign: 'assign', reschedule: 'reschedule',
  send: 'send', resend: 'send', export: 'export',
  duplicate: 'duplicate', merge: 'merge',
}
const ACTION_FOR: Record<string, string> = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' }
const VERB_PHRASE: Record<string, string> = {
  enable: 'Switched on', disable: 'Switched off', activate: 'Activated', deactivate: 'Deactivated',
  approve: 'Approved', reject: 'Rejected', submit: 'Submitted', review: 'Reviewed',
  complete: 'Completed', cancel: 'Cancelled', void: 'Voided', dismiss: 'Dismissed', archive: 'Archived',
  restore: 'Restored', supersede: 'Superseded', close: 'Closed', reopen: 'Reopened', publish: 'Published',
  sign: 'Signed', file: 'Filed', 'mark-paid': 'Marked paid', status: 'Status changed', deny: 'Denied', decline: 'Declined',
  payments: 'Payment recorded', payment: 'Payment recorded', pay: 'Payment recorded',
  refund: 'Refund recorded', refunds: 'Refund recorded', credit: 'Credit recorded', credits: 'Credit recorded',
  send: 'Sent', resend: 'Sent again', export: 'Exported', convert: 'Converted', assign: 'Assigned',
  reschedule: 'Rescheduled', duplicate: 'Duplicated', merge: 'Merged',
}
const PLAIN_FOR: Record<string, string> = { POST: 'Created', PUT: 'Updated', PATCH: 'Updated', DELETE: 'Deleted' }

/**
 * The verb is the last path segment — or, when that segment is hyphenated, its last word. (T60)
 *
 *   Roof: "A supplement deny and an Xactimate export are logged in the audit as 'create'."
 *
 * `deny` was not in the vocabulary at all, and `/claims/:id/xactimate-export` is an export whose
 * segment is not the bare word, so both fell through to the HTTP method: POST → "create". An exact
 * match still wins (`mark-paid` is its own word); the tail is tried only when the whole is unknown.
 */
const isVerb = (w: string) => !!ACTION_WORDS[w] || STATUS_WORDS.includes(w) || !!VERB_PHRASE[w]
const lastSegment = (path: string) => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const last = (parts[parts.length - 1] || '').toLowerCase()
  if (isVerb(last) || !last.includes('-')) return last
  const tail = last.slice(last.lastIndexOf('-') + 1)
  return isVerb(tail) ? tail : last
}
export const actionFromPath = (path: string, method: string): string => {
  const last = lastSegment(path)
  if (ACTION_WORDS[last]) return ACTION_WORDS[last]
  if (STATUS_WORDS.includes(last)) return 'status_change'
  return ACTION_FOR[method] || 'update'
}
export const describeRequest = (path: string, method: string, entity: string): string =>
  `${VERB_PHRASE[lastSegment(path)] || PLAIN_FOR[method] || 'Changed'} — ${entity.replace(/_/g, ' ')}`

const singular = (word: string): string => {
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(ss|ch|sh|x|z)es$/.test(word)) return word.replace(/es$/, '')
  if (/(us|ss|is)$/.test(word)) return word
  if (/s$/.test(word)) return word.replace(/s$/, '')
  return word
}

/** The record the URL names: a uuid or the cuid2-style ids this codebase generates. */
export const idFromPath = (path: string): string | undefined => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  for (let i = parts.length - 1; i >= 1; i--) {
    const p = parts[i]
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p)) return p
    if (/^[a-z0-9]{20,32}$/i.test(p) && /\d/.test(p)) return p
  }
  return undefined
}

/**
 * The collection segment, as written in the URL, and the segment before it.
 *   with an id:   the segment the id sits under — /api/jobs/:id/complete → jobs
 *   without one:  the LAST segment that is not a verb — /api/support/kb → kb, /api/bulk/jobs/status → jobs.
 *                 (crm's floor took the first segment, which files a new KB article under "support".)
 */
const collectionOf = (path: string): { seg: string; parent: string } => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const id = idFromPath(path)
  const at = id ? parts.indexOf(id) : -1
  if (at > 0) return { seg: parts[at - 1], parent: at > 1 ? parts[at - 2] : '' }
  let i = parts.length - 1
  while (i > 0 && (STATUS_WORDS.includes(parts[i].toLowerCase()) || ACTION_WORDS[parts[i].toLowerCase()])) i--
  return { seg: parts[i] || 'request', parent: i > 0 ? parts[i - 1] : '' }
}

/** The collection the record belongs to, singular: /api/jobs/:id → job, /api/support/kb → kb. */
export const entityFromPath = (path: string): string => singular(collectionOf(path).seg).replace(/-/g, '_')

const camel = (s: string) => s.replace(/[-_]([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase())
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
/**
 * Mount segments that name their table differently — each checked against the schemas. The dispensary
 * entries are keyed by parent + collection, never a bare "rule" or "session", so a generic word on
 * another route cannot be mapped to a dispensary table.
 */
const TABLE_ALIASES: Record<string, string> = {
  kb: 'supportKnowledgeBase', geofencing: 'geofence', team: 'teamMember', areaPricingRate: 'serviceRate',
  locationTransfer: 'inventoryTransfer', reportSaved: 'savedReport', reportWidget: 'biWidget',
  payByBankAccount: 'customerBankAccount', gamifiedLoyaltyChallenge: 'loyaltyChallenge', gamifiedLoyaltyMultiplierEvent: 'loyaltyChallenge',
  signageScreen: 'digitalSign', marketplaceInstalled: 'companyIntegration', securitySession: 'activeSession',
  fraudDetectionRule: 'fraudRule', menuSyncConnection: 'menuSyncConfig',
}

/**
 * The schema exports a path could mean, most likely first. Tables are usually named for the collection
 * alone (/api/jobs/:id → job), a nested collection usually carries its parent's name
 * (/api/snow/contracts/:id → snowContract). Measured across the templates this floor is mounted in.
 */
export const tableKeysForPath = (path: string): string[] => {
  const { seg, parent } = collectionOf(path)
  const entity = camel(singular(seg))
  const raw = camel(seg) // some tables keep the plural: /api/booking/settings → bookingSettings
  const keys = [entity, raw]
  if (parent) for (const e of [entity, raw]) keys.push(camel(singular(parent)) + cap(e), camel(parent) + cap(e))
  return [...new Set(keys.flatMap((k) => (TABLE_ALIASES[k] ? [TABLE_ALIASES[k], k] : [k])))]
}

/**
 * What a record is CALLED, most specific first. The generic four, then the identifiers a template's own
 * tables use (a PO's poNumber, a unit's stockNumber, a batch's batchNumber…), measured across every
 * mounted write path. Never free text (a comment's content, a lead's notes) or anything token-like.
 */
const NAME_COLUMNS = ['number', 'name', 'title', 'email', 'invoiceNumber', 'jobNumber', 'quoteNumber', 'poNumber', 'batchNumber', 'licenseNumber', 'stockNumber', 'serialNumber', 'strainName', 'accountName', 'institutionName', 'serviceType', 'platform']

const nameOf = (v: unknown): string =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : ''

export function createWriteAuditFloor(deps: WriteFloorDeps) {
  const tableFor = (path: string): [string, any] | undefined => {
    for (const k of tableKeysForPath(path)) { const t = deps.schema[k]; if (t && t.id) return [k, t] }
    return undefined
  }

  /** A record's name from its row — for a DELETE, before the handler removes it. */
  const nameBefore = async (path: string): Promise<{ name: string; companyId?: string } | undefined> => {
    try {
      const id = idFromPath(path)
      if (!id) return undefined
      const table = tableFor(path)?.[1]
      if (!table) return undefined
      const col = NAME_COLUMNS.find((k) => table[k])
      if (!col) return undefined
      const [row] = await deps.db.select({ v: table[col], companyId: table.companyId ?? table.id }).from(table).where(eq(table.id, id)).limit(1)
      const name = nameOf(row?.v)
      return name ? { name, companyId: table.companyId ? row.companyId : undefined } : undefined
    } catch {
      return undefined
    }
  }

  /** A record's name (and, for a create, its id) from the JSON the handler sent back. */
  const fromResponse = async (c: any): Promise<{ name?: string; id?: string }> => {
    try {
      if (!(c.res?.headers?.get('content-type') || '').includes('application/json')) return {}
      if (Number(c.res.headers.get('content-length') || '0') > 64_000) return {}
      const body = (await c.res.clone().json()) as any
      if (!body || typeof body !== 'object' || Array.isArray(body)) return {}
      const rec = body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : body
      let name: string | undefined
      for (const k of NAME_COLUMNS) { const n = nameOf(rec[k]); if (n) { name = n; break } }
      const id = typeof rec.id === 'string' && rec.id ? rec.id : undefined
      return { name, id }
    } catch {
      return {}
    }
  }

  return async function writeAuditFloor(c: any, next: () => Promise<void>) {
    const method = String(c.req.method).toUpperCase()
    if (!MUTATING.has(method)) return next()
    let path = ''
    try { path = new URL(c.req.url).pathname } catch { return next() }
    if (SKIP.some((re) => re.test(path))) return next()
    const before = method === 'DELETE' ? await nameBefore(path) : undefined
    await next()
    try {
      if (deps.scope.getStore()?.logged) return
      const status = c.res?.status ?? 0
      if (status < 200 || status >= 300) return
      const user = c.get('user') as any
      if (!user?.companyId) return
      const resolved = tableFor(path)?.[0]
      // Named for the table when it resolved (support_knowledge_base, snow_contract — the words the
      // handlers that do audit already use), else the path's own collection.
      const entity = resolved ? resolved.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase()) : entityFromPath(path)
      const reply = method === 'DELETE' ? {} : await fromResponse(c)
      const entityName = method === 'DELETE'
        ? (before && (!before.companyId || before.companyId === user.companyId) ? before.name : undefined)
        : reply.name
      await deps.log({
        action: actionFromPath(path, method),
        entity,
        entityId: idFromPath(path) ?? (method === 'POST' ? reply.id : undefined),
        entityName,
        metadata: { description: describeRequest(path, method, entity), method, path, status, via: 'request' },
        req: c,
      })
    } catch (err: any) {
      console.warn('[writeAuditFloor] not recorded:', err?.message || err)
    }
  }
}
