// Sample Harbor Home Care: a small home-care agency (companionship, household help, errands, meal prep, rides) with six
// caregivers, eight private-pay clients and a week of shifts. Every name is invented; people are they/them in anything written
// about them. Nothing here is medical or nursing care.
import type { Kit } from './kit.ts'

export default async function seed(k: Kit) {
  const { post, put, day } = k
  const pw = 'Demo-sample-1'

  const care = {
    companion: await post('/api/care-types', { name: 'Companionship', description: 'Company, conversation, games and walks.', hourlyRate: 31 }),
    household: await post('/api/care-types', { name: 'Household help', description: 'Light housekeeping, laundry and tidying.', hourlyRate: 32 }),
    errands: await post('/api/care-types', { name: 'Errands and rides', description: 'Groceries, appointments, pharmacy pick-ups and rides.', hourlyRate: 33 }),
    meals: await post('/api/care-types', { name: 'Meal preparation', description: 'Planning, cooking and tidying up after meals.', hourlyRate: 32 }),
  }

  const caregiver = (firstName: string, lastName: string, phone: string, rate: number, city = 'Eau Claire') =>
    post('/api/caregivers', { firstName, lastName, email: `${firstName.toLowerCase()}@harbor.example`, phone, city, state: 'WI', zip: '54701', password: pw, defaultPayRate: rate, profile: { defaultPayRate: rate } })
  const team = {
    robin: await caregiver('Robin', 'Ashford', '(715) 555-0211', 19),
    devon: await caregiver('Devon', 'Marsh', '(715) 555-0212', 18.5),
    skyler: await caregiver('Skyler', 'Quinn', '(715) 555-0213', 19.5),
    jules: await caregiver('Jules', 'Okafor', '(715) 555-0214', 18),
    reese: await caregiver('Reese', 'Lindgren', '(715) 555-0215', 20),
    ellis: await caregiver('Ellis', 'Navarro', '(715) 555-0216', 18.5),
  }

  const source = await post('/api/referral-sources', { name: 'Lakeside Senior Center', type: 'community', contactName: 'Pat Hollis', phone: '(715) 555-0231', city: 'Eau Claire', state: 'WI' }).catch(() => null)
  void source
  await post('/api/payers', { name: 'Private pay', payerType: 'private_pay' }).catch(() => null)

  const client = (firstName: string, lastName: string, careTypeId: string, street: string, extra: Record<string, unknown> = {}) =>
    post('/api/clients', {
      firstName, lastName, careTypeId, isPrivatePay: true, privatePayRate: 32, privatePayRateType: 'hourly', address: street, city: 'Eau Claire', state: 'WI', zip: '54701', isActive: true, startDate: day(-90),
      phone: '(715) 555-0301', email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
      emergencyContacts: [{ name: `${lastName} family contact`, relationship: 'Family', phone: '(715) 555-0399', isPrimary: true }], ...extra,
    })
  const clients = {
    avery: await client('Avery', 'Whitcomb', care.companion.id, '210 Maple Court', { serviceType: 'Companionship', assistanceNeeds: 'Likes cribbage and a walk around the block.' }),
    blake: await client('Blake', 'Tanaka', care.household.id, '48 Lakeview Drive', { serviceType: 'Household help', assistanceNeeds: 'Laundry and tidying twice a week.' }),
    corey: await client('Corey', 'Delacroix', care.errands.id, '915 Birch Street', { serviceType: 'Errands and rides', assistanceNeeds: 'Weekly grocery run and rides to the library.' }),
    dana: await client('Dana', 'Brightwater', care.meals.id, '33 Orchard Lane', { serviceType: 'Meal preparation', assistanceNeeds: 'Cooks together, three dinners a week.' }),
    emery: await client('Emery', 'Castellano', care.companion.id, '702 Prairie Road', { serviceType: 'Companionship' }),
    finley: await client('Finley', 'Oduya', care.household.id, '17 Cedar Place', { serviceType: 'Household help' }),
    gray: await client('Gray', 'Holloway', care.errands.id, '560 Sunset Avenue', { serviceType: 'Errands and rides', isActive: true }),
    harlow: await client('Harlow', 'Vasquez', care.companion.id, '88 Willow Way', { serviceType: 'Companionship', isActive: false }),
  }

  const pairs: Array<[keyof typeof team, keyof typeof clients]> = [
    ['robin', 'avery'], ['devon', 'blake'], ['skyler', 'corey'], ['jules', 'dana'], ['reese', 'emery'], ['ellis', 'finley'], ['robin', 'gray'],
  ]
  for (const [c, cl] of pairs) await post(`/api/clients/${clients[cl].id}/assignments`, { caregiverId: team[c].id, assignmentDate: day(-60) }).catch(() => null)

  for (const [name, desc] of [
    ['Companionship plan', 'Two visits a week for company, cards and a short walk.'],
    ['Household help plan', 'Laundry, tidying and changing linens.'],
    ['Errands and rides plan', 'Weekly groceries and rides to the library and the senior center.'],
  ] as const) {
    const who = name.startsWith('Companion') ? clients.avery : name.startsWith('Household') ? clients.blake : clients.corey
    await post('/api/care-plans', { clientId: who.id, serviceType: name.replace(' plan', ''), serviceDescription: desc, frequency: 'Weekly', careGoals: 'Keep a steady routine and enjoy the week.', startDate: day(-60), status: 'active' })
  }

  const task = (clientId: string, taskName: string, category: string, minutes: number, extra: Record<string, unknown> = {}) =>
    post(`/api/care-tasks/client/${clientId}`, { taskName, category, allottedMinutes: minutes, weeklyFrequency: 2, ...extra })
  await task(clients.avery.id, 'Cribbage and conversation', 'companion', 45)
  await task(clients.avery.id, 'Short walk around the block', 'companion', 20)
  await task(clients.blake.id, 'Laundry and folding', 'iadl', 45)
  await task(clients.blake.id, 'Tidy kitchen and living room', 'iadl', 40)
  await task(clients.corey.id, 'Grocery run', 'iadl', 60)
  await task(clients.dana.id, 'Cook dinner together', 'iadl', 60)

  // Shifts: weekly patterns (dayOfWeek 0 is Sunday) and a few one-time shifts around today.
  const weekly = (c: keyof typeof team, cl: keyof typeof clients, dayOfWeek: number, startTime: string, endTime: string) =>
    post('/api/schedules', { caregiverId: team[c].id, clientId: clients[cl].id, dayOfWeek, startTime, endTime, scheduleType: 'recurring' })
  await weekly('robin', 'avery', 1, '10:00', '12:00')
  await weekly('robin', 'avery', 4, '10:00', '12:00')
  await weekly('devon', 'blake', 2, '13:00', '15:00')
  await weekly('devon', 'blake', 5, '13:00', '15:00')
  await weekly('skyler', 'corey', 3, '09:00', '12:00')
  await weekly('jules', 'dana', 1, '16:00', '18:00')
  await weekly('jules', 'dana', 3, '16:00', '18:00')
  await weekly('jules', 'dana', 5, '16:00', '18:00')
  await weekly('reese', 'emery', 2, '10:00', '13:00')
  await weekly('ellis', 'finley', 4, '14:00', '16:30')
  await weekly('robin', 'gray', 6, '09:00', '11:00')
  const once = (c: keyof typeof team, cl: keyof typeof clients, offset: number, startTime: string, endTime: string, notes?: string) =>
    post('/api/schedules', { caregiverId: team[c].id, clientId: clients[cl].id, scheduleType: 'one-time', date: day(offset), startTime, endTime, ...(notes ? { notes } : {}) })
  await once('reese', 'emery', 0, '14:00', '16:00', 'Drive to the garden shop.')
  await once('skyler', 'gray', 1, '10:00', '12:00')
  await once('ellis', 'blake', 2, '10:00', '12:00')
  await once('devon', 'avery', 3, '15:00', '17:00', 'Cover for Robin.')
  await once('jules', 'corey', -2, '11:00', '13:00')
  await once('reese', 'dana', -4, '17:00', '19:00')

  // Billing: a manual invoice for two finished weeks, so the billing screens have something to show.
  const period = { billingPeriodStart: day(-28), billingPeriodEnd: day(-15) }
  await post('/api/billing/invoices/manual', {
    clientId: clients.avery.id, ...period, notes: 'Companionship, two visits a week.',
    lineItems: [{ caregiverId: team.robin.id, caregiverName: 'Robin Ashford', description: 'Companionship', hours: 8, rate: 31 }],
  })
  await post('/api/billing/invoices/manual', {
    clientId: clients.blake.id, ...period,
    lineItems: [{ caregiverId: team.devon.id, caregiverName: 'Devon Marsh', description: 'Household help', hours: 8, rate: 32 }],
  })
  void put
}
