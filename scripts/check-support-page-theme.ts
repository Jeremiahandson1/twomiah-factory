// CI guard: Support Tickets renders in LIGHT mode too.
//
// Salon T27 N16 \u2014 the whole page was written against one theme: bg-gray-900 cards, bg-gray-800 inputs and
// text-white headings, none of them with a light counterpart. On a light tenant that is a stack of
// near-black cards, and the headings ("AI Support Assistant", the ticket subject, "New Ticket") are white
// text on a white page \u2014 invisible, not merely low-contrast. The file is byte-identical in seven
// templates, so it was seven verticals, and an earlier sweep had reached exactly ONE line of it.
//
// The check is not a list of class names to avoid. It reads each line as LIGHT MODE renders it \u2014 every
// dark: variant removed \u2014 and fails on what is left: a near-black surface, or white text that is not
// sitting on a coloured button. That is the defect itself, so it cannot be satisfied by a different
// spelling of the same mistake.
//   bun scripts/check-support-page-theme.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error('FAIL: ' + m) }

// crm-automotive is PARKED and keeps its own copy \u2014 not checked, not touched.
const TEMPLATES = ['crm', 'crm-fieldservice', 'crm-basic', 'crm-landscaping', 'crm-restaurant', 'crm-rv', 'crm-salon', 'crm-vet']

// White on blue/purple/green/red/yellow, or on gray-700, reads in both themes \u2014 that is a coloured button,
// not a theme-blind surface.
const ON_A_COLOURED_BUTTON = /\bbg-(blue|purple|green|red|yellow)-\d|\bbg-gray-700\b/

for (const tpl of TEMPLATES) {
  const rel = 'templates/' + tpl + '/frontend/src/pages/support/SupportPage.tsx'
  let src = ''
  try { src = readFileSync(ROOT + rel, 'utf8') } catch { fail(rel + ' is missing'); continue }
  const bad: string[] = []
  src.split(/\r?\n/).forEach((line, i) => {
    // comments document the old colours; they are not what renders
    if (/^\s*(\/\/|\/\*|\*)/.test(line)) return
    const light = line.replace(/dark:[^\s"']+/g, '')
    if (/\bbg-gray-(800|900)\b/.test(light)) bad.push((i + 1) + ': a near-black surface with no light value')
    else if (/\btext-white\b/.test(light) && !ON_A_COLOURED_BUTTON.test(light)) bad.push((i + 1) + ': white text with no light value, and no coloured button under it')
  })
  if (bad.length) fail(tpl + ' Support Tickets is dark-only at \u2014 ' + bad.join('; '))
}

if (failed) { console.error('\nsupport page theme: ' + failed + ' check(s) FAILED'); process.exit(1) }
console.log('support page theme: Support Tickets reads in both themes in every vertical that has it')
