// A Factory handler that reads named columns from `tenants` reads only what it selected. (2026-10-20)
//
// Supabase answers a column that was not selected with nothing — no error. Swapping three select('*') reads for named
// lists left the premium checkout reading tenant.preview_premium_pages from a row without it, so every customer was told
// "Preview must be composed before checkout"; the domain attach and the bought-domain step had each other's lists.
// Here: every `const { data: X } = …from('tenants')…select('a, b, c')` in apps/api/src, and every X.<column> read after
// it up to the end of its handler, must be in the list. select('*') reads everything and is left alone. What a callee
// reads off a row passed whole (registrantGaps(tenant)) is not seen — name it in the select's comment.
//   bun test tests/unified/factory/tenant-select-reads.test.ts
import { test, expect } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const SRC = join(ROOT, 'apps/api/src')
const walk = (d: string, out: string[] = []) => {
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p) }
  return out
}

/** Where the handler a position sits in ends: the next route registered (at any indent) or top-level statement. */
const handlerEnd = (src: string, from: number) => {
  const re = /\n(?:\}\)|\}|export |async function |function |const [a-zA-Z]+ = |\s*[a-z][a-zA-Z]*\.(?:get|post|put|patch|delete|use)\(')/g
  re.lastIndex = from
  const m = re.exec(src)
  return m ? m.index : src.length
}

/** Every read of a column a named tenants select did not ask for, in one file's source. */
export function unselectedReads(src: string, constants: Map<string, string> = new Map()) {
  const out: Array<{ line: number; read: string; list: string }> = []
  let named = 0, everything = 0
  const re = /\{\s*data:\s*([a-zA-Z_]\w*)[^}]*\}\s*=\s*await\s+supabase\s*\.from\('tenants'\)((?:\s*\/\/[^\n]*|\s)*)\.select\((?:'([^']*)'|`([^`]*)`)/g
  for (const m of src.matchAll(re)) {
    const name = m[1]
    let list = m[3] ?? m[4] ?? ''
    if (m[4] !== undefined) list = list.replace(/\$\{([A-Z_]+)\}/g, (_x, k) => constants.get(k) ?? '?')
    if (list.trim() === '*' || list.includes('?')) { everything++; continue }
    named++
    const cols = new Set(list.split(',').map((c) => c.trim()).filter(Boolean))
    const at = m.index! + m[0].length
    // …up to the end of its handler, or where the same name is declared again (a second read, its own select)
    const again = src.slice(at).search(new RegExp(`\\{\\s*data:\\s*${name}\\b`))
    const body = src.slice(at, Math.min(handlerEnd(src, at), again < 0 ? Infinity : at + again))
    const line = src.slice(0, m.index).split('\n').length
    for (const r of new Set([...body.matchAll(new RegExp(`(?<![\\w.])${name}\\??\\.([a-z_][a-z0-9_]*)\\b`, 'g'))].map((x) => x[1]))) {
      if (!cols.has(r)) out.push({ line, read: `${name}.${r}`, list })
    }
  }
  return { out, named, everything }
}

test('every column a Factory handler reads off a named tenants select is in that select', () => {
  const files = walk(SRC)
  const constants = new Map<string, string>()
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/export const ([A-Z_]+_COLUMNS) = '([^']+)'/g)) constants.set(m[1], m[2])
  const problems: string[] = []
  let named = 0
  for (const f of files) {
    const r = unselectedReads(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'), constants)
    named += r.named
    for (const p of r.out) problems.push(`${relative(ROOT, f).replace(/\\/g, '/')}:${p.line} reads ${p.read} but selects only '${p.list}'`)
  }
  // the pattern still matches the code, so this checks something
  expect(named).toBeGreaterThanOrEqual(80)
  expect(problems).toEqual([])
})

test('the rule catches the reads that broke the checkout, and leaves select("*") and a later select alone', () => {
  const broken = [
    "factory.post('/x', async (c) => {",
    "  const { data: tenant } = await supabase.from('tenants').select('id, slug').eq('id', id).maybeSingle()",
    "  if (!tenant.preview_premium_pages) return c.json({}, 422)",
    "  return c.json({ s: tenant.slug })",
    "})",
    "factory.post('/y', async (c) => {",
    "  const { data: tenant } = await supabase.from('tenants').select('*').eq('id', id).maybeSingle()",
    "  return c.json({ p: tenant.preview_premium_pages })",
    "})",
    "async function z() {",
    "  const { data: t } = await supabase.from('tenants').select('id').maybeSingle()",
    "  if (t) await use(t.id)",
    "  const { data: t } = await supabase.from('tenants').select('id, name').maybeSingle()",
    "  return t.name",
    "}",
  ].join('\n')
  const r = unselectedReads(broken)
  expect(r.out.map((x) => x.read)).toEqual(['tenant.preview_premium_pages'])
  expect(r.named).toBe(3)
  expect(r.everything).toBe(1)
})
