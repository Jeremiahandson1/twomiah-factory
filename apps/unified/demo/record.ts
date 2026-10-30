// The recorder: a real unified server, per trade, seeded through its own routes, asked for every read the demo's screens make,
// and the answers written down. Nothing in the demo's data is typed by hand — the seed (demo/seed/<trade>.ts) says what the
// sample business has, the real server says what every screen is told about it.
//
// The reads come from demo/routes/<trade>.json: the addresses the real screens asked for when a browser walked them
// (scripts/discover-demo-routes.ts). An address with an id in it (/api/jobs/:id) is asked for once per row the list has.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { canonicalKey, looksLikeId } from '../web/demo/keys.ts'
import { daysBetween } from '../web/demo/shift.ts'
import { shiftString, shiftValue } from '../web/demo/shift.ts'
import type { DemoData, PageInfo, RecordedResponse } from '../web/demo/store.ts'
import { bootDemoTenant, type Kit } from './seed/kit.ts'
import type { DemoTrade } from './trades.ts'

export interface PostRead { path: string; body: unknown }
/** The reads the screens make (GET addresses, ids as :id), and the few POSTs they make to read (path and the body they sent). */
export interface RouteManifest { discoveredOn: string; routes: string[]; posts?: PostRead[] }

export const DEMO_DIR = import.meta.dir
export const DATA_DIR = path.join(DEMO_DIR, 'public', 'demo-data')
export const ROUTES_DIR = path.join(DEMO_DIR, 'routes')
/** Addresses whose :id is a row of another list, where the address does not say which (a reminder's history is an invoice's). */
const LISTS: Record<string, string> = { '/api/invoice-reminders/history': '/api/invoices' }
/** Rows asked for by id, per list: enough that any row a visitor opens is real. */
const MAX_DETAILS = 40

export function readManifest(trade: DemoTrade): RouteManifest | null {
  const file = path.join(ROUTES_DIR, `${trade.id}.json`)
  if (!fs.existsSync(file)) return null
  const found = JSON.parse(fs.readFileSync(file, 'utf8')) as RouteManifest
  // Reads the walk cannot reach on its own (a screen opened by a click on a row, not a link) are kept by hand in
  // <trade>.extra.json, so a fresh walk never drops them.
  const extra = path.join(ROUTES_DIR, `${trade.id}.extra.json`)
  if (fs.existsSync(extra)) found.routes = [...new Set([...found.routes, ...(JSON.parse(fs.readFileSync(extra, 'utf8')).routes as string[])])].sort()
  return found
}

/** A minimal admin page, so the real server will write its head (name, colours, screen settings) into something we can read. */
function pageShell(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-shell-'))
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>x</title></head><body></body></html>')
  return dir
}

function readPage(html: string): PageInfo {
  const meta = (name: string) => new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html)?.[1] ?? ''
  const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  const screens = /<script type="application\/json" id="vertical-screens">([\s\S]*?)<\/script>/.exec(html)?.[1]
  return {
    title: unesc(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? ''),
    companyName: unesc(meta('company-name')),
    brandPrimary: meta('brand-primary'), brandSecondary: meta('brand-secondary'), companyEmail: unesc(meta('company-email')),
    screens: screens ? JSON.parse(screens) : {},
  }
}

/** The rows of a recorded list answer (a bare array, { data }, or the one array property). */
function rowsOf(body: unknown): Array<{ id?: unknown }> {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>
    if (Array.isArray(o.data)) return o.data as any[]
    const arrays = Object.values(o).filter((v) => Array.isArray(v)) as any[][]
    if (arrays.length) return arrays.sort((a, b) => b.length - a.length)[0]
  }
  return []
}

/** Seeds the trade, then records. `seed` is the trade's own file. */
export async function recordTrade(trade: DemoTrade, manifest: RouteManifest, opts: { seed?: (k: Kit) => Promise<void> } = {}): Promise<DemoData> {
  const kit = await bootDemoTenant(trade, pageShell())
  const seed = opts.seed ?? (await import(`./seed/${trade.id}.ts`)).default
  await seed(kit)
  return await recordKit(kit, manifest)
}

export async function recordKit(kit: Kit, manifest: RouteManifest): Promise<DemoData> {
  const { t, trade } = kit
  const responses: Record<string, RecordedResponse> = {}
  const shiftBy = daysBetween(manifest.discoveredOn, kit.today)

  const ask = async (address: string) => {
    const url = new URL(address, 'http://demo.local')
    // The manifest's dates are the day it was walked; the data's are today's.
    for (const [k, v] of [...url.searchParams.entries()]) url.searchParams.set(k, shiftString(v, shiftBy))
    const res = await t.call(url.pathname + url.search, { headers: kit.headers })
    const text = await res.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    if (res.status >= 500) throw new Error(`${trade.id}: GET ${address} → ${res.status} ${text.slice(0, 300)}`)
    const key = canonicalKey('GET', url.pathname, url.searchParams)
    responses[key] = { status: res.status, body }
    return { key, status: res.status, body }
  }

  await ask('/api/auth/me')
  const hasPathId = (r: string) => r.split('?')[0].split('/').includes(':id')
  const hasQueryId = (r: string) => (r.split('?')[1] ?? '').split('&').some((kv) => kv.endsWith('=:id'))
  const direct = manifest.routes.filter((r) => !hasPathId(r) && !hasQueryId(r))
  for (const address of direct) await ask(address)

  /** The widest recorded answer of a list, or one asked for now. */
  const rowsOfList = async (listPath: string): Promise<Array<{ id?: unknown }>> => {
    let rows: Array<{ id?: unknown }> = []
    for (const [key, r] of Object.entries(responses)) if (key.slice(4).split('?')[0] === listPath && r.status === 200) { const got = rowsOf(r.body); if (got.length > rows.length) rows = got }
    if (!rows.length) rows = rowsOf((await ask(`${listPath}?limit=100`)).body)
    return rows.filter((row) => row.id && looksLikeId(String(row.id))).slice(0, MAX_DETAILS)
  }

  // Addresses with an id in the path: once per row of the list the id names. Mostly that is the part before the :id
  // (/api/jobs/:id → /api/jobs); where the part before it is a feature and not the thing (/api/comments/job/:id, a job's
  // comments), the thing is named by the last word, or by LISTS below when the word does not say.
  const plural = (name: string) => (name.endsWith('s') ? name : name.endsWith('y') ? `${name.slice(0, -1)}ies` : `${name}s`)
  for (const template of manifest.routes.filter(hasPathId)) {
    const [p, q] = template.split('?')
    const segs = p.split('/')
    const first = segs.indexOf(':id')
    if (segs.slice(first + 1).includes(':id') || hasQueryId(template)) continue
    const before = segs.slice(0, first)
    const candidates = [...new Set([LISTS[before.join('/')], `/api/${plural(before[before.length - 1])}`, before.join('/')].filter(Boolean) as string[])]
    let rows: Array<{ id?: unknown }> = []
    for (const candidate of candidates) { rows = await rowsOfList(candidate); if (rows.length) break }
    for (const row of rows) {
      const rest = [...before, String(row.id), ...segs.slice(first + 1)].join('/')
      await ask(q ? `${rest}?${q}` : rest)
    }
  }

  // Addresses with an id in the query (?contactId=:id): once per row of the list that id names (contactId → /api/contacts).
  for (const template of manifest.routes.filter((r) => hasQueryId(r) && !hasPathId(r))) {
    const [p, q] = template.split('?')
    const params = q.split('&')
    const slot = params.findIndex((kv) => kv.endsWith('=:id'))
    if (params.filter((kv) => kv.endsWith('=:id')).length > 1) continue
    const name = params[slot].slice(0, -4).replace(/Id$/, '')
    const plural = name.endsWith('y') ? `${name.slice(0, -1)}ies` : `${name}s`
    for (const row of await rowsOfList(`/api/${plural}`)) await ask(`${p}?${params.map((kv, i) => (i === slot ? `${kv.slice(0, -3)}${row.id}` : kv)).join('&')}`)
  }

  // POSTs the screens make to read: asked with the body they sent (its dates moved to today), answered under the path alone.
  for (const post of manifest.posts ?? []) {
    const res = await t.call(post.path, { method: 'POST', headers: kit.headers, json: shiftValue(post.body, shiftBy) })
    const text = await res.text()
    if (res.status >= 500) throw new Error(`${trade.id}: POST ${post.path} → ${res.status} ${text.slice(0, 300)}`)
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    responses[`POST ${post.path}`] = { status: res.status, body }
  }

  const page = readPage(await (await t.call('/crm')).text())
  const sorted: Record<string, RecordedResponse> = {}
  for (const k of Object.keys(responses).sort()) sorted[k] = responses[k]
  return { trade: trade.id, recordedOn: kit.today, page, responses: sorted }
}

/** One recorded response per line, so a re-recording reads as a diff and not as a wall. */
export function serialise(data: DemoData): string {
  const lines = Object.entries(data.responses).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`)
  return `{"trade":${JSON.stringify(data.trade)},"recordedOn":${JSON.stringify(data.recordedOn)},"page":${JSON.stringify(data.page)},"responses":{\n${lines.join(',\n')}\n}}\n`
}

export function writeData(data: DemoData) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(path.join(DATA_DIR, `${data.trade}.json`), serialise(data))
}
