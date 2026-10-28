// "Export everything": every table the business has, each as a CSV, in one ZIP — for ONE company.
//
// The list is the Drizzle schema, not a hand-kept one, so a table added next year is in the export the day it exists.
// A table is scoped to the company in one of three ways: it carries company_id; it is the company itself; or it is a
// child row (a line item, a payment) that reaches the company through a foreign key to a table that is scoped. A table
// that can be scoped no way is either named in WHOLE_TABLE (a single-tenant table — this database holds one business) or
// in LEFT_OUT with the reason; scripts/check-unified-export-everything.ts fails the build for any table that is none.
//
// What never leaves: passwords, sign-in and reset tokens, API keys and secrets, the encrypted credentials of a connected
// service, one-time links. The manifest says, per file, which columns were left out for that reason.
import { getTableConfig, PgTable, type PgColumn } from 'drizzle-orm/pg-core'
import { getTableName, is, sql, type SQL } from 'drizzle-orm'
import * as schema from '../db/schema/index.ts'
import { zip } from '../core/zip.ts'

/** A column that holds a secret, a password, a token or a credential — never exported. */
export const SECRET_COLUMN = /pass(word|wd)|secret|token|_hash$|^hash$|_enc$|credential|signing_key|license_key|api_key|private_key|refresh|totp|recovery|pin_hash/i
/** Named columns that match SECRET_COLUMN but are records, not secrets: a signed document's fingerprint. */
const NOT_SECRET = new Set(['signature_hash', 'document_hash'])
export const isSecretColumn = (name: string) => SECRET_COLUMN.test(name) && !NOT_SECRET.has(name)

/** Tables with no company link at all that still belong to this business, because the database holds one business. */
export const WHOLE_TABLE = new Set(['email_alias', 'inbound_message', 'gbp_connection'])
/** Parents for child tables whose link to the parent is a plain column, not a declared foreign key. */
const PARENT_BY_COLUMN: Record<string, { column: string; parent: string }> = {
  takeoff_calculated_material: { column: 'item_id', parent: 'takeoff_item' },
}
/** Tables not exported, and why. Each is a sign-in, a device or a cache — nothing the business entered. */
export const LEFT_OUT: Record<string, string> = {
  mfa_challenges: 'sign-in codes in flight',
  mfa_devices: 'two-factor secrets',
  portal_session: 'live customer-portal sessions',
  push_subscription: 'browser push endpoints',
  expo_push_tokens: 'phone push tokens',
  dashboard_cache: 'a cache, rebuilt on demand',
  self_hosted_license: 'the Twomiah licence record (held by Twomiah, carries the licence key)',
}

/** The friendly file names for the website's lists; every other table is named as it is in the database. */
const FILE_NAME: Record<string, string> = { page: 'pages', photo: 'media' }
const WEBSITE_TABLES = new Set(['website', 'page', 'post', 'portfolio_item', 'photo', 'page_view'])

const tables = (): PgTable[] => Object.values(schema).filter((x) => is(x, PgTable)) as PgTable[]
const byName = () => new Map(tables().map((t) => [getTableName(t), t]))
const q = (id: string) => sql.raw(`"${id.replace(/"/g, '""')}"`)

/** Where a table's rows are scoped to the company: a WHERE for the table, or null when it cannot be (or is whole). */
function scopeOf(name: string, companyId: string, depth = 0): SQL | 'whole' | null {
  const map = byName()
  const t = map.get(name)
  if (!t || depth > 4) return null
  const cfg = getTableConfig(t)
  if (name === 'company') return sql`${q('id')} = ${companyId}`
  if (cfg.columns.some((c) => c.name === 'company_id')) return sql`${q('company_id')} = ${companyId}`
  const plain = PARENT_BY_COLUMN[name]
  if (plain) {
    const inner = scopeOf(plain.parent, companyId, depth + 1)
    if (inner && inner !== 'whole') return sql`${q(plain.column)} IN (SELECT ${q('id')} FROM ${q(plain.parent)} WHERE ${inner})`
  }
  for (const fk of cfg.foreignKeys) {
    const ref = fk.reference()
    const parent = getTableName(ref.foreignTable as PgTable)
    if (parent === name) continue
    const inner = scopeOf(parent, companyId, depth + 1)
    if (!inner || inner === 'whole') continue
    return sql`${q(ref.columns[0].name)} IN (SELECT ${q(ref.foreignColumns[0].name)} FROM ${q(parent)} WHERE ${inner})`
  }
  return WHOLE_TABLE.has(name) ? 'whole' : null
}

/** How every table of the schema is handled — what the guard reads. */
export function exportPlan(): Array<{ table: string; how: 'scoped' | 'whole' | 'left-out' | 'unclassified'; reason?: string }> {
  return tables().map((t) => getTableName(t)).sort().map((table) => {
    if (LEFT_OUT[table]) return { table, how: 'left-out' as const, reason: LEFT_OUT[table] }
    const s = scopeOf(table, '_')
    return { table, how: s === 'whole' ? 'whole' as const : s ? 'scoped' as const : 'unclassified' as const }
  })
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}
const csvCell = (v: unknown) => {
  const s = cellText(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const PAGE = 5000

export interface BusinessExportFile { path: string; table: string; rows: number; leftOutColumns: string[] }
export interface BusinessExport { zip: Buffer; filename: string; files: BusinessExportFile[]; rows: number; tablesLeftOut: Array<{ table: string; reason: string }> }

/** One table's rows as CSV text (header + rows), read in pages by id so a big table is never one huge result. */
async function tableCsv(db: any, t: PgTable, where: SQL | 'whole', columns: PgColumn[]): Promise<{ csv: string; rows: number }> {
  const name = getTableName(t)
  const head = columns.map((c) => csvCell(c.name)).join(',')
  const list = sql.join(columns.map((c) => q(c.name)), sql`, `)
  const scope = where === 'whole' ? sql`TRUE` : where
  const hasId = columns.some((c) => c.name === 'id')
  const lines: string[] = []
  let after: string | null = null
  for (;;) {
    const page: SQL = hasId
      ? sql`SELECT ${list} FROM ${q(name)} WHERE (${scope}) ${after === null ? sql`` : sql`AND ${q('id')} > ${after}`} ORDER BY ${q('id')} LIMIT ${PAGE}`
      : sql`SELECT ${list} FROM ${q(name)} WHERE (${scope})`
    const res: any = await db.execute(page)
    const rows: Record<string, unknown>[] = res.rows ?? res
    for (const r of rows) lines.push(columns.map((c) => csvCell(r[c.name])).join(','))
    if (!hasId || rows.length < PAGE) break
    after = String(rows[rows.length - 1].id)
  }
  return { csv: [head, ...lines].join('\r\n') + '\r\n', rows: lines.length }
}

/**
 * The whole business as one ZIP: README.txt, manifest.csv, and a CSV for every table that has rows, the website's
 * (pages, media, posts, portfolio) in website/ and the rest in data/. Never reads another company's rows.
 */
export async function buildBusinessExport(db: any, companyId: string, opts: { now?: Date } = {}): Promise<BusinessExport> {
  const now = opts.now ?? new Date()
  const co: any = await db.execute(sql`SELECT name, slug FROM company WHERE id = ${companyId}`)
  const company = (co.rows ?? co)[0]
  if (!company) throw new Error('Unknown company')
  const entries: Array<{ name: string; data: string }> = []
  const files: BusinessExportFile[] = []
  const tablesLeftOut: Array<{ table: string; reason: string }> = []
  let total = 0
  for (const t of tables().sort((a, b) => getTableName(a).localeCompare(getTableName(b)))) {
    const name = getTableName(t)
    if (LEFT_OUT[name]) { tablesLeftOut.push({ table: name, reason: LEFT_OUT[name] }); continue }
    const where = scopeOf(name, companyId)
    if (!where) throw new Error(`The export does not know how to scope "${name}" to one business`)
    const cols = getTableConfig(t).columns
    const kept = cols.filter((c) => !isSecretColumn(c.name))
    const { csv, rows } = await tableCsv(db, t, where, kept)
    if (!rows) continue
    const path = `${WEBSITE_TABLES.has(name) ? 'website' : 'data'}/${FILE_NAME[name] ?? name}.csv`
    entries.push({ name: path, data: csv })
    files.push({ path, table: name, rows, leftOutColumns: cols.filter((c) => isSecretColumn(c.name)).map((c) => c.name) })
    total += rows
  }
  const day = now.toISOString().slice(0, 10)
  const manifest = ['file,table,rows,columns_left_out', ...files.map((f) => [f.path, f.table, f.rows, f.leftOutColumns.join(' ')].map(csvCell).join(','))].join('\r\n') + '\r\n'
  const readme = [
    `Everything ${company.name} has in Twomiah — exported ${day}.`,
    '',
    'Each list is one CSV file (opens in Excel, Numbers and Google Sheets), in two folders:',
    '  website/  your website: pages.csv (every page and its content), media.csv (every photo and file: name, caption,',
    '            address), and your posts, portfolio, site settings and page views',
    '  data/     everything else: contacts, jobs, quotes, invoices, payments, time, expenses, people, settings and the rest',
    '',
    'manifest.csv lists every file, how many rows it holds, and the columns left out.',
    '',
    'Left out on purpose, for your security: passwords, sign-in and reset tokens, API keys, secrets and the stored',
    'credentials of connected services (Stripe, QuickBooks, Twilio, Google). Sign-in sessions, two-factor secrets and',
    'push-notification endpoints are not exported either.',
    '',
    'Photos and files themselves are not inside this ZIP — media.csv lists each one with its address.',
    '',
  ].join('\r\n')
  const filename = `${String(company.slug || 'business').replace(/[^a-z0-9-]/gi, '-')}-everything-${day}.zip`
  return {
    zip: zip([{ name: 'README.txt', data: readme }, { name: 'manifest.csv', data: manifest }, ...entries], now),
    filename, files, rows: total, tablesLeftOut,
  }
}
