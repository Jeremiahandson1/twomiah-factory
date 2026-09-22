// The loyalty form must not advertise a setting the award engine will not honour.
//
// Settings → Loyalty fills its fields from useState BEFORE the saved config arrives, and keeps those
// values for any field the server does not send. So each placeholder is a claim about what an
// unconfigured tenant gets. The backend's claim lives in backend/src/utils/loyaltyConfig.ts, where the
// bonus defaults are deliberately 0 — "nothing is given away that nobody asked for".
//
// The screen said 50 welcome points and a 100-point birthday bonus. The engine said 0 and 0. A tester
// read 50 off the screen, watched a new customer's $80 first purchase award exactly 80 points, and
// filed it as "welcome and birthday bonuses are never granted" — for the second time, across two
// rounds. The engine was right every time; the form was describing a tenant that did not exist.
// (Dispensary T28 M-b, T21 M7 before it.)
//
// This guard fails when the form's starting values and the backend defaults disagree.
//
//   bun run scripts/check-loyalty-defaults-agree.ts
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const BE = join(ROOT, 'templates', 'crm-dispensary', 'backend', 'src', 'utils', 'loyaltyConfig.ts')
const FE = join(ROOT, 'templates', 'crm-dispensary', 'frontend', 'src', 'pages', 'LoyaltyPage.tsx')

let failures = 0
const fail = (m: string) => { failures++; console.log(`FAIL ${m}`) }

if (!existsSync(BE) || !existsSync(FE)) {
  console.log('crm-dispensary loyalty files not found — nothing to check')
  process.exit(0)
}

const be = readFileSync(BE, 'utf8')
const fe = readFileSync(FE, 'utf8')

/** `export const DEFAULT_X = 12` → 12 */
const beNum = (name: string): number | null => {
  const m = be.match(new RegExp(`export const ${name}\\s*=\\s*(-?[0-9.]+)`))
  return m ? Number(m[1]) : null
}

// The first useState object in the component is the config form; read its literal fields.
const formBlock = fe.match(/useState\(\{([\s\S]*?)\}\);/)
if (!formBlock) {
  fail('could not find the config useState block in LoyaltyPage.tsx — the form was restructured; check the defaults by hand')
} else {
  const block = formBlock[1]
  /** `welcomePoints: '50',` → 50 */
  const feNum = (field: string): number | null => {
    const m = block.match(new RegExp(`${field}\\s*:\\s*'(-?[0-9.]+)'`))
    return m ? Number(m[1]) : null
  }

  const pairs: Array<[string, string, string]> = [
    // [form field, backend constant, what it means on screen]
    ['welcomePoints', 'DEFAULT_WELCOME_POINTS', 'the welcome bonus'],
    ['birthdayBonus', 'DEFAULT_BIRTHDAY_BONUS', 'the birthday bonus'],
    ['pointsPerDollar', 'DEFAULT_POINTS_PER_DOLLAR', 'the earn rate'],
  ]

  for (const [field, constant, what] of pairs) {
    const a = feNum(field)
    const b = beNum(constant)
    if (b === null) { fail(`${constant} not found in loyaltyConfig.ts — the backend default moved; this guard cannot compare it`); continue }
    if (a === null) { fail(`${field} not found in the LoyaltyPage config form — cannot compare it to ${constant}`); continue }
    if (a !== b) {
      fail(`Settings → Loyalty starts ${what} at ${a}, but an unconfigured tenant actually gets ${b} (${constant}). The screen would advertise a bonus the engine never pays. (T28 M-b)`)
    }
  }
}

console.log(failures === 0
  ? 'ok — the loyalty form starts on the same numbers the award engine would use'
  : `${failures} problem(s)`)
process.exit(failures ? 1 : 0)
