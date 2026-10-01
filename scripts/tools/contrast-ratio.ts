// Do the dark-mode pairs I just wrote actually clear WCAG AA?
//
// A guard can only tell me a `dark:` class is PRESENT. Whether the pair is readable is arithmetic,
// and the arithmetic is doable here: Tailwind's palette is fixed, and a `/40` background composites
// over the page's dark ground (slate-900), so the effective colour is computable rather than
// guessable. The T32 report measured 1.10:1 and 1.00:1 by eye-dropper on a real render; this is the
// same number, derived.
const C: Record<string, string> = {
  'slate-900': '#0f172a', 'slate-800': '#1e293b', 'slate-700': '#334155',
  'slate-400': '#94a3b8', 'slate-300': '#cbd5e1', 'slate-200': '#e2e8f0', 'slate-100': '#f1f5f9',
  'red-950': '#450a0a', 'red-900': '#7f1d1d', 'red-300': '#fca5a5', 'red-200': '#fecaca',
  'orange-950': '#431407', 'orange-900': '#7c2d12', 'orange-300': '#fdba74', 'orange-200': '#fed7aa',
  'yellow-950': '#422006', 'yellow-900': '#713f12', 'yellow-200': '#fef08a',
  'green-950': '#052e16', 'green-900': '#14532d', 'green-300': '#86efac', 'green-200': '#bbf7d0',
  'blue-950': '#172554', 'blue-900': '#1e3a8a', 'blue-300': '#93c5fd', 'blue-200': '#bfdbfe',
  'purple-900': '#581c87', 'purple-200': '#e9d5ff',
  'amber-900': '#78350f', 'amber-200': '#fde68a',
  white: '#ffffff', 'gray-900': '#111827',
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
/** src over dst at alpha a. */
const over = (src: string, dst: string, a: number) => {
  const s = rgb(src), d = rgb(dst)
  return '#' + s.map((v, i) => Math.round(v * a + d[i] * (1 - a)).toString(16).padStart(2, '0')).join('')
}
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** The page's dark ground, which every /40 background composites over. */
const GROUND = C['slate-900']
const bg = (spec: string) => {
  if (C[spec]) return C[spec]
  const m = /^([a-z]+-\d+)(?:\/(\d+))?$/.exec(spec)
  if (!m) throw new Error('bad bg ' + spec)
  const base = C[m[1]]
  if (!base) throw new Error('unknown colour ' + m[1])
  return m[2] ? over(base, GROUND, Number(m[2]) / 100) : base
}

// orange-50, for the BEFORE row
C['orange-50'] = '#fff7ed'

const PAIRS: [string, string, string][] = [
  // what the report measured, BEFORE
  ['BEFORE · Bills "Overdue" tile (bg-white, dark text light)', 'white', 'slate-100'],
  ['BEFORE · Takeoffs selected sheet name', 'orange-50' in C ? 'orange-50' : 'white', 'slate-100'],
  // Bills
  ['Bills · Outstanding tile', 'slate-900', 'slate-100'],
  ['Bills · Overdue tile (overdue)', 'red-950/40', 'red-300'],
  ['Bills · Overdue tile (none)', 'slate-900', 'slate-100'],
  ['Bills · status open', 'blue-900/40', 'blue-200'],
  ['Bills · status partial', 'amber-900/40', 'amber-200'],
  ['Bills · status paid', 'green-900/40', 'green-200'],
  ['Bills · status void', 'slate-700', 'slate-300'],
  ['Bills · status overdue pill', 'red-900/40', 'red-200'],
  ['Bills · status fallback', 'slate-700', 'slate-300'],
  // Takeoffs
  ['Takeoffs · selected sheet name', 'orange-950/40', 'slate-100'],
  // Selections tiles
  ['Selections · tile gray', 'slate-800', 'slate-200'],
  ['Selections · tile blue', 'blue-950/40', 'blue-300'],
  ['Selections · tile green', 'green-950/40', 'green-300'],
  ['Selections · tile orange', 'orange-950/40', 'orange-300'],
  ['Selections · filter chip active', 'orange-900/40', 'orange-200'],
  ['Selections · filter chip idle', 'slate-700', 'slate-300'],
  // Equipment tiles + pills
  ['Equipment · tile gray', 'slate-800', 'slate-200'],
  ['Equipment · tile orange', 'orange-950/40', 'orange-300'],
  ['Equipment · tile yellow', 'yellow-950/40', 'yellow-200'],
  ['Equipment · tile red', 'red-950/40', 'red-300'],
  ['Equipment · job scheduled', 'blue-900/40', 'blue-200'],
  ['Equipment · job dispatched', 'purple-900/40', 'purple-200'],
  ['Equipment · job in_progress', 'yellow-900/40', 'yellow-200'],
  ['Equipment · job completed', 'green-900/40', 'green-200'],
  ['Equipment · job cancelled', 'slate-700', 'slate-300'],
]

let worst = Infinity, fails = 0
for (const [label, b, t] of PAIRS) {
  const r = ratio(bg(b), C[t] || bg(t))
  const before = label.startsWith('BEFORE')
  // 4.5:1 is AA for body text; 3:1 is AA for large text (the 2xl tile figures qualify, but hold
  // everything to 4.5 so the small label beside the big number passes too).
  const ok = before ? true : r >= 4.5
  if (!before) { worst = Math.min(worst, r); if (!ok) fails++ }
  console.log(`${ok ? (before ? '    ' : ' ok ') : 'FAIL'} ${r.toFixed(2).padStart(6)}:1  ${label}`)
}
console.log(`\nworst non-BEFORE pair: ${worst.toFixed(2)}:1 — ${fails === 0 ? 'every pair clears AA (4.5:1)' : `${fails} FAIL`}`)
if (fails) process.exit(1)
