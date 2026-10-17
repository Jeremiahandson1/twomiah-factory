// CI guard: the BRAND colour is used as the brand — never as a meaning, and never where it cannot be read.
//
// Every CRM's tailwind.config.js maps `orange`, `primary` and `brand` to the company's own palette
// (packages/tenant-ui/src/brandPalette.js). check-action-colour-is-brand.ts makes the actions follow it.
// This is the other side of the same rule, plus the two contrast facts the palette cannot guarantee:
//
//   A. MEANING MUST NOT FOLLOW THE BRAND. A status / priority / type / severity colour written orange-*
//      changes with the owner's colour: a green company's "urgent" chip turns green, and a yellow one's
//      measured 3.04:1 (Support Tickets, found by check-light-mode-ink). A colour map entry, or a chip picked
//      by `x === 'value' ? '…'`, may not use orange-/primary-/brand-*. Fixed families carry meaning: amber for
//      warning/high, red for danger/critical. A map whose keys ARE the brand's own roles (primary, link, the
//      confirm dialog's info button) or name a colour tone (`orange:` in a tone palette) is not a meaning.
//      A genuine exception needs `brand-meaning: <reason>` on the same line or the line above — per line.
//
//   B. BRAND TEXT IN DARK MODE IS 200 OR LIGHTER. Measured, not assumed: each dark:text-(orange|primary|brand)-N
//      is resolved through generatePalette() for ten awkward owner colours and measured on the dark grounds
//      the CRMs use (slate-900/800, gray-900/800), or on the string's own dark:bg- when it declares one.
//      300 is 2.73:1 for a pure-blue brand on slate-800; only 200 clears 4.5:1 for every hue.
//
//   C. WHITE TEXT ON THE BRAND clears 4.5:1 for every owner colour. 500/600/700 are clamped for it; 800 is
//      not (3.92:1 for #ffff00), so `hover:bg-orange-800 text-white` fails and hovers to 900 instead.
//
// templates/crm-automotive is parked (CLAUDE.md) and not scanned.
//   bun scripts/check-brand-colour-rules.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PARKED = new Set(['crm-automotive'])
const { generatePalette } = await import(pathToFileURL(ROOT + 'packages/tenant-ui/src/brandPalette.js').href)

const OWNER_COLOURS = ['#f97316', '#fff59d', '#ffffff', '#111111', '#ff0000', '#808080', '#ffff00', '#00ffff', '#2563eb', '#0000ff']
const PALETTES: Array<Record<string, string>> = OWNER_COLOURS.map((c) => generatePalette(c))
const DARK_GROUNDS: Record<string, string> = { 'slate-900': '#0f172a', 'slate-800': '#1e293b', 'gray-900': '#111827', 'gray-800': '#1f2937', 'slate-950': '#020617', 'gray-950': '#030712' }
const AA = 4.5

const lum = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0)
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const over = (fg: string, alpha: number, bg: string) => '#' + [1, 3, 5]
  .map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, '0')).join('')

const BRAND = '(?:orange|primary|brand)'
const SEGMENT = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g
const isCommentOnly = (line: string) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line)
const MEANING_EXCUSE = /brand-meaning:\s*\S{3,}/

/** Keys that name the brand's own roles, or a colour tone — a map keyed by these is not a meaning. */
const BRAND_ROLE_KEYS = new Set(['primary', 'secondary', 'link', 'info', 'brand', 'accent', 'default', 'orange', 'outline', 'ghost'])
/** An action shape inside a ternary is UI state (the selected tab, the active view), not a data meaning. */
const ACTION_SHAPE = new RegExp(`(?<![\\w:-])bg-${BRAND}-(500|600|700)(?![\\d/]).*text-white|text-white.*(?<![\\w:-])bg-${BRAND}-(500|600|700)(?![\\d/])|border-b-2|ring-2`)
const hasBrand = (s: string) => new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:bg|text|border|ring|from|to|via|border-l|border-t|border-b|border-r)-${BRAND}-\\d`).test(s)

export type Hit = { line: number; rule: string; snippet: string }

export function scanMeaning(text: string): Hit[] {
  const lines = text.split(/\r?\n/)
  const out: Hit[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentOnly(line) || !new RegExp(`${BRAND}-\\d`).test(line)) continue
    const bad: string[] = []
    // a colour-map entry: key: '…' | key: { … '…' } — one or several per line
    // (a quoted key only after `{`, `,` or at the start of the line — `? 'bg-green-500' : '…'` is a ternary, not a key)
    for (const m of line.matchAll(/(?:(?:^|[{,\s])([A-Za-z_$][\w]*)|(?:^\s*|[{,]\s*)['"]([A-Za-z_$][\w -]*)['"])\s*:\s*(\{[^{}]*\}|'[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/g)) {
      const key = m[1] || m[2], val = m[3]
      if (BRAND_ROLE_KEYS.has(key) || key === 'className' || key === 'class') continue
      if (!hasBrand(val)) continue
      if (/^\{/.test(val) && /(?:^|[\s{,])(label|value)\s*:\s*['"](primary|link)['"]/.test(val)) continue
      bad.push(`map entry "${key}"`)
    }
    // a chip picked by a data value: x === 'value' ? '…orange…'
    // (only when what is compared is DATA — a status, priority, type… — not UI state such as the open tab or view)
    for (const m of line.matchAll(/\b\w*(?:status|Status|priority|Priority|type|Type|severity|Severity|level|Level|kind|Kind|category|Category|stage|Stage|tier|Tier|source|Source|role|Role)\s*[!=]==\s*['"]([\w -]+)['"]\s*\?\s*('[^'\n]*'|"[^"\n]*"|`[^`\n]*`)/g)) {
      if (hasBrand(m[2]) && !ACTION_SHAPE.test(m[2])) bad.push(`chip for "${m[1]}"`)
    }
    if (!bad.length) continue
    if (MEANING_EXCUSE.test(line) || (i > 0 && MEANING_EXCUSE.test(lines[i - 1]))) continue
    out.push({ line: i + 1, rule: `A. a meaning painted in the brand colour (${bad.join(', ')})`, snippet: line.trim().slice(0, 160) })
  }
  return out
}

const worstOn = (shade: string, ground: (p: Record<string, string>) => string[]) => {
  let w = Infinity, at = ''
  PALETTES.forEach((p, k) => { for (const g of ground(p)) { const r = ratio(p[shade], g); if (r < w) { w = r; at = OWNER_COLOURS[k] } } })
  return { w, at }
}

/** css: an `@apply` line is one class string (index.css .sidebar-link.active was dark:text-brand-400). */
export function scanContrast(text: string, css = false): Hit[] {
  const lines = text.split(/\r?\n/)
  const out: Hit[] = []
  lines.forEach((line, i) => {
    if (isCommentOnly(line) || !new RegExp(`${BRAND}-\\d`).test(line)) return
    for (const seg of css ? (/@apply\b/.test(line) ? [line] : []) : (line.match(SEGMENT) || [])) {
      // B. dark-mode brand ink
      const ownDark = new RegExp(`(?<![\\w-])dark:bg-(${BRAND}|slate|gray)-(\\d{2,3})(?:/(\\d{1,3}))?(?![\\w-])`).exec(seg)
      for (const m of seg.matchAll(new RegExp(`(?<![\\w-])dark:(?:[\\w-]+:)*text-${BRAND}-(\\d{2,3})(?![\\d/])`, 'g'))) {
        const shade = m[1]
        const { w, at } = worstOn(shade, (p) => {
          if (!ownDark) return Object.values(DARK_GROUNDS)
          const fam = ownDark[1], s = ownDark[2], a = ownDark[3]
          const hex = /orange|primary|brand/.test(fam) ? p[s] : DARK_GROUNDS[`${fam}-${s}`]
          if (!hex) return Object.values(DARK_GROUNDS)
          return a ? [DARK_GROUNDS['slate-900'], DARK_GROUNDS['gray-900']].map((g) => over(hex, Number(a) / 100, g)) : [hex]
        })
        if (w < AA) out.push({ line: i + 1, rule: `B. ${m[0]} is ${w.toFixed(2)}:1 in dark mode for an owner colour of ${at} — brand text in dark mode is 200`, snippet: seg.slice(0, 160) })
      }
      // C. white text on a brand ground
      if (!/(?<![\w:-])text-white(?![\w/-])/.test(seg)) continue
      for (const m of seg.matchAll(new RegExp(`(?<![\\w-])((?:[\\w-]+:)*)bg-${BRAND}-(\\d{2,3})(?![\\d/])`, 'g'))) {
        const shade = m[2]
        if (/(^|:)(disabled|placeholder|file):/.test(m[1])) continue
        const { w, at } = worstOn(shade, () => ['#ffffff'])
        if (w < AA) out.push({ line: i + 1, rule: `C. white text on ${m[0]} is ${w.toFixed(2)}:1 for an owner colour of ${at}`, snippet: seg.slice(0, 160) })
      }
    }
  })
  return out
}

// ── self-test ────────────────────────────────────────────────────────────────────────────────────
{
  const must = (name: string, ok: boolean) => { if (!ok) { console.error(`SELF-TEST FAIL: ${name}`); process.exit(2) } }
  const m = (s: string) => scanMeaning(s).length, c = (s: string) => scanContrast(s).length
  must('A: a priority painted orange fails', m(`  urgent: 'bg-orange-500/20 text-orange-800 dark:text-orange-400',`) === 1)
  must('A: …and an inline map with several entries', m(`const P = { low: 'bg-gray-100', high: 'bg-orange-100 text-orange-700' }`) === 1)
  must('A: …and an object entry', m(`  rehab: { label: 'Rehab', cls: 'bg-orange-100 text-orange-800' },`) === 1)
  must('A: …and a chip picked by a status', m(`{s.status === 'partial' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100'}`) === 1)
  must('A: amber is a fixed meaning and passes', m(`  urgent: 'bg-amber-500/20 text-amber-800 dark:text-amber-300',`) === 0)
  must('A: a button variant map is the brand\'s own role', m(`  primary: 'bg-orange-500 text-white hover:bg-orange-600',`) === 0)
  must('A: a tone palette keyed by colour is not a meaning', m(`  orange: 'bg-orange-50 text-orange-700',`) === 0)
  must('A: the selected view (UI state) passes', m(`\${view === 'list' ? 'bg-orange-600 text-white' : 'bg-white'}`) === 0)
  must('A: the selected segment (UI state) passes', m(`\${mode === 'add' ? 'bg-orange-50 text-orange-700' : ''}`) === 0)
  must('A: a ternary\'s quoted branch is not a map key', m(`\${done ? 'bg-green-500' : 'bg-orange-500'}`) === 0)
  must('A: a type option carrying a colour fails', m(`  { value: 'sativa', label: 'Sativa', color: 'bg-orange-100 text-orange-700' },`) === 1)
  must('A: a chip picked by a strain type fails', m(`product.strainType === 'sativa' ? 'bg-orange-100 text-orange-700' :`) === 1)
  must('A: an excuse on the line above passes', m(`// brand-meaning: the owner's own colour marks their own jobs here\n  mine: 'bg-orange-100 text-orange-700',`) === 0)
  must('A: an excuse at the top of the file excuses nothing two lines down',
    m(`// brand-meaning: whole file\nconst x = 1\n  high: 'bg-orange-100 text-orange-700',`) === 1)
  must('A: an excuse with no reason excuses nothing', m(`// brand-meaning:\n  high: 'bg-orange-100',`) === 1)
  must('B: dark brand text 300 fails', c(`<a className="text-orange-600 dark:text-orange-300">x</a>`) === 1)
  must('B: dark brand text 400 on hover fails', c(`<a className="dark:hover:text-orange-400">x</a>`) === 1)
  must('B: dark brand text 200 passes', c(`<a className="text-orange-600 dark:text-orange-200 dark:hover:text-orange-100">x</a>`) === 0)
  must('B: a dark border 300 is not text', c(`<div className="border-orange-200 dark:border-orange-300">`) === 0)
  must('C: white on hover 800 fails', c(`<button className="bg-orange-700 hover:bg-orange-800 text-white">`) === 1)
  must('C: white on 500/600/700/900 passes', c(`<button className="bg-orange-600 hover:bg-orange-700 text-white">`) === 0 && c(`<b className="bg-orange-700 hover:bg-orange-900 text-white">`) === 0)
  must('B: an @apply line in index.css is read', scanContrast(`    @apply dark:bg-brand-500/10 dark:text-brand-400;`, true).length === 1)
  must('C: white on 400 fails', c(`<span className="bg-orange-400 text-white">`) === 1)
}

// ── the walk ────────────────────────────────────────────────────────────────────────────────────
const roots: string[] = []
for (const t of readdirSync(join(ROOT, 'templates'))) {
  if (!t.startsWith('crm') || PARKED.has(t)) continue
  const src = join(ROOT, 'templates', t, 'frontend', 'src')
  if (existsSync(src)) roots.push(src)
}
roots.push(join(ROOT, 'packages', 'tenant-ui', 'src'))
const files: string[] = []
const walk = (d: string) => {
  for (const e of readdirSync(d)) {
    if (e === 'node_modules' || e === 'dist') continue
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(tsx?|jsx?|css)$/.test(e) && !/\.(test|spec)\.[jt]sx?$/.test(e)) files.push(p)
  }
}
for (const r of roots) walk(r)

let failed = 0
const per: Record<string, number> = {}
for (const f of files) {
  const rel = relative(ROOT, f).split('\\').join('/')
  const src = readFileSync(f, 'utf8')
  const css = f.endsWith('.css')
  for (const h of css ? scanContrast(src, true) : [...scanMeaning(src), ...scanContrast(src)]) {
    failed++
    const k = h.rule.slice(0, 1)
    per[k] = (per[k] || 0) + 1
    console.error(`FAIL: ${rel}:${h.line} — ${h.rule}\n      ${h.snippet}`)
  }
}
if (failed) {
  console.error(`\n${failed} brand-colour fault(s): ${Object.entries(per).map(([k, n]) => `${k} ${n}`).join(', ')}`)
  console.error('A: move the meaning to a fixed family (amber for warning/high, red for danger) — or say why on that line: // brand-meaning: <reason>')
  console.error('B: brand text in dark mode is dark:text-orange-200 (100 for its hover).  C: a brand ground under white text is 500, 600, 700 or 900.')
  process.exit(1)
}
console.log(`brand colour rules: ${files.length} files — no meaning in the brand colour, dark-mode brand ink 200, white on the brand readable for every owner colour`)
