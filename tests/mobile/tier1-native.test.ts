// Tier 1 of the phone going native (owner 10/30, "option 3"): contacts, invoices and leads open on the phone in trades
// that used to get the desktop page — and say what that trade's desktop says. The phone's words are held to each trade's
// own settings (apps/unified/verticals/<trade>/settings.ts), so a type or a status added there fails here until the
// phone has it too. The screens import React Native, so they are read as text.
//
//   bun run tests/mobile/tier1-native.test.ts
import fs from 'node:fs'
import path from 'node:path'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
const settings = async (trade: string) => (await import(path.join(ROOT, 'apps/unified/verticals', trade, 'settings.ts'))).default

// ── contacts: each trade's chips are its own types, in its order, in its words ─────────────────────────────────────────
const contacts = read('apps/mobile/app/(tabs)/contacts.tsx')
const chipsOf = (trade: string) => {
  const block = new RegExp(`\\n  ${trade}: \\[([\\s\\S]*?)\\n  \\],`).exec(contacts)?.[1] || ''
  return [...block.matchAll(/\{ key: '([^']+)', label: '([^']+)' \}/g)].map((m) => ({ value: m[1], label: m[2] }))
}
for (const trade of ['salon', 'restaurant', 'bar', 'vet']) {
  const types = (await settings(trade)).screens.contacts.types as { value: string; label: string }[]
  const chips = chipsOf(trade)
  check(`${trade}: the contact chips are All, then the trade's own types and words`, JSON.stringify(chips) === JSON.stringify([{ value: 'all', label: 'All' }, ...types]), { chips, types })
}
check('a salon client opens on their chart; a lead or a supplier on the contact page', /SALON_NOT_CLIENTS = \['lead', 'vendor', 'other'\]/.test(contacts) && /spec: 'salon-clients'/.test(contacts))
{
  const people = read('apps/unified/server/crm/salon/people.ts')
  check('…the same "not a client" list as the server', /NON_CLIENT_TYPES = \['lead', 'vendor', 'other'\] as const/.test(people))
}

// ── invoices: the "Open" tab where the trade has one, and salon's tip ──────────────────────────────────────────────────
const list = read('apps/mobile/app/(details)/invoices.tsx')
const detail = read('apps/mobile/app/(details)/invoice/[id].tsx')
const openTrades = (/OPEN_TRADES = \[([^\]]*)\]/.exec(list)?.[1] || '').match(/'[^']+'/g)?.map((s) => s.slice(1, -1)).sort() || []
const want: string[] = [], tipping: string[] = []
// The phone's trade id and its settings folder (roofing's folder is `roof`).
for (const [trade, folder] of [['contractor', 'contractor'], ['basic', 'basic'], ['fieldservice', 'fieldservice'], ['landscaping', 'landscaping'], ['roofing', 'roof'], ['rv', 'rv'], ['salon', 'salon'], ['restaurant', 'restaurant'], ['bar', 'bar'], ['vet', 'vet'], ['store', 'store'], ['homecare', 'homecare']]) {
  const inv = (await settings(folder)).screens?.invoicing || {}
  if ((inv.extraInvoiceStatuses || []).includes('open')) want.push(trade)
  if (inv.tips) tipping.push(trade)
}
check('the invoice list offers "Open" in exactly the trades whose desktop does', JSON.stringify(openTrades) === JSON.stringify(want.sort()), { openTrades, want })
check('a tip is taken with a payment in exactly the trades whose desktop takes one', JSON.stringify(tipping) === '["salon"]' && /const tips = vertical === 'salon'/.test(detail) && /tipAmount: tipDollars/.test(detail), tipping)

// ── leads: "Create quote" only where the business has quotes ─────────────────────────────────────────────────────────
const lead = read('apps/mobile/app/(details)/leads/[id].tsx')
check('the lead\'s "Create quote" asks for the quotes feature, not only the permission', /canQuote = canConvert && can\('quotes:create'\) && hasFeature\('quotes'\)/.test(lead))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
