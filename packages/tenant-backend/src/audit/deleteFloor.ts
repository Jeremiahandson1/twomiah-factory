/**
 * A DELETE ALWAYS LEAVES A TRACE, AND NAMES WHAT WENT. (T59)
 *
 * Measured, not assumed: outside crm (which has its own all-writes floor, middleware/auditWrites.ts),
 * most DELETE handlers wrote no audit row at all — crm-basic and crm-fieldservice 7 of 7, the shared
 * jobs module's DELETE /:id among them. Deleting a job on showcase, field service or landscaping left
 * nothing to say it had existed. A deletion is the one event an audit log exists for.
 *
 * Writing an audit call into every handler would leave the next one to be added without it, which is
 * how this started. So this is a floor, for deletes only: after a DELETE that SUCCEEDED, one row saying
 * who deleted which record — unless the handler already wrote its own (richer) entry, which still wins.
 * Deletes only, on purpose: these templates' creates and updates were QA'd as they are, and a floor over
 * every write would add rows to logs the owner has already signed off.
 *
 * THE NAME IS READ BEFORE THE ROW GOES. A DELETE answers 204 with no body, and afterwards the row is
 * gone, so the record is looked up first: the table the path names (the mount segment, singular, in
 * camelCase — /api/change-orders/:id → changeOrder in db/schema.ts), the id in the URL, and the first of
 * number / name / title / email it has. Anything it cannot resolve gives no name, never a failed delete.
 *
 * HOW IT KNOWS THE HANDLER LOGGED. Each template's audit.log() marks the request's requestScope store
 * (`logged = true`); this runs inside that scope and checks the mark after the handler returns.
 *
 * IT CANNOT FAIL THE REQUEST. The response is settled before anything is written, and every step is
 * wrapped.
 */
import { eq } from 'drizzle-orm'

export interface DeleteFloorDeps {
  db: any
  /** The template's db/schema.ts, as a namespace (`import * as schema`). */
  schema: Record<string, any>
  /** The template's audit.log. */
  log: (entry: any) => any
  /** The template's requestScope (AsyncLocalStorage) — audit.log marks `logged` on its store. */
  scope: { getStore: () => any }
}

/** Never logged here, each for its own reason — the same list crm's floor uses. */
const SKIP = [/^\/api\/auth(\/|$)/, /^\/api\/internal(\/|$)/, /^\/api\/audit(\/|$)/, /\/webhook(s)?(\/|$)/]

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

/** The collection the id sits under: /api/jobs/:id → job, /api/booking/services/:id → service. */
export const entityFromPath = (path: string): string => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const id = idFromPath(path)
  const at = id ? parts.indexOf(id) : -1
  const seg = (at > 0 ? parts[at - 1] : parts[0]) || 'request'
  return singular(seg).replace(/-/g, '_')
}

const camel = (s: string) => s.replace(/[-_]([a-z0-9])/g, (_m, ch: string) => ch.toUpperCase())
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * The schema exports a delete path could mean, most likely first. Tables are usually named for the
 * collection alone (/api/jobs/:id → job), but a nested collection usually carries its parent's name
 * (/api/snow/contracts/:id → snowContract, /api/loyalty/rewards/:id → loyaltyReward,
 * /api/ai-receptionist/rules/:id → aiReceptionistRule). Measured across the eight templates this
 * floor is mounted in; the few paths that match none still get their row, just without a name.
 */
/** Mount segments that name their table differently — each checked against the schemas. */
const TABLE_ALIASES: Record<string, string> = { kb: 'supportKnowledgeBase', geofencing: 'geofence', team: 'teamMember', areaPricingRate: 'serviceRate' }

export const tableKeysForPath = (path: string): string[] => {
  const parts = path.replace(/^\/api\//, '').split('/').filter(Boolean)
  const id = idFromPath(path)
  const at = id ? parts.indexOf(id) : -1
  const entity = camel(entityFromPath(path))
  const parent = at > 1 ? parts[at - 2] : ''
  const keys = [entity]
  if (parent) keys.push(camel(singular(parent)) + cap(entity), camel(parent) + cap(entity))
  return [...new Set(keys.flatMap((k) => (TABLE_ALIASES[k] ? [TABLE_ALIASES[k], k] : [k])))]
}

export function createDeleteAuditFloor(deps: DeleteFloorDeps) {
  /** The table this path deletes from, as [export name, table], or undefined. */
  const tableFor = (path: string): [string, any] | undefined => {
    for (const k of tableKeysForPath(path)) { const t = deps.schema[k]; if (t && t.id) return [k, t] }
    return undefined
  }
  const nameBefore = async (path: string): Promise<{ name: string; companyId?: string } | undefined> => {
    try {
      const id = idFromPath(path)
      if (!id) return undefined
      const table = tableFor(path)?.[1]
      if (!table) return undefined
      const col = ['number', 'name', 'title', 'email'].find((k) => table[k])
      if (!col) return undefined
      const [row] = await deps.db.select({ v: table[col], companyId: table.companyId ?? table.id }).from(table).where(eq(table.id, id)).limit(1)
      const v = row?.v
      const name = typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : ''
      return name ? { name, companyId: table.companyId ? row.companyId : undefined } : undefined
    } catch {
      return undefined
    }
  }

  return async function deleteAuditFloor(c: any, next: () => Promise<void>) {
    if (String(c.req.method).toUpperCase() !== 'DELETE') return next()
    let path = ''
    try { path = new URL(c.req.url).pathname } catch { return next() }
    if (SKIP.some((re) => re.test(path))) return next()
    const before = await nameBefore(path)
    await next()
    try {
      if (deps.scope.getStore()?.logged) return
      const status = c.res?.status ?? 0
      if (status < 200 || status >= 300) return
      const user = c.get('user') as any
      if (!user?.companyId) return
      // Named for the table when it resolved (support_knowledge_base, snow_contract — the same words the
      // handlers that do audit already use), else the path's own collection.
      const resolved = tableFor(path)?.[0]
      const entity = resolved ? resolved.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase()) : entityFromPath(path)
      await deps.log({
        action: 'delete',
        entity,
        entityId: idFromPath(path),
        entityName: before && (!before.companyId || before.companyId === user.companyId) ? before.name : undefined,
        metadata: { description: `Deleted — ${entity.replace(/_/g, ' ')}`, method: 'DELETE', path, status, via: 'request' },
        req: c,
      })
    } catch (err: any) {
      console.warn('[deleteAuditFloor] not recorded:', err?.message || err)
    }
  }
}
