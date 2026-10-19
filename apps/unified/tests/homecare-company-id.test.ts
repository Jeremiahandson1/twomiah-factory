// Every row home-care code writes into a table that has company_id says which company it is (RULEBOOK §2,
// docs/UNIFIED_HOMECARE_PLAN.md decision 2). The home-care suite's sandbox fills a missing company_id with the one
// company, as the cutover data move does for the old rows (tests/unified/harness/runUnifiedSuite.ts `homecare`), so
// the suite alone would not see a route that forgot it; this reads the code instead.
//
// What it reads: every Drizzle `.insert(<table>).values(...)` and every raw `INSERT INTO <table> (...)` under
// server/crm/homecare and server/data/homecare*.ts. A Drizzle insert passes when its values (or, when they are a
// variable, that variable's own declaration) name companyId; a raw insert when its column list names company_id.
import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from '../server/db/schema/index.ts'

const SERVER = path.join(import.meta.dir, '..', 'server')

/** Export name → SQL name, and the SQL names of the tables that carry company_id. */
const byExport = new Map<string, string>()
const withCompany = new Set<string>()
for (const [name, value] of Object.entries(schema)) {
  try {
    const cfg = getTableConfig(value as any)
    byExport.set(name, cfg.name)
    if (cfg.columns.some((c) => c.name === 'company_id')) withCompany.add(cfg.name)
  } catch { /* not a table */ }
}

function files(dir: string, keep: (f: string) => boolean): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e)
    if (statSync(p).isDirectory()) out.push(...files(p, keep))
    else if (keep(p)) out.push(p)
  }
  return out
}

/** The text of the call's argument list starting at `open` (the index of its '('), balanced. */
function argument(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) return src.slice(open + 1, i)
  }
  return src.slice(open + 1)
}

export function insertsWithoutCompany(src: string, file: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\.insert\((\w+)\)\s*\.values\(/g)) {
    const table = byExport.get(m[1])
    if (!table || !withCompany.has(table)) continue
    const arg = argument(src, m.index! + m[0].length - 1).trim()
    let named = /\bcompanyId\b/.test(arg)
    // values(row) / values(rows): the variable's own declaration names it.
    if (!named && /^[\w.]+$/.test(arg)) {
      const decl = new RegExp(`(?:const|let)\\s+${arg.split('.')[0]}\\b[^=]*=`).exec(src)
      if (decl) named = /\bcompanyId\b/.test(src.slice(decl.index, decl.index + 2000).split(/\n\s*\n/)[0])
    }
    if (!named) out.push(`${file}: insert into ${table} (${m[1]}) without companyId`)
  }
  for (const m of src.matchAll(/INSERT\s+INTO\s+"?(\w+)"?\s*\(([^)]*)\)/gi)) {
    if (withCompany.has(m[1]) && !/\bcompany_id\b/.test(m[2])) out.push(`${file}: INSERT INTO ${m[1]} without company_id`)
  }
  return out
}

describe('home-care writes say which company', () => {
  test('every insert into a table with company_id sets it', () => {
    const scan = [
      ...files(path.join(SERVER, 'crm', 'homecare'), (f) => f.endsWith('.ts')),
      ...files(path.join(SERVER, 'data'), (f) => /[\\/]homecare\w*\.ts$/.test(f)),
    ]
    expect(scan.length).toBeGreaterThan(10)
    const problems = scan.flatMap((f) => insertsWithoutCompany(readFileSync(f, 'utf8'), path.relative(SERVER, f)))
    expect(problems).toEqual([])
  })

  test('the check catches each kind of miss (so a green run means something)', () => {
    expect(insertsWithoutCompany("await db.insert(clients).values({ firstName: 'A' })", 'x')).toHaveLength(1)
    expect(insertsWithoutCompany("const row = { firstName: 'A' }\nawait db.insert(clients).values(row)", 'x')).toHaveLength(1)
    expect(insertsWithoutCompany("await q.execute(sql`INSERT INTO clients (first_name) VALUES (${a})`)", 'x')).toHaveLength(1)
    expect(insertsWithoutCompany("await db.insert(clients).values({ companyId, firstName: 'A' })", 'x')).toEqual([])
    expect(insertsWithoutCompany("await q.execute(sql`INSERT INTO clients (company_id, first_name) VALUES (${c}, ${a})`)", 'x')).toEqual([])
  })
})
