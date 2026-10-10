// CI guard: a light HOVER ground carries its dark partner. (T64)
//
//   "Dispensary: in dark mode, hovering a row on Products or Customers turns it near-white while the text stays
//    light, so the row is unreadable. The rows have no dark:hover style."
//
// It was not two lists — it was ~440 class strings across the fleet: `hover:bg-gray-50` (or 100/200, or slate) in a
// string with no `dark:hover:bg-…`. Unhovered the row is dark and the text light; the moment a pointer crosses it,
// the ground goes near-white under light text. A render sweep never sees it because it never hovers.
//
// Rule, per class STRING (the quoted / template-literal segment the token sits in, not the whole line): a token
// `hover:bg-{gray|slate}-{50|100|200}` (not `group-hover:`) requires a `dark:hover:bg-` in the same string.
// `--fix` adds `dark:hover:bg-slate-800` (50/100) or `dark:hover:bg-slate-700` (200) right after the token.
//   bun scripts/check-dark-hover-pairs.ts [--fix]
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const FIX = process.argv.includes('--fix')
const PARKED = new Set(['crm-automotive', 'crm-homecare'])
const roots = ['packages/tenant-ui/src', ...readdirSync(join(ROOT, 'templates')).filter((t) => t.startsWith('crm') && !PARKED.has(t)).map((t) => `templates/${t}/frontend/src`)].filter((r) => existsSync(join(ROOT, r)))
const walk = (d: string): string[] => readdirSync(join(ROOT, d)).flatMap((f) => { const p = `${d}/${f}`; return statSync(join(ROOT, p)).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : /\.tsx$/.test(f) ? [p] : [] })
const TOKEN = /(^|[\s"'`{])hover:bg-(gray|slate)-(50|100|200)(?![\d/\w-])/g

let bad = 0, fixed = 0, files = 0
for (const f of roots.flatMap(walk)) {
  const raw = readFileSync(join(ROOT, f), 'utf8'), eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  let changed = false
  lines.forEach((line, i) => {
    if (!/hover:bg-(gray|slate)-(50|100|200)/.test(line)) return
    // the class string each token sits in: from the nearest quote/backtick before it to the next one after it
    let out = '', last = 0
    for (const m of line.matchAll(TOKEN)) {
      const at = m.index! + m[1].length, end = at + m[0].length - m[1].length
      const before = line.slice(0, at), after = line.slice(end)
      const open = Math.max(before.lastIndexOf('"'), before.lastIndexOf("'"), before.lastIndexOf('`'))
      const closeRel = after.search(/["'`]/)
      const segment = line.slice(open + 1, closeRel < 0 ? line.length : end + closeRel)
      if (/dark:hover:bg-/.test(segment)) continue
      bad++
      if (!FIX) { console.error(`FAIL: ${f}:${i + 1} — ${m[0].trim()} has no dark:hover:bg- partner`); continue }
      const partner = m[3] === '200' ? 'dark:hover:bg-slate-700' : 'dark:hover:bg-slate-800'
      out += line.slice(last, end) + ' ' + partner
      last = end; fixed++
    }
    if (FIX && last > 0) { lines[i] = out + line.slice(last); changed = true }
  })
  if (changed) { writeFileSync(join(ROOT, f), lines.join(eol)); files++ }
}
if (FIX) { console.log(`dark hover pairs: added ${fixed} partner(s) in ${files} file(s)`); process.exit(0) }
if (bad) { console.error(`\ndark hover pairs: ${bad} light hover ground(s) with no dark partner`); process.exit(1) }
console.log(`dark hover pairs: every light hover ground carries its dark partner, across ${roots.length} frontends`)
