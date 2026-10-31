// Migration 0050: field service's named option lines (quote_line_item.option_group) become proposal options before the column is
// dropped (docs/parity/quote-options-unify.md). A database is brought up to 0049, given quotes the old way, then migrated:
//   · each option name on a quote becomes one quote_proposal_option, in the order the names first appear;
//   · the picked one is chosen, and its lines point at it; the lines every option shares are left alone;
//   · a quote that already had proposal options keeps exactly those;
//   · the column is gone.
import { describe, test, expect, beforeAll } from 'bun:test'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { MIGRATIONS } from '../server/db/migrate.ts'

let client: PGlite
const rows = async (q: string) => (await client.query(q)).rows as any[]

beforeAll(async () => {
  // The migrations as they stood before 0050.
  const before = mkdtempSync(path.join(tmpdir(), 'mig0049-'))
  cpSync(MIGRATIONS, before, { recursive: true })
  const journal = JSON.parse(readFileSync(path.join(before, 'meta', '_journal.json'), 'utf8'))
  journal.entries = journal.entries.filter((e: any) => e.idx < 50)
  writeFileSync(path.join(before, 'meta', '_journal.json'), JSON.stringify(journal))
  client = new PGlite()
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: before })
  rmSync(before, { recursive: true, force: true })

  await client.exec(`
    INSERT INTO company (id, name, slug) VALUES ('co1', 'Test Co', 'test-co');
    INSERT INTO quote (id, company_id, number, name) VALUES ('q1', 'co1', 'QTE-1', 'Furnace'), ('q2', 'co1', 'QTE-2', 'Roof'), ('q3', 'co1', 'QTE-3', 'Plain');
    INSERT INTO quote_line_item (id, quote_id, description, quantity, unit_price, total, sort_order, optional, selected, option_group) VALUES
      ('l1', 'q1', 'Service call', 1, 100, 100, 0, false, true, NULL),
      ('l2', 'q1', 'Basic furnace', 1, 3000, 3000, 1, true, false, 'Good'),
      ('l3', 'q1', 'Better furnace', 1, 4500, 4500, 2, true, true, 'Better'),
      ('l4', 'q1', 'Better warranty', 1, 500, 500, 3, true, true, 'Better'),
      ('l5', 'q1', 'Best furnace', 1, 6000, 6000, 4, true, false, 'Best'),
      ('l6', 'q3', 'Tune-up', 1, 200, 200, 0, false, true, NULL);
    INSERT INTO quote_proposal_option (id, quote_id, name, sort_order) VALUES ('o1', 'q2', 'Shingle', 0), ('o2', 'q2', 'Metal', 1);
    INSERT INTO quote_line_item (id, quote_id, description, quantity, unit_price, total, sort_order, optional, selected, option_group, proposal_option_id) VALUES
      ('l7', 'q2', 'Shingles', 1, 7000, 7000, 0, true, false, NULL, 'o1'),
      ('l8', 'q2', 'Metal panels', 1, 12000, 12000, 1, true, false, NULL, 'o2'),
      ('l9', 'q2', 'Gutters', 1, 900, 900, 2, true, false, 'Add-on', NULL);
  `)
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
}, 120_000)

describe('0050 makes named option lines into proposal options', () => {
  test('one option per name, in order, the picked one chosen, its lines pointing at it', async () => {
    const opts = await rows(`SELECT id, name, sort_order, chosen, chosen_at FROM quote_proposal_option WHERE quote_id = 'q1' ORDER BY sort_order`)
    expect(opts.map((o) => [o.name, o.sort_order, o.chosen])).toEqual([['Good', 0, false], ['Better', 1, true], ['Best', 2, false]])
    expect(opts[1].chosen_at).toBeTruthy()
    const lines = await rows(`SELECT l.id, l.optional, l.selected, o.name FROM quote_line_item l LEFT JOIN quote_proposal_option o ON o.id = l.proposal_option_id WHERE l.quote_id = 'q1' ORDER BY l.sort_order`)
    expect(lines.map((l) => [l.id, l.name, l.optional, l.selected])).toEqual([
      ['l1', null, false, true], ['l2', 'Good', true, false], ['l3', 'Better', true, true], ['l4', 'Better', true, true], ['l5', 'Best', true, false],
    ])
  })

  test('a quote that already had proposal options keeps exactly those; a quote with no options is untouched', async () => {
    expect((await rows(`SELECT name FROM quote_proposal_option WHERE quote_id = 'q2' ORDER BY sort_order`)).map((o) => o.name)).toEqual(['Shingle', 'Metal'])
    expect((await rows(`SELECT proposal_option_id FROM quote_line_item WHERE id = 'l9'`))[0].proposal_option_id).toBeNull()
    expect(await rows(`SELECT 1 FROM quote_proposal_option WHERE quote_id = 'q3'`)).toEqual([])
  })

  test('the option-name column is gone', async () => {
    expect(await rows(`SELECT 1 FROM information_schema.columns WHERE table_name = 'quote_line_item' AND column_name = 'option_group'`)).toEqual([])
  })
})
