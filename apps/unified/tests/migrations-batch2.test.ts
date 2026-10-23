// Batch 2's migrations, one chain after engine's 0022_job_series: 0023 booking_override and 0024 homecare_invoice_links
// (fix-h), 0025 commission_plan_people (fix-f), 0026 financing (fix-i), 0027 one_time_zone (fix-e). Each branch made its
// own on an older engine, so their journal stamps and snapshot parents were re-set when they were put together.
//
// Drizzle applies by TIMESTAMP: a migration stamped earlier than the last one a database has applied is skipped for
// ever, silently. fix-f's 0025 was stamped before fix-h's 0023 and fix-e's 0027 before fix-i's 0026 — so the order of the
// stamps is held here, and proven on databases that stopped at every step of the chain.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { MIGRATIONS } from '../server/db/migrate.ts'

const BATCH2 = ['22:0022_job_series', '23:0023_booking_override', '24:0024_homecare_invoice_links', '25:0025_commission_plan_people', '26:0026_financing', '27:0027_one_time_zone']
/** Every migration there is: batch 2's chain, and whatever came after it (0028_site_drafts, fix-k). */
const ALL = ((): number => JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
  .entries.length)()
const journal = () => JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
const snapshot = (idx: number) => JSON.parse(fs.readFileSync(path.join(MIGRATIONS, `meta/${String(idx).padStart(4, '0')}_snapshot.json`), 'utf8'))

const columns = async (client: PGlite, table: string) =>
  ((await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).rows).map((r) => r.column_name)
const applied = async (client: PGlite) => Number((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)).rows[0].n)

/** The migrations folder as it stood at `last` (its journal cut there), in a temporary folder. */
function upTo(last: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-b2-'))
  fs.mkdirSync(path.join(dir, 'meta'))
  const j = journal()
  j.entries = j.entries.filter((e: any) => e.idx <= last)
  for (const e of j.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`))
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(j))
  return dir
}

/** A row with every column the table insists on, filled plainly (the tables as they stood at that migration). */
async function insertFilled(client: PGlite, table: string, values: Record<string, unknown>) {
  const required = (await client.query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`, [table])).rows
  for (const c of required) if (!(c.column_name in values)) values[c.column_name] = /timestamp|date/.test(c.data_type) ? new Date().toISOString() : /int|numeric|double|real/.test(c.data_type) ? 0 : /bool/.test(c.data_type) ? false : /json/.test(c.data_type) ? '{}' : `x-${c.column_name}`
  const keys = Object.keys(values)
  await client.query(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(values))
}

describe('batch 2 migration chain, 0022 to 0027', () => {
  test('the journal runs 0022 to 0027 in that order, each stamped after the one before', () => {
    const entries = journal().entries
    expect(entries.map((e: any) => `${e.idx}:${e.tag}`).slice(22, 28)).toEqual(BATCH2)
    expect(entries.map((e: any) => e.idx)).toEqual(entries.map((_: any, i: number) => i))
    for (let i = 1; i < entries.length; i++) expect(entries[i].when).toBeGreaterThan(entries[i - 1].when)
  })

  test('each snapshot names the one before it as its parent, and every tag has its SQL and snapshot', () => {
    const entries = journal().entries
    for (const e of entries) {
      expect(fs.existsSync(path.join(MIGRATIONS, `${e.tag}.sql`))).toBe(true)
      expect(fs.existsSync(path.join(MIGRATIONS, `meta/${String(e.idx).padStart(4, '0')}_snapshot.json`))).toBe(true)
    }
    for (let i = 1; i < entries.length; i++) expect(snapshot(i).prevId).toBe(snapshot(i - 1).id)
    // The last snapshot carries every batch-2 schema change (drizzle-kit generates the next migration from it).
    const last = snapshot(entries.length - 1).tables
    expect(Object.keys(last['public.booking'].columns)).toEqual(expect.arrayContaining(['override_by_user_id', 'override_at']))
    expect(Object.keys(last['public.invoices'].columns)).toContain('public_token')
    expect(Object.keys(last['public.commission_plan'].columns)).toContain('user_ids')
    expect(Object.keys(last['public.financing_application'].columns)).toEqual(expect.arrayContaining(['quote_id', 'invoice_id', 'funded_at']))
    expect(last['public.financing_event']).toBeDefined()
  })

  test('a fresh database migrates through 0027', async () => {
    const client = new PGlite()
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    expect(await applied(client)).toBe(ALL)
    expect(await columns(client, 'booking')).toEqual(expect.arrayContaining(['override_by_user_id', 'override_at']))
    expect(await columns(client, 'invoices')).toContain('public_token')
    expect(await columns(client, 'commission_plan')).toContain('user_ids')
    expect(await columns(client, 'financing_application')).toEqual(expect.arrayContaining(['quote_id', 'invoice_id', 'job_id', 'funded_amount']))
    expect(await columns(client, 'financing_event')).toContain('event_id')
    await client.close()
  }, 180_000)

  test('a database at 0022 holding rows migrates on through 0027, keeps them, and a re-run changes nothing', async () => {
    const client = new PGlite()
    await migrate(drizzle(client), { migrationsFolder: upTo(22) })
    expect(await applied(client)).toBe(23)
    expect(await columns(client, 'commission_plan')).not.toContain('user_ids')
    expect(await columns(client, 'financing_event')).toEqual([])
    await client.exec(`
      INSERT INTO company (id, name, slug) VALUES ('co1', 'Old Co', 'old-co');
      INSERT INTO booking (id, company_id, start_at, end_at, customer_name, customer_email, token) VALUES ('b1', 'co1', now(), now() + interval '1 hour', 'Pat', 'pat@example.com', 'tok1');
    `)
    await insertFilled(client, 'booking_settings', { id: 'bs1', company_id: 'co1', timezone: 'America/Denver' })
    await insertFilled(client, 'commission_plan', { id: 'cp1', company_id: 'co1', name: 'Sales 10%' })
    await insertFilled(client, 'contact', { id: 'ct1', company_id: 'co1', name: 'Pat' })
    await insertFilled(client, 'financing_application', { id: 'fa1', company_id: 'co1', contact_id: 'ct1' })
    await insertFilled(client, 'financing_application', { id: 'fa2', company_id: 'co1', contact_id: 'ct1' })
    await insertFilled(client, 'clients', { id: 'cl1', company_id: 'co1' })
    await insertFilled(client, 'invoices', { id: 'inv1', company_id: 'co1', client_id: 'cl1' })

    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    expect(await applied(client)).toBe(ALL)
    // 0023/0024: the old rows keep their data, the new columns empty.
    expect((await client.query<any>(`SELECT customer_name, override_at FROM booking WHERE id = 'b1'`)).rows[0]).toEqual({ customer_name: 'Pat', override_at: null })
    expect((await client.query<any>(`SELECT id, public_token FROM invoices WHERE id = 'inv1'`)).rows[0]).toEqual({ id: 'inv1', public_token: null })
    // 0025: the plan is kept, for no one in particular yet.
    expect((await client.query<any>(`SELECT name, user_ids FROM commission_plan WHERE id = 'cp1'`)).rows[0]).toEqual({ name: 'Sales 10%', user_ids: [] })
    // 0026: both applications kept, their new links empty.
    expect((await client.query<any>(`SELECT id, quote_id, invoice_id FROM financing_application ORDER BY id`)).rows).toEqual([
      { id: 'fa1', quote_id: null, invoice_id: null }, { id: 'fa2', quote_id: null, invoice_id: null }])
    // 0027: a company with no zone takes its booking zone.
    expect((await client.query<any>(`SELECT timezone FROM company WHERE id = 'co1'`)).rows[0]).toEqual({ timezone: 'America/Denver' })

    const before = {
      audit: (await client.query<any>(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n,
      company: (await client.query<any>(`SELECT timezone, updated_at FROM company WHERE id = 'co1'`)).rows[0],
    }
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    expect(await applied(client)).toBe(ALL)
    expect((await client.query<any>(`SELECT count(*)::int AS n FROM audit_log`)).rows[0].n).toBe(before.audit)
    expect((await client.query<any>(`SELECT timezone, updated_at FROM company WHERE id = 'co1'`)).rows[0]).toEqual(before.company)
    await client.close()
  }, 180_000)

  // The stamp trap: a database that stopped at any step of the chain must take every later one. A later migration
  // stamped before an applied one would be skipped here, and the count would come up short.
  for (const stop of [23, 24, 25, 26]) {
    test(`a database that stopped at ${String(stop).padStart(4, '0')} takes every later migration`, async () => {
      const client = new PGlite()
      await migrate(drizzle(client), { migrationsFolder: upTo(stop) })
      expect(await applied(client)).toBe(stop + 1)
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
      expect(await applied(client)).toBe(ALL)
      expect(await columns(client, 'commission_plan')).toContain('user_ids')
      expect(await columns(client, 'financing_event')).toContain('event_id')
      await client.close()
    }, 180_000)
  }
})

describe('0028 site drafts (fix-k): every existing page, post, work and settings row is live, with no draft', () => {
  test('a database at 0027 holding website rows migrates on, keeps them as they were, and has nothing unpublished', async () => {
    const client = new PGlite()
    await migrate(drizzle(client), { migrationsFolder: upTo(27) })
    expect(await columns(client, 'page')).not.toContain('draft')
    await client.exec(`INSERT INTO company (id, name, slug) VALUES ('co1', 'Old Co', 'old-co');`)
    await insertFilled(client, 'website', { id: 'w1', company_id: 'co1', tagline: 'Live words' })
    await insertFilled(client, 'page', { id: 'p1', company_id: 'co1', slug: 'about', title: 'About', sections: JSON.stringify([{ type: 'hero', variant: 'x', data: { title: 'Kept' } }]) })
    await insertFilled(client, 'post', { id: 'po1', company_id: 'co1', slug: 'news', title: 'News', body: 'Kept body' })
    await insertFilled(client, 'portfolio_item', { id: 'pi1', company_id: 'co1', slug: 'oak', title: 'Oak' })
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    for (const t of ['page', 'post', 'portfolio_item', 'website']) {
      expect(await columns(client, t)).toContain('draft')
      expect((await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE draft IS NOT NULL`)).rows[0].n).toBe(0)
    }
    expect((await client.query<{ s: string }>(`SELECT sections::text AS s FROM page WHERE id = 'p1'`)).rows[0].s).toContain('Kept')
    expect((await client.query<{ b: string }>(`SELECT body AS b FROM post WHERE id = 'po1'`)).rows[0].b).toBe('Kept body')
    expect((await client.query<{ t: string }>(`SELECT tagline AS t FROM website WHERE id = 'w1'`)).rows[0].t).toBe('Live words')
    await client.close()
  }, 180_000)
})
