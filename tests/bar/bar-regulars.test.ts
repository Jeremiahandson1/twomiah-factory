// crm-bar — the Regulars at the register, through the real routes on PGlite (services/barLoyalty.ts,
// routes/barLoyalty.ts, the register's guests / reward / pay):
//   1. switched off (no loyalty_rewards, or the bar's own switch), the register offers no Regulars
//   2. a bartender adds a regular: a name and a phone; the same number however typed is the same guest, whose name
//      is never changed; welcome points once, when the bar gives them
//   3. finding a guest by phone digits or name, with their points
//   4. earning: a paid check earns on its food and drink — never tax, tips or a gift card sold — once per check
//   5. redeeming: the engine's refusals in a bar's words; money off as a line; a free item is ONE of it; one reward
//      per check; taking it off puts the points back and it can go on again; the guest cannot leave with it on
//   6. a manager corrects points (a reason, never below zero); only an owner/admin changes the programme
//   7. another company's reward and guest are not found
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
const { company, user, contact, barMenuSection, barMenuItem, loyaltyMember, loyaltyTransaction, loyaltyReward } = S
const { requestScope } = await import('./src/services/audit.ts')
const L = await import('./src/services/barLoyalty.ts')

const ALL = ['contacts', 'bar_menu', 'bar_tonight', 'bar_register', 'gift_cards', 'loyalty_rewards']
const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-loy', email: 'bar@test.local', state: 'WI', settings: { defaultTaxRate: 5.5 }, enabledFeatures: ALL } as any).returning()
const mk = async (cid: string, role: string, first: string, tag: string) => (await db.insert(user).values({ email: `${role}-${tag}@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: cid, isActive: true } as any).returning())[0]
const owner = await mk(co.id, 'owner', 'Olive', 'loy'), manager = await mk(co.id, 'manager', 'Pat', 'loy'), bartender = await mk(co.id, 'field', 'Jess', 'loy')
const [sec] = await db.insert(barMenuSection).values({ slug: 'food', name: 'Food', kind: 'food', companyId: co.id } as any).returning()
const [burger] = await db.insert(barMenuItem).values({ sectionId: sec.id, slug: 'burger', name: 'Hamburger', priceCents: 1000, companyId: co.id } as any).returning()
const [beer] = await db.insert(barMenuItem).values({ sectionId: sec.id, slug: 'beer', name: 'Spotted Cow', priceCents: 550, toKitchen: false, companyId: co.id } as any).returning()

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
const R = await import('./src/routes/barRegister.ts')
app.route('/api/register', R.registerRoutes)
app.route('/api/loyalty', (await import('./src/routes/barLoyalty.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))
const call = (who: any, cid = co.id) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-company': cid, 'x-test-role': who.role }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = call(owner), M = call(manager), B = call(bartender)
const newCheck = async (label: string) => (await B('POST', '/api/register/check', { kind: 'tab', label })).json.check.id as string
const ring = (id: string, menuItemId: string) => B('POST', `/api/register/check/${id}/items`, { menuItemId })
const balanceOf = async (contactId: string) => (await db.select().from(loyaltyMember).where(and(eq(loyaltyMember.companyId, co.id), eq(loyaltyMember.contactId, contactId))))[0]?.pointsBalance ?? null

console.log('\n══════════ 1. switched off ══════════')
{
  const [other] = await db.insert(company).values({ name: 'No Regulars', slug: 'noloy', email: 'nl@test.local', settings: {}, enabledFeatures: ['contacts', 'bar_menu', 'bar_register'] } as any).returning()
  const ob = await mk(other.id, 'field', 'Nat', 'noloy')
  const st = await call(ob, other.id)('GET', '/api/register/state')
  const add = await call(ob, other.id)('POST', '/api/register/guests', { name: 'Mike', phone: '715-555-0100' })
  check(`without the feature: no Regulars on the register, no adding (${add.status})`, st.json.regulars === null && add.status === 403, [st.json.regulars, add.json])
  const on = await B('GET', '/api/register/state')
  check('with it: the register offers the Regulars', on.json.regulars && Array.isArray(on.json.regulars.rewards), on.json.regulars)
}

console.log('\n══════════ 2. adding a regular ══════════')
let mike = ''
{
  check('one key for a phone however it is typed', L.phoneKey('+1 (715) 555-0142') === '7155550142' && L.phoneKey('715.555.0142') === '7155550142' && L.phoneKey('17155550142') === '7155550142')
  const noPhone = await B('POST', '/api/register/guests', { name: 'Mike' })
  check('a regular needs a phone number', noPhone.status === 400 && /phone number/.test(noPhone.json.error), noPhone.json)
  const a = await B('POST', '/api/register/guests', { name: 'Mike Kowalski', phone: '(715) 555-0142' })
  mike = a.json.guest?.id
  const [g] = await db.select().from(contact).where(eq(contact.id, mike))
  check('added: a guest (client), tagged regular, from the register, on the programme with 0 points', a.status === 200 && g.type === 'client' && (g.tags as string[]).includes('regular') && g.source === 'register' && a.json.guest.pointsBalance === 0, [a.json, g])
  const again = await B('POST', '/api/register/guests', { name: 'Somebody Else', phone: '+1 715 555 0142' })
  const [still] = await db.select().from(contact).where(eq(contact.id, mike))
  check('the same number, typed another way, is the same guest — whose name is not changed', again.json.guest?.id === mike && still.name === 'Mike Kowalski', [again.json, still.name])
  const members = await db.select().from(loyaltyMember).where(eq(loyaltyMember.contactId, mike))
  check('…and one membership, not two', members.length === 1)
  // An existing CRM guest (from the party form, say) found by phone: only the tag is added.
  const [pat] = await db.insert(contact).values({ name: 'Pat Party', type: 'lead', phone: '715-555-0199', companyId: co.id, tags: ['party'] } as any).returning()
  const p = await B('POST', '/api/register/guests', { name: 'Patricia', phone: '7155550199' })
  const [pp] = await db.select().from(contact).where(eq(contact.id, pat.id))
  check('an existing guest found by phone gets only the tag', p.json.guest?.id === pat.id && pp.name === 'Pat Party' && pp.type === 'lead' && JSON.stringify(pp.tags) === JSON.stringify(['party', 'regular']), pp)
  // Welcome points, once, when the bar gives them.
  const wset = await O('PUT', '/api/loyalty/config', { loyaltyWelcomePoints: 10 })
  check('an owner sets welcome points', wset.status === 200 && wset.json.loyaltyWelcomePoints === 10, wset.json)
  const w = await B('POST', '/api/register/guests', { name: 'Wendy', phone: '715-555-0111' })
  check('a new regular gets them', w.json.guest?.pointsBalance === 10, w.json)
  const w2 = await B('POST', '/api/register/guests', { name: 'Wendy', phone: '715-555-0111' })
  check('…once', w2.json.guest?.pointsBalance === 10, w2.json)
  await O('PUT', '/api/loyalty/config', { loyaltyWelcomePoints: 0 })
}

console.log('\n══════════ 3. finding a guest ══════════')
{
  const byPhone = await B('GET', '/api/register/guests?q=555-0142')
  const byName = await B('GET', '/api/register/guests?q=kowal')
  check('by phone digits, and by name, with their points', byPhone.json.guests?.[0]?.id === mike && byName.json.guests?.[0]?.id === mike && byPhone.json.guests[0].pointsBalance === 0, [byPhone.json, byName.json])
  const short = await B('GET', '/api/register/guests?q=m')
  check('one letter finds nothing (no dumping the list)', short.json.guests.length === 0)
}

console.log('\n══════════ 4. earning ══════════')
let mikeCheck = ''
{
  // 2 burgers ($20) + a beer ($5.50) + a $25 gift card; tax and a $4 tip on top. Earns floor($25.50) = 25.
  mikeCheck = await newCheck('Mike')
  await B('POST', `/api/register/check/${mikeCheck}/guest`, { contactId: mike })
  await ring(mikeCheck, burger.id); await ring(mikeCheck, burger.id); await ring(mikeCheck, beer.id)
  await B('POST', `/api/register/check/${mikeCheck}/giftcard`, { amountCents: 2500 })
  const bal = (await B('GET', `/api/register/check/${mikeCheck}`)).json.check.totals.balanceCents
  const paid = await B('POST', `/api/register/check/${mikeCheck}/pay`, { tender: 'card_external', amountCents: bal, tipCents: 400 })
  check('paid', paid.json.check?.status === 'paid', paid.json)
  check(`earned on the food and drink only: ${await balanceOf(mike)} points`, (await balanceOf(mike)) === 25)
  const [m] = await db.select().from(loyaltyMember).where(eq(loyaltyMember.contactId, mike))
  const earns = await db.select().from(loyaltyTransaction).where(and(eq(loyaltyTransaction.memberId, m.id), eq(loyaltyTransaction.type, 'earn')))
  check('one earn row, for this check', earns.length === 1 && earns[0].checkId === mikeCheck && earns[0].points === 25 && m.lifetimePoints === 25, earns)
  // The same check closing again (a retry, a replay) earns nothing more.
  const again = await db.transaction(async (tx: any) => L.earnForPaidCheck(tx, co.id, { id: mikeCheck, number: 1, contactId: mike, items: paid.json.check.items }, 'Jess T'))
  check('a check earns once, however often it is replayed', again === 0 && (await balanceOf(mike)) === 25, again)
  const noGuest = await newCheck('Nobody')
  await ring(noGuest, burger.id)
  const nb = (await B('GET', `/api/register/check/${noGuest}`)).json.check.totals.balanceCents
  await B('POST', `/api/register/check/${noGuest}/pay`, { tender: 'cash', amountCents: nb })
  check('a check with no guest earns nobody anything', (await db.select().from(loyaltyTransaction).where(eq(loyaltyTransaction.checkId, noGuest))).length === 0)
}

console.log('\n══════════ 5. redeeming ══════════')
{
  const r5 = await O('POST', '/api/loyalty/rewards', { name: '$5 off', pointsCost: 20, type: 'fixed', valueCents: 500 })
  const free = await O('POST', '/api/loyalty/rewards', { name: 'Free burger', pointsCost: 100, type: 'free_item', menuItemId: burger.id })
  const bart = await B('POST', '/api/loyalty/rewards', { name: 'Free everything', pointsCost: 1, type: 'percent', valueCents: 100 })
  check('an owner makes rewards; a bartender may not', r5.status === 201 && free.status === 201 && bart.status === 403, [r5.json, free.json, bart.json])
  const c = await newCheck('Mike again')
  const noGuest = await B('POST', `/api/register/check/${c}/reward`, { rewardId: r5.json.id })
  check('a reward needs a regular on the check', noGuest.status === 400 && /Put a regular/.test(noGuest.json.error), noGuest.json)
  await B('POST', `/api/register/check/${c}/guest`, { contactId: mike })
  await ring(c, burger.id); await ring(c, burger.id)
  const poor = await B('POST', `/api/register/check/${c}/reward`, { rewardId: free.json.id })
  check("the engine's refusal, in a bar's words", poor.status === 400 && /costs 100 points and the guest has 25/.test(poor.json.error), poor.json)
  const ok = await B('POST', `/api/register/check/${c}/reward`, { rewardId: r5.json.id })
  const line = ok.json.check?.items?.find((i: any) => i.kind === 'reward')
  check('$5 off goes on as a line; the points come off', ok.status === 200 && line?.unitPriceCents === -500 && line.name === '$5 off' && (await balanceOf(mike)) === 5, [line, await balanceOf(mike)])
  check('…and the tax is on what is left', ok.json.check.totals.subtotalCents === 1500 && ok.json.check.totals.taxCents === 83, ok.json.check.totals)
  const two = await B('POST', `/api/register/check/${c}/reward`, { rewardId: r5.json.id })
  check('one reward per check', two.status === 409 && /One reward per check/.test(two.json.error), two.json)
  const leave = await B('POST', `/api/register/check/${c}/guest`, { contactId: null })
  check('the guest cannot be taken off with their reward on the check', leave.status === 409 && /Take the reward off first/.test(leave.json.error), leave.json)
  const off = await B('POST', `/api/register/item/${line.id}/void`, {})
  check('taking the reward off needs no manager, and puts the points back', off.status === 200 && !off.json.check.items.some((i: any) => i.kind === 'reward') && (await balanceOf(mike)) === 25, [off.json?.error, await balanceOf(mike)])
  const on2 = await B('POST', `/api/register/check/${c}/reward`, { rewardId: r5.json.id })
  check('…and it can go on again', on2.status === 200 && (await balanceOf(mike)) === 5, on2.json)
  const [m] = await db.select().from(loyaltyMember).where(eq(loyaltyMember.contactId, mike))
  const led = await db.select().from(loyaltyTransaction).where(and(eq(loyaltyTransaction.memberId, m.id), eq(loyaltyTransaction.checkId, c)))
  check('the ledger: redeem, reversal, redeem', JSON.stringify(led.map((t) => t.type).sort()) === JSON.stringify(['redeem', 'redeem', 'reversal']), led.map((t) => [t.type, t.points]))
  const [rw] = await db.select().from(loyaltyReward).where(eq(loyaltyReward.id, r5.json.id))
  check('the reward counts one use', rw.usageCount === 1, rw.usageCount)
  // Paid: earns on the food after the reward ($15 → 15).
  const bal = (await B('GET', `/api/register/check/${c}`)).json.check.totals.balanceCents
  await B('POST', `/api/register/check/${c}/pay`, { tender: 'cash', amountCents: bal })
  check(`it earns on what the food came to after the reward (${await balanceOf(mike)} = 5 + 15)`, (await balanceOf(mike)) === 20)
  // A free item is ONE of it.
  await M('POST', `/api/loyalty/members/${mike}/adjust`, { points: 100, reason: 'Birthday' })
  const c2 = await newCheck('Free burger')
  await B('POST', `/api/register/check/${c2}/guest`, { contactId: mike })
  const missing = await B('POST', `/api/register/check/${c2}/reward`, { rewardId: free.json.id })
  check('a free item must be on the check first', missing.status === 400 && /Add Free burger to the check/.test(missing.json.error), missing.json)
  await B('POST', `/api/register/check/${c2}/items`, { menuItemId: burger.id, qty: 3 })
  const fr = await B('POST', `/api/register/check/${c2}/reward`, { rewardId: free.json.id })
  const fl = fr.json.check?.items?.find((i: any) => i.kind === 'reward')
  check('a free burger takes ONE burger off a line of three', fr.status === 200 && fl?.unitPriceCents === -1000, fl)
}

console.log('\n══════════ 6. corrections and the programme ══════════')
{
  const bart = await B('POST', `/api/loyalty/members/${mike}/adjust`, { points: 50, reason: 'pal' })
  check('a bartender may not hand out points', bart.status === 403, bart.json)
  const why = await M('POST', `/api/loyalty/members/${mike}/adjust`, { points: 5 })
  check('a correction needs a reason', why.status === 400 && /Say why/.test(why.json.error), why.json)
  const below = await M('POST', `/api/loyalty/members/${mike}/adjust`, { points: -99999, reason: 'oops' })
  check('never below zero', below.status === 409 && /below zero/.test(below.json.error), below.json)
  const hist = await M('GET', `/api/loyalty/members/${mike}`)
  check('the guest\'s ledger reads back, newest first, with who', hist.status === 200 && hist.json.history.length >= 5 && hist.json.history.some((h: any) => h.type === 'adjustment_add' && h.createdBy === 'Pat T' && h.description === 'Birthday'), hist.json.history?.map((h: any) => h.type))
  const mc = await M('PUT', '/api/loyalty/config', { loyaltyPointsPerDollar: 2 })
  check('a manager may not change the programme (loyalty:configure is admin and up)', mc.status === 403, mc.json)
  const bad = await O('PUT', '/api/loyalty/config', { loyaltyPointsPerDollar: -1 })
  check('a silly rate is refused', bad.status === 400 && /Points per dollar/.test(bad.json.error), bad.json)
  const offc = await O('PUT', '/api/loyalty/config', { loyaltyEnabled: false })
  const st = await B('GET', '/api/register/state')
  check("the bar's own switch turns the Regulars off on the register", offc.status === 200 && offc.json.loyaltyEnabled === false && st.json.regulars === null, st.json.regulars)
  await O('PUT', '/api/loyalty/config', { loyaltyEnabled: true })
}

console.log('\n══════════ 7. another company ══════════')
{
  const [other] = await db.insert(company).values({ name: 'Other Bar', slug: 'other-loy', email: 'ob@test.local', settings: {}, enabledFeatures: ALL } as any).returning()
  const ob = await mk(other.id, 'field', 'Oz', 'otherloy'), oo = await mk(other.id, 'owner', 'Oona', 'otherloy')
  const theirs = (await call(oo, other.id)('POST', '/api/loyalty/rewards', { name: 'Their $5', pointsCost: 1, type: 'fixed', valueCents: 500 })).json
  const c = await newCheck('Cross')
  await B('POST', `/api/register/check/${c}/guest`, { contactId: mike })
  await ring(c, burger.id)
  const x = await B('POST', `/api/register/check/${c}/reward`, { rewardId: theirs.id })
  check("another company's reward is not found", x.status === 404, x.json)
  const peek = await call(oo, other.id)('GET', `/api/loyalty/members/${mike}`)
  check("…nor this bar's guest's points", peek.status === 200 && peek.json.member === null, peek.json)
  const find = await call(ob, other.id)('GET', '/api/register/guests?q=kowal')
  check("…nor this bar's guests in a search", find.json.guests.length === 0, find.json)
}

console.log(`\nbar-regulars: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
