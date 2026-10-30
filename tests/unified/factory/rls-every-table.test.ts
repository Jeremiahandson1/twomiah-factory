// Every Factory table has row-level security ON (found 2026-10-29: five tables were created without it). The staff dashboard runs
// Supabase's PUBLIC key in the browser; a public-schema table without RLS is open through Supabase's REST API to anyone holding it.
// The SQL files are the record of what the database holds, so a table created anywhere in them must be switched on somewhere in them.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

const API = path.resolve(import.meta.dir, '../../../apps/api')
const sqlFiles = (dir: string): string[] => fs.existsSync(dir)
  ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? sqlFiles(path.join(dir, e.name)) : e.name.endsWith('.sql') ? [path.join(dir, e.name)] : [])
  : []
const read = (f: string) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n').replace(/--.*$/gm, '')

describe('row-level security', () => {
  const all = [path.join(API, 'schema.sql'), ...sqlFiles(path.join(API, 'migrations'))].map(read).join('\n')
  const created = new Set([...all.matchAll(/create table (?:if not exists )?(?:public\.)?"?([a-z_0-9]+)"?/gi)].map((m) => m[1].toLowerCase()))
  const secured = new Set([...all.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s+enable\s+row\s+level\s+security/gi)].map((m) => m[1].toLowerCase()))
  test('the SQL files create tables (the scan is looking in the right place)', () => {
    expect(created.size).toBeGreaterThan(10)
  })
  test('every table the Factory creates has row-level security switched on', () => {
    expect([...created].filter((t) => !secured.has(t)).sort()).toEqual([])
  })
  test('the dashboard reads only tables it is meant to read with the public key', () => {
    const files: string[] = []
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.tsx?$/.test(e.name)) files.push(p) } }
    walk(path.resolve(import.meta.dir, '../../../apps/platform/src'))
    const read = new Set(files.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/supabase\s*\.from\('([a-z_]+)'\)/g)].map((m) => m[1])))
    expect([...read].sort()).toEqual(['factory_jobs', 'tenants'])
  })
})
