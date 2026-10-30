// Sample Willow Salon: a small hair salon with four stylists, a service menu, regulars with formulas on their charts, a book
// for this week, visits already closed, memberships and a loyalty programme. Every name is invented; people are they/them.
import type { Kit } from './kit.ts'

export default async function seed(k: Kit) {
  const { post, put, day, at } = k

  const team = {
    sky: await k.addUser({ email: 'sky@salon.example', firstName: 'Sky', lastName: 'Marlow', role: 'field', phone: '(715) 555-0211' }),
    devon: await k.addUser({ email: 'devon@salon.example', firstName: 'Devon', lastName: 'Okafor', role: 'field', phone: '(715) 555-0212' }),
    reese: await k.addUser({ email: 'reese@salon.example', firstName: 'Reese', lastName: 'Lindqvist', role: 'field', phone: '(715) 555-0213' }),
    jules: await k.addUser({ email: 'jules@salon.example', firstName: 'Jules', lastName: 'Ferreira', role: 'manager', phone: '(715) 555-0214' }),
    pat: await k.addUser({ email: 'pat@salon.example', firstName: 'Pat', lastName: 'Winslow', role: 'viewer', phone: '(715) 555-0215' }),
  }

  // The service menu: what the book, online booking and rebooking reminders all read.
  const svc = (name: string, category: string, durationMin: number, price: number, extra: Record<string, unknown> = {}) =>
    post('/api/service-menu', { name, category, durationMin, price, bookableOnline: true, ...extra })
  const cut = await svc('Haircut and style', 'hair', 60, 58, { rebookIntervalDays: 42 })
  const trim = await svc('Bang or neckline trim', 'hair', 15, 18)
  const blow = await svc('Blow-dry', 'hair', 30, 40, { rebookIntervalDays: 14 })
  const root = await svc('Root colour', 'colour', 90, 95, { priceIsFrom: true, rebookIntervalDays: 35, requiresPatchTest: true })
  const full = await svc('Full colour and gloss', 'colour', 150, 165, { priceIsFrom: true, rebookIntervalDays: 56, requiresPatchTest: true })
  const balayage = await svc('Balayage', 'colour', 210, 260, { priceIsFrom: true, rebookIntervalDays: 84, requiresPatchTest: true })
  const barber = await svc('Clipper cut and beard line-up', 'barber', 45, 42, { rebookIntervalDays: 28 })
  const manicure = await svc('Gel manicure', 'nails', 60, 48, { rebookIntervalDays: 21 })
  const brows = await svc('Brow shape and tint', 'brows', 30, 35, { rebookIntervalDays: 35 })
  await svc('Deep conditioning treatment', 'hair', 30, 30)

  // Members and regulars: the clients (the contacts the whole app shares), then what the chart adds.
  const client = (name: string, extra: Record<string, unknown> = {}) => post('/api/contacts', { type: 'client', name, city: 'Eau Claire', state: 'WI', source: 'referral', ...extra })
  const ada = await client('Ada Lindgren', { email: 'ada.lindgren@example.com', phone: '(715) 555-0221' })
  const marlo = await client('Marlo Quist', { email: 'marlo.quist@example.com', phone: '(715) 555-0222' })
  const noor = await client('Noor Haddad', { email: 'noor.haddad@example.com', phone: '(715) 555-0223' })
  const tess = await client('Tess Albright', { email: 'tess.albright@example.com', phone: '(715) 555-0224' })
  const rowan = await client('Rowan Beck', { email: 'rowan.beck@example.com', phone: '(715) 555-0225' })
  const ines = await client('Ines Carvalho', { email: 'ines.carvalho@example.com', phone: '(715) 555-0226' })
  const wren = await client('Wren Tallis', { email: 'wren.tallis@example.com', phone: '(715) 555-0227', source: 'website' })
  const kit = await client('Kit Oyelaran', { email: 'kit.oyelaran@example.com', phone: '(715) 555-0228' })
  await post('/api/contacts', { type: 'lead', name: 'Dana Whitcomb', email: 'dana.whitcomb@example.com', phone: '(715) 555-0231', source: 'website', notes: 'Asked about a bridal trial. Wants a Saturday in spring.' })
  await post('/api/contacts', { type: 'lead', name: 'Emery Stroud', email: 'emery.stroud@example.com', phone: '(715) 555-0232', source: 'google', notes: 'Asked whether we colour curly hair.' })
  await post('/api/contacts', { type: 'vendor', name: 'Prairie Beauty Supply', company: 'Prairie Beauty Supply', email: 'orders@prairiebeauty.example', phone: '(715) 555-0241' })

  const profile = (id: string, body: Record<string, unknown>) => put(`/api/clients/${id}/profile`, body)
  await profile(ada.id, { pronouns: 'she/her', hairType: 'Fine, straight', birthday: '1989-11-04', patchTestAt: day(-60), preferences: 'Quiet chair, no small talk before 10.', preferredStylistId: team.sky.id })
  await profile(marlo.id, { pronouns: 'they/them', hairType: 'Thick, wavy', birthday: '1992-03-19', patchTestAt: day(-90), allergies: 'Sensitive scalp — no bleach on the roots.', preferredStylistId: team.devon.id })
  await profile(noor.id, { pronouns: 'she/her', hairType: 'Coarse, curly', birthday: '1985-12-02', patchTestAt: day(-120), preferences: 'Diffuse dry, no flat iron.', preferredStylistId: team.reese.id })
  await profile(tess.id, { pronouns: 'they/them', hairType: 'Medium, wavy', birthday: '1998-07-28', preferredStylistId: team.sky.id })
  await profile(rowan.id, { pronouns: 'he/him', hairType: 'Short, straight', preferences: 'Number 2 on the sides, scissor the top.', preferredStylistId: team.devon.id })
  await profile(ines.id, { pronouns: 'she/her', hairType: 'Long, fine', birthday: '1990-10-31', patchTestAt: day(-45), preferredStylistId: team.reese.id })

  // Formulas kept on a chart: what went on, so the next visit starts there.
  await post(`/api/clients/${ada.id}/formulas`, { label: 'Root colour — warm brown', formula: [{ product: 'Root shade 6N', amount: '40 g' }, { product: 'Root shade 6G', amount: '20 g' }], developerVolume: '20 vol', processingMin: 35, note: 'Gloss at the bowl, rinse cool.' })
  await post(`/api/clients/${marlo.id}/formulas`, { label: 'Soft balayage lift', formula: [{ product: 'Lightener', amount: '30 g' }, { product: 'Toner 9V', amount: '15 g' }], developerVolume: '10 vol', processingMin: 40, note: 'Keep off the roots; scalp runs sensitive.' })
  await post(`/api/clients/${noor.id}/formulas`, { label: 'Full colour — deep copper', formula: [{ product: 'Copper 7C', amount: '50 g' }, { product: 'Copper 6RC', amount: '30 g' }], developerVolume: '20 vol', processingMin: 45 })
  await post(`/api/clients/${ines.id}/formulas`, { label: 'Gloss — cool beige', formula: [{ product: 'Gloss 8B', amount: '30 g' }], developerVolume: '5 vol', processingMin: 20 })

  // Loyalty and memberships, set up before the visits so closed visits earn points.
  await post('/api/memberships', { name: 'Monthly blowout club', description: 'Two blow-dries a month, with a discount on colour.', price: 59, billingCycle: 'monthly', creditsTotal: 2, includedServices: [blow.id] })
  const plan = await post('/api/memberships', { name: 'Colour care plan', description: 'A root touch-up every six weeks and a gloss between.', price: 89, billingCycle: 'monthly', creditsTotal: 2, includedServices: [root.id] })

  // Visits already done: an appointment, then the service logged against it (which closes the visit, bills it and awards points).
  const stylist = team
  const done = async (who: { id: string }, offset: number, hhmm: string, service: { id: string; price: string | number }, by: { id: string }, extra: Record<string, unknown> = {}) => {
    const dur = service === cut ? 60 : 90
    const appt = await post('/api/appointments', {
      contactId: who.id, serviceId: service.id, stylistId: by.id, startTime: at(offset, hhmm), endTime: new Date(Date.parse(at(offset, hhmm)) + dur * 60_000).toISOString(),
      status: 'in_chair', quotedPrice: Number(service.price),
    })
    return post('/api/service-records', { contactId: who.id, appointmentId: appt.id, serviceId: service.id, stylistId: by.id, performedAt: day(offset), priceCharged: Number(service.price), ...extra })
  }
  const a1 = await done(ada, -42, '10:00', root, stylist.sky, { formula: [{ product: 'Root shade 6N', amount: '40 g' }, { product: 'Root shade 6G', amount: '20 g' }], developerVolume: '20 vol', processingMin: 35, result: 'Even coverage, soft warm finish.' })
  await done(ada, -7, '10:00', cut, stylist.sky, { result: 'Two inches off, long layers.' })
  await done(marlo, -70, '13:00', balayage, stylist.devon, { formula: [{ product: 'Lightener', amount: '30 g' }, { product: 'Toner 9V', amount: '15 g' }], developerVolume: '10 vol', processingMin: 40, result: 'Soft honey ends, nothing near the scalp.' })
  await done(noor, -60, '11:00', full, stylist.reese, { formula: [{ product: 'Copper 7C', amount: '50 g' }, { product: 'Copper 6RC', amount: '30 g' }], developerVolume: '20 vol', processingMin: 45 })
  await done(tess, -30, '15:00', cut, stylist.sky)
  await done(rowan, -35, '09:00', barber, stylist.devon)
  await done(ines, -21, '14:00', manicure, stylist.reese)
  await done(wren, -3, '16:00', brows, stylist.reese)
  await done(kit, -10, '12:00', blow, stylist.devon)
  void a1

  // Memberships sold: the first month is billed when the client joins.
  await post('/api/memberships/enrollments', { planId: plan.id, contactId: ada.id })
  await post('/api/memberships/enrollments', { planId: plan.id, contactId: noor.id })

  // The book: this week and next, a few unconfirmed, one checked in, one cancelled.
  const book = (who: { id: string }, offset: number, hhmm: string, service: { id: string; price: string | number }, mins: number, by: { id: string }, extra: Record<string, unknown> = {}) =>
    post('/api/appointments', {
      contactId: who.id, serviceId: service.id, stylistId: by.id, startTime: at(offset, hhmm), endTime: new Date(Date.parse(at(offset, hhmm)) + mins * 60_000).toISOString(),
      quotedPrice: Number(service.price), ...extra,
    })
  const todayChair = await book(tess, 0, '09:30', cut, 60, stylist.sky, { status: 'checked_in', station: 'Chair 1' })
  void todayChair
  await book(marlo, 0, '11:00', balayage, 210, stylist.devon, { status: 'confirmed', station: 'Chair 2', notes: 'Bring inspiration photos.' })
  await book(ines, 0, '14:00', full, 150, stylist.reese, { status: 'confirmed', station: 'Chair 3' })
  await book(rowan, 0, '16:30', barber, 45, stylist.devon, { status: 'scheduled' })
  await book(ada, 1, '10:00', root, 90, stylist.sky, { status: 'confirmed', station: 'Chair 1' })
  await book(noor, 1, '13:00', full, 150, stylist.reese, { status: 'scheduled', station: 'Chair 3' })
  await book(kit, 2, '11:30', blow, 30, stylist.devon, { status: 'scheduled' })
  await book(wren, 3, '15:00', manicure, 60, stylist.reese, { status: 'scheduled' })
  await book(tess, 4, '10:00', trim, 15, stylist.sky, { status: 'scheduled' })
  await book(rowan, 6, '09:00', barber, 45, stylist.devon, { status: 'scheduled' })
  const gone = await book(kit, 1, '16:00', cut, 60, stylist.sky, { status: 'scheduled' })
  await put(`/api/appointments/${gone.id}`, { status: 'cancelled' })
  await book(ines, 8, '10:30', cut, 60, stylist.reese, { status: 'scheduled' })
}
