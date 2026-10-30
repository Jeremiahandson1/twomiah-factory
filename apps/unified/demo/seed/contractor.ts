// Sample Ridge Remodeling: a small remodeling company with a crew of five, a few customers, some work in every stage.
// Every name is invented; people are they/them in anything written about them.
import type { Kit } from './kit.ts'

export default async function seed(k: Kit) {
  const { post, put, day } = k

  const team = {
    jamie: await k.addUser({ email: 'jamie@contractor.example', firstName: 'Jamie', lastName: 'Rivera', role: 'admin', phone: '(715) 555-0111', hourlyRate: '42.00' }),
    morgan: await k.addUser({ email: 'morgan@contractor.example', firstName: 'Morgan', lastName: 'Lee', role: 'manager', phone: '(715) 555-0112', hourlyRate: '38.00' }),
    taylor: await k.addUser({ email: 'taylor@contractor.example', firstName: 'Taylor', lastName: 'Brooks', role: 'field', phone: '(715) 555-0113', hourlyRate: '32.00' }),
    riley: await k.addUser({ email: 'riley@contractor.example', firstName: 'Riley', lastName: 'Chen', role: 'field', phone: '(715) 555-0114', hourlyRate: '30.00' }),
    avery: await k.addUser({ email: 'avery@contractor.example', firstName: 'Avery', lastName: 'Stone', role: 'viewer', phone: '(715) 555-0115' }),
  }

  const person = (name: string, extra: Record<string, unknown> = {}) => post('/api/contacts', { type: 'client', name, city: 'Eau Claire', state: 'WI', source: 'referral', ...extra })
  const rowan = await person('Alex Rowan', { email: 'alex.rowan@example.com', phone: '(715) 555-0121', address: '418 Birchwood Lane', zip: '54701' })
  const pike = await person('Jordan Pike', { email: 'jordan.pike@example.com', phone: '(715) 555-0122', address: '77 Larkspur Court', zip: '54703' })
  const calloway = await person('Sam Calloway', { email: 'sam.calloway@example.com', phone: '(715) 555-0123', address: '902 Hollow Creek Road', zip: '54703' })
  const finch = await person('Harper & Finch Cafe', { company: 'Harper & Finch Cafe', email: 'hello@harperfinch.example', phone: '(715) 555-0124', address: '15 Water Street', zip: '54701', source: 'website' })
  const aldridge = await person('Quinn Aldridge', { email: 'quinn.aldridge@example.com', phone: '(715) 555-0125', address: '36 Meadowlark Drive', zip: '54701' })
  const vance = await post('/api/contacts', { type: 'lead', name: 'Rory Vance', email: 'rory.vance@example.com', phone: '(715) 555-0131', source: 'website', notes: 'Asked about a basement finish. Wants a number before spring.' })
  const ostrander = await post('/api/contacts', { type: 'lead', name: 'Blake Ostrander', email: 'blake.ostrander@example.com', phone: '(715) 555-0132', source: 'google', notes: 'Siding on a 1960s ranch.' })
  await post('/api/contacts', { type: 'vendor', name: 'Northwoods Lumber Supply', company: 'Northwoods Lumber Supply', email: 'orders@northwoods.example', phone: '(715) 555-0141' })
  await post('/api/contacts', { type: 'subcontractor', name: 'Brightline Electric', company: 'Brightline Electric', email: 'office@brightline.example', phone: '(715) 555-0142' })

  const project = (name: string, contactId: string, extra: Record<string, unknown>) => post('/api/projects', { name, contactId, ...extra })
  const kitchen = await project('Rowan kitchen remodel', rowan.id, { status: 'active', budget: 48000, address: '418 Birchwood Lane', city: 'Eau Claire', state: 'WI', startDate: day(-12), endDate: day(21) })
  const bath = await project('Pike bathroom addition', pike.id, { status: 'planning', budget: 31500, address: '77 Larkspur Court', city: 'Eau Claire', state: 'WI', startDate: day(10), endDate: day(52) })
  const deck = await project('Calloway deck rebuild', calloway.id, { status: 'active', budget: 14200, address: '902 Hollow Creek Road', city: 'Eau Claire', state: 'WI', startDate: day(-4), endDate: day(6) })
  const cafe = await project('Harper & Finch counter and seating', finch.id, { status: 'completed', budget: 22800, address: '15 Water Street', city: 'Eau Claire', state: 'WI', startDate: day(-60), endDate: day(-21) })

  const job = (title: string, contactId: string, projectId: string | undefined, extra: Record<string, unknown>) => post('/api/jobs', { title, contactId, ...(projectId ? { projectId } : {}), priority: 'normal', ...extra })
  const jobs = [
    await job('Demo old cabinets and flooring', rowan.id, kitchen.id, { status: 'completed', scheduledDate: day(-10), scheduledTime: '08:00', estimatedHours: 14, assignedToId: team.taylor.id, description: 'Remove upper and lower cabinets, pull the vinyl, check the subfloor.' }),
    await job('Rough plumbing and electrical', rowan.id, kitchen.id, { status: 'completed', scheduledDate: day(-6), scheduledTime: '08:00', estimatedHours: 16, assignedToId: team.riley.id }),
    await job('Hang and finish drywall', rowan.id, kitchen.id, { status: 'in_progress', scheduledDate: day(0), scheduledTime: '08:00', estimatedHours: 18, assignedToId: team.taylor.id, priority: 'high' }),
    await job('Install cabinets', rowan.id, kitchen.id, { status: 'scheduled', scheduledDate: day(2), scheduledTime: '07:30', estimatedHours: 20, assignedToId: team.riley.id }),
    await job('Countertop template and install', rowan.id, kitchen.id, { status: 'scheduled', scheduledDate: day(9), scheduledTime: '09:00', estimatedHours: 6, assignedToId: team.morgan.id }),
    await job('Remove old deck boards', calloway.id, deck.id, { status: 'completed', scheduledDate: day(-3), scheduledTime: '08:00', estimatedHours: 8, assignedToId: team.riley.id }),
    await job('Frame and set new deck', calloway.id, deck.id, { status: 'in_progress', scheduledDate: day(0), scheduledTime: '07:30', estimatedHours: 12, assignedToId: team.riley.id }),
    await job('Stain and railings', calloway.id, deck.id, { status: 'scheduled', scheduledDate: day(4), scheduledTime: '09:00', estimatedHours: 8, assignedToId: team.taylor.id }),
    await job('Site visit — bathroom addition', pike.id, bath.id, { status: 'scheduled', scheduledDate: day(1), scheduledTime: '10:00', estimatedHours: 1.5, assignedToId: team.morgan.id }),
    await job('Estimate — basement finish', vance.id, undefined, { status: 'scheduled', scheduledDate: day(3), scheduledTime: '13:00', estimatedHours: 1, assignedToId: team.jamie.id }),
    await job('Punch list walk-through', finch.id, cafe.id, { status: 'completed', scheduledDate: day(-21), scheduledTime: '14:00', estimatedHours: 2, assignedToId: team.jamie.id }),
    await job('Fix sticking pantry door', aldridge.id, undefined, { status: 'scheduled', scheduledDate: day(5), scheduledTime: '15:00', estimatedHours: 1, assignedToId: team.taylor.id }),
  ]
  void jobs

  const quote = async (name: string, contactId: string, projectId: string | undefined, lineItems: Array<{ description: string; quantity: number; unitPrice: number; type?: string }>, extra: Record<string, unknown> = {}) =>
    post('/api/quotes', { name, contactId, ...(projectId ? { projectId } : {}), taxRate: 5.5, expiryDate: day(30), lineItems, terms: 'Half down to start, the rest on completion. Valid for 30 days.', ...extra })
  const q1 = await quote('Pike bathroom addition — framing through finish', pike.id, bath.id, [
    { description: 'Foundation, framing and roof tie-in', quantity: 1, unitPrice: 9800, type: 'labor' },
    { description: 'Plumbing rough-in and fixtures', quantity: 1, unitPrice: 6400, type: 'labor' },
    { description: 'Tile, vanity and finish carpentry', quantity: 1, unitPrice: 8700, type: 'material' },
    { description: 'Electrical and ventilation', quantity: 1, unitPrice: 3200, type: 'labor' },
  ])
  const q2 = await quote('Calloway deck — stain and railings', calloway.id, deck.id, [
    { description: 'Composite railing system', quantity: 1, unitPrice: 3150, type: 'material' },
    { description: 'Stain and seal, two coats', quantity: 1, unitPrice: 1180, type: 'labor' },
  ])
  const q3 = await quote('Vance basement finish (rough number)', vance.id, undefined, [
    { description: 'Framing, insulation and drywall — 850 sq ft', quantity: 850, unitPrice: 19, type: 'labor' },
    { description: 'Egress window install', quantity: 1, unitPrice: 2900, type: 'labor' },
  ], { status: 'draft' })
  const q4 = await quote('Aldridge pantry door and trim', aldridge.id, undefined, [
    { description: 'Re-hang and plane door, new hardware', quantity: 1, unitPrice: 185, type: 'labor' },
    { description: 'Trim repair and paint', quantity: 1, unitPrice: 140, type: 'labor' },
  ])
  await quote('Ostrander siding replacement', ostrander.id, undefined, [
    { description: 'Remove and replace siding — 1,600 sq ft', quantity: 1600, unitPrice: 8.5, type: 'labor' },
    { description: 'Wrap, flashing and trim', quantity: 1, unitPrice: 2100, type: 'material' },
  ])
  await post(`/api/quotes/${q1.id}/send`).catch(() => {})
  await post(`/api/quotes/${q2.id}/send`).catch(() => {})
  await post(`/api/quotes/${q2.id}/approve`).catch(() => {})
  await post(`/api/quotes/${q4.id}/send`).catch(() => {})
  void q3

  const invoice = (contactId: string, projectId: string | undefined, lineItems: Array<{ description: string; quantity: number; unitPrice: number }>, extra: Record<string, unknown> = {}) =>
    post('/api/invoices', { contactId, ...(projectId ? { projectId } : {}), taxRate: 5.5, lineItems, ...extra })
  const i1 = await invoice(rowan.id, kitchen.id, [{ description: 'Kitchen remodel — deposit (30%)', quantity: 1, unitPrice: 14400 }], { issueDate: day(-14), dueDate: day(-7) })
  const i2 = await invoice(rowan.id, kitchen.id, [{ description: 'Kitchen remodel — demo and rough-in milestone', quantity: 1, unitPrice: 9600 }], { issueDate: day(-5), dueDate: day(9) })
  const i3 = await invoice(calloway.id, deck.id, [{ description: 'Deck rebuild — deposit', quantity: 1, unitPrice: 5000 }], { issueDate: day(-6), dueDate: day(-1) })
  const i4 = await invoice(finch.id, cafe.id, [{ description: 'Counter and seating — final payment', quantity: 1, unitPrice: 11400 }], { issueDate: day(-30), dueDate: day(-16) })
  await invoice(aldridge.id, undefined, [{ description: 'Service call and trim repair', quantity: 1, unitPrice: 325 }], { issueDate: day(-2), dueDate: day(12) })
  for (const i of [i1, i2, i3, i4]) await post(`/api/invoices/${i.id}/send`).catch(() => {})
  await post(`/api/invoices/${i1.id}/payments`, { amount: 15192, method: 'check', reference: 'Check 2041' })
  await post(`/api/invoices/${i4.id}/payments`, { amount: 12027, method: 'bank_transfer', reference: 'ACH' })
  await post(`/api/invoices/${i3.id}/payments`, { amount: 2000, method: 'cash', notes: 'Partial — balance due Friday' })
  void put
}
