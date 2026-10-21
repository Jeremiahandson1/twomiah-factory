/**
 * A live premium website's records, read through its own admin API, and its site.db rebuilt from them — for a business
 * moving to the unified app with its site AS IT IS (owner, 2026-10-21: "i just want the site to be the same").
 *
 * Why the admin API: a Render disk is out of reach of a one-off job, and the site's own API is what it serves its admin
 * from — every row it shows is a row the site has. The Factory signs a server-to-server token with the site's own
 * JWT_SECRET (the template's authMiddleware takes a Bearer token without a jti as the Factory's). GET requests only.
 *
 * The rebuilt file is the template's own SQLite layout (its migration, the same one the live site ran — the move checks
 * the site's code is the template's), filled from the API's JSON: the API writes a drizzle row as JSON, so a json column
 * comes as an object, a timestamp_ms column as an ISO string, a boolean column as true/false — and back they go.
 * apps/unified/server/move/site.ts moves the file, tested on files built the same way.
 *
 * What it cannot carry it refuses, and says so: a site whose bookings, alias or webhook tables hold rows (the admin API
 * does not give their full rows — booking tokens, calendar connections) stops the move instead of losing them.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'

export interface SiteExport {
  /** The tables as the API gave them: camelCase rows. */
  tables: Record<string, Record<string, unknown>[]>
  /** What the file does not hold, said in the move's report (analytics history, sign-in sessions…). */
  notCarried: string[]
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

/** HS256, no jti — the template's server-to-server token — admin, ten minutes. */
export function factoryToken(jwtSecret: string, now = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ alg: 'HS256', typ: 'JWT' })
  const body = b64({ sub: 'factory-export', email: 'factory@twomiah.com', role: 'admin', iat: now, exp: now + 600 })
  return `${head}.${body}.${crypto.createHmac('sha256', jwtSecret).update(`${head}.${body}`).digest('base64url')}`
}

/** Tables the API lists in full, by endpoint and key. */
const LISTED: [table: string, endpoint: string, key: string][] = [
  ['photos', 'photos', 'photos'],
  ['leads', 'leads', 'leads'],
  ['users', 'users', 'users'],
]
/** Tables the API lists as a summary; each row is read whole by its slug. */
const BY_SLUG: [table: string, endpoint: string, listKey: string, oneKey: string][] = [
  ['pages', 'pages', 'pages', 'page'],
  ['posts', 'posts', 'posts', 'post'],
  ['projects', 'projects', 'projects', 'project'],
]
/** Tables this export cannot carry whole; any row in one stops the move. */
const MUST_BE_EMPTY: [label: string, endpoint: string, key: string][] = [
  ['booking services', 'booking-services', 'services'],
  ['booking hours', 'booking-availability', 'rules'],
  ['booking blackouts', 'booking-blackouts', 'blackouts'],
  ['booking zones', 'booking-zones', 'zones'],
  ['bookings', 'bookings', 'bookings'],
  ['booking series', 'booking-series', 'series'],
  ['booking waitlist', 'booking-waitlist', 'waitlist'],
  ['booking bans', 'booking-bans', 'bans'],
  ['booking webhooks', 'booking-webhooks', 'webhooks'],
  ['email aliases', 'email-aliases', 'aliases'],
]

/**
 * The site's records. `only: 'leads'` — a business getting a NEW site: its settings (the file needs its row), its users
 * and its enquiries, nothing else read or refused (move/site.ts scope 'leads' moves the enquiries alone).
 */
export async function exportPremiumSite(o: { baseUrl: string; jwtSecret: string; fetchImpl?: Fetch; only?: 'leads' }): Promise<SiteExport> {
  const f = o.fetchImpl ?? ((u, i) => fetch(u, i))
  const base = o.baseUrl.replace(/\/+$/, '')
  const token = factoryToken(o.jwtSecret)
  const get = async (p: string): Promise<any> => {
    const r = await f(`${base}/api/admin/${p}`, { headers: { Authorization: 'Bearer ' + token, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`the site answered ${r.status} for /api/admin/${p}`)
    return r.json()
  }
  const tables: SiteExport['tables'] = {}
  const s = (await get('settings')).settings
  if (!s) throw new Error('the site has no settings row')
  tables.settings = [s]
  for (const [table, endpoint, key] of LISTED) {
    if (o.only === 'leads' && table === 'photos') continue
    const rows = (await get(endpoint))[key]
    if (!Array.isArray(rows)) throw new Error(`/api/admin/${endpoint} gave no ${key} list`)
    tables[table] = rows
  }
  if (o.only === 'leads') return { tables, notCarried: ['the old site itself: the business gets a new one (its enquiries are carried)'] }
  for (const [table, endpoint, listKey, oneKey] of BY_SLUG) {
    const list = (await get(endpoint))[listKey]
    if (!Array.isArray(list)) throw new Error(`/api/admin/${endpoint} gave no ${listKey} list`)
    tables[table] = []
    for (const r of list) tables[table].push((await get(`${endpoint}/${encodeURIComponent(String(r.slug))}`))[oneKey])
  }
  const held: string[] = []
  for (const [label, endpoint, key] of MUST_BE_EMPTY) {
    const body = await get(endpoint)
    const rows = body?.[key] ?? Object.values(body ?? {}).find(Array.isArray)
    if (!Array.isArray(rows)) throw new Error(`/api/admin/${endpoint} gave no list; cannot tell whether it is empty`)
    if (rows.length) held.push(`${label} (${rows.length})`)
  }
  if (held.length) throw new Error(`the site holds ${held.join(', ')}, which this export cannot carry whole — moving it would lose them`)
  return {
    tables,
    notCarried: ['the site\'s visitor counts and admin audit history', 'site sign-in sessions and two-factor (site sign-ins become the CRM\'s users by email)'],
  }
}

const camel = (snake: string) => snake.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

/**
 * The site.db the live site has, from its export: the template's migration (templates/<template>/db/migrations), then
 * every row, each column by its snake_case name from the API's camelCase field. Returns the file's bytes.
 */
export function buildSiteDb(templateDir: string, ex: SiteExport): Uint8Array {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-db-'))
  const file = path.join(dir, 'site.db')
  try {
    const db = new Database(file, { create: true })
    const migrations = path.join(templateDir, 'db', 'migrations')
    const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta', '_journal.json'), 'utf8'))
    for (const e of journal.entries) for (const s of fs.readFileSync(path.join(migrations, e.tag + '.sql'), 'utf8').split('--> statement-breakpoint')) if (s.trim()) db.exec(s)
    for (const [table, rows] of Object.entries(ex.tables)) {
      const cols = db.query(`PRAGMA table_info("${table}")`).all() as { name: string; type: string; notnull: number; dflt_value: unknown; pk: number }[]
      if (!cols.length) throw new Error(`the template has no ${table} table`)
      for (const row of rows) {
        const names: string[] = [], values: unknown[] = []
        for (const c of cols) {
          const field = camel(c.name)
          let v = field in row ? row[field] : undefined
          if (v === undefined) {
            // A column the API does not show: the user's password hash (never moved — site.ts matches users by email).
            if (c.notnull && c.dflt_value == null && !c.pk) {
              if (c.name === 'password_hash') v = '!'
              else throw new Error(`${table}.${c.name} is required and the site's API did not give it`)
            } else continue
          }
          if (v !== null) {
            if (/INT/i.test(c.type)) v = typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'string' && ISO.test(v) ? Date.parse(v) : v
            else if (typeof v === 'object') v = JSON.stringify(v)
          }
          names.push(c.name); values.push(v)
        }
        db.query(`INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...(values as any[]))
      }
    }
    db.close()
    return new Uint8Array(fs.readFileSync(file))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
