// CI guard: a refusal is rendered on the page, never thrown at a native pop-up.
//
//   Owner, on Events: "Scheduling a payment for 0.001 refuses, but the message is a pop-up instead of
//   showing on the page." And then, after the next pass: "24 other pop-up error messages remain."
//
// They did. Every events screen reported a refusal with `alert()`, and that is wrong three ways that
// compound:
//
//   - It leaves the form. The sentence naming the bad field appears somewhere the field is not, and
//     dismissing it is the only way back to the field.
//   - It is gone the moment it is dismissed. "Another event already holds that room that night" is a
//     sentence the coordinator needs IN FRONT OF THEM while they decide what to do next.
//   - Nothing but a person clicking OK can read it — no role="alert" announcement, and no rendered-page
//     check can see it, which is why these survived every automated sweep this campaign has run.
//
// crm-restaurant now renders its refusals through components/ui/FormError, and this guard is the
// ratchet that keeps it that way.
//
// WHY A CEILING RATHER THAN A FLAT BAN. 155 call sites exist across the fleet. Banning the lot today
// would mean one enormous untested edit across eleven live verticals, which is the opposite of what a
// guard is for. So each template carries the number it had when its door was measured, and that number
// may only FALL. A template at 0 can never gain one; a template at 27 can never reach 28. The work of
// driving the rest to zero stays visible in this file instead of being forgotten.
//
//   bun scripts/check-refusals-render-on-the-page.ts
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

/**
 * The CEILING per door. Measured, not guessed. A number here may only ever be lowered — lowering it
 * is the whole point, and raising it to make CI green is how "still open" keeps coming back.
 *
 * crm-automotive and crm-homecare are PARKED. Their numbers are recorded so that parking them does
 * not quietly become permission to add more, but no work is planned against them.
 */
/**
 * A TEMPLATE AT ZERO IS NOT A BUNDLE AT ZERO. (T58, after measuring the deployed build)
 *
 * This file counts source directories, and `packages/tenant-ui` is vendored into every template's
 * frontend at generation. So "crm-restaurant: 0" was true of templates/crm-restaurant and NOT true
 * of what the tenant actually serves: the deployed Events bundle still carried one pop-up, from
 * ReviewsPage's follow-up handler in tenant-ui. The ceiling list below was right; the claim made
 * from it was wrong.
 *
 * Driving packages/tenant-ui to zero is therefore worth more than any single template, because it
 * is the only directory that can reintroduce a pop-up into a template already cleaned.
 */
const CEILING: Record<string, number> = {
  // 29 → 21 (T58i). The owner's "RV: 8 alert() calls remain, in Warranties and Inventory" — and
  // neither was in crm-rv, whose own ceiling has been 0 since T58d. Both pages are SHARED:
  // warranties/WarrantiesPage.tsx (4) and inventory/InventoryPage.tsx (4), mounted by every
  // vertical that sells those modules. Counting per directory is what made that legible; chasing it
  // inside crm-rv would have found nothing and I would have reported it as not reproducing.
  'packages/tenant-ui/src': 21, // ships into EVERY vertical — the most valuable to remove next
  'templates/crm-vet': 27,
  'templates/crm-homecare': 21, // parked
  'templates/crm-automotive': 16, // parked
  // crm-rv: 16 → 0 (T58d). The owner's "RV still has 24 alert() calls" — 16 of its own, plus the
  // ones tenant-ui contributes to its bundle, which is the door below.
  'templates/crm-rv': 0,
  'templates/crm': 9,
  'templates/crm-fieldservice': 8,
  'templates/crm-landscaping': 8,
  'templates/crm-roof': 8,
  'templates/crm-basic': 5,
  'templates/crm-dispensary': 4,
  'templates/cms': 2,
  'templates/pricing': 1,
  // Everything not named here — crm-restaurant, crm-salon, crm-store and the website templates —
  // must be at zero. That is the default, so a new template starts out held to the right standard
  // instead of inheriting a grandfathered allowance.
}

const walk = (dir: string, out: string[] = []): string[] => {
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return out }
  for (const n of names) {
    if (n === 'node_modules' || n === 'dist' || n === 'build' || n === '.git') continue
    const p = join(dir, n)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}

/**
 * A CALL SITE, not the word.
 *
 * Comments are stripped first — this very file, and the FormError component, both discuss `alert()`
 * in prose, and a guard that counts its own explanation is a guard nobody can keep green.
 *
 * `window.alert = …` is NOT a call: crm-restaurant's ToastContext still overrides it as a backstop for
 * anything that slips through, and that override is the opposite of the problem.
 */
const callSites = (src: string): number => {
  const bare = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  return (bare.match(/(?<![.\w])(?:window\.)?alert\s*\(/g) || []).length
}

// ── the rule holds on the thing it describes: catch the shapes, before trusting the counts ─────────
for (const [label, sample, want] of [
  ['a bare call', 'if (!ok) alert("no")', 1],
  ['a window call', 'window.alert(msg)', 1],
  ['spaced', 'alert ("no")', 1],
  ['the shim assignment is not a call', 'window.alert = (m) => toast(m)', 0],
  ['a line comment is not a call', '// it used to alert(x) here', 0],
  ['a block comment is not a call', '/**\n * alert(x) was wrong\n */', 0],
  ['a property is not a call', 'this.alert(x)', 0],
  ['a longer name is not a call', 'showAlert(x)', 0],
] as Array<[string, string, number]>) {
  const got = callSites(sample)
  if (got !== want) fail(`the counter itself is wrong — ${label}: counted ${got}, expected ${want}`)
}

// ── every door ─────────────────────────────────────────────────────────────────────────────────────
const doors = [
  ...readdirSync(join(ROOT, 'templates')).filter((t) => {
    try { return statSync(join(ROOT, 'templates', t)).isDirectory() } catch { return false }
  }).map((t) => `templates/${t}`),
  'packages/tenant-ui/src',
]

const over: string[] = []
const under: string[] = []
for (const door of doors) {
  let n = 0
  for (const f of walk(join(ROOT, door))) n += callSites(readFileSync(f, 'utf8'))
  const ceiling = CEILING[door] ?? 0
  if (n > ceiling) {
    over.push(door)
    fail(
      `${door}: ${n} native pop-up(s), ceiling ${ceiling}. A refusal must render on the page — see ` +
      `templates/crm-restaurant/frontend/src/components/ui/FormError.tsx. Lower the ceiling, never raise it.`,
    )
  } else if (n < ceiling) {
    under.push(`${door} ${ceiling} → ${n}`)
  }
}

if (under.length) {
  console.error(
    `\nFAIL: ${under.length} door(s) now have FEWER pop-ups than their ceiling: ${under.join(', ')}.\n` +
    `      Lower the ceiling in CEILING to the new number, so the ground that was won cannot be lost again.`,
  )
  failed += under.length
}

if (failed) { console.error(`\nrefusals render on the page: ${failed} check(s) FAILED`); process.exit(1) }
const remaining = Object.values(CEILING).reduce((s, n) => s + n, 0)
console.log(
  `refusals render on the page: every door is at or under its ceiling. ` +
  `crm-restaurant, crm-salon and crm-store have none of their OWN; ` +
  `${remaining} remain across the other doors, and until packages/tenant-ui reaches 0 every ` +
  `template's shipped bundle can still carry one from there`,
)
