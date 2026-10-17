// crm-bar — the register's pure arithmetic, ported with its numbers from website-premium-bar's own tests
// (lib/kitchen/pacing.test.ts, lib/register/money.test.ts, lib/register/reports.test.ts, Amber Inn 9/26):
//   · pacing: the longest item starts at fire, everything is ready together; the cue under each ticket; the
//     "on now" and all-day counts across tickets; fresh → warn → late; learning cook times from bumps
//   · a check's money: voids not charged, tax once on the taxable subtotal, payments and tips apart, an even
//     split that adds up to the cent, change, quick-cash buttons, money always printed with cents
//   · the night: sales from frozen totals, tenders without voided payments, tips per person (the website earns
//     none), channels, items, voids, the drawer, hours in the order the night runs, gift cards kept out of sales
//   · the business day: 4 AM to 4 AM local (services/barLive.ts — the same rule the Tonight overrides lapse at)
let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}
const same = (name: string, got: unknown, want: unknown) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want })

const { ageState, allDay, cueFor, effectivePrep, learn, lessonFromBump, paceTicket, startNow } = await import('./src/services/barPacing.ts')
const { changeDue, checkTotals, formatMoney, quickCash, splitEvenly, taxRateBpsFrom } = await import('./src/services/barCheckMoney.ts')
const { summarizeDay } = await import('./src/services/barReports.ts')
const { businessDayOf, businessDayWindow, endOfBusinessDay } = await import('./src/services/barLive.ts')

console.log('\n══════════ pacing ══════════')
const MIN = 60_000
const t0 = Date.parse('2026-09-26T17:00:00Z')
const burger = { key: 'a', name: 'Cheddarburger', qty: 1, prepSeconds: 600, menuItemId: 'burger' }
const fries = { key: 'b', name: 'Fries', qty: 1, prepSeconds: 240, menuItemId: 'fries' }
const fish = { key: 'c', name: 'Fish Fry', qty: 2, prepSeconds: 420, menuItemId: 'fish' }
{
  const p = paceTicket(t0, [burger, fries])
  check('the longest item starts at fire; everything is ready together', p.readyAt === t0 + 10 * MIN && p.items.find(i => i.name === 'Cheddarburger')!.startAt === t0 && p.items.find(i => i.name === 'Fries')!.startAt === t0 + 6 * MIN, p)
  same('at fire: burger on now, fries in 6', cueFor(p, t0), { text: 'Cheddarburger on now · Fries in 6', state: 'start' })
  same('two minutes in: just the countdown to fries', cueFor(p, t0 + 2 * MIN), { text: 'Fries in 4', state: 'wait' })
  same('fries due', cueFor(p, t0 + 6 * MIN).text, 'Fries on now')
  same('everything going: up in N', cueFor(p, t0 + 8 * MIN), { text: 'Up in 2', state: 'wait' })
  same('ready: plate it', cueFor(p, t0 + 10 * MIN).state, 'plate')
  const q = paceTicket(t0, [burger, { ...fries, qty: 3 }, { ...fries, key: 'd', name: 'Onion Rings', qty: 1 }])
  same('quantities and same-time starts group', cueFor(q, t0).text, 'Cheddarburger on now · 3 Fries + Onion Rings in 6')
  const a = paceTicket(t0, [burger, fries])
  const b = paceTicket(t0 + 6 * MIN, [{ ...fries, key: 'x', qty: 2 }])
  same('fries from two tickets come due together → one batch', startNow([a, b], t0 + 6 * MIN), [{ name: 'Fries', qty: 3 }])
  same('all day totals', allDay([{ items: [burger, fries] }, { items: [fish, { ...burger, qty: 2 }] }]), [
    { name: 'Cheddarburger', qty: 3 }, { name: 'Fish Fry', qty: 2 }, { name: 'Fries', qty: 1 },
  ])
  same('fresh → warn → late', [ageState(t0, t0 + 5 * MIN, 600, 900), ageState(t0, t0 + 10 * MIN, 600, 900), ageState(t0, t0 + 15 * MIN, 600, 900)], ['fresh', 'warn', 'late'])
  same("uses the owner's time until there are enough samples", [
    effectivePrep({ prepSeconds: 600, learnedPrepSeconds: 700, learnedSamples: 2 }, 480),
    effectivePrep({ prepSeconds: 600, learnedPrepSeconds: 700, learnedSamples: 3 }, 480),
    effectivePrep({ prepSeconds: null, learnedPrepSeconds: null, learnedSamples: 0 }, 480),
  ], [600, 700, 480])
  same('a bump teaches the longest item', lessonFromBump([burger, fries], t0, t0 + 11 * MIN, false), { menuItemId: 'burger', observedSeconds: 660 })
  same('no lesson from a recall, a forgotten bump, a mis-tap, or a tie between two items', [
    lessonFromBump([burger], t0, t0 + 11 * MIN, true), lessonFromBump([burger], t0, t0 + 50 * MIN, false),
    lessonFromBump([burger], t0, t0 + 30_000, false), lessonFromBump([burger, { ...burger, key: 'z', menuItemId: 'other' }], t0, t0 + 11 * MIN, false),
  ], [null, null, null, null])
  same('moving average', [learn(null, 0, 660), learn(600, 1, 700)], [{ learnedPrepSeconds: 660, learnedSamples: 1 }, { learnedPrepSeconds: 630, learnedSamples: 2 }])
}

console.log('\n══════════ a check\'s money ══════════')
{
  const items = [
    { qty: 2, unitPriceCents: 729, state: 'sent' },   // 2 Hamburger platters
    { qty: 1, unitPriceCents: 949, state: 'held' },   // Fish fry
    { qty: 1, unitPriceCents: 500, state: 'void' },   // voided — not charged
  ]
  same('subtotal skips voids; tax 5.5% once on the whole check', checkTotals(items, [], 550), { subtotalCents: 2407, taxCents: 132, totalCents: 2539, paidCents: 0, tipCents: 0, balanceCents: 2539 })
  const t = checkTotals(items, [{ amountCents: 1000, tipCents: 200 }, { amountCents: 500, tipCents: 0, voidedAt: new Date() }], 550)
  check('payments reduce the balance; tips are apart; a voided payment does not count', t.paidCents === 1000 && t.tipCents === 200 && t.balanceCents === 1539, t)
  same('a gift card sold is not taxed (the food is, when it is spent)', checkTotals([{ qty: 1, unitPriceCents: 5000, state: 'sent', kind: 'giftcard' }, { qty: 1, unitPriceCents: 1000, state: 'sent', kind: 'item' }], [], 550).taxCents, 55)
  same('an even split adds up to the cent', [splitEvenly(2539, 3), splitEvenly(2539, 3).reduce((a, b) => a + b, 0), splitEvenly(1000, 4), splitEvenly(5, 1)], [[847, 846, 846], 2539, [250, 250, 250, 250], [5]])
  same('change due, or null when short', [changeDue(2539, 3000), changeDue(2539, 2539), changeDue(2539, 2000)], [461, 0, null])
  same('quick cash buttons', [quickCash(2539), quickCash(800)], [[2539, 2600, 3000, 4000, 5000], [800, 1000, 2000, 5000, 10000]])
  same('money is printed with cents, a minus sign, thousands', [formatMoney(2539), formatMoney(5), formatMoney(-461), formatMoney(123456)], ['$25.39', '$0.05', '−$4.61', '$1,234.56'])
  same("the tax rate is Settings › Company's percent, as basis points; unset or nonsense is 0", [taxRateBpsFrom({ defaultTaxRate: 5.5 }), taxRateBpsFrom({ defaultTaxRate: '5.5' }), taxRateBpsFrom({}), taxRateBpsFrom({ defaultTaxRate: 'abc' }), taxRateBpsFrom({ defaultTaxRate: 140 }), taxRateBpsFrom(null)], [550, 550, 0, 0, 0, 0])
}

console.log('\n══════════ the night ══════════')
const TZ = 'America/Chicago'
const at = (iso: string) => new Date(iso)
const chk = (o: any) => ({ id: 'c', number: 1, kind: 'tab', label: 'x', status: 'paid', subtotalCents: 0, taxCents: 0, totalCents: 0, tipCents: 0, closedAt: at('2026-09-26T02:00:00Z'), closedByName: 'Jess', voidReason: null, ...o })
{
  // Friday night, Sept 25 2026 (CDT, UTC-5)
  const checks = [
    chk({ id: 'a', number: 11, kind: 'tab', label: 'Mike', subtotalCents: 879, taxCents: 48, totalCents: 927, tipCents: 200, closedAt: at('2026-09-26T01:10:00Z') }),      // 8:10 PM
    chk({ id: 'b', number: 12, kind: 'table', label: 'Booth 2', subtotalCents: 949, taxCents: 52, totalCents: 1001, tipCents: 0, closedAt: at('2026-09-26T01:40:00Z') }),  // 8:40 PM
    chk({ id: 'c', number: 13, kind: 'online', label: 'Web · Sam', subtotalCents: 1698, taxCents: 93, totalCents: 1791, tipCents: 0, closedAt: at('2026-09-26T06:20:00Z') }), // 1:20 AM
    chk({ id: 'd', number: 14, kind: 'walkup', label: 'Walk-up', status: 'void', voidReason: 'Walked out', closedByName: 'Dana' }),
  ]
  const items = [
    { checkId: 'a', name: 'Hamburger', size: 'Sandwich', qty: 1, unitPriceCents: 579, state: 'sent', voidReason: null, voidedByName: null },
    { checkId: 'a', name: 'Draft Root Beer', size: null, qty: 1, unitPriceCents: 300, state: 'sent', voidReason: null, voidedByName: null },
    { checkId: 'a', name: 'Hamburger', size: 'Platter', qty: 2, unitPriceCents: 729, state: 'void', voidReason: 'Rang in wrong', voidedByName: 'Jess' },
    { checkId: 'b', name: 'Fish Fry', size: null, qty: 1, unitPriceCents: 949, state: 'sent', voidReason: null, voidedByName: null },
    { checkId: 'c', name: 'Cheddarburger', size: 'Platter', qty: 2, unitPriceCents: 849, state: 'sent', voidReason: null, voidedByName: null },
  ]
  const payments = [
    { checkId: 'a', tender: 'cash', amountCents: 500, tipCents: 0, takenByName: 'Jess', voidedAt: at('2026-09-26T01:05:00Z'), voidReason: 'wrong check', voidedByName: "Jess (OK'd by Pat)", takenAt: at('2026-09-26T01:00:00Z') },
    { checkId: 'a', tender: 'card_external', amountCents: 927, tipCents: 200, takenByName: 'Jess', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:10:00Z') },
    { checkId: 'b', tender: 'cash', amountCents: 1001, tipCents: 150, takenByName: 'Dana', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:40:00Z') },
    { checkId: 'c', tender: 'card_online', amountCents: 1791, tipCents: 0, takenByName: 'Website', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T06:20:00Z') },
  ]
  const s = summarizeDay('2026-09-25', TZ, checks, items, payments)
  check('sales from frozen check totals; a voided check is not a sale', s.checksPaid === 3 && s.checksVoided === 1 && s.subtotalCents === 879 + 949 + 1698 && s.taxCents === 48 + 52 + 93 && s.totalCents === 927 + 1001 + 1791 && s.averageCheckCents === Math.round(3719 / 3), s)
  same('by tender, without the voided payment', s.byTender, [
    { tender: 'card_online', label: 'Card (website)', count: 1, amountCents: 1791, tipsCents: 0 },
    { tender: 'cash', label: 'Cash', count: 1, amountCents: 1001, tipsCents: 150 },
    { tender: 'card_external', label: 'Card (reader)', count: 1, amountCents: 927, tipsCents: 200 },
  ])
  same('tips per person, cash and card apart; the website earns none', s.tipsByStaff, [
    { who: 'Jess', count: 1, tipsCents: 200, cashTipsCents: 0, cardTipsCents: 200 },
    { who: 'Dana', count: 1, tipsCents: 150, cashTipsCents: 150, cardTipsCents: 0 },
  ])
  same('channels', s.byChannel.map(c => c.channel), ['Website', 'Tables', 'Bar'])
  same('items sold, without the voided line', [s.items[0], s.items.some(i => i.name === 'Hamburger (platter)')], [{ name: 'Cheddarburger (platter)', qty: 2, salesCents: 1698 }, false])
  same('every kind of void, each with who', [s.voids.map(v => v.kind).sort(), s.voids.find(v => v.kind === 'item'), s.voids.find(v => v.kind === 'payment')?.by, s.voids.find(v => v.kind === 'check')?.by],
    [['check', 'item', 'payment'], { kind: 'item', what: '2 × Hamburger (platter)', amountCents: 1458, reason: 'Rang in wrong', by: 'Jess', checkNumber: 11 }, "Jess (OK'd by Pat)", 'Dana'])
  same('cash in the drawer = cash sales + cash tips', s.cash, { salesCents: 1001, tipsCents: 150, inCents: 1151 })
  same('hours run the way the night does: 8 PM before 1 AM', [s.byHour.map(h => h.label), s.byHour[0]], [['8 PM', '1 AM'], { hour: 20, label: '8 PM', totalCents: 1928, checks: 2 }])
}
{
  // A $50 card and a $10 burger on one check; a second check paid off a card.
  const gcChecks = [
    chk({ id: 'g', number: 20, subtotalCents: 6000, taxCents: 55, totalCents: 6055, closedAt: at('2026-09-26T01:00:00Z') }),
    chk({ id: 'h', number: 21, subtotalCents: 1000, taxCents: 55, totalCents: 1055, closedAt: at('2026-09-26T01:30:00Z') }),
  ]
  const gcItems = [
    { checkId: 'g', name: 'Gift card', size: null, qty: 1, unitPriceCents: 5000, state: 'sent', voidReason: null, voidedByName: null, kind: 'giftcard' },
    { checkId: 'g', name: 'Hamburger', size: null, qty: 1, unitPriceCents: 1000, state: 'sent', voidReason: null, voidedByName: null, kind: 'item' },
    { checkId: 'h', name: 'Hamburger', size: null, qty: 1, unitPriceCents: 1000, state: 'sent', voidReason: null, voidedByName: null, kind: 'item' },
  ]
  const gcPays = [
    { checkId: 'g', tender: 'cash', amountCents: 6055, tipCents: 0, takenByName: 'Jess', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:00:00Z') },
    { checkId: 'h', tender: 'giftcard', amountCents: 1055, tipCents: 0, takenByName: 'Jess', voidedAt: null, voidReason: null, takenAt: at('2026-09-26T01:30:00Z') },
  ]
  const g = summarizeDay('2026-09-25', TZ, gcChecks, gcItems, gcPays)
  check('a gift card sold is not food and drink', g.subtotalCents === 2000 && g.giftCardsSold.count === 1 && g.giftCardsSold.cents === 5000 && g.totalCents === 7110 && !g.items.find(i => i.name === 'Gift card'), g)
  check('paying with a card is its own tender and not cash', g.byTender.find(t => t.tender === 'giftcard')?.amountCents === 1055 && g.cash.salesCents === 6055, g.byTender)
}

console.log('\n══════════ the business day: 4 AM to 4 AM ══════════')
{
  same('1:20 AM and 3:59 AM belong to the night before; 4:00 AM and 6:30 AM to the new day', [
    businessDayOf(at('2026-09-26T06:20:00Z'), TZ), businessDayOf(at('2026-09-26T08:59:00Z'), TZ),
    businessDayOf(at('2026-09-26T09:00:00Z'), TZ), businessDayOf(at('2026-09-26T11:30:00Z'), TZ),
  ], ['2026-09-25', '2026-09-25', '2026-09-26', '2026-09-26'])
  const w = businessDayWindow('2026-09-25', TZ)
  same('the window is 4 AM to 4 AM local', [w.from.toISOString(), w.to.toISOString()], ['2026-09-25T09:00:00.000Z', '2026-09-26T09:00:00.000Z'])
  // The night the clocks go back (Nov 1 2026, 2 AM CDT → 1 AM CST): the night is 25 hours, and still ends at 4 AM.
  const fall = businessDayWindow('2026-10-31', TZ)
  same('the fall-back night runs 25 hours and ends at 4 AM CST', [fall.from.toISOString(), fall.to.toISOString(), (fall.to.getTime() - fall.from.getTime()) / 3600000], ['2026-10-31T09:00:00.000Z', '2026-11-01T10:00:00.000Z', 25])
  same("a console override set at 11 PM lapses at the night's end (the same rule)", endOfBusinessDay(at('2026-09-26T04:00:00Z'), TZ).toISOString(), w.to.toISOString())
}

console.log(`\nbar-register-arithmetic: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
