// CI guard: placeholder text clears 4.5:1 on the field it sits in, in both themes. (Browser check, 10/17)
//
// Tailwind's own placeholder ink is gray-400 — 2.54:1 on white — and the fleet had ~135 placeholder utilities
// competing with it, several failing in dark mode (dark:placeholder-gray-600 on gray-900 is about 2:1). The rule now:
//   · ONE base rule per template (index.css, @layer base) owns the STANDARD grounds: gray-500 on white/gray-50 in
//     light, slate-400 on slate-800…950 / gray-800…900 in dark. Its pairs are computed here, not asserted.
//   · A placeholder utility appears ONLY on a field whose ground is not standard, and every pair it makes — light
//     ink on light ground, dark ink (or the light utility, which also applies in dark) on dark ground — is computed.
//   · A placeholder utility on a standard ground is refused: it would compete with the base rule for no reason.
// Colours are Tailwind v3's stock gray/slate (the brand remap touches orange/primary/brand only).
//   bun scripts/check-placeholder-contrast.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const HEX: Record<string, string> = {
  white: '#ffffff', black: '#000000',
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db', 'gray-400': '#9ca3af',
  'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827', 'gray-950': '#030712',
  'slate-50': '#f8fafc', 'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8',
  'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a', 'slate-950': '#020617',
}
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => { const [x, y] = [lum(HEX[a]), lum(HEX[b])]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const need = (ink: string, ground: string, where: string) => {
  if (!HEX[ink] || !HEX[ground]) { fail(`${where}: unknown colour ${!HEX[ink] ? ink : ground} — add it to this guard's table`); return }
  const r = ratio(ink, ground)
  if (r < 4.5) fail(`${where}: placeholder ${ink} on ${ground} is ${r.toFixed(2)}:1`)
}

// The base rule's grounds — what a field with no ground of its own sits on in each theme.
const LIGHT_STD = ['white', 'gray-50', 'slate-50']
const DARK_STD = ['slate-800', 'slate-900', 'slate-950', 'gray-800', 'gray-900']
const BASE_LIGHT = 'gray-500', BASE_DARK = 'slate-400'
for (const g of LIGHT_STD) need(BASE_LIGHT, g, `the base rule (light, ${g})`)
for (const g of DARK_STD) need(BASE_DARK, g, `the base rule (dark, ${g})`)

const templates = readdirSync(join(ROOT, 'templates')).filter((t) => (t === 'crm' || t.startsWith('crm-')) && t !== 'crm-automotive')
for (const t of templates) {
  const css = readFileSync(join(ROOT, 'templates', t, 'frontend/src/index.css'), 'utf8').replace(/\r\n/g, '\n')
  const rule = /input::placeholder,\s*\n\s*textarea::placeholder \{\s*\n\s*@apply text-gray-500 dark:text-slate-400;/.exec(css)
  if (!rule) { fail(`templates/${t}: index.css has no base placeholder rule (@apply text-gray-500 dark:text-slate-400)`); continue }
  const layer = css.lastIndexOf('@layer base {', rule.index)
  if (layer < 0 || css.slice(layer, rule.index).split('{').length - css.slice(layer, rule.index).split('}').length !== 1) fail(`templates/${t}: the placeholder rule must sit inside @layer base`)
}

// Every placeholder utility, with the grounds named in the same class string.
const TOK = /(?<![\w:-])(dark:)?placeholder(?:-|:text-)([a-z]+-\d+|white|black)(?![\w-])/g
const files: string[] = []
const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (e === 'node_modules' || e === 'shared') continue; if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|css)$/.test(e)) files.push(p) } }
for (const t of templates) walk(join(ROOT, 'templates', t, 'frontend/src'))
walk(join(ROOT, 'packages/tenant-ui/src'))
let seen = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')
  const rel = f.slice(ROOT.length).replace(/\\/g, '/')
  for (const m of src.matchAll(/(["'`])((?:(?!\1)[^\n])*?placeholder(?:-|:text-)(?:(?!\1)[^\n])*?)\1|@apply ([^;\n]*placeholder[^;\n]*);/g)) {
    const cls = m[2] ?? m[3]
    const toks = [...cls.matchAll(TOK)]
    if (!toks.length) continue
    seen++
    const lightBg = /(?<![:\w-])bg-([a-z]+-\d+|white|transparent)(?![\w-])/.exec(cls)?.[1]
    const darkBg = /dark:bg-([a-z]+-\d+|white|transparent)/.exec(cls)?.[1]
    const lightPh = toks.find((x) => !x[1])?.[2]
    const darkPh = toks.find((x) => x[1])?.[2]
    const lightGround = !lightBg || lightBg === 'transparent' ? 'white' : lightBg
    // A field with no dark ground of its own takes the base rule's dark field (slate-800), unless its light ground is
    // already dark — a permanently dark field keeps it in both themes.
    const permanentlyDark = HEX[lightGround] && lum(HEX[lightGround]) < 0.2 && !darkBg
    const darkGround = darkBg && darkBg !== 'transparent' ? darkBg : permanentlyDark ? lightGround : 'slate-800'
    const where = `${rel}: "${cls.trim().slice(0, 90)}…"`
    const standard = LIGHT_STD.includes(lightGround) && (DARK_STD.includes(darkGround))
    if (standard) { fail(`${where}: a placeholder utility on a standard ground — remove it; the base rule owns this field`); continue }
    need(lightPh ?? BASE_LIGHT, lightGround, `${where} [light]`)
    need(darkPh ?? lightPh ?? BASE_DARK, darkGround, `${where} [dark]`)
  }
}

if (failed) { console.error(`\nplaceholder contrast: ${failed} problem(s)`); process.exit(1) }
console.log(`placeholder contrast: base rule in ${templates.length} templates; ${seen} placeholder utilities, each on a non-standard ground, every pair ≥ 4.5:1`)
