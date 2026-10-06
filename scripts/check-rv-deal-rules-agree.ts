// CI guard: the RV deal rules are the SAME rules on the screen and on the server.
//
//   Owner: "a down payment of 999,999 is accepted", and "when several fields are bad, the API names
//   only the first one — price −3 with tax −1 names only the price."
//
// Both come from the same cause. The deal rules exist TWICE:
//
//   frontend/src/lib/deal.ts   dealErrors()  → a per-field map, and the richer of the two
//   backend/.../salesLeads.ts  dealInput()   → returned on the FIRST failure, as a bare string
//
// and deal.ts's comment calls itself "the rules the server enforces on save". That was a claim, not
// a fact: the server named one field where the screen named four, and neither bounded the down
// payment at all. A comment asserting two implementations agree is how a disagreement survives
// review — so this runs BOTH over the same cases and compares the verdicts.
//
// It cannot be one shared module: the screen imports from tenant-ui and the route from
// tenant-backend, and there is no isomorphic package between them. Given that, the next best thing
// is a check that fails the moment they diverge.
//
//   bun scripts/check-rv-deal-rules-agree.ts
import { readFileSync } from 'node:fs'
const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }

const { dealErrors, DEAL_DEFAULTS } = await import(`${ROOT}templates/crm-rv/frontend/src/lib/deal.ts`)

/**
 * Both halves are imported, not extracted.
 *
 * The first version of this guard pulled dealInput out of the route file by brace-matching, because
 * the route imports the database and cannot be loaded here. That broke immediately on the function's
 * return TYPE — `{ deal: ... } | { error: ... }` — whose braces close before the body's do, so it
 * silently evaluated a type annotation and tested nothing. The rules now live in services/deal.ts,
 * which imports nothing, so this can just import them. A guard that has to parse the code it checks
 * is a guard with its own bugs.
 */
const { dealInput } = await import(`${ROOT}templates/crm-rv/backend/src/services/deal.ts`)

// …and the route must still be the thing using them, or this checks a module nobody calls.
const routeSrc = readFileSync(`${ROOT}templates/crm-rv/backend/src/routes/salesLeads.ts`, 'utf8')
if (!/from '\.\.\/services\/deal\.ts'/.test(routeSrc)) fail('salesLeads.ts must import the deal rules from services/deal.ts')
if (/function dealInput\b/.test(routeSrc)) fail('salesLeads.ts has its own copy of dealInput again — that is the duplication this guard exists for')
if (!/fields: parsed\.fields/.test(routeSrc)) fail('PUT /:id/deal must return the whole `fields` map, not just the leading sentence')

const base = { ...DEAL_DEFAULTS, price: 30000 }
const cases: Array<[string, Record<string, number>]> = [
  ['a clean deal', base],
  ['the owner\'s case — a 999,999 down payment', { ...base, down: 999_999 }],
  ['a down payment exactly at the out-the-door total', { ...base, down: 0 }],   // filled below
  ['the owner\'s case — price -3 and tax -1', { ...base, price: -3, taxRate: -1 }],
  ['three bad fields at once', { ...base, price: -3, taxRate: -1, down: -5 }],
  ['a discount over the price', { ...base, discount: 40000 }],
  ['a tax rate over 25', { ...base, taxRate: 30 }],
  ['a money field over the cap', { ...base, prep: 20_000_000 }],
  ['zero everything', Object.fromEntries(Object.keys(base).map((k) => [k, 0])) as Record<string, number>],
]
// A down payment equal to the total must be ALLOWED — paying cash is a deal, not an error.
{
  const d: any = { ...base }
  const otd = (30000) + d.accessories + (d.taxRate / 100) * (30000 + d.accessories - d.tradeAllow) + d.doc + d.freight + d.titleReg + d.prep
  cases[2][1] = { ...base, down: Math.round(otd * 100) / 100 }
}

for (const [label, deal] of cases) {
  const screen = dealErrors(deal as any) as Record<string, string>
  const server = dealInput(deal)
  const serverFields = ('fields' in server && server.fields) ? server.fields : {}

  const screenKeys = Object.keys(screen).sort()
  const serverKeys = Object.keys(serverFields).sort()
  if (screenKeys.join(',') !== serverKeys.join(',')) {
    fail(`${label}: the screen flags [${screenKeys.join(', ') || 'nothing'}] and the server flags [${serverKeys.join(', ') || 'nothing'}]`)
    continue
  }
  for (const k of screenKeys) {
    if (screen[k] !== serverFields[k]) fail(`${label}: field "${k}" — screen says ${JSON.stringify(screen[k])}, server says ${JSON.stringify(serverFields[k])}`)
  }
  // A clean deal must be accepted by both.
  if (!screenKeys.length && !('deal' in server && server.deal)) fail(`${label}: the screen accepts it and the server does not`)
}

// ── and the two specific faults, asserted directly ────────────────────────────────────────────────
{
  const over = dealInput({ ...base, down: 999_999 })
  if (!('fields' in over) || !over.fields?.down) fail('a 999,999 down payment must be refused — that was the report')
  if (over.fields?.down && !/out-the-door/i.test(over.fields.down)) fail(`the refusal must say what the ceiling IS, got ${JSON.stringify(over.fields.down)}`)

  const many = dealInput({ ...base, price: -3, taxRate: -1 })
  const named = Object.keys(('fields' in many && many.fields) || {})
  if (named.length < 2) fail(`both bad fields must be named, got [${named.join(', ')}] — that was the report`)
  if (!/other field/.test(String(('error' in many && many.error) || ''))) {
    fail(`the leading sentence must say there are more, got ${JSON.stringify(('error' in many && many.error) || '')}`)
  }

  const cash = cases[2][1]
  if (!('deal' in dealInput(cash))) fail('paying the full out-the-door amount in cash must be ACCEPTED, not refused')
}

if (failed) { console.error(`\nrv deal rules agree: ${failed} check(s) FAILED`); process.exit(1) }
console.log(`rv deal rules agree: the screen and the server return the same per-field verdict over ${cases.length} deals, a 999,999 down payment is refused by both, and a cash deal is accepted`)
