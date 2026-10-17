// CI guard: a CRM's ACTIONS are painted in the company's colour, not in a hard-coded blue.
//
// Every CRM's tailwind.config.js maps `orange`, `primary` and `brand` to the brand palette
// (packages/tenant-ui/src/brandPalette.js), so a button written `bg-orange-600 text-white` follows the
// owner's colour from Settings. A button written `bg-blue-600 text-white` never does: crm-roof shipped
// hundreds of blue buttons, links and focus rings, so a red roofing company got a blue CRM with a red logo.
//
// The rule (white-label policy): what you CLICK, and the "you are here" marker, is the brand. Blue stays
// only where it MEANS something a user must read the same in every company — a status chip, an info
// banner, a chart series, a category colour.
//
// This guard fails on the shapes that are unambiguously an action:
//   1. a filled button  — bg-blue-500/600/700 with text-white in the same class string
//   2. a focus ring     — focus:ring-blue-* / focus:border-blue-* (also focus-visible:, focus-within:)
//   3. a text link      — text-blue-600/700 with hover:underline or hover:text-blue-* in the same string
//
// A site where one of those shapes is genuinely semantic (a preview of Google's own result link, an ad
// platform's call-to-action) is excused by a comment on THE SAME LINE or THE LINE ABOVE:
//     // semantic-blue: <why the blue means something here>
//     {/* semantic-blue: <why> */}
// The excuse is per line, never per file: a comment anywhere else in the file excuses nothing. The
// self-test below plants exactly that and fails the run if it is ever accepted.
//
// templates/crm-automotive is parked (CLAUDE.md) and not scanned.
//
//   bun scripts/check-action-colour-is-brand.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const PARKED = new Set(['crm-automotive'])

/** Quoted class strings on one line: '…', "…" and `…` (a template literal is read whole, ternaries included). */
const SEGMENT = /'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g

type Rule = { name: string; test: (s: string) => boolean }
const RULES: Rule[] = [
  {
    name: 'filled button: bg-blue-500/600/700 under text-white',
    test: (s) => /(?<![\w-])(?:[\w-]+:)*bg-blue-(500|600|700)(?![\d/])/.test(s) && /(?<![\w:-])text-white(?![\w/-])/.test(s),
  },
  {
    name: 'focus ring/border in blue',
    test: (s) => /(?<![\w-])(?:[\w-]+:)*(focus|focus-visible|focus-within):(ring|border|outline)-blue-\d/.test(s),
  },
  {
    name: 'text link: text-blue-600/700 with hover:underline or hover:text-blue-*',
    test: (s) => /(?<![\w:-])text-blue-(600|700)(?![\d/])/.test(s) && /(?<![\w-])(?:dark:)?hover:(underline|text-blue-\d)/.test(s),
  },
]

/** A semantic-blue excuse needs a reason after the colon — a bare marker excuses nothing. */
const EXCUSE = /semantic-blue:\s*\S{3,}/

const isCommentOnly = (line: string) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line)

export function scan(text: string): Array<{ line: number; rule: string; snippet: string }> {
  const lines = text.split(/\r?\n/)
  const out: Array<{ line: number; rule: string; snippet: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isCommentOnly(line) || !/blue-\d/.test(line)) continue
    const hits = new Set<string>()
    for (const seg of line.match(SEGMENT) || []) for (const r of RULES) if (r.test(seg)) hits.add(r.name)
    if (!hits.size) continue
    const excused = EXCUSE.test(line) || (i > 0 && EXCUSE.test(lines[i - 1]))
    if (excused) continue
    for (const rule of hits) out.push({ line: i + 1, rule, snippet: line.trim().slice(0, 160) })
  }
  return out
}

// ── self-test: the rules fire, and the excuse is per line ─────────────────────────────────────────
{
  const must = (name: string, ok: boolean) => { if (!ok) { console.error(`SELF-TEST FAIL: ${name}`); process.exit(2) } }
  const one = (src: string) => scan(src).length
  must('a blue filled button fails', one(`<button className="px-4 bg-blue-600 text-white rounded">Save</button>`) === 1)
  must('…and so does its hover-first spelling', one(`<button className="hover:bg-blue-700 bg-blue-600 text-white">`) === 1)
  must('a brand filled button passes', one(`<button className="px-4 bg-orange-600 text-white hover:bg-orange-700">`) === 0)
  must('a translucent blue wash under white text is not a button', one(`<div className="bg-blue-600/20 text-white">`) === 0)
  must('a blue focus ring fails', one(`<input className="border focus:ring-2 focus:ring-blue-500" />`) === 1)
  must('a blue focus border fails', one(`<input className="border focus:border-blue-500" />`) === 1)
  must('a blue link fails', one(`<a className="text-blue-600 hover:underline">Open</a>`) === 1)
  must('a blue link with a hover colour fails', one(`<a className="text-blue-700 hover:text-blue-800">Open</a>`) === 1)
  must('a blue status chip passes', one(`  scheduled: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',`) === 0)
  must('an info banner passes', one(`<div className="bg-blue-50 border border-blue-200 text-blue-800">Tip</div>`) === 0)
  must('a comment that only DESCRIBES a blue button is not code', one(`// was bg-blue-600 text-white, now the brand`) === 0)
  must('an excuse on the same line passes', one(`<a className="text-blue-700 hover:underline">{t}</a> {/* semantic-blue: Google's own result-link colour */}`) === 0)
  must('an excuse on the line above passes', one(`{/* semantic-blue: the ad platform's own call-to-action */}\n<span className="bg-blue-600 text-white">{cta}</span>`) === 0)
  must('an excuse with no reason excuses nothing', one(`// semantic-blue:\n<span className="bg-blue-600 text-white">x</span>`) === 1)
  // the allow-list cannot become a blanket: an excuse at the top of the file, two lines above, or below,
  // leaves every other site failing
  const file = [
    '// semantic-blue: this whole file is a Google preview',
    'export function A() {',
    '  return <a className="text-blue-600 hover:underline">x</a>',
    '}',
    'const b = "bg-blue-600 text-white"',
    '',
    '// semantic-blue: an excuse two lines up',
    '',
    'const c = "focus:ring-blue-500"',
    'const d = "bg-blue-700 text-white"',
    '// semantic-blue: an excuse BELOW the site',
  ].join('\n')
  must('a file-level excuse leaves every other line failing (per line, not per file)', one(file) === 4)
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
    else if (/\.(tsx?|jsx?)$/.test(e) && !/\.(test|spec)\.[jt]sx?$/.test(e)) files.push(p)
  }
}
for (const r of roots) walk(r)

let failed = 0
const per = new Map<string, number>()
for (const f of files) {
  const rel = relative(ROOT, f).split('\\').join('/')
  for (const h of scan(readFileSync(f, 'utf8'))) {
    failed++
    const key = rel.startsWith('templates/') ? rel.split('/')[1] : 'packages/tenant-ui'
    per.set(key, (per.get(key) || 0) + 1)
    console.error(`FAIL: ${rel}:${h.line} — ${h.rule}\n      ${h.snippet}`)
  }
}

if (failed) {
  console.error(`\n${failed} action(s) painted a fixed blue instead of the brand: ${[...per].map(([k, n]) => `${k} ${n}`).join(', ')}`)
  console.error('Use the brand family (orange-* — the company colour in every CRM). If the blue genuinely MEANS something,')
  console.error('say why on that line or the line above:  // semantic-blue: <reason>')
  process.exit(1)
}
console.log(`action colour is brand: ${files.length} files in ${roots.length} frontends — no blue button, focus ring or link`)
