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
import { readFileSync } from 'node:fs'
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

if (failed) { console.error(`\ncontrast measured: ${failed} pair(s) below ${AA}:1`); process.exit(1) }
console.log(`contrast measured: every chip (${platformColours.size} platform colours x 2 themes) and every coloured banner clears ${AA}:1`)
