// CI guard: an arrow-only button says what it does to a screen reader. (T64)
//
//   "Field service: the Contacts previous/next buttons have no accessible name for screen readers."
//
// A <button> whose only content is a ChevronLeft / ChevronRight icon must carry aria-label or title — page, day and
// week arrows and Back buttons, 36 of them when this was written. The opening tag is read with brace and quote depth,
// because a regex stops at the `>` of `onClick={() => …}` and silently skips the very buttons it is looking for.
//   bun scripts/check-arrow-buttons-named.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PARKED = new Set(['crm-automotive', 'crm-homecare'])
const roots = ['packages/tenant-ui/src', ...readdirSync(join(ROOT, 'templates')).filter((t) => t.startsWith('crm') && !PARKED.has(t)).map((t) => `templates/${t}/frontend/src`)]
const walk = (d: string): string[] => readdirSync(join(ROOT, d)).flatMap((f) => { const p = `${d}/${f}`; return statSync(join(ROOT, p)).isDirectory() ? (f === 'node_modules' ? [] : walk(p)) : f.endsWith('.tsx') ? [p] : [] })

/** index just past the `>` that closes the tag opened at `start`, or -1 */
function tagEnd(s: string, start: number): number {
  let depth = 0, q: string | null = null
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === q && s[i - 1] !== '\\') q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') depth--
    else if (ch === '>' && depth === 0) return i + 1
  }
  return -1
}

let n = 0, seen = 0
for (const f of roots.flatMap(walk)) {
  const s = readFileSync(join(ROOT, f), 'utf8')
  let i = 0
  while ((i = s.indexOf('<button', i)) >= 0) {
    if (!/[\s>]/.test(s[i + 7] || '')) { i += 7; continue }
    const end = tagEnd(s, i + 7)
    if (end < 0) break
    const attrs = s.slice(i + 7, end - 1)
    const close = s.indexOf('</button>', end)
    if (attrs.trimEnd().endsWith('/') || close < 0) { i = end; continue }
    const inner = s.slice(end, close).replace(/\s+/g, ' ').trim()
    const iconOnly = /^<Chevron(Left|Right)\b/.test(inner) && inner.endsWith('/>') && tagEnd(inner, 1) === inner.length
    if (iconOnly) {
      seen++
      if (!/aria-label|title=/.test(attrs)) { n++; console.error(`FAIL: ${f}:${s.slice(0, i).split('\n').length} — an arrow-only button with no aria-label`) }
    }
    i = end
  }
}
if (seen < 30) { console.error(`arrow buttons: only ${seen} found — the walk is not reading the screens`); process.exit(1) }
if (n) { console.error(`\narrow buttons: ${n} with no accessible name`); process.exit(1) }
console.log(`arrow buttons: all ${seen} arrow-only buttons are named, across ${roots.length} frontends`)
