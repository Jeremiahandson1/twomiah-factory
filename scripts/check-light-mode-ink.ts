// CI guard: the AI Receptionist and Support screens are MEASURED readable in light mode.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// T42 #10. The owner measured the AI Receptionist title at 1.05:1 in light mode — white words on a
// white page — and reported Support's stats and chips as unreadable in the same theme. Both had
// survived every round, for two different reasons:
//
//   · check-unpaired-dark-ink.ts looks for the OPPOSITE shape, near-black ink with no dark partner.
//     The AI Receptionist page has none of that, so there was nothing there for it to find.
//   · check-support-page-theme.ts knows exactly two shapes, `bg-gray-800/900` and `text-white`. The
//     stats were `text-blue-400` and the chips `bg-yellow-500/20 text-yellow-400`, so it was green
//     over a screen the owner could not read.
//
// And the Support fix existed the whole time: crm-salon's copy had been paired in a salon round, and
// the other seven byte-identical copies never got it. One site fixed, seven siblings missed.
//
// ── why this guard names files instead of sweeping the fleet ────────────────────────────────────
//
// The broad rule — "light ink with no light-mode value" — reports 2,208 places across 402 files, and
// the narrowest honest version of it (white ink, no dark partner, no ground of its own) still reports
// 40. Checked by hand, those 40 are dominated by correct code: the ground is painted by a PARENT,
// which no line-window check can see. tenant-ui's photo lightbox is `bg-black/90` on the wrapper with
// white ink two lines in; the roof sidebar is dark in both themes. A guard that reports those is a
// guard somebody switches off, and the file it was protecting goes with it.
//
// So this measures the two page families the owner reported, by name, and measures them properly:
// contrast computed from Tailwind's own hex values against the surface the element declares. Light
// mode is produced the way the cascade produces it — every `dark:` variant deleted. That is the
// defect itself, so it cannot be satisfied by a different spelling of the same mistake.
//
// Fleet-wide light-mode contrast is a RENDERED measurement, not a static one (T41 did it with real
// screenshots: 77/77 both themes). This guard does not pretend to replace that.
//
//   bun scripts/check-light-mode-ink.ts
import { existsSync, readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/** The screens this guard answers for. crm-automotive and crm-homecare are PARKED (CLAUDE.md). */
const FILES = [
  ...['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping'].map((t) => `templates/${t}/frontend/src/components/features/AIReceptionistPage.tsx`),
  'templates/crm-roof/frontend/src/pages/roofing/AIReceptionistPage.tsx',
  ...['crm', 'crm-basic', 'crm-fieldservice', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet'].map((t) => `templates/${t}/frontend/src/pages/support/SupportPage.tsx`),
]

/** Tailwind v3, the shades these screens use. */
const HEX: Record<string, string> = {
  white: '#ffffff', black: '#000000',
  'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0', 'slate-300': '#cbd5e1', 'slate-400': '#94a3b8',
  'slate-500': '#64748b', 'slate-600': '#475569', 'slate-700': '#334155', 'slate-800': '#1e293b', 'slate-900': '#0f172a',
  'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb', 'gray-300': '#d1d5db', 'gray-400': '#9ca3af',
  'gray-500': '#6b7280', 'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937', 'gray-900': '#111827',
  'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b',
  'orange-300': '#fdba74', 'orange-400': '#fb923c', 'orange-500': '#f97316', 'orange-600': '#ea580c', 'orange-700': '#c2410c', 'orange-800': '#9a3412',
  'amber-300': '#fcd34d', 'amber-400': '#fbbf24', 'amber-500': '#f59e0b', 'amber-600': '#d97706', 'amber-700': '#b45309', 'amber-800': '#92400e',
  'yellow-300': '#fde047', 'yellow-400': '#facc15', 'yellow-500': '#eab308', 'yellow-600': '#ca8a04', 'yellow-700': '#a16207', 'yellow-800': '#854d0e',
  'green-300': '#86efac', 'green-400': '#4ade80', 'green-500': '#22c55e', 'green-600': '#16a34a', 'green-700': '#15803d', 'green-800': '#166534',
  'emerald-300': '#6ee7b7', 'emerald-400': '#34d399', 'emerald-500': '#10b981', 'emerald-600': '#059669', 'emerald-700': '#047857', 'emerald-800': '#065f46',
  'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af',
  'purple-300': '#d8b4fe', 'purple-400': '#c084fc', 'purple-500': '#a855f7', 'purple-600': '#9333ea', 'purple-700': '#7e22ce', 'purple-800': '#6b21a8',
  'teal-400': '#2dd4bf', 'teal-500': '#14b8a6', 'teal-600': '#0d9488', 'teal-700': '#0f766e',
}
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
/** an alpha tint composited over white — `bg-yellow-500/20` is not yellow-500 */
const over = (hex: string, a: number) => '#' + [1, 3, 5]
  .map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * a + 255 * (1 - a)).toString(16).padStart(2, '0')).join('')
const ratio = (ink: string, bg: string) => {
  const a = lum(ink), b = lum(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * The app shell's LIGHT ground, which is what an element declaring no background of its own sits on.
 * slate-50 rather than pure white: white flatters every ink by a few hundredths and this check should
 * not be kinder than the screen.
 */
const PAGE = '#f8fafc'
const MIN = 4.5 // WCAG AA for the body and label text these screens are made of

/** Deliberately single-theme surfaces, which are not bugs. */
const SINGLE_THEME = /CustomerPortal|LoginPage|PaywallPage|ForgotPassword|ResetPassword|SignaturePad/

for (const rel of FILES) {
  const abs = ROOT + rel
  if (!existsSync(abs)) { fail(`${rel} is missing — if a screen was renamed, point this guard at it`); continue }
  if (SINGLE_THEME.test(rel)) continue
  const src = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n')
  const bad: string[] = []

  let inBlock = false
  const lines = src.split('\n')
  lines.forEach((raw, i) => {
    /**
     * COMMENTS ARE NOT CODE — and this file's own header names the broken classes while explaining
     * them, which is where such a sentence belongs. Tracked as a state machine rather than a regex
     * over the whole source, so a `/*` inside a string literal cannot swallow the rest of the page
     * and turn this guard quietly green.
     */
    let code = raw
    if (inBlock) { const e = code.indexOf('*/'); if (e === -1) return; code = code.slice(e + 2); inBlock = false }
    for (;;) {
      const o = code.search(/\{?\/\*/); if (o === -1) break
      const c = code.indexOf('*/', o)
      if (c === -1) { code = code.slice(0, o); inBlock = true; break }
      code = code.slice(0, o) + ' ' + code.slice(c + 2).replace(/^\}/, '')
    }
    code = code.replace(/\/\/.*$/, '')
    if (!/\btext-|\bbg-/.test(code)) return

    // LIGHT MODE is the cascade with the dark media query not matching: every dark: variant gone.
    const light = code.replace(/\bdark:(?:[a-z-]+:)*[\w/[\].-]+/g, ' ')

    // (a) a near-black surface with no light value is unreadable whatever ink is on it
    const surface = light.match(/\bbg-(?:gray|slate|zinc|neutral)-(?:800|900|950)\b/)
    if (surface) { bad.push(`${i + 1}: ${surface[0]} — a near-black surface with no light value`); return }

    /**
     * (b) ink too light for the ground it rests on.
     *
     * Each quoted class string is judged on its own, so a ternary's two branches cannot cover for
     * each other — `isActive ? 'text-emerald-400' : 'text-slate-500 dark:text-slate-400'` is one
     * correct branch and one broken one, and the broken one is the state most rows are in.
     *
     * HOVER AND FOCUS GROUNDS ARE NOT THE RESTING GROUND. `hover:bg-slate-100 text-slate-500` rests
     * on the page, not on slate-100, and measuring it against the hover tint reported three correct
     * elements in the first draft of this check. Only an unprefixed bg counts.
     */
    for (const m of light.matchAll(/(['"`])([^'"`\n]*)\1/g)) {
      const cls = m[2]
      if (!/text-/.test(cls)) continue
      // an inline brand colour behind the ink is a judgement this check cannot make
      if (/style=\{\{\s*(?:background|backgroundColor)/.test(light)) continue

      let bg = PAGE, bgName = 'the page'
      const own = [...cls.matchAll(/(?:^|\s)bg-([a-z]+-\d{2,3}|white|black)(?:\/(\d{1,3}))?(?![\w-])/g)].pop()
      if (own && HEX[own[1]]) {
        bg = own[2] ? over(HEX[own[1]], Number(own[2]) / 100) : HEX[own[1]]
        bgName = `bg-${own[1]}${own[2] ? '/' + own[2] : ''}`
      } else if (/(?:^|\s)bg-/.test(cls)) {
        continue // a ground this check does not know (a gradient, a brand token) — not judged
      }

      for (const t of cls.matchAll(/(?:^|\s)text-([a-z]+-\d{2,3}|white|black)(?![\w-])/g)) {
        const ink = HEX[t[1]]
        if (!ink) continue
        const r = ratio(ink, bg)
        if (r >= MIN) continue
        bad.push(`${i + 1}: text-${t[1]} on ${bgName} = ${r.toFixed(2)}:1, under ${MIN}:1`)
      }
    }
  })

  if (bad.length) fail(`${rel} is unreadable in LIGHT mode — ${bad.join('; ')}`)
}

if (failed) {
  console.error(`\nlight-mode ink: ${failed} screen(s) FAILED`)
  console.error('Pair the ink: keep the dark value on a dark: variant and give the base class a shade')
  console.error('that carries on a light ground. The 700s and 800s are measured in this file\'s HEX map.')
  process.exit(1)
}
console.log(`light-mode ink: ${FILES.length} screen(s) measured, every ink clears ${MIN}:1 on its own ground in light mode`)
