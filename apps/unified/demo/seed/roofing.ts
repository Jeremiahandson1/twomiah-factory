// Sample Peak Roofing: a small roofing company after a hail storm — homeowners, a job at every stage of the pipeline, two
// insurance claims, a crew or two, a materials order, a canvassing session and a storm board. Every name is invented;
// people are they/them in anything written about them.
import type { Kit } from './kit.ts'

export default async function seed(k: Kit) {
  const { post, put, day, t } = k

  const team = {
    jordan: await k.addUser({ email: 'jordan@roofing.example', firstName: 'Jordan', lastName: 'Ellis', role: 'manager', phone: '(715) 555-0211', hourlyRate: '40.00' }),
    sasha: await k.addUser({ email: 'sasha@roofing.example', firstName: 'Sasha', lastName: 'Marsh', role: 'manager', phone: '(715) 555-0212', hourlyRate: '36.00' }),
    devon: await k.addUser({ email: 'devon@roofing.example', firstName: 'Devon', lastName: 'Park', role: 'field', phone: '(715) 555-0213', hourlyRate: '31.00' }),
    emerson: await k.addUser({ email: 'emerson@roofing.example', firstName: 'Emerson', lastName: 'Cole', role: 'field', phone: '(715) 555-0214', hourlyRate: '29.00' }),
    reese: await k.addUser({ email: 'reese@roofing.example', firstName: 'Reese', lastName: 'Whitaker', role: 'viewer', phone: '(715) 555-0215' }),
  }

  const crewA = await post('/api/crews', { name: 'Crew A — Tear-off and install', foremanName: 'Devon Park', foremanPhone: '(715) 555-0213', size: 5 })
  const crewB = await post('/api/crews', { name: 'Crew B — Repairs and gutters', foremanName: 'Emerson Cole', foremanPhone: '(715) 555-0214', size: 3 })
  await post('/api/crews', { name: 'Lakeside Roof Crew (subcontractor)', foremanName: 'Rowan Hale', foremanPhone: '(715) 555-0215', size: 6, isSubcontractor: true, subcontractorCompanyName: 'Lakeside Roof Crew LLC' })

  const owner = (name: string, address: string, zip: string, phone: string, email: string) =>
    post('/api/contacts', { type: 'client', name, email, phone, address, city: 'Eau Claire', state: 'WI', zip, source: 'canvassing' })
  const hale = await owner('Taylor Hale', '812 Maple Ridge Drive', '54701', '(715) 555-0221', 'taylor.hale@example.com')
  const brandt = await owner('Morgan Brandt', '44 Cedar Hollow Road', '54703', '(715) 555-0222', 'morgan.brandt@example.com')
  const okafor = await owner('Kai Okafor', '2307 Westview Terrace', '54701', '(715) 555-0223', 'kai.okafor@example.com')
  const lindqvist = await owner('Jules Lindqvist', '19 Orchard Lane', '54703', '(715) 555-0224', 'jules.lindqvist@example.com')
  const prescott = await owner('Avery Prescott', '660 Riverbend Court', '54701', '(715) 555-0225', 'avery.prescott@example.com')
  const nakamura = await owner('Riley Nakamura', '3115 Thornapple Street', '54703', '(715) 555-0226', 'riley.nakamura@example.com')
  const delgado = await owner('Quinn Delgado', '97 Birch Knoll', '54701', '(715) 555-0227', 'quinn.delgado@example.com')
  const whitlock = await owner('Sam Whitlock', '1450 Pinecrest Avenue', '54703', '(715) 555-0228', 'sam.whitlock@example.com')

  const roof = (contactId: string, address: string, zip: string, jobType: string, status: string, extra: Record<string, unknown> = {}) =>
    post('/api/jobs', { contactId, jobType, propertyAddress: address, city: 'Eau Claire', state: 'WI', zip, status, roofType: 'asphalt shingle', stories: 1, source: 'canvassing', ...extra })

  const jHale = await roof(hale.id, '812 Maple Ridge Drive', '54701', 'insurance', 'signed', { roofAge: 17, totalSquares: 31, estimatedRevenue: 16800, assignedSalesRepId: team.jordan.id, assignedCrewId: crewA.id, installDate: day(6), installEndDate: day(8) })
  const jBrandt = await roof(brandt.id, '44 Cedar Hollow Road', '54703', 'insurance', 'in_production', { roofAge: 22, totalSquares: 38, estimatedRevenue: 21400, assignedSalesRepId: team.sasha.id, assignedCrewId: crewA.id, installDate: day(0), installEndDate: day(2) })
  const jOkafor = await roof(okafor.id, '2307 Westview Terrace', '54701', 'replacement', 'proposal_sent', { roofAge: 19, totalSquares: 27, estimatedRevenue: 13900, assignedSalesRepId: team.jordan.id })
  const jLindqvist = await roof(lindqvist.id, '19 Orchard Lane', '54703', 'repair', 'inspection_scheduled', { roofAge: 9, totalSquares: 4, estimatedRevenue: 1250, assignedSalesRepId: team.sasha.id, inspectionDate: day(2), scheduledDate: day(2), scheduledTime: '10:00' })
  const jPrescott = await roof(prescott.id, '660 Riverbend Court', '54701', 'insurance', 'inspected', { roofAge: 14, totalSquares: 33, estimatedRevenue: 17900, assignedSalesRepId: team.jordan.id })
  const jNakamura = await roof(nakamura.id, '3115 Thornapple Street', '54703', 'replacement', 'invoiced', { roofAge: 25, totalSquares: 29, estimatedRevenue: 15200, assignedSalesRepId: team.sasha.id, assignedCrewId: crewA.id, installDate: day(-12), installEndDate: day(-10) })
  const jDelgado = await roof(delgado.id, '97 Birch Knoll', '54701', 'repair', 'collected', { roofAge: 6, totalSquares: 3, estimatedRevenue: 980, assignedSalesRepId: team.jordan.id, assignedCrewId: crewB.id, installDate: day(-20), installEndDate: day(-20) })
  const jWhitlock = await roof(whitlock.id, '1450 Pinecrest Avenue', '54703', 'replacement', 'lead', { roofAge: 21, estimatedRevenue: 14600, assignedSalesRepId: team.jordan.id })
  void jWhitlock

  // Insurance: two claims, a supplement on one.
  const claimHale = await post('/api/insurance/claims', { jobId: jHale.id, claimNumber: 'CLM-DEMO-40117', insuranceCompany: 'Sample Mutual Insurance', causeOfLoss: 'hail', deductible: '1000.00', dateOfLoss: day(-24), adjusterName: 'Pat Sampleton' })
  const claimBrandt = await post('/api/insurance/claims', { jobId: jBrandt.id, claimNumber: 'CLM-DEMO-40122', insuranceCompany: 'Example Casualty Co.', causeOfLoss: 'wind', deductible: '2500.00', dateOfLoss: day(-24) })
  for (const [claim, rcv, acv, status] of [[claimHale, '16800', '12600', 'approved'], [claimBrandt, '21400', '16050', 'approved']] as const) {
        await put(`/api/insurance/claims/${claim.id}`, { rcv, acv })
    await post(`/api/insurance/claims/${claim.id}/status`, { status })
  }
  {
    await post(`/api/insurance/claims/${claimBrandt.id}/supplements`, {
      reason: 'Decking damage found after tear-off',
      lineItems: [{ description: 'Replace damaged decking', qty: 6, unit: 'EA', unitPrice: 84 }, { description: 'Additional drip edge', qty: 120, unit: 'LF', unitPrice: 3.4 }],
    })
  }

  // Materials for the jobs on the way.
  await post('/api/materials', { jobId: jHale.id, supplier: 'Northwoods Roofing Supply', orderStatus: 'ordered', orderDate: day(-2), deliveryDate: day(5), supplierOrderNumber: 'PO-DEMO-1180', deliveryAddress: '812 Maple Ridge Drive',
    lineItems: [{ description: 'Architectural shingles — bundles', qty: 93, unit: 'BDL', unitPrice: 38 }, { description: 'Synthetic underlayment', qty: 4, unit: 'RL', unitPrice: 96 }, { description: 'Ridge cap', qty: 6, unit: 'BDL', unitPrice: 52 }] })
  await post('/api/materials', { jobId: jBrandt.id, supplier: 'Northwoods Roofing Supply', orderStatus: 'delivered', orderDate: day(-6), deliveryDate: day(-1), supplierOrderNumber: 'PO-DEMO-1174', deliveryAddress: '44 Cedar Hollow Road',
    lineItems: [{ description: 'Architectural shingles — bundles', qty: 114, unit: 'BDL', unitPrice: 38 }, { description: 'Ice and water shield', qty: 3, unit: 'RL', unitPrice: 118 }] })

  // Quotes and invoices, on the shared routes.
  const quote = (contactId: string, jobId: string, name: string, lineItems: Array<{ description: string; quantity: number; unitPrice: number; type?: string }>) =>
    post('/api/quotes', { name, contactId, jobId, taxRate: 5.5, expiryDate: day(30), lineItems, terms: 'Half down at signing, the rest at completion. Valid for 30 days.' })
  const qOkafor = await quote(okafor.id, jOkafor.id, 'Okafor roof replacement — 27 squares', [
    { description: 'Tear-off and haul-away', quantity: 27, unitPrice: 85, type: 'labor' },
    { description: 'Architectural shingles, installed', quantity: 27, unitPrice: 310, type: 'material' },
    { description: 'Flashing, vents and ridge', quantity: 1, unitPrice: 1650, type: 'material' },
  ])
  await post(`/api/quotes/${qOkafor.id}/send`)
  const qLind = await quote(lindqvist.id, jLindqvist.id, 'Lindqvist flashing repair', [{ description: 'Re-seal chimney flashing and replace 12 shingles', quantity: 1, unitPrice: 1250, type: 'labor' }])
  void qLind

  const invoice = (contactId: string, jobId: string, lineItems: Array<{ description: string; quantity: number; unitPrice: number }>, extra: Record<string, unknown> = {}) =>
    post('/api/invoices', { contactId, jobId, taxRate: 5.5, lineItems, ...extra })
  const iNak = await invoice(nakamura.id, jNakamura.id, [{ description: 'Roof replacement — 29 squares, complete', quantity: 1, unitPrice: 15200 }], { issueDate: day(-9), dueDate: day(5) })
  const iDel = await invoice(delgado.id, jDelgado.id, [{ description: 'Roof repair — storm damage patch', quantity: 1, unitPrice: 980 }], { issueDate: day(-19), dueDate: day(-5) })
  for (const i of [iNak, iDel]) await post(`/api/invoices/${i.id}/send`)
  await post(`/api/invoices/${iDel.id}/payments`, { amount: 1033.9, method: 'check', reference: 'Check 3318' })
  await post(`/api/invoices/${iNak.id}/payments`, { amount: 7500, method: 'bank_transfer', reference: 'ACH deposit' })

  // The storm: an event with doors the roofers could knock on.
  const storm = await post('/api/storms/events', { affectedZipCodes: ['54701', '54703'], eventType: 'hail', hailSizeInches: 1.75, eventDate: new Date(Date.now() - 24 * 86_400_000).toISOString(), description: 'Sample hail storm across the east side — dime to quarter size.' })
  await post('/api/storms/events', { affectedZipCodes: ['54703'], eventType: 'wind', windSpeedMph: 62, eventDate: new Date(Date.now() - 70 * 86_400_000).toISOString(), description: 'Sample wind event.' })
  const doors: Array<[string, string, string]> = [
    ['1802 Fairview Drive', '54701', 'severe'], ['1806 Fairview Drive', '54701', 'moderate'], ['1811 Fairview Drive', '54701', 'moderate'],
    ['230 Aspen Way', '54703', 'severe'], ['238 Aspen Way', '54703', 'minor'], ['241 Aspen Way', '54703', 'moderate'],
  ]
  for (const [address, zip, estimatedDamage] of doors) {
    await t.db.insert(t.schema.stormLead).values({ companyId: k.companyId, stormEventId: storm.id, address, city: 'Eau Claire', state: 'WI', zip, status: 'new', estimatedDamage } as any)
  }

  // The door-knocking script a new roofing company starts with (verticals/roof/settings.ts STARTER).
  await post('/api/canvassing/scripts', { name: 'Hail Damage — Standard Script', isDefault: true, steps: [
    { title: 'Introduction', body: "Hi, I'm [Name] with Sample Peak Roofing. I'm in the neighborhood today because the recent hail storm caused damage to many roofs in this area. Have you had a chance to look at your roof since the storm?", tips: 'Be friendly and non-pushy. If they have not looked, that is your opening.' },
    { title: 'Damage Assessment', body: 'I noticed from the street that your roof may have some damage. Would it be okay if I took a quick look from the ground? No obligation at all.', tips: 'Never go on the roof without permission. Point out damage from the ground.' },
    { title: 'Close', body: 'I can schedule a free inspection for you this week. What day works best?', tips: 'Offer specific time slots. Leave a door hanger if they want to think about it.' },
  ] })

  // Canvassing: a session from yesterday with a handful of doors, and one under way.
  const lat = 44.8113; const lng = -91.4985
  const session = await post('/api/canvassing/sessions', { name: 'Fairview Drive — day one', centerLat: lat, centerLng: lng, radiusMiles: 0.5, weatherEvent: 'Sample hail storm' })
  const stops: Array<[string, string, string, string?]> = [
    ['no_answer', '1802 Fairview Drive', '54701'], ['interested', '1806 Fairview Drive', '54701', 'Jamie Rourke'], ['not_interested', '1809 Fairview Drive', '54701'],
    ['appointment_set', '1811 Fairview Drive', '54701', 'Cameron Ashby'], ['already_has_contractor', '1815 Fairview Drive', '54701'], ['vacant', '1818 Fairview Drive', '54701'],
  ]
  let i = 0
  for (const [outcome, address, zip, name] of stops) {
    i++
    await post(`/api/canvassing/sessions/${session.id}/stops`, {
      outcome, address, city: 'Eau Claire', state: 'WI', zip, lat: lat + i * 0.0004, lng: lng + i * 0.0003,
      ...(name ? { homeownerName: name, phone: `(715) 555-03${10 + i}`, notes: outcome === 'appointment_set' ? 'Free inspection booked for later this week.' : 'Saw granule loss in the downspouts; wants a number.' } : {}),
    })
  }
  await post(`/api/canvassing/sessions/${session.id}/end`)
  await post('/api/canvassing/sessions', { name: 'Aspen Way — today', centerLat: lat + 0.01, centerLng: lng - 0.01, radiusMiles: 0.4 })

  // The lead inbox: callers and form fills waiting for a reply.
  const lead = (homeownerName: string, sourcePlatform: string, status: string, o: Record<string, unknown>) =>
    t.db.insert(t.schema.lead).values({ companyId: k.companyId, homeownerName, sourcePlatform, status, ...o } as any)
  await lead('Drew Ferris', 'website', 'new', { email: 'drew.ferris@example.com', phone: '(715) 555-0331', jobType: 'Roof replacement', location: 'Eau Claire, WI 54701', description: 'Hail dented my gutters last month. Can someone look at the roof?', budget: 'Insurance claim' })
  await lead('Lane Okonkwo', 'phone', 'new', { phone: '(715) 555-0332', jobType: 'Roof repair', location: 'Altoona, WI 54720', description: 'Water stain on the bedroom ceiling after the last rain.' })
  await lead('Peyton Ruiz', 'website', 'contacted', { email: 'peyton.ruiz@example.com', phone: '(715) 555-0333', jobType: 'Roof inspection', location: 'Eau Claire, WI 54703', description: 'Neighbor said we should get ours checked after the storm.', contactedAt: new Date() })
  await lead('Robin Castellano', 'google', 'new', { email: 'robin.castellano@example.com', jobType: 'Gutter installation', location: 'Chippewa Falls, WI 54729', description: 'New gutters with the roof, if possible.' })
}
