// ADAPTED COPY of tests/bar/bar-register.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 5 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-bar — the register and the grill, through the real routes on PGlite (routes/barRegister.ts):
//   1. the bar_register feature gates both; a viewer may not ring; a bartender may
//   2. check numbers go forwards per company (a split takes the next; another company starts at 1)
//   3. ringing: sizes, 86, off the menu, an open price, a pour copies the beer, quantities
//   4. tax is Settings › Company's rate, once on the check; a closed check keeps the rate it closed at
//   5. send: food makes ONE ticket (drinks don't), coursing sends just what was picked, nothing new refuses
//   6. the grill: the ticket shows with its cue and the all-day count; bump, recall, bump twice refused;
//      a bump teaches the cook time
//   7. paying: never more than the balance; cash change; short cash refused; a silly tip refused;
//      paid in full closes it, freezes the totals, sends held food; a paid check takes nothing more
//   8. split by item and by seat; a split the payments already cover is refused
//   9. voids: a held item just comes off; a sent one needs bar:manage or a manager's till PIN (and says so when
//      no manager has one); a wrong PIN refused; the void notes the ticket; below what's paid refused and undone;
//      a payment void is always a manager's; the PIN is hashed, 4–8 digits, never shared
//  10. the night: summary from closed checks, open checks block the close unless forced, over/short, the
//      close is a manager's, a 1:30 AM check counts toward the night before
//  11. another company's check is not found
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S = await import('./db/schema.ts')
const { company, user, barMenuSection, barMenuItem, barTap, barCheck, barCheckItem, barKitchenTicket, barCloseout, auditLog } = S
const { requestScope } = await import('./src/services/audit.ts')

const ALL = ['contacts', 'bar_menu', 'bar_tonight', 'bar_register']
const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-reg', email: 'bar@test.local', state: 'WI', settings: { defaultTaxRate: 5.5 }, enabledFeatures: ALL } as any).returning()
const mk = async (cid: string, role: string, first: string, tag: string) => (await db.insert(user).values({ email: `${role}-${tag}@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: cid, isActive: true } as any).returning())[0]
const owner = await mk(co.id, 'owner', 'Olive', 'reg'), manager = await mk(co.id, 'manager', 'Pat', 'reg'), bartender = await mk(co.id, 'field', 'Jess', 'reg'), viewer = await mk(co.id, 'viewer', 'Vic', 'reg')

const [burgers] = await db.insert(barMenuSection).values({ slug: 'burgers', name: 'Burgers', kind: 'food', companyId: co.id } as any).returning()
const [drinks] = await db.insert(barMenuSection).values({ slug: 'drinks', name: 'Drinks', kind: 'drink', companyId: co.id } as any).returning()
const item = async (v: any) => (await db.insert(barMenuItem).values({ companyId: co.id, ...v } as any).returning())[0]
const cheddar = await item({ sectionId: burgers.id, slug: 'cheddarburger', name: 'Cheddarburger', priceCents: null, variations: [{ id: 'sandwich', name: 'Sandwich', priceCents: 1000 }, { id: 'platter', name: 'Platter', priceCents: 1400 }], prepSeconds: 600 })
const fries = await item({ sectionId: burgers.id, slug: 'fries', name: 'Fries', priceCents: 400, prepSeconds: 240 })
const fishFry = await item({ sectionId: burgers.id, slug: 'fish-fry', name: 'Fish Fry', priceCents: 1300, is86ed: true })
const special = await item({ sectionId: burgers.id, slug: 'special', name: 'Market Special', priceCents: null, priceLabel: 'market' })
const gone = await item({ sectionId: burgers.id, slug: 'gone', name: 'Old Thing', priceCents: 500, isActive: false })
const rootBeer = await item({ sectionId: drinks.id, slug: 'root-beer', name: 'Draft Root Beer', priceCents: 300 })
const [spotted] = await db.insert(barTap).values({ companyId: co.id, lineNumber: 1, beerName: 'Spotted Cow', priceCents: 500, status: 'pouring' } as any).returning()
const [blown] = await db.insert(barTap).values({ companyId: co.id, lineNumber: 2, beerName: 'Hacker-Pschorr', priceCents: 700, status: 'blown' } as any).returning()

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
const R = await import('./src/routes/barRegister.ts')
app.route('/api/register', R.registerRoutes)
app.route('/api/grill', R.kitchenRoutes)
app.route('/api/bar', (await import('./src/routes/bar.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))

const call = (who: any, cid = co.id) => async (method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': cid, 'x-test-role': who.role }
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = call(owner), M = call(manager), B = call(bartender), V = call(viewer)

console.log('\n══════════ 1. the feature and who may ring ══════════')
{
  const [other] = await db.insert(company).values({ name: 'No Register', slug: 'noreg', email: 'nr@test.local', settings: {}, enabledFeatures: ['contacts', 'bar_menu'] } as any).returning()
  const otherOwner = await mk(other.id, 'owner', 'Nora', 'noreg')
  const a = await call(otherOwner, other.id)('GET', '/api/register/state'), g = await call(otherOwner, other.id)('GET', '/api/grill/state')
  check(`with bar_register off, the register and the grill are refused (${a.status}, ${g.status})`, a.status === 403 && g.status === 403, [a.json, g.json])
  const v = await V('GET', '/api/register/state'), vg = await V('GET', '/api/grill/state'), vo = await V('POST', '/api/register/check', { kind: 'tab', label: 'Vic' })
  check(`a viewer may not ring or bump (${v.status}, ${vg.status}, ${vo.status})`, v.status === 403 && vg.status === 403 && vo.status === 403)
  const b = await B('GET', '/api/register/state')
  check('a bartender gets the register: open checks, the menu with sizes, the tap list, the tax rate, their powers', b.status === 200 && Array.isArray(b.json.open) && b.json.taxRateBps === 550 && b.json.me.mayManage === false && b.json.me.name === 'Jess T', b.json)
  const names = b.json.menu.map((s: any) => s.name)
  check('the menu: food first, the taps lead the drinks, inactive items and blown kegs left off', JSON.stringify(names) === JSON.stringify(['Burgers', 'On tap', 'Drinks']) && !JSON.stringify(b.json.menu).includes('Old Thing') && !JSON.stringify(b.json.menu).includes('Hacker'), names)
  const ched = b.json.menu[0].items.find((i: any) => i.name === 'Cheddarburger')
  check('an item shows every size', ched?.sizes?.length === 2 && ched.sizes[1].priceCents === 1400, ched)
}

console.log('\n══════════ 2. check numbers ══════════')
let mike = '', booth = ''
{
  const a = await B('POST', '/api/register/check', { kind: 'tab', label: 'Mike' })
  const b = await B('POST', '/api/register/check', { kind: 'table', spot: 'Booth 2' })
  const w = await B('POST', '/api/register/check', { kind: 'walkup' })
  check(`numbers go forwards: ${a.json.check?.number}, ${b.json.check?.number}, ${w.json.check?.number}`, a.json.check.number === 1 && b.json.check.number === 2 && w.json.check.number === 3, [a.json, b.json, w.json])
  check('a table takes its spot as its name; a walk-up is "Walk-up"; who opened it is on it', b.json.check.label === 'Booth 2' && w.json.check.label === 'Walk-up' && a.json.check.openedByName === 'Jess T')
  const none = await B('POST', '/api/register/check', { kind: 'tab', label: '  ' })
  check('a tab needs a name', none.status === 400 && /Whose tab/.test(none.json.error), none.json)
  mike = a.json.check.id; booth = b.json.check.id
  const [other] = await db.insert(company).values({ name: 'Other Bar', slug: 'otherbar-reg', email: 'ob@test.local', settings: {}, enabledFeatures: ALL } as any).returning()
  const oo = await mk(other.id, 'owner', 'Otto', 'other')
  const first = await call(oo, other.id)('POST', '/api/register/check', { kind: 'tab', label: 'Sam' })
  check('another company starts at #1', first.json.check?.number === 1, first.json)
  const peek = await call(oo, other.id)('GET', `/api/register/check/${mike}`)
  check(`another company's check is not found (${peek.status})`, peek.status === 404, peek.json)
  const ring = await call(oo, other.id)('POST', `/api/register/check/${mike}/items`, { menuItemId: fries.id })
  check(`…and cannot be rung on (${ring.status})`, ring.status === 404, ring.json)
}

console.log('\n══════════ 3. ringing ══════════')
{
  const noSize = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: cheddar.id })
  check('an item with two sizes asks which', noSize.status === 400 && /Which size of Cheddarburger/.test(noSize.json.error), noSize.json)
  const r = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: cheddar.id, sizeId: 'platter', note: 'no onions' })
  const line = r.json.check.items[0]
  check('rung: the size, its price, held, for the grill, who rang it', line.name === 'Cheddarburger' && line.size === 'Platter' && line.unitPriceCents === 1400 && line.state === 'held' && line.toKitchen === true && line.addedByName === 'Jess T' && line.note === 'no onions', line)
  const e86 = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: fishFry.id })
  check("an 86'd item is refused by name", e86.status === 400 && /Fish Fry is 86'd/.test(e86.json.error), e86.json)
  const off = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: gone.id })
  check('an item off the menu is refused', off.status === 400 && /off the menu/.test(off.json.error), off.json)
  const open1 = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: special.id })
  check('an item with no price on file asks for one', open1.status === 400 && /no price on file/.test(open1.json.error), open1.json)
  const open2 = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: special.id, priceCents: 1650 })
  check('…and takes the typed price', open2.json.check?.items?.some((i: any) => i.name === 'Market Special' && i.unitPriceCents === 1650), open2.json)
  const pour = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: 'tap:' + spotted.id, qty: 2 })
  const p = pour.json.check.items.find((i: any) => i.name === 'Spotted Cow')
  check("a pour copies the beer's name and price, and never goes to the grill", p && p.unitPriceCents === 500 && p.qty === 2 && p.toKitchen === false && p.tapId === spotted.id, p)
  const bl = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: 'tap:' + blown.id })
  check('a blown keg is refused', bl.status === 400 && /blown/.test(bl.json.error), bl.json)
  const q = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: fries.id, qty: 99 })
  check('a silly quantity is refused', q.status === 400 && /quantity/.test(q.json.error), q.json)
  await B('POST', `/api/register/check/${mike}/items`, { menuItemId: rootBeer.id })
  await B('POST', `/api/register/check/${mike}/items`, { menuItemId: fries.id })
}

console.log('\n══════════ 4. tax ══════════')
{
  const r = await B('GET', `/api/register/check/${mike}`)
  const t = r.json.check.totals
  // 1400 + 1650 + 2×500 + 300 + 400 = 4750; 5.5% = 261.25 → 261
  check(`the subtotal and the tax once on the whole check (${t.subtotalCents} + ${t.taxCents})`, t.subtotalCents === 4750 && t.taxCents === 261 && t.totalCents === 5011 && t.balanceCents === 5011, t)
  check('quick-cash buttons for the balance', JSON.stringify(r.json.check.quickCash) === JSON.stringify([5011, 5100, 5500, 6000, 10000]), r.json.check.quickCash)
}

console.log('\n══════════ 5. send ══════════')
let ticketId = ''
{
  const c0 = (await B('GET', `/api/register/check/${mike}`)).json.check
  const fryLine = c0.items.find((i: any) => i.name === 'Fries')
  const course = await B('POST', `/api/register/check/${mike}/send`, { itemIds: [fryLine.id] })
  const sent = course.json.check.items.filter((i: any) => i.state === 'sent')
  check('coursing: only what was picked goes', sent.length === 1 && sent[0].id === fryLine.id, sent)
  const all = await B('POST', `/api/register/check/${mike}/send`)
  const items = all.json.check.items
  check('send: everything held is sent', items.every((i: any) => i.state === 'sent'), items.map((i: any) => i.state))
  const tickets = await db.select().from(barKitchenTicket).where(eq(barKitchenTicket.checkId, mike))
  check(`the food went to the grill as tickets (${tickets.length}); the drinks did not`, tickets.length === 2 && items.filter((i: any) => !i.toKitchen).every((i: any) => !i.ticketId), tickets)
  ticketId = items.find((i: any) => i.name === 'Cheddarburger').ticketId
  const again = await B('POST', `/api/register/check/${mike}/send`)
  check('nothing new to send is refused', again.status === 409 && /Nothing new/.test(again.json.error), again.json)
}

console.log('\n══════════ 6. the grill ══════════')
{
  const g = await B('GET', '/api/grill/state')
  const t = g.json.open.find((x: any) => x.id === ticketId)
  check('the ticket is on the grill with where it goes, its items and a cue', t && t.label === 'Mike' && t.items.some((i: any) => i.name === 'Cheddarburger' && i.variation === 'Platter' && i.note === 'no onions') && typeof t.cue?.text === 'string' && t.age === 'fresh', t)
  check('the all-day count adds the tickets up', g.json.allDay.some((x: any) => x.name === 'Fries' && x.qty === 1) && g.json.allDay.some((x: any) => x.name === 'Cheddarburger'), g.json.allDay)
  const pace = t.items.find((i: any) => i.name === 'Market Special')
  check('an item with no prep time takes the default (8 min)', pace?.prepSeconds === 480, pace)
  // Pretend the ticket fired 11 minutes ago, so the bump is a clean lesson for the burger.
  await db.update(barKitchenTicket).set({ firedAt: new Date(Date.now() - 11 * 60000) }).where(eq(barKitchenTicket.id, ticketId))
  const bump = await B('POST', '/api/grill/bump', { id: ticketId })
  check('bump', bump.status === 200, bump.json)
  const twice = await B('POST', '/api/grill/bump', { id: ticketId })
  check('bumping twice is refused', twice.status === 409, twice.json)
  const [ch] = await db.select().from(barMenuItem).where(eq(barMenuItem.id, cheddar.id))
  check(`the bump taught the burger's cook time (${ch.learnedPrepSeconds}s, ${ch.learnedSamples} sample)`, ch.learnedSamples === 1 && Math.abs((ch.learnedPrepSeconds || 0) - 660) <= 2, ch)
  const after = await B('GET', '/api/grill/state')
  check('a bumped ticket leaves the screen and shows as recently up', !after.json.open.some((x: any) => x.id === ticketId) && after.json.bumped.some((x: any) => x.id === ticketId))
  const rec = await B('POST', '/api/grill/recall', { id: ticketId })
  const back = await B('GET', '/api/grill/state')
  check('recall brings it back, marked recalled', rec.status === 200 && back.json.open.some((x: any) => x.id === ticketId && x.recalled === true), back.json.open.map((x: any) => x.id))
  await B('POST', '/api/grill/bump', { id: ticketId })
  const [ch2] = await db.select().from(barMenuItem).where(eq(barMenuItem.id, cheddar.id))
  check('a recalled ticket teaches nothing', ch2.learnedSamples === 1, ch2)
  const reg = await B('GET', '/api/register/state')
  const row = reg.json.open.find((o: any) => o.id === mike)
  check("the register sees the food is up", !!row?.foodUpAt, row)
}

console.log('\n══════════ 7. paying ══════════')
{
  const over = await B('POST', `/api/register/check/${mike}/pay`, { tender: 'cash', amountCents: 6000 })
  check('more than the balance is refused', over.status === 400 && /more than the balance/.test(over.json.error), over.json)
  const what = await B('POST', `/api/register/check/${mike}/pay`, { tender: 'bitcoin', amountCents: 100 })
  check('a tender the register does not take is refused', what.status === 400 && /Cash or card/.test(what.json.error), what.json)
  const short = await B('POST', `/api/register/check/${mike}/pay`, { tender: 'cash', amountCents: 2000, cashTenderedCents: 1500 })
  check('short cash is refused', short.status === 400 && /Not enough cash/.test(short.json.error), short.json)
  const silly = await B('POST', `/api/register/check/${mike}/pay`, { tender: 'card_external', amountCents: 2000, tipCents: 50000 })
  check('a silly tip is refused', silly.status === 400 && /tip looks wrong/.test(silly.json.error), silly.json)
  const cash = await B('POST', `/api/register/check/${mike}/pay`, { tender: 'cash', amountCents: 2000, tipCents: 300, cashTenderedCents: 2500 })
  check(`cash: change for what they handed over (${cash.json.changeCents})`, cash.status === 200 && cash.json.changeCents === 200 && cash.json.check.totals.balanceCents === 3011 && cash.json.check.status === 'open', cash.json)
  // a held item, to see it sent when the check is paid off
  await B('POST', `/api/register/check/${mike}/items`, { menuItemId: fries.id })
  const bal = (await B('GET', `/api/register/check/${mike}`)).json.check.totals.balanceCents
  const card = await B('POST', `/api/register/check/${mike}/pay`, { tender: 'card_external', amountCents: bal, tipCents: 500 })
  const done = card.json.check
  check('paid in full: closed, by whom, totals frozen with the rate', done.status === 'paid' && done.closedByName === 'Jess T' && done.totals.balanceCents === 0, done)
  const [row] = await db.select().from(barCheck).where(eq(barCheck.id, mike))
  check('the frozen totals on the row (subtotal, tax, total, tips, rate)', row.subtotalCents === 5150 && row.taxCents === 283 && row.totalCents === 5433 && row.tipCents === 800 && row.taxRateBps === 550, row)
  check('the fries held when it was paid went to the grill', done.items.every((i: any) => i.state === 'sent'), done.items.map((i: any) => i.state))
  const more = await B('POST', `/api/register/check/${mike}/items`, { menuItemId: fries.id })
  check('a paid check takes nothing more', more.status === 409 && /already paid/.test(more.json.error), more.json)
  // the rate changes tomorrow; tonight's closed check does not
  await db.update(company).set({ settings: { defaultTaxRate: 7 } } as any).where(eq(company.id, co.id))
  const later = await B('GET', `/api/register/check/${mike}`)
  check('a closed check keeps the rate it closed at', later.json.check.taxRateBps === 550 && later.json.check.totals.taxCents === 283, later.json.check.totals)
  await db.update(company).set({ settings: { defaultTaxRate: 5.5 } } as any).where(eq(company.id, co.id))
}

console.log('\n══════════ 8. split ══════════')
{
  const add = (v: any) => B('POST', `/api/register/check/${booth}/items`, v)
  await add({ menuItemId: cheddar.id, sizeId: 'sandwich', seat: 1 })
  await add({ menuItemId: fries.id, seat: 2 })
  await add({ menuItemId: rootBeer.id, seat: 3 })
  const v = (await B('GET', `/api/register/check/${booth}`)).json.check
  const sp = await B('POST', `/api/register/check/${booth}/split`, { itemIds: [v.items[2].id], label: 'Root beer guy' })
  check('split by item: the line moves to a new check, numbered next', sp.status === 200 && sp.json.to.label === 'Root beer guy' && sp.json.to.items.length === 1 && sp.json.from.items.length === 2 && sp.json.to.number > 3, sp.json)
  const allOf = await B('POST', `/api/register/check/${booth}/split`, { itemIds: sp.json.from.items.map((i: any) => i.id) })
  check('splitting off everything is refused', allOf.status === 400 && /everything/.test(allOf.json.error), allOf.json)
  const seats = await B('POST', `/api/register/check/${booth}/split-seats`)
  check('split by seat: seat 2 gets its own check named for the spot', seats.status === 200 && seats.json.created.length === 1 && seats.json.created[0].label === 'Booth 2 · Seat 2' && seats.json.from.items.length === 1, seats.json)
  // pay part of a check, then try to split off what the payment covers
  const c2 = (await B('POST', '/api/register/check', { kind: 'tab', label: 'Dee' })).json.check.id
  await B('POST', `/api/register/check/${c2}/items`, { menuItemId: fries.id })
  await B('POST', `/api/register/check/${c2}/items`, { menuItemId: rootBeer.id })
  await B('POST', `/api/register/check/${c2}/pay`, { tender: 'cash', amountCents: 500 })
  const dee = (await B('GET', `/api/register/check/${c2}`)).json.check
  const cov = await B('POST', `/api/register/check/${c2}/split`, { itemIds: [dee.items[0].id] })
  check('a split the payments already cover is refused', cov.status === 409 && /Split before paying/.test(cov.json.error), cov.json)
}

console.log('\n══════════ 9. voids and the till PIN ══════════')
{
  const c = (await B('POST', '/api/register/check', { kind: 'tab', label: 'Ray' })).json.check.id
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: fries.id })
  const held = (await B('GET', `/api/register/check/${c}`)).json.check.items[0]
  const vh = await B('POST', `/api/register/item/${held.id}/void`, {})
  check('a held item just comes off — no reason, no manager', vh.status === 200 && vh.json.check.items.length === 0, vh.json)
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: cheddar.id, sizeId: 'sandwich' })
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: fries.id })
  await B('POST', `/api/register/check/${c}/send`)
  const ray = (await B('GET', `/api/register/check/${c}`)).json.check
  const sentBurger = ray.items.find((i: any) => i.name === 'Cheddarburger')
  const noPinYet = await B('POST', `/api/register/item/${sentBurger.id}/void`, { reason: 'Rang in wrong' })
  check('a sent item needs a manager — and the refusal says no manager has a till PIN yet', noPinYet.status === 403 && noPinYet.json.code === 'NEEDS_MANAGER' /* unified: a refusal is { error, code } (RULEBOOK §3): "a manager has to OK this" is code NEEDS_MANAGER, not a needsManager field */ && /no manager has set a till PIN/.test(noPinYet.json.error), noPinYet.json)
  const short = await M('PUT', '/api/register/pin', { pin: '12' })
  check('a till PIN is 4 to 8 digits', short.status === 400 && /4 to 8 digits/.test(short.json.error), short.json)
  const setM = await M('PUT', '/api/register/pin', { pin: '4321' })
  check('the manager sets a till PIN', setM.status === 200 && setM.json.hasPin === true, setM.json)
  const [pm] = await db.select().from(user).where(eq(user.id, manager.id))
  check('…stored hashed, never as typed', !!pm.pinHash && pm.pinHash !== '4321' && pm.pinHash.startsWith('$2'), pm.pinHash?.slice(0, 4))
  const dup = await B('PUT', '/api/register/pin', { pin: '4321' })
  check('nobody else may take the same PIN', dup.status === 409 && /already uses that PIN/.test(dup.json.error), dup.json)
  const ask = await B('POST', `/api/register/item/${sentBurger.id}/void`, { reason: 'Rang in wrong' })
  check('now it asks for the manager\'s PIN', ask.status === 403 && ask.json.code === 'NEEDS_MANAGER' /* unified: code NEEDS_MANAGER, not a needsManager field */ && /type their till PIN/.test(ask.json.error), ask.json)
  const wrong = await B('POST', `/api/register/item/${sentBurger.id}/void`, { reason: 'Rang in wrong', managerPin: '9999' })
  check('a wrong PIN is refused', wrong.status === 403 && /not a manager PIN/.test(wrong.json.error), wrong.json)
  // A bartender's own PIN vouches for nothing: Jess has none yet; give her one and try it as a "manager" PIN.
  await B('PUT', '/api/register/pin', { pin: '5555' })
  const own = await B('POST', `/api/register/item/${sentBurger.id}/void`, { reason: 'Rang in wrong', managerPin: '5555' })
  check("a bartender's own PIN is not a manager's", own.status === 403, own.json)
  const ok = await B('POST', `/api/register/item/${sentBurger.id}/void`, { reason: 'Rang in wrong', managerPin: '4321' })
  const vl = ok.json.check?.items?.find((i: any) => i.id === sentBurger.id)
  check('the right PIN: voided, with the reason and both names', ok.status === 200 && vl?.state === 'void' && vl.voidReason === 'Rang in wrong' && vl.voidedByName === "Jess T (OK'd by Pat T)", vl)
  const [tk] = await db.select().from(barKitchenTicket).where(eq(barKitchenTicket.id, sentBurger.ticketId))
  check('the void is written on the grill ticket', /VOID: 1 × Cheddarburger \(sandwich\)/.test(tk.note || ''), tk.note)
  const aud = await db.select().from(auditLog).where(and(eq(auditLog.entityId, sentBurger.id)))
  check('the void left an audit row', aud.length === 1, aud)
  const noReason = await M('POST', `/api/register/item/${ray.items.find((i: any) => i.name === 'Fries').id}/void`, {})
  check('a manager voiding needs no PIN, but still a reason', noReason.status === 400 && /reason/.test(noReason.json.error), noReason.json)
  // below what's paid: $2 paid on the $4.22 left (the fries), then try to void the fries
  await B('POST', `/api/register/check/${c}/pay`, { tender: 'cash', amountCents: 200 })
  const friesLine = ray.items.find((i: any) => i.name === 'Fries')
  const below = await M('POST', `/api/register/item/${friesLine.id}/void`, { reason: 'Cold' })
  const [fl] = await db.select().from(barCheckItem).where(eq(barCheckItem.id, friesLine.id))
  check('a void that would take the check below what has been paid is refused, and undone', below.status === 409 && /below what has been paid/.test(below.json.error) && fl.state === 'sent', [below.json, fl.state])
  const pay = (await B('GET', `/api/register/check/${c}`)).json.check.payments[0]
  const bp = await B('POST', `/api/register/payment/${pay.id}/void`, { reason: 'Wrong check' })
  check('a payment void is always a manager\'s', bp.status === 403 && bp.json.code === 'NEEDS_MANAGER' /* unified: code NEEDS_MANAGER, not a needsManager field */, bp.json)
  const mp = await B('POST', `/api/register/payment/${pay.id}/void`, { reason: 'Wrong check', managerPin: '4321' })
  check('…with the PIN, voided; the balance comes back', mp.status === 200 && mp.json.check.totals.paidCents === 0, mp.json)
  const vc = await B('POST', `/api/register/check/${c}/void`, { reason: 'Walked out' })
  check('voiding a check with sent food needs a manager', vc.status === 403 && vc.json.code === 'NEEDS_MANAGER' /* unified: code NEEDS_MANAGER, not a needsManager field */, vc.json)
  const vc2 = await M('POST', `/api/register/check/${c}/void`, { reason: 'Walked out' })
  check('…a manager voids it', vc2.status === 200 && vc2.json.check.status === 'void' && vc2.json.check.voidReason === 'Walked out', vc2.json)
  const empty = (await B('POST', '/api/register/check', { kind: 'tab', label: 'Oops' })).json.check.id
  const ve = await B('POST', `/api/register/check/${empty}/void`, {})
  check('an empty check is voided by anyone, no reason needed', ve.status === 200 && ve.json.check.status === 'void', ve.json)
}

console.log('\n══════════ 10. the night ══════════')
{
  const day = (await M('GET', '/api/register/day')).json
  check('the summary counts the paid checks and the void', day.scope === 'night' && day.summary.checksPaid >= 1 && day.summary.checksVoided >= 2 && day.summary.totalCents >= 5433, day.summary)
  // A bartender reads their OWN checkout, as a server does on Toast (Bar Run 1: they read the whole night's sales
  // and everyone's tips). The drawer is the bar's, so the cash it should hold is still the whole night's.
  const own = (await B('GET', '/api/register/day')).json
  check('a bartender gets their own checkout: only the checks they closed, only their tips',
    own.scope === 'mine' && own.summary.checksVoided < day.summary.checksVoided && own.summary.tipsByStaff.every((t: any) => t.who === 'Jess T'), { own: own.summary, night: day.summary.checksVoided })
  check('…while the drawer to count is the whole night\'s cash', own.drawerInCents === day.summary.cash.inCents && own.summary.cash.inCents <= day.summary.cash.inCents, { drawer: own.drawerInCents, mine: own.summary.cash.inCents })
  check('…and lists what is still open', day.open.length >= 2, day.open.map((o: any) => o.label))
  check('cash in the drawer = cash sales + cash tips (2000 + 300, and Dee’s 500)', day.summary.cash.inCents === 2800, day.summary.cash)
  const bart = await B('POST', '/api/register/closeout', { day: day.day, floatCents: 15000, countedCents: 17700 })
  check('closing the night is a manager\'s', bart.status === 403 && bart.json.code === 'NEEDS_MANAGER' /* unified: code NEEDS_MANAGER, not a needsManager field */, bart.json)
  const blocked = await M('POST', '/api/register/closeout', { day: day.day, floatCents: 15000, countedCents: 17700 })
  check('open checks block the close', blocked.status === 409 && /still open/.test(blocked.json.error), blocked.json)
  const forced = await B('POST', '/api/register/closeout', { day: day.day, floatCents: 15000, countedCents: 17700, force: true, managerPin: '4321' })
  const cl = forced.json.closeout
  check(`forced, with the PIN: expected ${cl?.cashExpectedCents}, counted ${cl?.cashCountedCents}, ${cl?.overShortCents} short`, forced.status === 200 && cl.cashExpectedCents === 17800 && cl.overShortCents === -100 && cl.closedByName === "Jess T (OK'd by Pat T)", forced.json)
  check('the frozen summary keeps the checks open at close', Array.isArray(cl.summary.openAtClose) && cl.summary.openAtClose.length >= 2, cl.summary.openAtClose)
  const bad = await M('POST', '/api/register/closeout', { day: day.day, floatCents: -5 })
  check('a negative float is refused', bad.status === 400, bad.json)
  // A check paid at 1:30 AM local belongs to the night before.
  const late = (await B('POST', '/api/register/check', { kind: 'tab', label: 'Night Owl' })).json.check.id
  await B('POST', `/api/register/check/${late}/items`, { menuItemId: rootBeer.id })
  const bal = (await B('GET', `/api/register/check/${late}`)).json.check.totals.balanceCents
  await B('POST', `/api/register/check/${late}/pay`, { tender: 'cash', amountCents: bal })
  await db.update(barCheck).set({ closedAt: new Date('2026-09-26T06:30:00Z') }).where(eq(barCheck.id, late))   // 1:30 AM CDT Sat
  const fri = (await B('GET', '/api/register/day?day=2026-09-25')).json.summary
  const sat = (await B('GET', '/api/register/day?day=2026-09-26')).json.summary
  check('a 1:30 AM check counts toward the night before', fri.checksPaid === 1 && fri.totalCents === bal && sat.checksPaid === 0, { fri: fri.checksPaid, sat: sat.checksPaid })
  const rows = await db.select().from(barCloseout).where(eq(barCloseout.companyId, co.id))
  check('one close-out row, for this company', rows.length === 1)
  // Reports (Bar Run 1): a run of nights is the sum of those nights' close-out figures.
  const rep = await M('GET', '/api/register/report?from=2026-09-25&to=2026-09-26')
  const r = rep.json.report
  check('the two nights added up equal Friday + Saturday', rep.status === 200 && r.checksPaid === fri.checksPaid + sat.checksPaid && r.totalCents === fri.totalCents + sat.totalCents && r.tipsCents === fri.tipsCents + sat.tipsCents && r.nights.length === 2, { r, fri: fri.totalCents, sat: sat.totalCents })
  const nope = await B('GET', '/api/register/report?from=2026-09-25&to=2026-09-26')
  check('a bartender does not read the takings over a range (reports:read)', nope.status === 403, nope.json)
  const wide = await M('GET', '/api/register/report?from=2026-01-01&to=2026-12-31')
  const back = await M('GET', '/api/register/report?from=2026-09-26&to=2026-09-25')
  check('more than 93 nights, or to before from, is refused in words', wide.status === 400 && /93/.test(wide.json.error) && back.status === 400, [wide.json, back.json])
}

console.log('\n══════════ 12. the grill settings on a menu item ══════════')
{
  const put = await M('PUT', `/api/bar/menu/items/${fries.id}`, { prepMinutes: '7.5' })
  check('minutes on the grill are saved as seconds', put.status === 200 && put.json.prepSeconds === 450, put.json)
  const bad = await M('PUT', `/api/bar/menu/items/${fries.id}`, { prepMinutes: '200' })
  check('a silly cook time is refused', bad.status === 400 && /between half a minute and 90/.test(bad.json.error), bad.json)
  const clear = await M('PUT', `/api/bar/menu/items/${fries.id}`, { prepMinutes: '' })
  check('blank goes back to the house default', clear.status === 200 && clear.json.prepSeconds === null, clear.json)
  const bart = await B('PUT', `/api/bar/menu/items/${fries.id}`, { prepMinutes: '5' })
  check('a bartender may not change it (bar:update)', bart.status === 403, bart.json)
  await M('PUT', `/api/bar/menu/items/${fries.id}`, { toKitchen: false })
  const c = (await B('POST', '/api/register/check', { kind: 'tab', label: 'Chips only' })).json.check.id
  await B('POST', `/api/register/check/${c}/items`, { menuItemId: fries.id })
  const sent = await B('POST', `/api/register/check/${c}/send`)
  const tickets = await db.select().from(barKitchenTicket).where(eq(barKitchenTicket.checkId, c))
  check('a food item marked "not to the grill" is sent without a ticket', sent.status === 200 && tickets.length === 0 && sent.json.check.items[0].state === 'sent', { tickets: tickets.length })
  await M('PUT', `/api/bar/menu/items/${fries.id}`, { toKitchen: null })
}

console.log(`\nbar-register: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
