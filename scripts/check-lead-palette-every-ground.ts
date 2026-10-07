/**
 * CI guard: every ink in the lead palette clears AA on EVERY ground it can sit on.
 *
 *   owner, T58k: "Vet Lead Inbox contrast is not fixed on the live build. #767676 sits on off-white
 *   #FAFAFA and #F5F5F5, which gives 4.35:1 and 4.17:1. In dark mode, Dismiss is 3.28:1. That grey
 *   passes only on pure white, which is probably what the test checked against."
 *
 * The diagnosis of the test was correct, and that is the reason this file exists. The Lead pages are
 * inline-styled, so no class-based sweep can read them; theme.ts was written to be the one place
 * their colours live, and every shade in it was chosen against `surface` alone — #fff in light,
 * #1e293b in dark. The palette has five other grounds (`hover`, `activeBtn`, `mutedBtnBg`, `codeBg`,
 * `infoBg`), and the notes beside each colour quote a ratio on white as though that settled it.
 *
 * Measured across every ink × every ground, SIX were below AA where two had been reported:
 *
 *   light  faint         #767676 on #f0f0f0   3.99:1
 *   light  statConverted #2e7d32 on #f0f0f0   4.50:1   (okText is the same pair)
 *   dark   muted         #94a3b8 on #334155   4.04:1   (infoBody is the same)
 *   dark   faint         #8193a6 on #334155   3.28:1   ← the owner's Dismiss button, to the decimal
 *
 * WHY THE BROWSER RUN MISSED IT TOO. scripts/measure-contrast-live.ts reported "every label meets
 * AA" on veterinary/leads in both themes. It measures the text it finds on the page as loaded, and
 * the worst pairings here are STATES — a hovered row, a toggled-on filter button, the Dismiss
 * control's own ground. Rendering is not the same as rendering every state, which is why a
 * palette-level check belongs in CI next to it rather than instead of it.
 *
 *   bun scripts/check-lead-palette-every-ground.ts
 */
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const { LIGHT, DARK, contrastRatio } = await import(`${ROOT}packages/tenant-ui/src/leads/theme.ts`)

const AA = 4.5
/** The keys that are a GROUND — something text is painted on top of. */
const GROUND_KEYS = ['surface', 'hover', 'activeBtn', 'mutedBtnBg', 'codeBg', 'infoBg'] as const
/** The keys that are INK — text or an icon. `border`/`divider`/`inputBorder` are not text. */
const INK_KEYS = ['text', 'muted', 'faint', 'link', 'statNew', 'statContacted', 'statConverted', 'infoHead', 'infoBody'] as const

const luminance = (hex: string) => {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex))
  if (!m) return NaN
  const s = m[1].length === 3 ? m[1].split('').map((c: string) => c + c).join('') : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(s.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

for (const [theme, p] of [['light', LIGHT], ['dark', DARK]] as Array<[string, any]>) {
  for (const ink of INK_KEYS) {
    for (const ground of GROUND_KEYS) {
      const r = contrastRatio(p[ink], p[ground])
      if (r < AA) {
        fail(`${theme}: ${ink} (${p[ink]}) on ${ground} (${p[ground]}) is ${r.toFixed(2)}:1 — below AA. ` +
             `Choose the nearest shade that clears 4.5 on the WORST ground, not on ${theme === 'light' ? '#fff' : 'surface'}.`)
      }
    }
  }
  // Each status chip's ink against its OWN background.
  for (const [name, pair] of Object.entries(p.chip) as Array<[string, any]>) {
    const r = contrastRatio(pair.text, pair.bg)
    if (r < AA) fail(`${theme}: chip.${name} — ${pair.text} on ${pair.bg} is ${r.toFixed(2)}:1, below AA`)
  }
  // The error and "active" pairs are a lozenge each: ink on its own wash.
  for (const [ink, bg, label] of [['errText', 'errBg', 'error banner'], ['okText', 'okBg', 'Active pill']] as const) {
    const r = contrastRatio(p[ink], p[bg])
    if (r < AA) fail(`${theme}: ${label} — ${p[ink]} on ${p[bg]} is ${r.toFixed(2)}:1, below AA`)
  }
  /**
   * THE TIERS MUST STILL READ AS TIERS, and visibly.
   *
   * Lifting `faint` to the minimum passing shade put it within 0.002 luminance of `muted` — ordered
   * on paper, the same grey to the eye. A contrast fix that flattens the hierarchy has traded one
   * readability problem for another, so the gap is asserted, not just the ordering.
   */
  const [lt, lm, lf] = [luminance(p.text), luminance(p.muted), luminance(p.faint)]
  const ordered = theme === 'light' ? lt < lm && lm < lf : lt > lm && lm > lf
  if (!ordered) fail(`${theme}: the text tiers are out of order — text ${lt.toFixed(4)}, muted ${lm.toFixed(4)}, faint ${lf.toFixed(4)}`)
  const gap = Math.abs(lm - lf)
  if (gap < 0.01) fail(`${theme}: muted (${p.muted}) and faint (${p.faint}) differ by only ${gap.toFixed(4)} luminance — the same grey to the eye. Separate them or drop the tier.`)
}

if (failed) { console.error(`\nlead palette on every ground: ${failed} check(s) FAILED`); process.exit(1) }
console.log(
  `lead palette on every ground: ${INK_KEYS.length} ink(s) × ${GROUND_KEYS.length} ground(s) in both themes, ` +
  `plus the chips and the two lozenges, all clear AA — and the three text tiers stay visibly apart`,
)
