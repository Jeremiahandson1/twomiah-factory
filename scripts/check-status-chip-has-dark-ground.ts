/**
 * GUARD #211 — a status chip with a light ground must have a dark one too.
 *
 * T51 follow-up, owner: "two status chips stay light in dark mode."
 *
 * A chip is a light ground plus coloured ink: `bg-amber-100 text-amber-800`. With no `dark:bg-*`
 * partner the ground stays near-white while the card behind it goes dark, so the chip is a bright
 * blot on the row — and where the INK has a dark partner and the ground does not, it becomes light
 * ink on a light ground and the status disappears entirely.
 *
 * The existing contrast guards pass these, because each half is individually fine: amber-800 on
 * amber-100 is a good pair, and the fault is the partner that is MISSING. That is the same shape as
 * the T41 note about half a pair being worse than none, one level up — there the ink had no ground,
 * here the ground has no dark twin.
 *
 * The owner saw two. The fleet had 54: 24 in live templates and 30 in crm-homecare, which is parked.
 * Two of those 54 were only found after this check's colour list was widened — the first version
 * omitted `pink` and reported a file clean with a broken chip still in it, which is why the palette
 * below is the whole Tailwind set rather than the colours that happened to come up.
 *
 * WHAT COUNTS AS A CHIP
 *   a class string with a ground at step 50/100/200 that is ALWAYS painted — no hover:, focus: or
 *   group- prefix, since those paint only transiently and are written that way everywhere — and
 *   coloured ink of its own at step 600-900.
 */
import * as fs from 'fs'
import * as path from 'path'

const ROOT = process.argv[2] || process.cwd()

/** Parked: not generated for any tenant, and 30 of the 54 were here. */
const SKIP = new Set(['crm-homecare', 'crm-automotive'])

/** The whole palette. An omission here is a file reported clean with a broken chip in it. */
const PALETTE = 'amber|yellow|green|blue|red|orange|purple|emerald|sky|indigo|rose|teal|lime|cyan|gray|slate|pink|fuchsia|violet|stone|zinc|neutral'
const GROUND = new RegExp(`(?<![:-])\\bbg-(${PALETTE})-(?:50|100|200)\\b`)
const COLOURED_INK = new RegExp(`(?<![:-])\\btext-(?:${PALETTE})-(?:[6-9]00)\\b`)

const files: string[] = []
const walk = (dir: string) => {
  let entries: fs.Dirent[] = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'shared') walk(p) }
    else if (e.name.endsWith('.tsx')) files.push(p)
  }
}
const templatesDir = path.join(ROOT, 'templates')
for (const t of fs.readdirSync(templatesDir)) {
  if (!t.startsWith('crm') || SKIP.has(t)) continue
  walk(path.join(templatesDir, t, 'frontend', 'src'))
}
// …and the shared screens, which ship to every vertical at once.
walk(path.join(ROOT, 'packages', 'tenant-ui', 'src'))

let failed = 0
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/['"`]([^'"`\n]{8,300})['"`]/g)) {
      const cls = m[1]
      const ground = cls.match(GROUND)
      if (!ground || !COLOURED_INK.test(cls)) continue
      if (/\bdark:bg-/.test(cls)) continue
      failed++
      console.error(`FAIL: ${path.relative(ROOT, f)}:${i + 1}`)
      console.error(`      bg-${ground[1]}-… with coloured ink and no dark: ground`)
      console.error(`      ${cls.slice(0, 140)}`)
      if (/\bdark:text-/.test(cls)) {
        console.error(`      the INK already flips in dark mode and the ground does not — this one goes light-on-light`)
      }
    }
  })
}

if (failed) {
  console.error(`\ncheck-status-chip-has-dark-ground: ${failed} chip(s) stay light in dark mode`)
  console.error(`Add the partner: bg-X-100 text-X-700  →  dark:bg-X-950/40 dark:text-X-300`)
  console.error(`(and for a neutral chip, dark:bg-slate-800 dark:text-slate-200)\n`)
  process.exit(1)
}
console.log(`check-status-chip-has-dark-ground: ok — every light chip in ${files.length} file(s) has a dark ground`)
