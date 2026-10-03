// CI guard: contrast that is MEASURED, in both themes, including the pages no other guard can see.
//
// Why this exists. Every other contrast guard in this repo reads class names — it checks that a
// `dark:` partner is present, not that the resulting colours are readable. Two things slip through:
//
//   1. Inline styles. The Lead Inbox is built from a palette object, so there are no classes to pair.
//      T28 "fixed" its source chip by darkening the brand colour until it cleared 4.5:1 against the
//      chip's wash — but computed that wash over WHITE, while the wash is 12% ALPHA and in dark mode
//      composites over the #1e293b card. The ink went darker, the background went darker with it, and
//      the chip fell from 2.56:1 to 1.99:1. A className guard cannot see any of that.
//
//   2. Changing a BACKGROUND under text that was already fine. T28 added dark backgrounds to the
//      warning banners and paired only some of the text on them, leaving yellow-800 on a near-black
//      panel at 2.14:1. Each individual class pair looked correct in isolation.
//
// So this computes the numbers. Colours resolve from the same sources the app uses — the leads palette
// for the inline pages, a Tailwind table for the class pairs — and every pair is checked in LIGHT and
// DARK. A failure prints the measured ratio, not an opinion.
//   bun scripts/check-contrast-measured.ts
import { readFileSync, readdirSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

const AA = 4.5

// ---------------------------------------------------------------- colour maths
const toRgb = (hex: string): number[] => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || ''))
  if (!m) return [0, 0, 0]
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}
const lum = (rgb: number[]) => {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => { const [hi, lo] = [lum(toRgb(a)), lum(toRgb(b))].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
const over = (fg: string, alpha: number, bg: string) => {
  const f = toRgb(fg), b = toRgb(bg)
  return '#' + f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha))).map((v) => v.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- the chip (inline styles)
//
// The real function, run over the real platform colours, against BOTH real card colours. This is the
// check whose absence let the regression ship.
const themeSrc = readFileSync(ROOT + 'packages/tenant-ui/src/leads/theme.ts', 'utf8')
const surfaceOf = (block: string) => /surface: '(#[0-9a-fA-F]{3,6})'/.exec(themeSrc.split(block)[1] || '')?.[1]
const LIGHT_SURFACE = surfaceOf('const LIGHT: LeadPalette = {')
const DARK_SURFACE = surfaceOf('const DARK: LeadPalette = {')
if (!LIGHT_SURFACE || !DARK_SURFACE) fail('could not read the lead palette surfaces from theme.ts')

let chipColors: ((brand: string, surface: string) => { bg: string; text: string }) | null = null
let CHIP_TINT_ALPHA = 0.12
try { ({ chipColors, CHIP_TINT_ALPHA } = await import(ROOT + 'packages/tenant-ui/src/leads/theme.ts')) }
catch (e: any) { fail('theme.ts must export chipColors so the chip can be measured: ' + (e?.message || e)) }

// every brand colour any vertical offers
const platformColours = new Set<string>()
for (const rel of ['packages/tenant-ui/src/leads/types.ts', 'templates/crm-salon/frontend/src/leadsConfig.ts']) {
  try { for (const m of readFileSync(ROOT + rel, 'utf8').matchAll(/color: '(#[0-9a-fA-F]{6})'/g)) platformColours.add(m[1]) } catch { /* optional */ }
}
if (platformColours.size === 0) fail('found no platform brand colours to measure')

if (chipColors && LIGHT_SURFACE && DARK_SURFACE) {
  for (const [theme, surface] of [['light', LIGHT_SURFACE], ['dark', DARK_SURFACE]] as const) {
    for (const brand of platformColours) {
      const { bg, text } = chipColors(brand, surface)
      // The background is computed HERE, from the surface, instead of trusting what chipColors
      // returns. Asking the function for both halves measures it against its own assumption — which
      // is exactly how the original bug shipped, and how the first version of this guard missed it:
      // a function that composites over the wrong colour and then checks its ink against that same
      // wrong colour is perfectly self-consistent and completely wrong. (Salon T29)
      const actualBg = over(brand, CHIP_TINT_ALPHA, surface)
      if (bg.toLowerCase() !== actualBg.toLowerCase()) {
        fail(`lead source chip ${brand} on the ${theme} card: chipColors painted ${bg} but a ${CHIP_TINT_ALPHA * 100}% wash over ${surface} is ${actualBg} — it is compositing over the wrong colour`)
      }
      const r = ratio(text, actualBg)
      if (r < AA) fail(`lead source chip ${brand} on the ${theme} card: ${r.toFixed(2)}:1 (ink ${text} on ${actualBg}) — needs ${AA}:1`)
    }
  }
}

// ---------------------------------------------------------------- class pairs on a changed background
//
// Tailwind values for the classes actually used on the banners below. Kept small deliberately: a table
// nobody maintains is worse than no table, so it covers the pairs this guard checks and nothing else.
const TW: Record<string, string> = {
  'white': '#ffffff', 'slate-900': '#0f172a', 'slate-800': '#1e293b', 'gray-900': '#111827',
  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a', 'yellow-700': '#a16207',
  'yellow-800': '#854d0e', 'yellow-900': '#713f12',
  'green-50': '#f0fdf4', 'green-200': '#bbf7d0', 'green-800': '#166534', 'green-900': '#14532d',
  'sky-50': '#f0f9ff', 'sky-100': '#e0f2fe', 'sky-900': '#0c4a6e',
  'orange-300': '#fdba74', 'orange-600': '#ea580c',
  'blue-300': '#93c5fd', 'blue-600': '#2563eb',
  'red-300': '#fca5a5', 'red-600': '#dc2626',
  'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8',
}
/** "yellow-900/20" → that colour at 20% over the page behind it. */
const resolve = (token: string, behind: string): string | null => {
  const [name, alpha] = token.split('/')
  const hex = TW[name]
  if (!hex) return null
  return alpha ? over(hex, Number(alpha) / 100, behind) : hex
}

// The page behind a panel: white in light mode, the app's dark page in dark mode.
const PAGE = { light: '#ffffff', dark: '#0f172a' }

/**
 * Every banner this repo paints a coloured background on, with the text that sits on it. Listed by hand
 * because that is the point: changing a background means naming the foregrounds on it, which is the step
 * that was skipped.
 */
const BANNERS: Array<{ where: string; bg: { light: string; dark: string }; text: Array<{ what: string; light: string; dark: string }> }> = [
  {
    where: 'Settings › Email Domain — "no domain connected" banner',
    bg: { light: 'yellow-50', dark: 'yellow-900/20' },
    text: [{ what: 'body', light: 'yellow-800', dark: 'yellow-200' }],
  },
  {
    where: 'Settings › Email Domain — verification banner (unverified)',
    bg: { light: 'yellow-50', dark: 'yellow-900/20' },
    text: [{ what: 'body', light: 'yellow-800', dark: 'yellow-200' }],
  },
  {
    where: 'Settings › Email Domain — verification banner (verified)',
    bg: { light: 'green-50', dark: 'green-900/20' },
    text: [{ what: 'body', light: 'green-800', dark: 'green-200' }],
  },
  {
    where: 'Settings › Branded Email — "connect a domain first" banner',
    bg: { light: 'yellow-50', dark: 'yellow-900/20' },
    text: [{ what: 'body', light: 'yellow-800', dark: 'yellow-200' }],
  },
  {
    where: 'Billing — notice banner',
    bg: { light: 'yellow-50', dark: 'yellow-900/20' },
    text: [{ what: 'body', light: 'yellow-800', dark: 'yellow-200' }],
  },
]
// green-200 is not in the small table above unless it is used; add the ones the list needs.
TW['green-200'] = '#bbf7d0'

for (const b of BANNERS) {
  for (const theme of ['light', 'dark'] as const) {
    const bg = resolve(b.bg[theme], PAGE[theme])
    if (!bg) { fail(`${b.where}: unknown colour ${b.bg[theme]}`); continue }
    for (const t of b.text) {
      const fg = resolve(t[theme], bg)
      if (!fg) { fail(`${b.where}: unknown colour ${t[theme]}`); continue }
      const r = ratio(fg, bg)
      if (r < AA) fail(`${b.where} (${theme}) ${t.what}: ${r.toFixed(2)}:1 — ${t[theme]} on ${b.bg[theme]} needs ${AA}:1`)
    }
  }
}

// …and the files must actually carry those pairs, or the table above measures fiction.
//
// The first version of this check only looked at lines carrying the panel's own `dark:bg-…` class. Every
// heading it missed is a CHILD of the panel, on the next line, so a banner whose body was paired and whose
// heading was not passed cleanly — the same shape of miss as the defect itself. The rule is now about ink,
// not panels: on a page that paints coloured panels, dark coloured ink must carry a light partner. A
// ternary needs one per branch, which is why this counts occurrences rather than testing for presence.
const PANELLED = [
  'packages/tenant-ui/src/settings/EmailDomainPage.tsx',
  'packages/tenant-ui/src/settings/EmailAliasesPage.tsx',
  'packages/tenant-ui/src/settings/BillingPage.tsx',
  'packages/tenant-ui/src/settings/AccountOffboardPage.tsx',
]
for (const rel of PANELLED) {
  let src = ''
  try { src = readFileSync(ROOT + rel, 'utf8') } catch { fail(rel + ' is missing'); continue }
  src.split(/\r?\n/).forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    // every piece of dark coloured ink on this line…
    const dark = [...line.matchAll(/(?<!dark:)\btext-(yellow|green|red|sky|blue|orange)-(700|800|900)\b/g)]
    if (!dark.length) return
    for (const hue of new Set(dark.map((m) => m[1]))) {
      const needed = dark.filter((m) => m[1] === hue).length
      const partners = [...line.matchAll(new RegExp('dark:text-' + hue + '-(100|200|300)\\b', 'g'))].length
      if (partners < needed) {
        fail(`${rel.split('/').pop()}:${i + 1} has ${needed} dark ${hue} ink but ${partners} dark-mode partner(s) — ${line.trim().slice(0, 90)}`)
      }
    }
  })
}

// ---------------------------------------------------------------- the BRAND scale
//
// Every template rewrites Tailwind's orange-* with the tenant's own brand hue:
//     tailwind.config.js → colors: { orange: brandPalette }
// so `text-orange-700` means "the brand hue at 33% lightness", not a colour. A shade that reads for a
// blue salon can be unreadable for a yellow one — which is exactly how "Create a free account" measured
// 5.18:1 against a fixed hex and 4.26:1 on the actual tenant. (Salon T30 M1)
//
// So the safe shades are COMPUTED here, from the template's own generator, across all 360 hues.
const hslToHex = (h: number, sPct: number, lPct: number) => {
  const s = sPct / 100, l = lPct / 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1) }
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}
// shade → [max saturation, lightness] — mirrors generatePalette() in each template's tailwind.config.js
const BRAND_SHADES: Record<string, [number, number]> = {
  '200': [100, 80], '300': [95, 65], '400': [95, 55], '600': [100, 40],
  '700': [100, 33], '800': [100, 26], '900': [100, 20],
}
const worstAcrossHues = (shade: string, ground: string) => {
  const [smax, l] = BRAND_SHADES[shade]
  let worst = Infinity
  for (let h = 0; h < 360; h++) worst = Math.min(worst, ratio(hslToHex(h, Math.min(100, smax), l), ground))
  return worst
}
const LIGHT_GROUND = '#ffffff', DARK_GROUND = '#1e293b'
const safeLight = Object.keys(BRAND_SHADES).filter((sh) => worstAcrossHues(sh, LIGHT_GROUND) >= AA)
const safeDark = Object.keys(BRAND_SHADES).filter((sh) => worstAcrossHues(sh, DARK_GROUND) >= AA)
if (!safeLight.length || !safeDark.length) fail('no brand shade is readable for every hue — the palette generator has changed and the rule below needs rewriting')

/**
 * Brand-coloured TEXT. Icons and accents are not in this list — they are not body text and have their
 * own (lower) bar; they are a separate pass, not an assumption that they are fine.
 */
const BRAND_TEXT: Array<{ where: string; file: string; needle: RegExp }> = [
  { where: 'Reviews → Follow Up link', file: 'packages/tenant-ui/src/reviews/ReviewsPage.tsx', needle: /text-orange-900 dark:text-orange-200[^"]*font-medium/ },
  { where: 'Integrations → "Create a free account"', file: 'packages/tenant-ui/src/settings/IntegrationsPage.tsx', needle: /text-orange-900 dark:text-orange-200 hover:underline">Create a free account/ },
]
for (const t of BRAND_TEXT) {
  let src = ''
  try { src = readFileSync(ROOT + t.file, 'utf8') } catch { /* reported below */ }
  if (!src) { fail(t.file + ' is missing'); continue }
  if (!t.needle.test(src)) {
    fail(`${t.where}: brand-coloured text must be text-orange-${safeLight[0]} dark:text-orange-${safeDark[0]} — those are the only shades that clear ${AA}:1 for EVERY tenant hue (worst case ${worstAcrossHues(safeLight[0], LIGHT_GROUND).toFixed(2)}:1 light, ${worstAcrossHues(safeDark[0], DARK_GROUND).toFixed(2)}:1 dark)`)
  }
}

/**
 * White text on the BRAND background — the primary button, and the pass the note above defers.
 *
 * `bg-*-500` carries text-white in 253 places and `bg-*-600` (its hover) in 153, at text-sm
 * font-medium, so the 4.5:1 body-text bar applies. generatePalette used to pin those shades to a
 * fixed HSL lightness, and lightness is not luminance: white on a yellow, lime, green, teal, cyan or
 * even the fallback orange brand came out between 1.5:1 and 3.3:1. Every test tenant uses one blue
 * (6.70:1), so no QA round could see it.
 *
 * The shades are now luminance-clamped at generation. This runs the REAL generatePalette from a
 * template's tailwind.config.js over the whole hue circle — not a hand-copied shade table, because a
 * table is the thing that goes stale.
 */
{
  const hslHex = (h: number) => {
    const s = 1, l = 0.5, a = s * Math.min(l, 1 - l)
    const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1) }
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
  }
  // Every template that ships the palette, not just the base one: each has its OWN copy of
  // generatePalette, so checking one file would leave the other ten free to drift. Parked templates
  // are reported, never failed — see CLAUDE.md.
  const PARKED = new Set(['crm-homecare', 'crm-automotive'])
  let checked = 0
  for (const t of readdirSync(ROOT + 'templates').sort()) {
    const cfgPath = ROOT + 'templates/' + t + '/frontend/tailwind.config.js'
    let src: string
    try { src = readFileSync(cfgPath, 'utf8').replace(/\r/g, '') } catch { continue }
    if (!/function generatePalette/.test(src)) continue
    if (PARKED.has(t)) { console.log(`  (parked, not enforced: ${t})`); continue }

    let palette: ((hex: string) => Record<string, string>) | null = null
    try {
      const body = src.slice(0, src.search(/^(export default|module\.exports)/m))
      palette = new Function(body + '; return generatePalette;')() as (hex: string) => Record<string, string>
    } catch (e: any) {
      fail('could not load generatePalette from ' + cfgPath + ': ' + (e?.message || e))
      continue
    }
    checked++
    let worst = { shade: '', hue: -1, r: Infinity }
    for (let h = 0; h < 360; h++) {
      const p = palette(hslHex(h))
      for (const shade of ['500', '600']) {
        const r = ratio('#ffffff', p[shade])
        if (r < worst.r) worst = { shade, hue: h, r }
      }
    }
    if (worst.r < AA) {
      fail(`${t}: white text on the brand button is ${worst.r.toFixed(2)}:1 at hue ${worst.hue} on shade ${worst.shade} — generatePalette must keep 500 and 600 dark enough for white to clear ${AA}:1 at EVERY hue, or a tenant who picks yellow/lime/green/teal/cyan gets an unreadable primary button`)
    }
  }
  if (checked === 0) fail('no template tailwind.config.js exposed generatePalette — this check silently measured nothing')
}

// ---------------------------------------------------------------- the BRAND scale, used AS INK
//
// The block above measures white ON the brand. This measures the brand AS INK on its own tints,
// which is the other half and was missing: every status badge and chip in the fleet is
// `bg-orange-100 text-orange-700` / `bg-orange-50 text-orange-700`, and those classes resolve to
// brand shades. Live measurement, T41:
//
//   roofing/jobs    "insurance"            3.28:1
//   events/spaces   "Exclusive use"        3.57:1
//   contractor      "Expiring in 30 Days"  3.57:1
//
// Same cause as the white-text clamp — the shades fix LIGHTNESS, and at equal lightness a green is
// far brighter than a navy, so a green/teal/yellow brand's 700 lands near 3.3:1 on its own 100
// while a navy brand's clears easily. generatePalette now clamps it (readableAsInkOn). Run the
// REAL generator over the whole hue circle, template by template, rather than a copied table.
{
  const hslHex = (h: number) => {
    const s = 1, l = 0.5, a = s * Math.min(l, 1 - l)
    const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1) }
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
  }
  const PARKED = new Set(['crm-homecare', 'crm-automotive'])
  let checked = 0
  for (const t of readdirSync(ROOT + 'templates').sort()) {
    const cfgPath = ROOT + 'templates/' + t + '/frontend/tailwind.config.js'
    let src: string
    try { src = readFileSync(cfgPath, 'utf8').replace(/\r/g, '') } catch { continue }
    if (!/function generatePalette/.test(src)) continue
    if (PARKED.has(t)) continue

    let palette: ((hex: string) => Record<string, string>) | null = null
    try {
      const body = src.slice(0, src.search(/^(export default|module\.exports)/m))
      palette = new Function(body + '; return generatePalette;')() as (hex: string) => Record<string, string>
    } catch (e: any) { fail('could not load generatePalette from ' + cfgPath + ': ' + (e?.message || e)); continue }
    checked++
    let worst = { tint: '', hue: -1, r: Infinity }
    for (let h = 0; h < 360; h++) {
      const p = palette(hslHex(h))
      for (const tint of ['50', '100']) {
        const r = ratio(p['700'], p[tint])
        if (r < worst.r) worst = { tint, hue: h, r }
      }
    }
    if (worst.r < AA) {
      fail(`${t}: brand ink on its own tint is ${worst.r.toFixed(2)}:1 at hue ${worst.hue} (shade 700 on ${worst.tint}) — generatePalette must keep 700 dark enough to clear ${AA}:1 against the 100 shade at EVERY hue, or every status chip in the product is unreadable for a green, teal or yellow tenant`)
    }
  }
  if (checked === 0) fail('no template tailwind.config.js exposed generatePalette for the ink check — it silently measured nothing')
}

// ---------------------------------------------------------------- white text on a LITERAL hue
//
// The brand scale is clamped at generation. The literal Tailwind hues are not, and they carry white
// text in a few hundred places. Live measurement, T41:
//
//   landscaping/locations  "New Location"   white on bg-sky-500     2.77:1
//   contractor             "Mark approved"  white on bg-green-500   2.28:1
//   fieldservice TechView  the pause button white on bg-yellow-500  1.93:1
//
// `orange`, `primary` and `brand` are skipped — those three ARE the brand palette, measured above.
{
  const WHITE_ON: Record<string, Record<string, string>> = {
    red: { '400': '#f87171', '500': '#ef4444', '600': '#dc2626' },
    green: { '400': '#4ade80', '500': '#22c55e', '600': '#16a34a' },
    emerald: { '400': '#34d399', '500': '#10b981', '600': '#059669' },
    teal: { '400': '#2dd4bf', '500': '#14b8a6', '600': '#0d9488' },
    cyan: { '400': '#22d3ee', '500': '#06b6d4', '600': '#0891b2' },
    sky: { '400': '#38bdf8', '500': '#0ea5e9', '600': '#0284c7' },
    lime: { '400': '#a3e635', '500': '#84cc16', '600': '#65a30d' },
    yellow: { '400': '#facc15', '500': '#eab308', '600': '#ca8a04' },
    amber: { '400': '#fbbf24', '500': '#f59e0b', '600': '#d97706' },
    blue: { '400': '#60a5fa', '500': '#3b82f6', '600': '#2563eb' },
    indigo: { '400': '#818cf8', '500': '#6366f1' },
    violet: { '400': '#a78bfa', '500': '#8b5cf6' },
    purple: { '400': '#c084fc', '500': '#a855f7' },
    pink: { '400': '#f472b6', '500': '#ec4899' },
    rose: { '400': '#fb7185', '500': '#f43f5e' },
  }
  const PARKED = new Set(['crm-homecare', 'crm-automotive'])
  const walk = (dir: string, out: string[] = []): string[] => {
    let entries: string[]
    try { entries = readdirSync(dir, { withFileTypes: true }).map((d: any) => (d.isDirectory() ? d.name + '/' : d.name)) } catch { return out }
    for (const n of entries) {
      if (n.endsWith('/')) {
        const name = n.slice(0, -1)
        if (['node_modules', 'dist', 'shared', '.git'].includes(name)) continue
        walk(dir + '/' + name, out)
      } else if (n.endsWith('.tsx')) out.push(dir + '/' + n)
    }
    return out
  }
  const files: string[] = []
  for (const t of readdirSync(ROOT + 'templates')) {
    if (!/^crm(-|$)/.test(t) || PARKED.has(t)) continue
    walk(ROOT + 'templates/' + t + '/frontend/src', files)
  }
  walk(ROOT + 'packages/tenant-ui/src', files)

  let offenders = 0
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').replace(/\r\n/g, '\n').split('\n')
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
      if (!/\btext-white\b/.test(line)) return
      for (const m of line.matchAll(/\bbg-([a-z]+)-(400|500|600)\b/g)) {
        const table = WHITE_ON[m[1]]
        if (!table || !table[m[2]]) continue
        const r = ratio('#ffffff', table[m[2]])
        if (r >= AA) continue
        offenders++
        fail(`${f.slice(ROOT.length)}:${i + 1} white text on bg-${m[1]}-${m[2]} is ${r.toFixed(2)}:1 — needs ${AA}:1. Darken the ground (bg-${m[1]}-700 clears it for every hue in this table) rather than keeping a button nobody can read`)
      }
    })
  }
  if (!offenders) console.log(`  white-on-light: ${files.length} screens carry no literal light ground under white text`)
}

if (failed) { console.error(`\ncontrast measured: ${failed} pair(s) below ${AA}:1`); process.exit(1) }
console.log(`contrast measured: brand text on shades ${safeLight[0]}/${safeDark[0]} (the only pair safe for every hue); every chip (${platformColours.size} platform colours x 2 themes) and every coloured banner clears ${AA}:1`)
