// The demo's data: the recorded answers of a real server, plus the visitor's changes on top of them, all in memory.
//
// A list (/api/contacts) is a COLLECTION here: its rows from every recorded variant of the request. Until the visitor changes
// it, the exact recorded answer is served, byte for byte what the real server said. After a change the list is rebuilt
// from the rows (so a new job appears, a deleted one is gone) in the shape the recorded answer had. A change lives only in
// this object: reset() drops it, a new tab never had it, nothing here ever leaves the page.
import { canonicalKey, looksLikeId } from './keys'
import { daysBetween, localToday, shiftString, shiftValue } from './shift'

export type Row = Record<string, any>
export interface RecordedResponse { status: number; body: unknown }
export interface PageInfo { title: string; companyName: string; brandPrimary: string; brandSecondary: string; companyEmail: string; screens: Record<string, unknown> }
export interface DemoData { trade: string; recordedOn: string; page: PageInfo; responses: Record<string, RecordedResponse> }

interface Collection {
  path: string
  /** Where the rows sit in the answer: 'data', 'items'… or '' for a bare array. */
  listKey: string
  rows: Row[]
  changed: boolean
}

const RESERVED = new Set(['page', 'limit', 'offset', 'cursor', 'search', 'q', 'sort', 'order', 'sortBy', 'sortOrder', 'from', 'to', 'start', 'end', 'date', 'tile', 'include', 'fields'])
const idOf = (r: Row) => String(r.id)

/** The rows of a recorded list answer, and where they sit. */
function listOf(body: unknown): { key: string; rows: Row[] } | null {
  const isRows = (v: unknown): v is Row[] => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && x.id !== undefined)
  if (isRows(body)) return { key: '', rows: body }
  if (body && typeof body === 'object') {
    const o = body as Row
    if (isRows(o.data)) return { key: 'data', rows: o.data }
    let best: { key: string; rows: Row[] } | null = null
    for (const [k, v] of Object.entries(o)) if (isRows(v) && (!best || v.length > best.rows.length)) best = { key: k, rows: v }
    return best
  }
  return null
}

/**
 * A list row laid over the same record's recorded detail. The row wins — it holds the visitor's changes — except where it
 * speaks of the same name in another shape: a list's `notes` is a sentence, the detail's `notes` is the thread of notes, and
 * a sentence laid over a thread would break the screen that maps over it.
 */
function overlay(detail: Row, row: Row): Row {
  const kind = (v: unknown) => (v === null || v === undefined ? 'none' : Array.isArray(v) ? 'array' : typeof v)
  for (const [k, v] of Object.entries(row)) {
    const was = kind(detail[k])
    if (was !== 'none' && kind(v) !== 'none' && was !== kind(v)) continue
    detail[k] = v
  }
  return detail
}

/** An empty list answer of the same shape counts as a list too (a recorded page with no rows). */
function emptyListKey(body: unknown): string | null {
  if (Array.isArray(body)) return ''
  if (body && typeof body === 'object' && Array.isArray((body as Row).data)) return 'data'
  return null
}

const clone = <T,>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** The same shape with nothing in it: arrays empty, scalars null, objects emptied the same way. */
function skeleton(v: any): any {
  if (Array.isArray(v)) return []
  if (v && typeof v === 'object') { const o: Row = {}; for (const [k, x] of Object.entries(v)) o[k] = skeleton(x); return o }
  return null
}

const singular = (word: string) => (word.endsWith('ies') ? word.slice(0, -3) + 'y' : word.endsWith('s') ? word.slice(0, -1) : word)

export class DemoStore {
  readonly data: DemoData
  /** Whole days the recorded dates move by (the day it was recorded to today). */
  readonly delta: number
  private recorded = new Map<string, RecordedResponse>()
  private collections = new Map<string, Collection>()
  private details = new Map<string, Map<string, Row>>()
  private extra = new Map<string, RecordedResponse>()
  private seq = 0
  /** Called when something the visitor did would have reached the outside world. */
  notify: (message: string) => void = () => {}

  constructor(data: DemoData, now = new Date()) {
    this.data = data
    this.delta = daysBetween(data.recordedOn, localToday(now))
    this.load()
  }

  /** Back to the recorded data: every change gone. */
  reset() { this.collections.clear(); this.details.clear(); this.extra.clear(); this.seq = 0; this.load() }

  private load() {
    this.recorded.clear()
    for (const [key, r] of Object.entries(this.data.responses)) this.recorded.set(key, { status: r.status, body: shiftValue(r.body, this.delta) })
    // Collections: every recorded GET list, the rows of all its variants together.
    for (const [key, r] of this.recorded) {
      if (!key.startsWith('GET /api/') || r.status !== 200) continue
      const path = key.slice(4).split('?')[0]
      // One record's answer (…/jobs/<id>) is not a list, even when it carries rows of its own (a quote's line items).
      if (looksLikeId(path.slice(path.lastIndexOf('/') + 1))) continue
      const found = listOf(r.body)
      if (found) {
        const c = this.collections.get(path) ?? { path, listKey: found.key, rows: [], changed: false }
        for (const row of found.rows) if (!c.rows.some((x) => idOf(x) === idOf(row))) c.rows.push(clone(row))
        this.collections.set(path, c)
      } else {
        const k = emptyListKey(r.body)
        if (k !== null && !this.collections.has(path)) this.collections.set(path, { path, listKey: k, rows: [], changed: false })
      }
    }
    // Details: GET <collection>/<id>.
    for (const [key, r] of this.recorded) {
      if (!key.startsWith('GET /api/') || r.status !== 200) continue
      const path = key.slice(4).split('?')[0]
      const cut = path.lastIndexOf('/')
      const base = path.slice(0, cut), id = path.slice(cut + 1)
      if (this.collections.has(base) && looksLikeId(id) && r.body && typeof r.body === 'object') {
        if (!this.details.has(base)) this.details.set(base, new Map())
        this.details.get(base)!.set(id, clone(r.body as Row))
      }
    }
  }

  // ── reads ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The answer to a GET, or null when nothing was recorded for it. */
  read(pathname: string, params: URLSearchParams): RecordedResponse | null {
    const path = pathname.replace(/\/+$/, '')
    const unshifted = new URLSearchParams()
    params.forEach((v, k) => unshifted.append(k, shiftString(v, -this.delta)))
    const exact = this.recorded.get(canonicalKey('GET', path, unshifted))
    const col = this.collections.get(path)
    if (col) {
      if (exact && !col.changed) return { status: exact.status, body: clone(exact.body) }
      return { status: 200, body: this.list(col, params, exact?.body ?? this.anyAnswer(path)) }
    }
    const cut = path.lastIndexOf('/')
    const base = path.slice(0, cut), id = path.slice(cut + 1)
    const parent = this.collections.get(base)
    if (parent && looksLikeId(id)) return this.detail(parent, id)
    if (exact) return { status: exact.status, body: clone(exact.body) }
    const extra = this.extra.get(canonicalKey('GET', path, unshifted))
    return extra ? { status: extra.status, body: clone(extra.body) } : null
  }

  /** Any recorded answer of this path, for the shape the rebuilt list should have. */
  private anyAnswer(path: string): unknown {
    for (const [key, r] of this.recorded) if (r.status === 200 && key.startsWith(`GET ${path}`) && key.slice(4).split('?')[0] === path) return r.body
    return null
  }

  private list(col: Collection, params: URLSearchParams, shape: unknown): unknown {
    let rows = col.rows.slice()
    const search = (params.get('search') ?? params.get('q') ?? '').trim().toLowerCase()
    if (search) rows = rows.filter((r) => JSON.stringify(Object.values(r).filter((v) => typeof v === 'string' || typeof v === 'number')).toLowerCase().includes(search))
    params.forEach((value, key) => {
      if (RESERVED.has(key) || value === '') return
      if (!rows.some((r) => key in r)) return
      const want = value.split(',')
      rows = rows.filter((r) => want.includes(String(r[key])))
    })
    const sort = params.get('sort') ?? params.get('sortBy')
    if (sort && rows.some((r) => sort in r)) {
      const dir = (params.get('order') ?? params.get('sortOrder')) === 'desc' ? -1 : 1
      rows.sort((a, b) => (a[sort] > b[sort] ? dir : a[sort] < b[sort] ? -dir : 0))
    }
    const total = rows.length
    const limit = Number(params.get('limit')) > 0 ? Number(params.get('limit')) : Math.max(50, total)
    const page = Math.max(1, Number(params.get('page')) || 1)
    const paged = rows.slice((page - 1) * limit, page * limit)
    if (col.listKey === '') return clone(paged)
    const body: Row = shape && typeof shape === 'object' && !Array.isArray(shape) ? clone(shape as Row) : {}
    body[col.listKey] = clone(paged)
    body.pagination = { ...(typeof body.pagination === 'object' && body.pagination ? body.pagination : {}), page, limit, total, pages: limit > 0 ? Math.ceil(total / limit) : 0 }
    return body
  }

  private detail(parent: Collection, id: string): RecordedResponse | null {
    const row = parent.rows.find((r) => idOf(r) === id)
    const recorded = this.details.get(parent.path)?.get(id)
    if (!row && !recorded) return null
    if (!row) return null // deleted
    if (recorded) return { status: 200, body: overlay(clone(recorded), clone(row)) }
    // A row the visitor made: the shape of a recorded detail, empty, with the row's own fields on it.
    const sample = this.details.get(parent.path)?.values().next().value
    return { status: 200, body: { ...(sample ? skeleton(sample) : {}), ...clone(row) } }
  }

  /** A POST the screens make to READ (a payroll or report calculation): its recorded answer, whatever the request says. */
  readPost(pathname: string): RecordedResponse | null {
    const r = this.recorded.get(`POST ${pathname.replace(/\/+$/, '')}`)
    return r ? { status: r.status, body: clone(r.body) } : null
  }

  // ── writes ───────────────────────────────────────────────────────────────────────────────────────────────────
  has(path: string): boolean { return this.collections.has(path.replace(/\/+$/, '')) }
  collection(path: string): Collection | undefined { return this.collections.get(path.replace(/\/+$/, '')) }
  row(path: string, id: string): Row | undefined { return this.collections.get(path)?.rows.find((r) => idOf(r) === id) }

  create(path: string, body: Row): Row {
    const col = this.collections.get(path)!
    const sample = col.rows[0]
    const now = new Date().toISOString()
    const row: Row = { ...(sample ? skeleton(sample) : {}), ...clone(body), id: `demo-${++this.seq}`, createdAt: now, updatedAt: now }
    if (sample && 'companyId' in sample) row.companyId = sample.companyId
    if (sample && typeof sample.number === 'string' && row.number == null) row.number = this.nextNumber(col)
    if (sample && 'status' in sample && row.status == null) row.status = this.defaultStatus(col)
    this.link(row, col)
    col.rows.unshift(row)
    col.changed = true
    return row
  }

  update(path: string, id: string, body: Row): Row | null {
    const col = this.collections.get(path)
    const row = col?.rows.find((r) => idOf(r) === id)
    if (!col || !row) return null
    Object.assign(row, clone(body), { updatedAt: new Date().toISOString() })
    this.link(row, col)
    col.changed = true
    return row
  }

  remove(path: string, id: string): boolean {
    const col = this.collections.get(path)
    const at = col ? col.rows.findIndex((r) => idOf(r) === id) : -1
    if (!col || at < 0) return false
    col.rows.splice(at, 1)
    col.changed = true
    return true
  }

  /** Marks a collection changed (an action that moved rows between lists). */
  touch(path: string) { const c = this.collections.get(path); if (c) c.changed = true }

  private nextNumber(col: Collection): string {
    let best: { prefix: string; n: number; width: number } | null = null
    for (const r of col.rows) {
      const m = /^(.*?)(\d+)$/.exec(String(r.number ?? ''))
      if (m && (!best || Number(m[2]) > best.n)) best = { prefix: m[1], n: Number(m[2]), width: m[2].length }
    }
    return best ? `${best.prefix}${String(best.n + 1).padStart(best.width, '0')}` : String(col.rows.length + 1)
  }

  private defaultStatus(col: Collection): string | null {
    const seen = new Set(col.rows.map((r) => r.status))
    for (const s of ['draft', 'new', 'scheduled', 'open', 'pending', 'active']) if (seen.has(s)) return s
    return (col.rows[0]?.status as string) ?? null
  }

  /** A row that names a related record by id (contactId) shows that record's name where the screen reads one (contact, contactName). */
  private link(row: Row, own: Collection) {
    for (const key of Object.keys(row)) {
      if (!key.endsWith('Id') || row[key] == null || row[key] === '') continue
      const base = key.slice(0, -2)
      const target = [...this.collections.values()].find((c) => c !== own && singular(c.path.split('/').pop() || '') === base.toLowerCase().replace(/[^a-z]/g, ''))
      const found = target?.rows.find((r) => idOf(r) === String(row[key]))
      if (!found) continue
      const name = found.name ?? (found.firstName ? `${found.firstName} ${found.lastName ?? ''}`.trim() : found.title ?? found.number ?? null)
      if (`${base}Name` in row || row[`${base}Name`] === null) row[`${base}Name`] = name
      if (base in row && (row[base] === null || typeof row[base] === 'object')) {
        const pick: Row = {}
        for (const f of ['id', 'name', 'title', 'firstName', 'lastName', 'email', 'phone', 'company', 'number', 'status', 'address', 'city']) if (f in found) pick[f] = found[f]
        row[base] = pick
      }
    }
  }
}
