// The data move (apps/unified/server/move) on a contractor tenant: the live template's database built from its own
// migrations, filled with linked rows, moved into an empty unified database, and every value compared after.
import { test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { readLayout, planMove, type Layout, type Query } from '../server/move/schema.ts'
import { moveTenant } from '../server/move/copy.ts'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')

/** A database built as drizzle-kit migrate builds it on a real server: each journal entry's file in order. */
async function built(folder: string) {
  const db = new PGlite()
  const journal = JSON.parse(fs.readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8'))
  for (const e of journal.entries) await db.exec(fs.readFileSync(path.join(folder, e.tag + '.sql'), 'utf8').split('--> statement-breakpoint').join('\n'))
  const query: Query = (text, params) => db.query(text, params as any[]) as any
  return { db, query, layout: await readLayout(query) }
}

let src: Awaited<ReturnType<typeof built>>
let dst: Awaited<ReturnType<typeof built>>

/** Inserts a row with the given values; every other required column gets a plain value of its type. */
async function put(table: string, values: Record<string, unknown>) {
  const t = src.layout.get(table)!
  // Only the columns this template has (its payment, for one, carries no company_id).
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(values).filter(([k]) => t.columns.has(k)))
  for (const c of t.columns.values()) {
    if (c.name in row || c.nullable || c.hasDefault) continue
    row[c.name] = c.type.includes('timestamp') ? '2026-10-01T12:00:00Z' : c.type === 'boolean' ? false : /int|numeric|double|real/.test(c.type) ? 1 : c.type.startsWith('json') ? '{}' : c.type.startsWith('_') ? '{}' : c.type === 'date' ? '2026-10-01' : `${table}-${c.name}`
  }
  const cols = Object.keys(row)
  await src.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]))
}

beforeAll(async () => {
  src = await built(path.join(ROOT, 'templates/crm/backend/db/migrations'))
  dst = await built(path.join(ROOT, 'apps/unified/server/db/migrations'))
  await put('company', { id: 'co1', name: 'Higgs-like Builders', slug: 'higgs-like' })
  await put('user', { id: 'u1', company_id: 'co1', email: 'owner@x.example', first_name: 'Ann', last_name: 'Owner', role: 'owner' })
  await put('user', { id: 'u2', company_id: 'co1', email: 'tech@x.example', first_name: 'Ted', last_name: 'Tech', role: 'field' })
  await put('contact', { id: 'c1', company_id: 'co1', name: 'Pat Client', type: 'client', email: 'pat@x.example', notes: 'Gate code 1234\nDog in yard' })
  await put('project', { id: 'p1', company_id: 'co1', contact_id: 'c1', name: 'Kitchen remodel', number: 'PRJ-1' })
  await put('job', { id: 'j1', company_id: 'co1', contact_id: 'c1', project_id: 'p1', assigned_to_id: 'u2', title: 'Demo', number: 'JOB-1', scheduled_date: '2026-10-21 00:00:00', scheduled_time: '09:00' })
  await put('quote', { id: 'q1', company_id: 'co1', contact_id: 'c1', name: 'Kitchen', number: 'QTE-1', total: '12345.67' })
  await put('quote_line_item', { id: 'ql1', quote_id: 'q1', description: 'Cabinets', quantity: '3', unit_price: '9999999999.99', total: '12345.67' })
  await put('invoice', { id: 'i1', company_id: 'co1', contact_id: 'c1', number: 'INV-1', total: '12345.67', amount_paid: '100.00' })
  await put('invoice_line_item', { id: 'il1', invoice_id: 'i1', description: 'Deposit', quantity: '1', unit_price: '12345.67', total: '12345.67' })
  await put('payment', { id: 'pay1', company_id: 'co1', invoice_id: 'i1', amount: '100.00', method: 'card', paid_at: '2026-10-02 15:30:00.123456' })
  await put('time_entry', { id: 'te1', company_id: 'co1', user_id: 'u2', job_id: 'j1', date: '2026-10-21', hours: '7.5', clock_in: '2026-10-21 14:00:00', clock_out: '2026-10-21 21:30:00' })
  // Every self-link the unified layout has, filled with a row that points at a LATER row (the second pass's case).
  for (const [name, t] of dst.layout) {
    const self = t.foreignKeys.find((fk) => fk.refTable === name)
    if (!self || !src.layout.get(name)?.columns.has(self.column) || !src.layout.get(name)?.columns.has('id')) continue
    const base: Record<string, unknown> = src.layout.get(name)!.columns.has('company_id') ? { company_id: 'co1' } : {}
    try {
      await put(name, { ...base, id: `${name}-b` })
      await put(name, { ...base, id: `${name}-a`, [self.column]: `${name}-b` })
    } catch { /* a table whose other required links this test does not make */ }
  }
}, 180_000)

test("the contractor template's tables move whole: every row, every value, links and all", async () => {
  const plan = planMove(src.layout, dst.layout)
  const report = await moveTenant({
    read: src.query, write: dst.query, plan, target: dst.layout,
    // The one column the copy cannot take from the old layout (diff: ai_receptionist_settings.id).
    fill: (table, column, row) => table === 'ai_receptionist_settings' && column === 'id' ? (row ? `ars_${row.company_id}` : '') : undefined,
  })
  expect(report.mismatches).toEqual([])
  const n = (t: string) => report.tables.find((x) => x.table === t)?.moved
  for (const t of ['company', 'user', 'contact', 'project', 'job', 'quote', 'quote_line_item', 'invoice', 'invoice_line_item', 'payment', 'time_entry']) expect({ t, n: n(t) }).toEqual({ t, n: t === 'user' ? 2 : 1 })

  const one = async (sql: string) => (await dst.query(sql)).rows[0]
  expect(await one(`SELECT notes FROM contact WHERE id = 'c1'`)).toEqual({ notes: 'Gate code 1234\nDog in yard' })
  expect(await one(`SELECT unit_price::text AS p, total::text AS t FROM quote_line_item WHERE id = 'ql1'`)).toEqual({ p: '9999999999.99', t: '12345.67' })
  expect(await one(`SELECT to_char(paid_at, 'YYYY-MM-DD HH24:MI:SS.US') AS at FROM payment WHERE id = 'pay1'`)).toEqual({ at: '2026-10-02 15:30:00.123456' })
  expect(await one(`SELECT assigned_to_id, project_id, contact_id FROM job WHERE id = 'j1'`)).toEqual({ assigned_to_id: 'u2', project_id: 'p1', contact_id: 'c1' })
  // Every self-link made above survived the second pass.
  for (const [name, t] of dst.layout) {
    const self = t.foreignKeys.find((fk) => fk.refTable === name)
    if (!self) continue
    const r = (await dst.query(`SELECT "${self.column}" AS v FROM "${name}" WHERE id = '${name}-a'`)).rows[0]
    if (r) expect({ name, v: r.v }).toEqual({ name, v: `${name}-b` })
  }
}, 120_000)

test('a move that fails leaves the new database as it was', async () => {
  const fresh = await built(path.join(ROOT, 'apps/unified/server/db/migrations'))
  const plan = planMove(src.layout, fresh.layout)
  // Without the id the copy cannot invent, ai_receptionist_settings has none (empty here, so force a failure instead).
  await expect(moveTenant({ read: src.query, write: fresh.query, plan, target: fresh.layout, after: [{ name: 'boom', run: async () => { throw new Error('step failed') } }] })).rejects.toThrow('step failed')
  expect((await fresh.query(`SELECT count(*)::int AS n FROM contact`)).rows[0].n).toBe(0)
  expect((await fresh.query(`SELECT count(*)::int AS n FROM company`)).rows[0].n).toBe(0)
}, 120_000)
