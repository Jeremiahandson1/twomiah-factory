// Sample Corner Tap & Table: a bar and grill that also books private parties. A menu, a tap list, a night's checks rung up,
// a stock room, a week's schedule, regulars, and parties in every stage (enquiry → booked → deposit → banquet event order).
// Every name is invented; people are they/them in anything written about them.
import type { Kit } from './kit.ts'

export default async function seed(k: Kit) {
  const { post, put, patch, day, at } = k

  const team = {
    reese: await k.addUser({ email: 'reese@restaurant-bar.example', firstName: 'Reese', lastName: 'Okafor', role: 'manager', phone: '(715) 555-0211', hourlyRate: '24.00' }),
    sky: await k.addUser({ email: 'sky@restaurant-bar.example', firstName: 'Sky', lastName: 'Marlow', role: 'field', phone: '(715) 555-0212', hourlyRate: '11.00' }),
    dana: await k.addUser({ email: 'dana@restaurant-bar.example', firstName: 'Dana', lastName: 'Whitfield', role: 'field', phone: '(715) 555-0213', hourlyRate: '11.00' }),
    ash: await k.addUser({ email: 'ash@restaurant-bar.example', firstName: 'Ash', lastName: 'Lindqvist', role: 'field', phone: '(715) 555-0214', hourlyRate: '15.50' }),
  }

  // ── hours: bar every day, kitchen a little shorter ──────────────────────────────────────────────────────────
  const week = (open: string, close: string) => Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open, close }]]))
  await put('/api/bar/settings', { hours: { bar: week('11:00', '23:59'), kitchen: week('11:00', '21:30'), holidays: [] } })

  // ── the menu ────────────────────────────────────────────────────────────────────────────────────────────
  const section = (name: string, kind: 'food' | 'drink', sortOrder: number, description?: string) => post('/api/bar/menu/sections', { name, kind, sortOrder, ...(description ? { description } : {}) })
  const starters = await section('Starters', 'food', 1, 'Made to share.')
  const burgers = await section('Burgers & Sandwiches', 'food', 2, 'Served with fries or slaw.')
  const mains = await section('From the Grill', 'food', 3)
  const cocktails = await section('Cocktails', 'drink', 4)
  const soft = await section('Soft Drinks', 'drink', 5)
  const item = (sectionId: string, name: string, priceCents: number, extra: Record<string, unknown> = {}) => post('/api/bar/menu/items', { sectionId, name, priceCents, ...extra })
  const wings = await item(starters.id, 'Smoked Wings', 1300, { description: 'Dry-rubbed, then sauced. Bleu cheese or ranch.', dietary: ['GF'] })
  await item(starters.id, 'Cheese Curds', 1100, { description: 'Beer-battered, with spicy ranch.' })
  await item(starters.id, 'Soft Pretzel', 900, { description: 'With beer cheese and mustard.' })
  const burger = await item(burgers.id, 'Corner Burger', 1500, {
    description: 'Half-pound patty, cheddar, pickles, house sauce.',
    modifiers: [{ id: 'modbacon01', name: 'Add bacon', priceCents: 200 }, { id: 'modnoonion', name: 'No onions', priceCents: 0 }],
  })
  await item(burgers.id, 'Crispy Chicken Sandwich', 1400, { description: 'Hot honey, slaw, brioche bun.' })
  await item(burgers.id, 'Black Bean Burger', 1400, { description: 'Grilled corn salsa, avocado.', dietary: ['V'] })
  const ribeye = await item(mains.id, 'Ribeye, 12 oz', 2900, { description: 'Garlic butter, roasted potatoes, seasonal greens.' })
  await item(mains.id, 'Whitefish Plate', 2200, { description: 'Pan-seared, lemon caper sauce, wild rice.' })
  const oldFashioned = await item(cocktails.id, 'Old Fashioned', 1100, { description: 'Bourbon, bitters, orange.' })
  await item(cocktails.id, 'Corner Margarita', 1000, { description: 'Lime, agave, salt rim.' })
  await item(cocktails.id, 'Moscow Mule', 1000, { description: 'Vodka, ginger beer, lime.' })
  const soda = await item(soft.id, 'Fountain Soda', 300, { description: 'Free refills at the table.' })
  const sold86 = await item(starters.id, 'Fried Pickle Chips', 900, { description: 'Dill chips, spicy ranch.' })
  await put(`/api/bar/menu/items/${sold86.id}/86`, { is86ed: true })

  // ── the taps ────────────────────────────────────────────────────────────────────────────────────────────
  const taps = [
    { lineNumber: 1, beerName: 'Sample Lager', brewery: 'Northwoods Brewing', style: 'American Lager', abv: 4.8, sizes: [{ id: 'pint', name: 'Pint', oz: 16, priceCents: 600 }, { id: 'pitcher', name: 'Pitcher', oz: 60, priceCents: 1800 }] },
    { lineNumber: 2, beerName: 'Hazy Eau Claire IPA', brewery: 'Chippewa Valley Beer Co.', style: 'Hazy IPA', abv: 6.6, sizes: [{ id: 'pint', name: 'Pint', oz: 16, priceCents: 700 }] },
    { lineNumber: 3, beerName: 'Barn Door Brown', brewery: 'Northwoods Brewing', style: 'Brown Ale', abv: 5.2, sizes: [{ id: 'pint', name: 'Pint', oz: 16, priceCents: 650 }] },
    { lineNumber: 4, beerName: 'Orchard Cider', brewery: 'Maple Hollow Cidery', style: 'Dry Cider', abv: 5.5, sizes: [{ id: 'pint', name: 'Pint', oz: 16, priceCents: 650 }] },
  ]
  const tapRows: Array<{ id: string }> = []
  for (const t of taps) tapRows.push(await post('/api/bar/taps', t))

  // ── tonight: a special, a game on, an event ─────────────────────────────────────────────────────────────
  await post('/api/bar/specials', { title: 'Wing night', description: 'Smoked wings, half off until 9.', priceCents: 650 })
  await post('/api/bar/games', { league: 'NFL', home: 'Sample Wolves', away: 'Sample Harbor Hawks', startsAt: at(2, '19:20'), isFeatured: true, note: 'Sound on in the back room.' })
  await post('/api/bar/events', { title: 'Trivia night', description: 'Teams of up to six. Prizes for the top three.', startsAt: at(3, '19:00'), endsAt: at(3, '21:30'), isPublished: true })
  await post('/api/bar/events', { title: 'Live music: the Sample Trio', description: 'No cover.', startsAt: at(6, '20:00'), endsAt: at(6, '23:00'), isPublished: true })

  // ── regulars and gift cards ─────────────────────────────────────────────────────────────────────────────
  await put('/api/loyalty/config', { loyaltyEnabled: true, loyaltyPointsPerDollar: 1, loyaltyWelcomePoints: 25 })
  await post('/api/loyalty/rewards', { name: '10% off your check', pointsCost: 150, type: 'percent', valueCents: 10 })
  await post('/api/loyalty/rewards', { name: '$5 off your check', pointsCost: 100, type: 'fixed', valueCents: 500 })
  const regulars = []
  for (const [name, phone, email] of [
    ['Jules Aldous', '(715) 555-0231', 'jules.aldous@example.com'],
    ['Pat Quill', '(715) 555-0232', 'pat.quill@example.com'],
    ['Robin Teague', '(715) 555-0233', 'robin.teague@example.com'],
    ['Skyler Brandt', '(715) 555-0234', 'skyler.brandt@example.com'],
  ]) regulars.push((await post('/api/register/guests', { name, phone, email })).guest)

  // ── a night's checks, rung up and paid ──────────────────────────────────────────────────────────────────
  const itemOn = (checkId: string, menuItemId: string, qty = 1, extra: Record<string, unknown> = {}) => post(`/api/register/check/${checkId}/items`, { menuItemId, qty, ...extra })
  const settled = async (open: { check: { id: string } }, tender: 'cash' | 'card_external', amountFrom: (c: any) => number, tipCents: number) => {
    const got = await k.api('GET', `/api/register/check/${open.check.id}`)
    const c = got.check ?? got
    await post(`/api/register/check/${open.check.id}/pay`, { tender, amountCents: amountFrom(c), tipCents, ...(tender === 'cash' ? { cashTenderedCents: Math.ceil((amountFrom(c) + tipCents) / 500) * 500 } : {}) })
  }
  const totalDue = (c: any) => Number(c.totals.balanceCents)

  const a = await post('/api/register/check', { kind: 'table', spot: 'Table 4' })
  await itemOn(a.check.id, burger.id, 2)
  await itemOn(a.check.id, wings.id)
  await itemOn(a.check.id, soda.id, 2)
  await post(`/api/register/check/${a.check.id}/send`)
  await settled(a, 'card_external', totalDue, 800)

  const b = await post('/api/register/check', { kind: 'tab', label: 'Pat' })
  await itemOn(b.check.id, oldFashioned.id, 2)
  await settled(b, 'cash', totalDue, 400)

  const c = await post('/api/register/check', { kind: 'table', spot: 'Table 9' })
  await itemOn(c.check.id, ribeye.id, 2)
  await itemOn(c.check.id, oldFashioned.id, 2)
  await post(`/api/register/check/${c.check.id}/send`)
  await settled(c, 'card_external', totalDue, 1200)

  // Left open for the visitor to find: a tab and a table still running.
  const open1 = await post('/api/register/check', { kind: 'tab', label: 'Skyler' })
  await itemOn(open1.check.id, oldFashioned.id)
  await itemOn(open1.check.id, wings.id)
  await post(`/api/register/check/${open1.check.id}/send`)
  const open2 = await post('/api/register/check', { kind: 'table', spot: 'Table 2' })
  await itemOn(open2.check.id, burger.id)
  await itemOn(open2.check.id, soda.id)
  void tapRows

  // ── stock, vendors and an order ─────────────────────────────────────────────────────────────────────────
  const vendor = await post('/api/stock/vendors', { name: 'Northwoods Distributing', contactName: 'Sample Rep', phone: '(715) 555-0241', email: 'orders@northwoods-dist.example', orderDays: 'Mon, Thu' })
  const grocer = await post('/api/stock/vendors', { name: 'Valley Produce & Meats', contactName: 'Sample Dispatcher', phone: '(715) 555-0242', email: 'orders@valleyproduce.example', orderDays: 'Tue, Fri' })
  const stockItem = (name: string, category: string, unit: string, packName: string, packSize: number, packCostCents: number, parPacks: number, vendorId: string) =>
    post('/api/stock/items', { name, category, unit, packName, packSize, packCostCents, parPacks, vendorId })
  const keg = await stockItem('Sample Lager keg', 'beer', 'each', 'keg', 1, 14500, 2, vendor.vendor?.id ?? vendor.id)
  await stockItem('Bourbon, 750 ml', 'liquor', 'each', 'bottle', 1, 2400, 4, vendor.vendor?.id ?? vendor.id)
  await stockItem('Ground beef, 5 lb', 'food', 'lb', 'case', 5, 2650, 6, grocer.vendor?.id ?? grocer.id)
  await stockItem('Brioche buns', 'food', 'each', 'case of 48', 48, 2200, 3, grocer.vendor?.id ?? grocer.id)
  void keg
  await post('/api/stock/orders/draft-low').catch(() => {})

  // ── the schedule: this week ─────────────────────────────────────────────────────────────────────────────
  const shifts: Array<[number, { id: string }, string, string, string]> = [
    [0, team.reese, '11:00', '19:00', 'Manager'], [0, team.sky, '16:00', '23:00', 'Bartender'], [0, team.ash, '11:00', '21:00', 'Grill'],
    [1, team.reese, '11:00', '19:00', 'Manager'], [1, team.dana, '16:00', '23:00', 'Bartender'], [1, team.ash, '11:00', '21:00', 'Grill'],
    [2, team.sky, '16:00', '23:00', 'Bartender'], [2, team.dana, '11:00', '19:00', 'Server'], [2, team.ash, '11:00', '21:00', 'Grill'],
  ]
  for (const [offset, who, start, end, position] of shifts) await post('/api/schedule/shifts', { userId: who.id, day: day(offset), start, end, position }).catch(() => {})

  // ── private parties ─────────────────────────────────────────────────────────────────────────────────────
  const backRoom = await post('/api/event-spaces', { name: 'Back Room', description: 'A private room with its own bar and a screen.', seatedCapacity: 40, standingCapacity: 60, minimumSpend: 800, hireFee: 150, amenities: ['Private bar', 'Projector', 'Sound system'] })
  const patio = await post('/api/event-spaces', { name: 'Patio', description: 'Covered, heated, string lights.', seatedCapacity: 30, standingCapacity: 45, minimumSpend: 500, hireFee: 0, amenities: ['Heaters', 'Lawn games'] })
  const wholeBar = await post('/api/event-spaces', { name: 'The Whole Place', description: 'Everything, for a buyout.', seatedCapacity: 90, standingCapacity: 140, minimumSpend: 4000, hireFee: 500 })

  const bbq = await post('/api/menu-packages', { name: 'Taproom Buffet', description: 'Smoked wings, sliders, two sides and a salad.', category: 'dinner', pricePerPerson: 32, minGuests: 20, courses: [{ name: 'Starters', items: ['Smoked wings', 'Cheese curds'] }, { name: 'Mains', items: ['Corner sliders', 'Crispy chicken bites'] }, { name: 'Sides', items: ['Slaw', 'Mac and cheese'] }] })
  const apps = await post('/api/menu-packages', { name: 'Appetizer Party', description: 'Heavy appetizers for a standing crowd.', category: 'reception', pricePerPerson: 22, minGuests: 15, courses: [{ name: 'Passed', items: ['Pretzel bites', 'Wings', 'Chicken skewers'] }] })
  const brunch = await post('/api/menu-packages', { name: 'Weekend Brunch', description: 'Eggs, potatoes, bacon and a bottomless coffee bar.', category: 'brunch', pricePerPerson: 24, minGuests: 12 })

  const host = (name: string, extra: Record<string, unknown>) => post('/api/contacts', { type: 'client', name, city: 'Eau Claire', state: 'WI', source: 'website', ...extra })
  const ellis = await host('Morgan Ellis', { email: 'morgan.ellis@example.com', phone: '(715) 555-0251' })
  const hartley = await host('Hartley Family', { email: 'hartley.family@example.com', phone: '(715) 555-0252' })
  const lakeshore = await host('Lakeshore Dental (staff party)', { company: 'Lakeshore Dental', email: 'events@lakeshoredental.example', phone: '(715) 555-0253' })
  const prater = await host('Jesse Prater', { email: 'jesse.prater@example.com', phone: '(715) 555-0254' })
  const cho = await post('/api/contacts', { type: 'lead', name: 'Taylor Cho', email: 'taylor.cho@example.com', phone: '(715) 555-0255', source: 'website', notes: 'Asked about the Back Room for a retirement party in the spring.' })
  await post('/api/contacts', { type: 'vendor', name: 'Northwoods Distributing', company: 'Northwoods Distributing', email: 'orders@northwoods-dist.example', phone: '(715) 555-0241' })

  const party = (extra: Record<string, unknown>) => post('/api/events', extra)
  // Booked: a birthday dinner, a fortnight out, with a deposit paid and a run of show.
  const birthday = await party({
    name: 'Ellis 40th birthday dinner', contactId: ellis.id, eventDate: day(12), startTime: '18:00', endTime: '22:00', spaceId: backRoom.id,
    eventType: 'birthday', status: 'confirmed', guestCount: 32, quotedTotal: 1650, depositRequired: 500, notes: 'One guest is vegetarian. Cake comes from outside; plates please.',
  })
  await post(`/api/events/${birthday.id}/menu`, { packageId: bbq.id, quantity: 32 })
  await post(`/api/events/${birthday.id}/menu`, { name: 'Open bar, two hours', unitPrice: 14, perPerson: true, quantity: 32 })
  await post(`/api/events/${birthday.id}/timeline`, { time: '18:00', title: 'Doors and welcome drinks', department: 'bar' })
  await post(`/api/events/${birthday.id}/timeline`, { time: '19:00', title: 'Buffet opens', department: 'kitchen', details: 'Wings first, sliders at 19:15.' })
  await post(`/api/events/${birthday.id}/timeline`, { time: '20:30', title: 'Cake and toasts', department: 'floor' })
  const deposit = await post(`/api/events/${birthday.id}/payments`, { label: 'Deposit', amount: 500, dueDate: day(-3) })
  await post(`/api/events/${birthday.id}/payments`, { label: 'Final balance', amount: 1150, dueDate: day(10) })
  void deposit

  // Booked: a company party in the whole place.
  const staff = await party({
    name: 'Lakeshore Dental holiday party', contactId: lakeshore.id, eventDate: day(34), startTime: '17:00', endTime: '21:30', spaceId: wholeBar.id,
    eventType: 'corporate', status: 'confirmed', guestCount: 70, quotedTotal: 3900, depositRequired: 1000,
  })
  await post(`/api/events/${staff.id}/menu`, { packageId: apps.id, quantity: 70 })
  await post(`/api/events/${staff.id}/payments`, { label: 'Deposit', amount: 1000, dueDate: day(-1) })

  // Tentative: a rehearsal dinner held on a date, not yet confirmed.
  const rehearsal = await party({
    name: 'Hartley rehearsal dinner', contactId: hartley.id, eventDate: day(48), startTime: '17:30', endTime: '21:00', spaceId: patio.id,
    eventType: 'wedding', status: 'tentative', guestCount: 24, quotedTotal: 1100, depositRequired: 300,
  })
  await post(`/api/events/${rehearsal.id}/menu`, { packageId: bbq.id, quantity: 24 })

  // Enquiries: newly in, waiting on a reply.
  await party({ name: 'Prater anniversary brunch', contactId: prater.id, eventDate: day(27), startTime: '10:30', endTime: '13:00', spaceId: backRoom.id, eventType: 'anniversary', status: 'enquiry', guestCount: 18 }).then(async (e) => {
    await post(`/api/events/${e.id}/menu`, { packageId: brunch.id, quantity: 18 })
  })
  await party({ name: 'Cho retirement party', contactId: cho.id, eventDate: day(75), startTime: '16:00', endTime: '20:00', eventType: 'other', status: 'enquiry', guestCount: 45 })

  // Done: a finished party and a lost one, so the book has history.
  const done = await party({
    name: 'Valley Realty client night', contactId: lakeshore.id, eventDate: day(-14), startTime: '17:00', endTime: '20:30', spaceId: backRoom.id,
    eventType: 'corporate', status: 'completed', guestCount: 28, guestCountFinal: 26, quotedTotal: 1240, depositRequired: 400,
  })
  await post(`/api/events/${done.id}/menu`, { packageId: apps.id, quantity: 26 })
  await party({ name: 'Aldous graduation party', contactId: ellis.id, eventDate: day(-6), spaceId: patio.id, eventType: 'other', status: 'lost', guestCount: 20 })

  void patch
  void regulars
}
