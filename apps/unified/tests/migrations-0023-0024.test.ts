// fix-h's two migrations after engine's 0022_job_series: 0023_booking_override (who booked outside the rules) and
// 0024_homecare_invoice_links (home care invoices' private /d/<token>). Both orders a database can arrive in migrate
// cleanly: a fresh one, and one already at 0022 holding rows — which keep their data and get the new columns empty.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { MIGRATIONS } from '../server/db/migrate.ts'

const columns = async (client: PGlite, table: string) =>
  ((await client.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).rows).map((r) => r.column_name)

/** The migrations folder as it stood at `last` (its journal cut there), in a temporary folder. */
function upTo(last: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'))
  fs.mkdirSync(path.join(dir, 'meta'))
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
  journal.entries = journal.entries.filter((e: any) => e.idx <= last)
  for (const e of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${e.tag}.sql`), path.join(dir, `${e.tag}.sql`))
  fs.writeFileSync(path.join(dir, 'meta/_journal.json'), JSON.stringify(journal))
  return dir
}

describe('migrations 0023 and 0024', () => {
  test('the journal runs 0022 job_series, 0023 booking_override, 0024 homecare_invoice_links, in that order', () => {
    const tags = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')).entries.map((e: any) => `${e.idx}:${e.tag}`)
    expect(tags.slice(22, 25)).toEqual(['22:0022_job_series', '23:0023_booking_override', '24:0024_homecare_invoice_links'])
  })

  test('a fresh database migrates to the end with both new columns', async () => {
    const client = new PGlite()
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    expect(await columns(client, 'booking')).toEqual(expect.arrayContaining(['override_by_user_id', 'override_at']))
    expect(await columns(client, 'invoices')).toContain('public_token')
    expect(await columns(client, 'job_series')).toContain('frequency')
  }, 120_000)

  test('a database already at 0022, with a booking and a home care invoice, migrates on and keeps them', async () => {
    const client = new PGlite()
    await migrate(drizzle(client), { migrationsFolder: upTo(22) })
    expect(await columns(client, 'booking')).not.toContain('override_at')
    expect(await columns(client, 'invoices')).not.toContain('public_token')
    await client.exec(`
      INSERT INTO company (id, name, slug) VALUES ('co1', 'Old Co', 'old-co');
      INSERT INTO booking (id, company_id, start_at, end_at, customer_name, customer_email, token) VALUES ('b1', 'co1', now(), now() + interval '1 hour', 'Pat', 'pat@example.com', 'tok1');
    `)
    // A row with every column the table insists on, filled plainly (the home care tables as they stood at 0022).
    const insertFilled = async (table: string, values: Record<string, unknown>) => {
      const required = (await client.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 AND is_nullable = 'NO' AND column_default IS NULL`, [table])).rows
      for (const c of required) if (!(c.column_name in values)) values[c.column_name] = /timestamp|date/.test(c.data_type) ? new Date().toISOString() : /int|numeric|double|real/.test(c.data_type) ? 0 : /bool/.test(c.data_type) ? false : `x-${c.column_name}`
      const keys = Object.keys(values)
      await client.query(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(values))
    }
    await insertFilled('clients', { id: 'cl1', company_id: 'co1' })
    await insertFilled('invoices', { id: 'inv1', company_id: 'co1', client_id: 'cl1' })
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    const b = (await client.query<any>(`SELECT customer_name, override_by_user_id, override_at FROM booking WHERE id = 'b1'`)).rows[0]
    expect(b).toEqual({ customer_name: 'Pat', override_by_user_id: null, override_at: null })
    const inv = (await client.query<any>(`SELECT id, public_token FROM invoices WHERE id = 'inv1'`)).rows[0]
    expect(inv).toEqual({ id: 'inv1', public_token: null })
    // Running again is a no-op.
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
  }, 120_000)
})
