// CI guard: the Help page follows the theme. It was written dark-only and later had its TEXT themed but never
// its SURFACES, so in light mode a dozen dark-navy cards sat on a light page with muted grey text inside them
// — measured on the live contractor tenant at 2.35:1 and 3.67:1 against a page background of rgb(249,250,251).
// (Contractor T14 M2, reported seven builds running.)
//
// The rule: no bare dark surface may be painted without a light counterpart on the same element, and white
// text is only allowed where the background is a saturated colour in BOTH themes.
//   bun scripts/check-help-page-theme.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const read = (p: string) => { try { return readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

// crm-automotive is parked and keeps its own copy
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-landscaping', 'crm-rv', 'crm-vet', 'crm-salon', 'crm-restaurant']
const REL = (t: string) => `templates/${t}/frontend/src/pages/help/HelpPage.tsx`

const base = read(REL('crm'))
if (!base) { console.error('FAIL: templates/crm/frontend/src/pages/help/HelpPage.tsx is missing'); process.exit(1) }

// one page, seven copies — a fix to one is a fix to all
for (const t of TEMPLATES.slice(1)) {
  const src = read(REL(t))
  if (!src) { fail(`${REL(t)} is missing`); continue }
  if (src !== base) fail(`${t}'s Help page has drifted from the crm copy — they are one page in seven places`)
}

const SURFACE = /\b(bg-gray-(?:800|900)|border-gray-(?:700|800)|divide-gray-800)\b/g
const COLOURED = /bg-(blue|purple|green|red|orange|emerald|indigo)-\d/

const lines = base.split('\n')
lines.forEach((line, i) => {
  const n = i + 1
  // a dark surface needs a light one on the same element
  for (const m of line.match(SURFACE) || []) {
    if (!line.includes(`dark:${m}`) && !line.includes(`dark:hover:${m}`)) {
      fail(`line ${n}: "${m}" is painted with no light-mode counterpart — that is a dark card on a light page`)
    }
  }
  // white text only over a saturated background
  if (COLOURED.test(line)) return
  const bare = line.match(/(?<![-:\w])text-white\b/g) || []
  if (bare.length) fail(`line ${n}: bare "text-white" with no coloured background — invisible in light mode`)
  // a hover that goes white must say which theme it is for
  const hover = line.match(/(?<!dark:)\bhover:text-white\b/g) || []
  if (hover.length) fail(`line ${n}: "hover:text-white" needs to be dark-mode only`)
})

// the heading and the cards specifically — the two things the report named
if (!/text-gray-900 dark:text-white">Help Center</.test(base)) fail('the "Help Center" heading must carry both themes')
if (!/bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-200 dark:divide-gray-800/.test(base)) fail('the FAQ list must be a light card in light mode')

if (failed) { console.error(`\nhelp page theme: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`help page theme: one Help page in ${TEMPLATES.length} templates, and it follows the theme`)
