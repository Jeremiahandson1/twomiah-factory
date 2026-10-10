// CI guard: an icon-only button says what it does to a screen reader. (T64 arrows → T65 every icon)
//
//   "Field service: the Contacts previous/next buttons have no accessible name for screen readers."
//
// That was 36 arrows; the same was true of 237 more — the trash cans, pencils, X's, refresh and send buttons a screen
// reader announced as just "button". A <button> whose content can render only icons — one icon, icons in wrapper
// divs, or `{on ? <IconA/> : <IconB/>}` — must carry aria-label (or title), named for what it DOES there — an X closes a window in one place and removes a line item in another, so the
// name cannot come from the icon. The opening tag is read with brace and quote depth, because a regex stops at the `>`
// of `onClick={() => …}` and silently skips the very buttons it is looking for.
//   bun scripts/check-icon-buttons-named.ts
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

/** index just past the `}` that closes the `{` at `start` */
function braceEnd(s: string, start: number): number {
  let depth = 0, q: string | null = null
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === q && s[i - 1] !== '\\') q = null; continue }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i + 1
  }
  return -1
}

/**
 * True when the content can render NOTHING a screen reader reads: only icon components, lowercase wrapper tags
 * around them, and `{…}` expressions whose every branch is an icon — `{on ? <ToggleRight/> : <ToggleLeft/>}`,
 * `{busy && <Spinner/>}`. (T65 live: roof's toggle and copy buttons, and the dispensary avatar menu
 * `<div><User/></div><ChevronDown/>`, all passed the one-self-closing-icon rule and all read as just "button".)
 */
function rendersNoText(inner: string): boolean {
  let icons = 0, out = '', i = 0
  while (i < inner.length) {
    const ch = inner[i]
    if (ch === '<') {
      const end = tagEnd(inner, i + 1)
      if (end < 0) return false
      const tag = inner.slice(i, end)
      if (/^<[A-Z][\w.]*\b/.test(tag)) { if (!tag.endsWith('/>')) return false; icons++ }
      else if (!/^<\/?[a-z][\w-]*\b/.test(tag)) return false
      i = end
    } else if (ch === '{') {
      const end = braceEnd(inner, i)
      if (end < 0) return false
      const body = inner.slice(i + 1, end - 1).trim()
      if (!/^\/\*[\s\S]*\*\/$/.test(body)) {
        // every branch an icon: strip the icons and what is left must end in `? :` or `&&`
        let rest = '', k = 0, found = 0
        while (k < body.length) {
          if (body[k] === '<' && /[A-Z]/.test(body[k + 1] || '')) { const e = tagEnd(body, k + 1); if (e < 0 || !body.slice(k, e).endsWith('/>')) return false; found++; rest += ' '; k = e }
          else rest += body[k++]
        }
        rest = rest.replace(/\s+/g, ' ').trim()
        if (!found || !(/\? :$/.test(rest) || /&&$/.test(rest))) return false
        icons += found
      }
      i = end
    } else { out += ch; i++ }
  }
  return icons > 0 && !out.trim()
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
    // icons and wrappers only — no text a screen reader could fall back on
    if (rendersNoText(inner)) {
      seen++
      if (!/aria-label|title=/.test(attrs)) { n++; console.error(`FAIL: ${f}:${s.slice(0, i).split('\n').length} — ${inner.slice(0, 90)} — button with no aria-label`) }
    }
    i = end
  }
}
if (seen < 200) { console.error(`icon buttons: only ${seen} found — the walk is not reading the screens`); process.exit(1) }
if (n) { console.error(`\nicon buttons: ${n} with no accessible name`); process.exit(1) }
console.log(`icon buttons: all ${seen} icon-only buttons are named, across ${roots.length} frontends`)
