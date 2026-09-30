// CI guard: every door that creates an order records WHICH door it was, and no screen hard-codes
// one door's name over all of them.
//
// ── why this guard exists ───────────────────────────────────────────────────────────────────────
//
// T52 N5. An order that has not been ID-checked shows the budtender the date of birth on it so they
// can hold it against the card, and the sentence read:
//
//     "The kiosk recorded 04/02/1990 as the date of birth — check it against the card."
//
// …on EVERY order carrying one. The job of that sentence is to say how much to trust the number
// before the card comes out, and an unattended tablet, a form somebody filled in at home and a
// colleague typing at the register are three different amounts of trust. It said "the kiosk" about
// all of them.
//
// Naming the door needs the ORDER to know the door, and that was the real hole. `orders.source`
// existed and only the public menu ever wrote it: the till wrote nothing, the kiosk wrote nothing
// (it put 'kiosk' in `type` instead) and the external-POS import wrote nothing. So `?source=pos`
// and `?source=kiosk` on the orders list matched no row that had ever existed, and the banner had
// nothing to read but a guess. This is the same shape as T46 N21, where the column was added and
// nothing wrote it — and the same shape as every other finding in this family: one fact, several
// writers, and only some of them told.
//
// ── what it checks ──────────────────────────────────────────────────────────────────────────────
//
//   1. every INSERT into orders sets `source` — found by scanning for the inserts themselves, so a
//      door added later is caught by existing, not by being added to a list here;
//   2. the doors do not all claim the same one;
//   3. the ID-check banner asks the shared helper instead of naming a door in its own text.
//
//   bun scripts/check-every-order-names-its-door.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const BACKEND = 'templates/crm-dispensary/backend/src'
let failed = 0
const fail = (m: string) => { failed++; console.error(`FAIL: ${m}`) }
const read = (p: string) => { try { return readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n') } catch { return '' } }
/** Comments stripped: a rule about code must not be satisfied by prose describing it. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/^\s*--[^\n]*$/gm, '')

function routeFiles(): string[] {
  try {
    return readdirSync(join(ROOT, BACKEND, 'routes')).filter((f) => f.endsWith('.ts')).map((f) => `${BACKEND}/routes/${f}`)
  } catch { return [] }
}

// ── 1. every door that creates an order says which door it is ───────────────────────────────────
const doors: Array<{ file: string; source: string }> = []
for (const file of routeFiles()) {
  const src = code(read(file))

  // Drizzle: tx.insert(order).values({ … }) — read to the matching close of values(.
  for (const m of src.matchAll(/\.insert\(order\)\s*\.values\(\{/g)) {
    const body = balanced(src, m.index! + m[0].length - 1)
    const got = body.match(/\bsource:\s*'([a-z_]+)'/)
    if (!got) fail(`${file}: an order is created here without recording which door it came through — set \`source\`. (T52 N5: the ID-check banner then tells the budtender "the kiosk recorded" it, whatever actually happened, and ?source= on the orders list cannot find it.)`)
    else doors.push({ file, source: got[1] })
  }

  // Raw SQL: INSERT INTO orders( … ) — `source` has to be in the column list.
  for (const m of src.matchAll(/INSERT INTO orders\s*\(([^)]*)\)/gi)) {
    const columns = m[1].split(',').map((s) => s.trim())
    if (!columns.includes('source')) {
      fail(`${file}: a raw INSERT INTO orders omits the \`source\` column — every door records which door it is. (T52 N5)`)
    } else {
      const after = src.slice(m.index!, m.index! + 2600)
      const got = after.match(/VALUES[\s\S]*?'([a-z_]+)'\s*,\s*(?:--[^\n]*\n\s*)?'([a-z_]+)'/)
      doors.push({ file, source: got?.[2] || 'raw' })
    }
  }
}

if (doors.length < 4) {
  fail(`only ${doors.length} order-creating door(s) found — there are four (the till, the kiosk, the public menu, the external-POS import). If one was renamed or removed, update this guard rather than letting it stop looking.`)
}

// ── 2. …and they do not all claim to be the same one ────────────────────────────────────────────
{
  const named = new Set(doors.map((d) => d.source).filter((s) => s !== 'raw'))
  if (doors.length >= 2 && named.size < 2) {
    fail(`every order-creating door writes the same source (${[...named].join(', ') || 'none'}) — then the column says nothing and the banner is guessing again`)
  }
}

// ── 3. the screen asks the helper rather than naming a door in its own text ─────────────────────
{
  const page = code(read('templates/crm-dispensary/frontend/src/pages/OrderDetailPage.tsx'))
  if (!page) fail('OrderDetailPage.tsx is missing')
  else {
    if (/The kiosk recorded/.test(page)) {
      fail('OrderDetailPage.tsx names the kiosk in its own text again — that sentence prints on till and order-ahead sales too. Ask dobSourceLabel(order). (T52 N5)')
    }
    if (!/dobSourceLabel\(/.test(page)) {
      fail('the ID-check banner no longer asks dobSourceLabel() who took the date of birth down (T52 N5)')
    }
  }

  const utils = code(read('templates/crm-dispensary/frontend/src/utils/order.ts'))
  if (!/export function dobSourceLabel\(/.test(utils)) {
    fail('dobSourceLabel has left utils/order.ts. It lives there rather than in the page so it can be tested without React — tests/dispensary/t52-dob-source.test.ts imports it from that path.')
  }
  // It has to read the column the doors write, and tell the doors apart.
  for (const needle of ['kioskSessionId', "'kiosk'", "'online'", "'pos'"]) {
    if (!utils.includes(needle)) fail(`dobSourceLabel no longer distinguishes ${needle} — the three doors have to say three different things`)
  }
}

/** The substring from an opening brace to its match. */
function balanced(src: string, open: number): string {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return src.slice(open)
}

console.log(failed ? `\n${failed} failure(s)` : `ok: ${doors.length} order-creating door(s), each recording which door it is`)
process.exit(failed ? 1 : 0)
