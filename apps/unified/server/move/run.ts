// The data move, run where the data is: a one-off job on the business's NEW unified service (Render, in the old
// database's region — a tenant database is reached on Render's private network only). It reads the old template
// database through one read-only snapshot and writes the new one in one transaction (copy.ts): all of it, or nothing.
//
//   bun apps/unified/server/move/run.ts
//
// From the environment (set by the Factory's cutover, apps/api/src/unified/cutover.ts):
//   DATABASE_URL               the new database (the service's own)
//   MOVE_SOURCE_DATABASE_URL   the old one — only ever read
//   MOVE_KIND                  'crm' | 'crm-bar' | 'homecare'  (the old template)
//   MOVE_MODE                  'check' — a rehearsal: everything runs and is counted, every refusal is met, then the new
//                              database's transaction is rolled back, so nothing is kept — or 'move'
//   MOVE_SITE_KEY              optional: a file in the business's own storage bucket holding its website package
//                              (siteSource.ts): a fresh site, or the old premium site to move as it is
//   MOVE_REPORT_KEY            optional: where in that bucket to leave the report, for the Factory to read
//
// Prints one line `MOVE_REPORT {json}` (and leaves it at MOVE_REPORT_KEY); exits 0 only on success.
import pg from 'pg'
import { readLayout, planMove, type Query } from './schema.ts'
import { moveTenant, type MoveStep } from './copy.ts'
import { tradesMove } from './steps/trades.ts'
import { homecareMove } from './steps/homecare.ts'
import { parseSitePackage, premiumSiteSteps, siteLeadsSteps, writeFreshSiteAt, type SitePackage } from './siteSource.ts'
import { sharedPhotoStore, type PhotoStore } from '../site/admin.ts'
import type { StartingSite } from '../modules/provision.ts'

/** The report: in the job's log, and in the business's bucket for the Factory (a long log line can be cut). */
async function report(o: unknown) {
  const text = JSON.stringify(o)
  console.log('MOVE_REPORT ' + text)
  if (process.env.MOVE_REPORT_KEY) await sharedPhotoStore().put(process.env.MOVE_REPORT_KEY, Buffer.from(text), 'application/json')
}

/**
 * One dedicated connection — BEGIN … COMMIT must all run on the same one (a pool would hand each statement elsewhere) —
 * on UTC, as the app's own (db/client.ts): a timestamp with a time zone is read as text, which the session's zone shapes.
 */
async function connect(url: string): Promise<{ query: Query; close: () => Promise<void> }> {
  const client = new pg.Client({ connectionString: url, options: '-c TimeZone=UTC', statement_timeout: 600_000 })
  await client.connect()
  const query: Query = async (text, params) => ({ rows: (await client.query(text, (params ?? []) as any[])).rows })
  return { query, close: async () => { await client.end() } }
}

export interface RunMoveOptions {
  src: Query
  dst: Query
  kind: 'crm' | 'crm-bar' | 'homecare'
  mode: 'check' | 'move'
  site?: SitePackage | null
  store: PhotoStore
  /** Writes a fresh site once the records are in (siteSource.ts writeFreshSite against the service's database). */
  writeFresh: (site: StartingSite) => Promise<number>
  fetchImpl?: typeof fetch
}

/** The move itself, given its two databases (main below wires the real ones; the tests, theirs). */
export async function runMove(o: RunMoveOptions) {
  const source = await readLayout(o.src)
  const target = await readLayout(o.dst)
  // Into an empty business only: a second run must never pile one business on top of another.
  const [{ n }] = (await o.dst('SELECT count(*)::int AS n FROM company')).rows
  if (Number(n) > 0) throw new Error(`the new database already holds ${n} business(es); a move goes into an empty one`)

  const base = o.kind === 'homecare'
    ? homecareMove(source, target)
    : (() => { const plan = planMove(source, target); return { plan, ...tradesMove({ vertical: o.kind as 'crm' | 'crm-bar', source, target, plan }) } })()
  const after: MoveStep[] = [...base.after]
  let undoFiles: (() => Promise<void>) | null = null
  let siteReport: unknown = null
  if (o.site && 'premium' in o.site) {
    const s = premiumSiteSteps(o.site.premium, o.store, o.fetchImpl)
    after.push(...s.steps); undoFiles = s.undoFiles; siteReport = s.report
  }
  let leadsReport: unknown = null
  if (o.site && 'fresh' in o.site && o.site.leadsFrom) {
    const s = siteLeadsSteps(o.site.leadsFrom, o.store)
    after.push(...s.steps); leadsReport = s.report
  }

  let result
  try {
    result = await moveTenant({ read: o.src, write: o.dst, plan: base.plan, target, fill: base.fill, before: base.before, after, rollback: o.mode === 'check' })
  } catch (e) {
    if (undoFiles) await undoFiles().catch(() => {})
    throw e
  }
  // A rehearsal keeps no photo files either.
  if (o.mode === 'check' && undoFiles) await undoFiles().catch(() => {})

  // A fresh site, once the records are in (its own transaction; a failure here leaves the records, and says so).
  let freshPages: number | null = null
  if (o.site && 'fresh' in o.site && o.mode === 'move') freshPages = await o.writeFresh(o.site.fresh)

  return {
    mode: o.mode, kind: o.kind, ok: true, tables: result.tables, steps: result.steps, mismatches: result.mismatches,
    onlyInSource: base.plan.onlyInSource,
    site: o.site ? ('fresh' in o.site ? { fresh: true, pages: freshPages ?? o.site.fresh.pages.length, oldSiteEnquiries: leadsReport } : siteReport) : null,
  }
}

async function main() {
  const kind = process.env.MOVE_KIND as RunMoveOptions['kind']
  const mode = process.env.MOVE_MODE === 'move' ? 'move' : 'check'
  if (!['crm', 'crm-bar', 'homecare'].includes(kind)) throw new Error('MOVE_KIND must be crm, crm-bar or homecare')
  if (!process.env.MOVE_SOURCE_DATABASE_URL || !process.env.DATABASE_URL) throw new Error('MOVE_SOURCE_DATABASE_URL and DATABASE_URL are required')
  if (process.env.MOVE_SOURCE_DATABASE_URL === process.env.DATABASE_URL) throw new Error('the old and new databases are the same')

  const store = sharedPhotoStore()
  let site: SitePackage | null = null
  if (process.env.MOVE_SITE_KEY) {
    const obj = await store.getObject(process.env.MOVE_SITE_KEY)
    if (!obj) throw new Error("the website package is not in the business's storage")
    site = parseSitePackage(JSON.parse(Buffer.from(obj.body as ArrayBuffer).toString('utf8')))
  }
  const src = await connect(process.env.MOVE_SOURCE_DATABASE_URL)
  const dst = await connect(process.env.DATABASE_URL)
  try {
    await report(await runMove({ src: src.query, dst: dst.query, kind, mode, site, store, writeFresh: (s) => writeFreshSiteAt(process.env.DATABASE_URL!, s) }))
    // The package was the business's own data in transit: removed once used.
    if (mode === 'move' && process.env.MOVE_SITE_KEY) await store.remove(process.env.MOVE_SITE_KEY).catch(() => {})
  } finally {
    await src.close(); await dst.close()
  }
}

if (import.meta.main) {
  main().catch(async (e) => {
    process.exitCode = 1
    await report({ ok: false, error: e?.message || String(e), report: e?.report }).catch((w) => console.error('the report could not be stored:', w?.message))
  })
}
