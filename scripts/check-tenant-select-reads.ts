// CI guard: a handler that reads named columns from `tenants` reads only what it selected. (2026-10-20)
//
// Supabase answers a column that was not selected with nothing — no error. Swapping three select('*') reads for named
// lists left the premium checkout reading tenant.preview_premium_pages from a row without it, so every customer was told
// "Preview must be composed before checkout"; the domain attach and the bought-domain step had each other's lists.
// Here: every `const { data: X } = …from('tenants')…select('a, b, c')` in apps/api/src, and every X.<column> read after
// it up to the end of its handler, must be in the list. select('*') reads everything and is left alone. What a callee
// reads off a row passed whole (registrantGaps(tenant)) is not seen — name it in the select's comment.
//   bun scripts/check-tenant-select-reads.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = decodeURIComponent(new URL('../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1')
const SRC = join(ROOT, 'apps/api/src')
const walk = (d: string, out: string[] = []) => {
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p) }
  return out
}
const constants = new Map<string, string>()
for (const f of walk(SRC)) for (const m of readFileSync(f, 'utf8').matchAll(/export const ([A-Z_]+_COLUMNS) = '([^']+)'/g)) constants.set(m[1], m[2])

let failed = 0, checked = 0, everything = 0, unread = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }
/** Where the handler a position sits in ends: the next route registered (at any indent) or top-level statement. */
const handlerEnd = (src: string, from: number) => {
  const re = /\n(?:\}\)|\}|export |async function |function |const [a-zA-Z]+ = |\s*[a-z][a-zA-Z]*\.(?:get|post|put|patch|delete|use)\(')/g
  re.lastIndex = from
  const m = re.exec(src)
  return m ? m.index : src.length
}

for (const file of walk(SRC)) {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const rel = relative(ROOT, file).replace(/\\/g, '/')
  // { data: tenant } / { data: tenant, error } … .from('tenants') … .select('…' | `${X}…`)
  const re = /\{\s*data:\s*([a-zA-Z_]\w*)[^}]*\}\s*=\s*await\s+supabase\s*\.from\('tenants'\)((?:\s*\/\/[^\n]*|\s)*)\.select\((?:'([^']*)'|`([^`]*)`)/g
  for (const m of src.matchAll(re)) {
    const name = m[1]
    let list = m[3] ?? m[4] ?? ''
    if (m[4] !== undefined) list = list.replace(/\$\{([A-Z_]+)\}/g, (_x, k) => constants.get(k) ?? '?')
    if (list.trim() === '*' || list.includes('?')) { everything++; continue }
    const cols = new Set(list.split(',').map((c) => c.trim()).filter(Boolean))
    const at = m.index! + m[0].length
    // …or where the same name is declared again (a second read, its own select)
    const again = src.slice(at).search(new RegExp(`\\{\\s*data:\\s*${name}\\b`))
    const body = src.slice(at, Math.min(handlerEnd(src, at), again < 0 ? Infinity : at + again))
    const line = src.slice(0, m.index).split('\n').length
    checked++
    const reads = new Set<string>()
    for (const r of body.matchAll(new RegExp(`(?<![\\w.])${name}\\??\\.([a-z_][a-z0-9_]*)\\b`, 'g'))) reads.add(r[1])
    if (!reads.size) unread++
    for (const col of reads) if (!cols.has(col)) fail(`${rel}:${line} reads ${name}.${col} but selects only '${list}'`)
  }
}

if (checked < 10) fail(`only ${checked} named tenants selects found — the pattern no longer matches the code, so this guard checks nothing`)
if (failed) { console.error(`\ntenant select reads: ${failed} read(s) of unselected columns`); process.exit(1) }
console.log(`tenant select reads: ${checked} named selects, every column read is selected (${everything} select every column)`)
