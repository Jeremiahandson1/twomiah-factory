// crm-bar — the bar's own records and what its website reads live, through the real routes on PGlite.
//   1. the two bar features gate the staff routes; switched off, the public reads answer 404
//   2. who may do what: a viewer reads; a bartender (field) works the console — 86, tap status, tonight,
//      a special — and may not edit the menu; a manager edits; only an owner/admin imports a whole menu
//   3. the menu: sizes from a price label, a typed price is dollars, refusals say why, a section with items
//      is not deleted, 86 and inactive reach the public menu correctly
//   4. taps: a blown keg leaves the public list; nothing private (keg level, inactive lines) is public
//   5. Tonight: overrides lapse at 4 AM the next business morning, the board says who and how busy
//   6. hours: refused when malformed; the live state follows them (kitchen and bar separately), on the bar's clock
//   7. specials and public events reach the live state / public list; unpublished events do not
//   8. the speakeasy password: hashed, never returned, checked case-insensitively, rate-limited
//   9. a cancelled company's public reads stop (402 ACCOUNT_LOCKED)
//  10. the import upserts (twice = once) and derives sizes; every write leaves an audit row
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 500)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S = await import('./db/schema.ts')
const { company, user, auditLog, barSettings, barStatus, barMenuItem, barTap } = S
const { requestScope } = await import('./src/services/audit.ts')
const { buildLiveState, endOfBusinessDay } = await import('./src/services/barLive.ts')

const ALL = ['contacts', 'invoices', 'team', 'dashboard', 'bar_menu', 'bar_tonight']
const [co] = await db.insert(company).values({ name: 'The Tap Room', slug: 'taproom-bl', email: 'bar@test.local', state: 'WI', settings: {}, enabledFeatures: ALL } as any).returning()
const mk = async (role: string, first: string) => (await db.insert(user).values({ email: `${role}-bl@test.local`, passwordHash: 'x', firstName: first, lastName: 'T', role, companyId: co.id, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'Olive'), manager = await mk('manager', 'Max'), bartender = await mk('field', 'Bea'), viewer = await mk('viewer', 'Vic')

const app = new Hono()
app.use('*', (c, next) => requestScope.run({ c }, next))
app.route('/api/bar', (await import('./src/routes/bar.ts')).default)
app.route('/api/public/bar', (await import('./src/routes/barPublic.ts')).default)
app.onError((err: any, c: any) => c.json({ error: err?.message || 'Internal error' }, err?.status || 500))

const call = (who: any | null) => async (method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' }
  if (who) Object.assign(headers, { 'x-test-user': who.id, 'x-test-company': co.id, 'x-test-role': who.role })
  const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const O = call(owner), M = call(manager), B = call(bartender), V = call(viewer), PUB = call(null)
const settle = () => new Promise((r) => setTimeout(r, 120))
const setFeatures = (list: string[]) => db.update(company).set({ enabledFeatures: list } as any).where(eq(company.id, co.id))

console.log('\n══════════ 1. the features gate the routes ══════════')
{
  // A second company with the bar features off (the gate caches per company for 15 s, so the switch is
  // tested on a company that never had them rather than by flipping this one back and forth).
  const [other] = await db.insert(company).values({ name: 'Not A Bar', slug: 'notabar-bl', email: 'nb@test.local', settings: {}, enabledFeatures: ['contacts'] } as any).returning()
  const [otherOwner] = await db.insert(user).values({ email: 'owner-nb@test.local', passwordHash: 'x', firstName: 'N', lastName: 'B', role: 'owner', companyId: other.id, isActive: true } as any).returning()
  const asOther = async (path: string) => (await app.request(path, { headers: { 'x-test-user': otherOwner.id, 'x-test-company': other.id, 'x-test-role': 'owner' } })).status
  const t = await asOther('/api/bar/tonight'), m = await asOther('/api/bar/menu')
  check(`with Tonight and Menu off, the staff routes refuse (${t}, ${m})`, t === 403 && m === 403)
  // The public reads answer for the bar this database was made for (the oldest company), read fresh.
  await setFeatures(['contacts'])
  const pl = await PUB('GET', '/api/public/bar/live'), pm = await PUB('GET', '/api/public/bar/menu')
  check(`…and with them off, the website's reads answer 404, not data (${pl.status}, ${pm.status})`, pl.status === 404 && pm.status === 404)
  await setFeatures(ALL)
  check('switched on, they answer', (await O('GET', '/api/bar/tonight')).status === 200 && (await PUB('GET', '/api/public/bar/live')).status === 200)
}

console.log('\n══════════ 2/3. the menu, and who may change it ══════════')
let burgers = '', drinks = '', cheese = '', fish = ''
{
  const s = await M('POST', '/api/bar/menu/sections', { name: 'Burgers', description: 'Half-pound beef. Sandwich / platter.' })
  check(`a manager adds a section (${s.status})`, s.status === 201 && s.json.slug === 'burgers', s.json)
  burgers = s.json.id
  const d = await M('POST', '/api/bar/menu/sections', { name: 'Drinks', kind: 'drink' })
  drinks = d.json.id
  check('a second section, a drink one', d.status === 201 && d.json.kind === 'drink', d.json)
  const bs = await B('POST', '/api/bar/menu/sections', { name: 'Secret' })
  check(`a bartender may not add a section (${bs.status})`, bs.status === 403)

  const i = await M('POST', '/api/bar/menu/items', { sectionId: burgers, name: 'Cheeseburger', priceCents: 649, priceLabel: '$6.49 / $7.99', description: 'Real cheddar.' })
  check(`an item with a two-price label (${i.status})`, i.status === 201 && i.json.slug === 'cheeseburger', i.json)
  cheese = i.json.id
  check('…gets one size per price from its label', Array.isArray(i.json.variations) && i.json.variations.length === 2 && i.json.variations[1].priceCents === 799, i.json.variations)
  const f = await M('POST', '/api/bar/menu/items', { sectionId: burgers, name: 'Fish Fry', price: '9' })
  check(`a typed "9" is nine DOLLARS, not 9 cents (${f.json?.priceCents})`, f.status === 201 && f.json.priceCents === 900, f.json)
  fish = f.json.id
  const bad = await M('POST', '/api/bar/menu/items', { sectionId: burgers, name: 'Mystery', price: 'a lot' })
  check(`a price that is not a price is refused, saying so (${bad.status})`, bad.status === 400 && /not a price/.test(bad.json?.error), bad.json)
  const noName = await M('POST', '/api/bar/menu/items', { sectionId: burgers, priceCents: 100 })
  check('an item with no name is refused', noName.status === 400 && /needs a name/.test(noName.json?.error), noName.json)
  const otherCo = await M('POST', '/api/bar/menu/items', { sectionId: 'not-a-section', name: 'Ghost' })
  check('an item cannot be filed under a section that does not exist', otherCo.status === 400, otherCo.json)
  const dup = await M('POST', '/api/bar/menu/items', { sectionId: burgers, name: 'Cheeseburger', priceCents: 700 })
  check('a second item with the same name gets its own address', dup.status === 201 && dup.json.slug === 'cheeseburger-2', dup.json)
  await M('PUT', `/api/bar/menu/items/${dup.json.id}`, { isActive: false })

  const vEdit = await V('PUT', `/api/bar/menu/items/${cheese}`, { name: 'Free burger' })
  check(`a viewer may not edit the menu (${vEdit.status})`, vEdit.status === 403)
  const vRead = await V('GET', '/api/bar/menu')
  check('…but reads it', vRead.status === 200 && vRead.json.sections.some((x: any) => x.slug === 'burgers'), vRead.json)

  const b86 = await B('PUT', `/api/bar/menu/items/${fish}/86`, { is86ed: true })
  check(`the bartender 86es the fish (${b86.status})`, b86.status === 200 && b86.json.is86ed === true, b86.json)
  const v86 = await V('PUT', `/api/bar/menu/items/${fish}/86`, { is86ed: false })
  check(`a viewer cannot (${v86.status})`, v86.status === 403)
  const bEdit = await B('PUT', `/api/bar/menu/items/${fish}`, { priceCents: 1 })
  check(`a bartender may 86 but not reprice (${bEdit.status})`, bEdit.status === 403)

  const pub = await PUB('GET', '/api/public/bar/menu')
  const pBurgers = pub.json?.sections?.find((x: any) => x.slug === 'burgers')
  check('the website\'s menu lists the section and its active items', pub.status === 200 && pBurgers?.items?.length === 2, pBurgers)
  check('…with the 86 shown (greyed on the site, still listed)', pBurgers?.items?.find((x: any) => x.slug === 'fish-fry')?.is86ed === true, pBurgers?.items)
  check('…an inactive item not at all', !pBurgers?.items?.some((x: any) => x.slug === 'cheeseburger-2'))
  check('…prices formatted for people ("$9", the label when there is one)', pBurgers?.items?.find((x: any) => x.slug === 'fish-fry')?.price === '$9' && pBurgers?.items?.find((x: any) => x.slug === 'cheeseburger')?.price === '$6.49 / $7.99', pBurgers?.items?.map((x: any) => x.price))
  check('…and nothing internal (no ids, no company)', !JSON.stringify(pub.json).includes(co.id) && !('id' in (pBurgers?.items?.[0] || {})), pBurgers?.items?.[0])
  const one = await PUB('GET', '/api/public/bar/menu/cheeseburger'), gone = await PUB('GET', '/api/public/bar/menu/cheeseburger-2')
  check(`one item's own page reads it; an inactive one is 404 (${one.status}, ${gone.status})`, one.status === 200 && one.json.section?.slug === 'burgers' && gone.status === 404)
  const del = await M('DELETE', `/api/bar/menu/sections/${burgers}`)
  check(`a section with items in it is not deleted (${del.status})`, del.status === 409 && /Move or delete/.test(del.json?.error), del.json)
}

console.log('\n══════════ 4. taps ══════════')
{
  const t1 = await M('POST', '/api/bar/taps', { lineNumber: 1, beerName: 'Spotted Cow', brewery: 'New Glarus', style: 'Farmhouse Ale', abv: 4.8, price: '5.5' })
  const t2 = await M('POST', '/api/bar/taps', { lineNumber: 2, beerName: 'Hacker-Pschorr Weisse', brewery: 'Hacker-Pschorr', originCountry: 'Germany', abv: '5.5' })
  check(`a manager puts two beers on (${t1.status}, ${t2.status})`, t1.status === 201 && t2.status === 201, [t1.json, t2.json])
  const badAbv = await M('POST', '/api/bar/taps', { lineNumber: 3, beerName: 'Rocket Fuel', abv: 140 })
  check('an ABV over 70% is refused', badAbv.status === 400 && /ABV/.test(badAbv.json?.error), badAbv.json)
  const bNew = await B('POST', '/api/bar/taps', { lineNumber: 4, beerName: 'Mine' })
  check(`a bartender may not put a new beer on a line (${bNew.status})`, bNew.status === 403)
  const blow = await B('PUT', `/api/bar/taps/${t2.json.id}/status`, { status: 'blown' })
  check(`…but blows a keg (${blow.status})`, blow.status === 200 && blow.json.status === 'blown' && !!blow.json.blownAt, blow.json)
  const badStatus = await B('PUT', `/api/bar/taps/${t1.json.id}/status`, { status: 'empty-ish' })
  check('a status that is not one is refused', badStatus.status === 400)
  const pub = await PUB('GET', '/api/public/bar/taps')
  check('the website\'s tap list leaves the blown keg off', pub.status === 200 && pub.json.taps.length === 1 && pub.json.taps[0].beerName === 'Spotted Cow', pub.json)
  check('…prices formatted, nothing private', pub.json.taps[0].price === '$5.50' && !('isActive' in pub.json.taps[0]) && !('tappedAt' in pub.json.taps[0]), pub.json.taps[0])
}

console.log('\n══════════ 5/6. hours and Tonight ══════════')
{
  const bad = await M('PUT', '/api/bar/settings', { hours: { bar: { fri: [{ open: '11am', close: '2am' }] }, kitchen: {} } })
  check(`hours not in HH:MM are refused, saying so (${bad.status})`, bad.status === 400 && /HH:MM/.test(bad.json?.error), bad.json)
  const badTz = await M('PUT', '/api/bar/settings', { hours: { timezone: 'Mars/Olympus', bar: {}, kitchen: {} } })
  check('a time zone that is not one is refused', badTz.status === 400 && /time zone/.test(badTz.json?.error), badTz.json)
  const bHours = await B('PUT', '/api/bar/settings', { hours: { bar: {}, kitchen: {} } })
  check(`a bartender may not change the hours (${bHours.status})`, bHours.status === 403)
  // Bar Tue–Sat 11:00–02:00, kitchen 11:00–21:00. No timezone given: the company is in WI → Central.
  const week = (open: string, close: string) => Object.fromEntries(['tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open, close }]]))
  const ok = await M('PUT', '/api/bar/settings', { hours: { bar: week('11:00', '02:00'), kitchen: week('11:00', '21:00') } })
  check(`hours saved; the zone comes from the company's state (${ok.json?.hours?.timezone})`, ok.status === 200 && ok.json.hours.timezone === 'America/Chicago', ok.json)

  // Friday 2026-10-16, 9:30 PM Central = 02:30Z on the 17th: bar open, kitchen closed.
  const fri930 = new Date('2026-10-17T02:30:00Z')
  const l1 = await buildLiveState(co.id, fri930)
  check(`Friday 9:30 PM: the bar is open, the kitchen is closed — separately (${l1.bar.isOpen}, ${l1.kitchen.isOpen})`, l1.bar.isOpen === true && l1.kitchen.isOpen === false, { bar: l1.bar.line, kitchen: l1.kitchen.line })
  check(`…on the bar's own clock (localDate ${l1.localDate}, closes "${l1.bar.short}")`, l1.localDate === '2026-10-16' && l1.bar.short === 'closes 2 AM', l1.bar)
  const sun = await buildLiveState(co.id, new Date('2026-10-18T18:00:00Z'))
  check('Sunday: closed (no hours that day)', sun.bar.isOpen === false && sun.kitchen.isOpen === false, sun.bar)

  const room = await B('PUT', '/api/bar/tonight', { roomStatus: 'packed', note: 'Packers on all screens' })
  check(`the bartender sets how busy and the note (${room.status})`, room.status === 200 && room.json.live.room.label === 'Packed' && room.json.live.note === 'Packers on all screens', room.json?.live)
  check('…and the board says who did it', room.json.live.updatedBy === 'Bea', room.json.live.updatedBy)
  const badRoom = await B('PUT', '/api/bar/tonight', { roomStatus: 'wild' })
  check('a room status that is not one is refused', badRoom.status === 400, badRoom.json)
  const close = await B('PUT', '/api/bar/tonight', { kitchenOpen: false })
  const [st] = await db.select().from(barStatus).where(eq(barStatus.companyId, co.id))
  const expectUntil = endOfBusinessDay(new Date(), 'America/Chicago').getTime()
  check(`"kitchen closed" lapses at the next 4 AM on the bar's clock (${st.overrideUntil?.toISOString()})`, close.status === 200 && st.kitchenOpen === false && st.overrideUntil?.getTime() === expectUntil, st)
  check('…the live board shows the kitchen closed now', (await buildLiveState(co.id)).kitchen.isOpen === false)
  const lapsed = await buildLiveState(co.id, new Date(expectUntil + 60_000))
  check('…and after it lapses, the hours rule again (no stale "closed" the next day)', lapsed.kitchen.source !== 'manual', lapsed.kitchen)
  const clear = await B('PUT', '/api/bar/tonight', { kitchenOpen: null })
  const [st2] = await db.select().from(barStatus).where(eq(barStatus.companyId, co.id))
  check('clearing the last override clears its expiry too', clear.status === 200 && st2.kitchenOpen === null && st2.overrideUntil === null, st2)
  check('a viewer cannot work the console', (await V('PUT', '/api/bar/tonight', { roomStatus: 'quiet' })).status === 403)
  // endOfBusinessDay: before 4 AM still belongs to last night.
  const e1 = endOfBusinessDay(new Date('2026-10-17T07:30:00Z'), 'America/Chicago') // 2:30 AM CDT Sat
  const e2 = endOfBusinessDay(new Date('2026-10-17T02:30:00Z'), 'America/Chicago') // 9:30 PM CDT Fri
  check(`2:30 AM lapses at 4 AM the same morning; 9:30 PM at 4 AM the next (${e1.toISOString()}, ${e2.toISOString()})`, e1.toISOString() === '2026-10-17T09:00:00.000Z' && e2.toISOString() === '2026-10-17T09:00:00.000Z')
}

console.log('\n══════════ 7. specials, games and events ══════════')
{
  const sp = await B('POST', '/api/bar/specials', { title: 'Walleye basket', price: '12.5' })
  check(`the bartender posts tonight's special (${sp.status})`, sp.status === 201 && !!sp.json.endsAt, sp.json)
  const live = await buildLiveState(co.id)
  check(`…it is on the board with its price ("${live.special?.price}")`, live.special?.title === 'Walleye basket' && live.special?.price === '$12.50', live.special)
  const badDays = await M('POST', '/api/bar/specials', { title: 'Taco Tuesday', isRecurring: true, recurrenceDays: 'tuesdays' })
  check('weekdays not as codes are refused', badDays.status === 400 && /MO,TU/.test(badDays.json?.error), badDays.json)
  const ev = await B('POST', '/api/bar/events', { title: 'Trivia Night', startsAt: new Date(Date.now() + 86400000).toISOString() })
  const hidden = await M('POST', '/api/bar/events', { title: 'Staff party', startsAt: new Date(Date.now() + 2 * 86400000).toISOString(), isPublished: false })
  check(`events posted (${ev.status}, ${hidden.status})`, ev.status === 201 && hidden.status === 201 && ev.json.slug === 'trivia-night')
  const pub = await PUB('GET', '/api/public/bar/events')
  check('the website lists the published event, not the unpublished one', pub.status === 200 && pub.json.events.length === 1 && pub.json.events[0].slug === 'trivia-night', pub.json)
  const g = await B('POST', '/api/bar/games', { league: 'NFL', home: 'Packers', away: 'Bears', startsAt: new Date(Date.now() + 3600000).toISOString(), isFeatured: true })
  check(`a featured game (${g.status}) shows on the board`, g.status === 201 && (await buildLiveState(co.id)).game?.home === 'Packers')
  const hrs = await PUB('GET', '/api/public/bar/hours')
  check('the website reads the hours, bar and kitchen separately', hrs.status === 200 && hrs.json.bar.fri?.[0]?.close === '02:00' && hrs.json.kitchen.fri?.[0]?.close === '21:00' && hrs.json.timezone === 'America/Chicago', hrs.json)
}

console.log('\n══════════ 8. the speakeasy door ══════════')
{
  const off = await PUB('POST', '/api/public/bar/speakeasy', { answer: 'anything' })
  check(`no password set: the door is not there (${off.status})`, off.status === 404)
  const set = await M('PUT', '/api/bar/settings', { speakeasyPassword: 'Walter Brewing', speakeasyNote: '$1 off a root beer' })
  check('a manager sets the password', set.status === 200 && set.json.speakeasy.enabled === true, set.json)
  check('…the settings never send it back, or its hash', !JSON.stringify(set.json).toLowerCase().includes('walter brewing') && !JSON.stringify(set.json).includes('$2'), set.json)
  const [row] = await db.select().from(barSettings).where(eq(barSettings.companyId, co.id))
  check('…it is stored as a bcrypt hash', /^\$2[aby]\$/.test(row.speakeasyPasswordHash || ''), row.speakeasyPasswordHash?.slice(0, 4))
  check('the live state says the door is on, and nothing more', (await buildLiveState(co.id)).speakeasy.enabled === true)
  const wrong = await PUB('POST', '/api/public/bar/speakeasy', { answer: 'ginger ale' })
  check('a wrong answer is just "no"', wrong.status === 200 && wrong.json.ok === false && !wrong.json.note, wrong.json)
  const right = await PUB('POST', '/api/public/bar/speakeasy', { answer: '  WALTER brewing ' })
  check('the right one, in any case, opens it and says what it is good for', right.json.ok === true && right.json.note === '$1 off a root beer', right.json)
  let last: any = null
  for (let i = 0; i < 12; i++) last = await PUB('POST', '/api/public/bar/speakeasy', { answer: 'guess' + i })
  check(`knocking over and over is slowed down (${last.status})`, last.status === 429, last.json)
  await settle()
  const [audited] = (await db.select().from(auditLog).where(and(eq(auditLog.companyId, co.id), eq(auditLog.entity, 'bar_settings')))) as any[]
  check('the audit row says the password changed, never what it is', !!audited && !JSON.stringify(audited).toLowerCase().includes('walter brewing'), audited?.changes)
}

console.log('\n══════════ 9. a cancelled bar\'s page stops ══════════')
{
  await db.update(company).set({ settings: { subscriptionStatus: 'canceled', billingStatus: 'canceled' } } as any).where(eq(company.id, co.id))
  const l = await PUB('GET', '/api/public/bar/live'), m = await PUB('GET', '/api/public/bar/menu')
  check(`locked: the website's reads answer 402 ACCOUNT_LOCKED (${l.status}, ${m.status})`, l.status === 402 && l.json.code === 'ACCOUNT_LOCKED' && m.status === 402)
  await db.update(company).set({ settings: {} } as any).where(eq(company.id, co.id))
}

console.log('\n══════════ 10. the import, and the audit trail ══════════')
{
  const menu = { menu: { sections: [
    { name: 'Daily Specials', description: 'Burger / platter with a choice of one side.', items: [
      { name: 'Wednesday Wings', priceCents: 799, priceLabel: '15 / $7.99 · 20 / $10.39' },
      { name: 'Friday Fish Fry Special', priceCents: 949, priceLabel: '$9.49', isSignature: true },
    ] },
  ] }, taps: [{ lineNumber: 7, beerName: 'Root Beer', badge: 'George Berg Soft Drinks Co. — Est. 1920' }],
  events: [{ title: 'Fish Fry', startsAt: '2026-10-23T22:00:00Z', isRecurring: true, recurrenceDays: 'FR' }],
  hours: { bar: { fri: [{ open: '11:00', close: '02:00' }] }, kitchen: { fri: [{ open: '11:00', close: '21:00' }] } } }
  const mgr = await M('POST', '/api/bar/import', menu)
  check(`a manager may not import a whole menu (${mgr.status})`, mgr.status === 403, mgr.json)
  const once = await O('POST', '/api/bar/import', menu)
  check(`the owner imports (${once.status})`, once.status === 200 && once.json.imported.items === 2 && once.json.imported.taps === 1 && once.json.imported.hours === true, once.json)
  const before = (await db.select().from(barMenuItem).where(eq(barMenuItem.companyId, co.id))).length
  const twice = await O('POST', '/api/bar/import', menu)
  const after = (await db.select().from(barMenuItem).where(eq(barMenuItem.companyId, co.id))).length
  check(`running it again changes nothing (${before} → ${after} items)`, twice.status === 200 && before === after)
  const [wings] = await db.select().from(barMenuItem).where(and(eq(barMenuItem.companyId, co.id), eq(barMenuItem.slug, 'wednesday-wings')))
  check('the import derives sizes from a label ("15 / $7.99 · 20 / $10.39")', JSON.stringify((wings.variations as any[]).map((v) => v.priceCents)) === '[799,1039]', wings.variations)
  const taps7 = await db.select().from(barTap).where(and(eq(barTap.companyId, co.id), eq(barTap.lineNumber, 7)))
  check('a tap line imported twice is one line', taps7.length === 1, taps7.length)
  const badImport = await O('POST', '/api/bar/import', { taps: [{ lineNumber: 0, beerName: 'Zero' }] })
  check('a bad row is refused before anything is written, naming it', badImport.status === 400 && /Tap 0/.test(badImport.json?.error), badImport.json)
  await settle()
  const rows = (await db.select().from(auditLog).where(eq(auditLog.companyId, co.id))) as any[]
  const entities = new Set(rows.map((r) => r.entity))
  check(`every kind of write left audit rows (${[...entities].sort().join(', ')})`, ['bar_menu_section', 'bar_menu_item', 'bar_tap', 'bar_status', 'bar_special', 'bar_event', 'bar_game', 'bar_settings', 'bar_import'].every((e) => entities.has(e)), [...entities])
}

console.log(`\nbar-live: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
