// Salon T27 lows — N13, N14, N15 and the rest of N17, against real Postgres (PGlite) and the real routes.
//
// N13  a converted lead could be moved back to "new", leaving the contact it created stranded and the
//      inbox reading 0 converted; and Convert made a contact of type 'lead', which by salon's own
//      definition is not a client, so the person never reached the Clients page.
// N14  removing a stylist reported "0 unassigned" after taking them off a booking, and called the
//      booking a job.
// N15  Help described the Marketing page to a salon with Email Marketing switched off.
// N17  an unknown serviceId came back as the generic foreign-key message.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, teamMember, appointment, serviceMenu, lead, supportKnowledgeBase } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()

const app = new Hono()
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.route('/api/leads', (await import('./src/routes/leads.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.route('/api/support', (await import('./src/routes/support.ts')).default)
app.onError(errorHandler)

const mkCompany = async (slug: string, features: string[]) => {
  const [co] = await db.insert(company).values({ name: 'Shears ' + slug, slug, email: slug + '@test.local', settings: { timezone: 'UTC', plan: 'starter', subscriptionStatus: 'active' }, enabledFeatures: features } as any).returning()
  const [owner] = await db.insert(user).values({ email: slug + '@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
  return { co, owner }
}
const caller = (co: any, owner: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── N14: a stylist holds appointments, and removing them says so ─────────────────────────────────
console.log('\n── N14: removing a stylist reports the appointments it unassigns ──')
{
  const { co, owner } = await mkCompany('n14', ['salon_booking'])
  const call = caller(co, owner)
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Booked Client' } as any).returning()
  const [stylist] = await db.insert(teamMember).values({ companyId: co.id, name: 'Frankie', role: 'Stylist', active: true } as any).returning()
  const [idle] = await db.insert(teamMember).values({ companyId: co.id, name: 'Nobody', role: 'Stylist', active: true } as any).returning()
  const [appt] = await db.insert(appointment).values({ companyId: co.id, contactId: client.id, stylistMemberId: stylist.id, startTime: new Date('2026-10-01T14:00:00.000Z'), endTime: new Date('2026-10-01T14:30:00.000Z'), status: 'scheduled' } as any).returning()

  const list = await call('GET', '/api/team')
  const row = (list.json?.data || []).find((r: any) => r.id === stylist.id)
  check('the roster says the stylist is holding 1 appointment', Number(row?.assignedJobs) === 1, { assignedJobs: row?.assignedJobs, row })
  check('…and nobody else is holding anything', Number((list.json?.data || []).find((r: any) => r.id === idle.id)?.assignedJobs) === 0, list.json?.data)
  check('the list says what this vertical calls that work', list.json?.workLabel?.one === 'appointment' && list.json?.workLabel?.many === 'appointments', list.json?.workLabel)

  const del = await call('DELETE', `/api/team/${stylist.id}`)
  check('removing the stylist succeeds', del.status === 200, del)
  check('…and reports the 1 appointment it unassigned, not 0', Number(del.json?.unassignedJobs) === 1, del.json)
  check('…in the salon\'s own word for it', del.json?.unassignedLabel?.one === 'appointment', del.json?.unassignedLabel)

  const [after] = await db.select().from(appointment).where(eq(appointment.id, appt.id))
  check('the booking really is unassigned afterwards', after?.stylistMemberId == null, { stylistMemberId: after?.stylistMemberId })
  check('…and the booking itself is still there', !!after, after)
  const [gone] = await db.select().from(teamMember).where(eq(teamMember.id, stylist.id))
  check('the stylist is gone from the roster', !gone, gone)

  const del2 = await call('DELETE', `/api/team/${idle.id}`)
  check('removing someone holding nothing reports 0', del2.status === 200 && Number(del2.json?.unassignedJobs) === 0, del2.json)
}

// ── N13: converting is a one-way door, and it produces a CLIENT ──────────────────────────────────
console.log('\n── N13: a converted lead stays converted, and becomes a client ──')
{
  const { co, owner } = await mkCompany('n13', ['lead_inbox', 'client_profiles'])
  const call = caller(co, owner)
  const [row] = await db.insert(lead).values({ companyId: co.id, homeownerName: 'Wanda Walker', email: 'wanda@test.local', phone: '555-0100', sourcePlatform: 'instagram', status: 'new' } as any).returning()

  const conv = await call('POST', `/api/leads/${row.id}/convert`)
  check('converting succeeds', conv.status === 200, conv)
  check('…and the contact it creates is a CLIENT, not another lead', conv.json?.contact?.type === 'client', { type: conv.json?.contact?.type })

  const back = await call('PUT', `/api/leads/${row.id}/status`, { status: 'new' })
  check('moving it back to "new" is refused', back.status === 409, back)
  check('…and the refusal names the contact and what to do about it', /already converted to Wanda Walker/i.test(String(back.json?.error)) && /delete that contact/i.test(String(back.json?.error)), back.json)

  const [still] = await db.select().from(lead).where(eq(lead.id, row.id))
  check('the lead is still converted', still?.status === 'converted', { status: still?.status })
  const stats = await call('GET', '/api/leads/stats')
  check('…so the inbox still counts 1 converted', Number(stats.json?.totals?.converted) === 1, stats.json?.totals)

  // A lead whose contact was later deleted is genuinely orphaned, and has to stay workable.
  await db.delete(contact).where(eq(contact.id, conv.json.contact.id))
  const reopen = await call('PUT', `/api/leads/${row.id}/status`, { status: 'new' })
  check('once the contact is deleted, the lead can be worked again', reopen.status === 200, reopen)

  const other = await db.insert(lead).values({ companyId: co.id, homeownerName: 'Plain Lead', sourcePlatform: 'yelp', status: 'new' } as any).returning()
  const ok = await call('PUT', `/api/leads/${other[0].id}/status`, { status: 'contacted' })
  check('an unconverted lead still changes status normally', ok.status === 200 && ok.json?.status === 'contacted', ok.json)
}

// ── N17: an unknown service is named ─────────────────────────────────────────────────────────────
console.log('\n── N17: booking an unknown service says which field is wrong ──')
{
  const { co, owner } = await mkCompany('n17', ['salon_booking', 'service_menu'])
  const call = caller(co, owner)
  const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Service Client' } as any).returning()
  const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cut', durationMin: 30, price: '40' } as any).returning()
  const { co: other } = await mkCompany('n17-other', ['service_menu'])
  const [theirs] = await db.insert(serviceMenu).values({ companyId: other.id, name: 'Their Cut', durationMin: 30, price: '40' } as any).returning()

  const good = await call('POST', '/api/appointments', { contactId: client.id, serviceId: svc.id, startTime: '2026-10-02T15:00:00.000Z' })
  check('booking a real service works', good.status === 201, good)

  const bad = await call('POST', '/api/appointments', { contactId: client.id, serviceId: 'svc_does_not_exist', startTime: '2026-10-02T16:00:00.000Z' })
  check('an unknown service is refused with 404, not the generic 409', bad.status === 404, bad)
  check('…and the message names the Service Menu', /not on your Service Menu/i.test(String(bad.json?.error)), bad.json)
  check('…not the foreign-key sentence', !/related record does not exist/i.test(String(bad.json?.error)), bad.json)

  const cross = await call('POST', '/api/appointments', { contactId: client.id, serviceId: theirs.id, startTime: '2026-10-02T17:00:00.000Z' })
  check('another salon\'s service is just as absent', cross.status === 404, cross)

  const upd = await call('PUT', `/api/appointments/${good.json?.id}`, { serviceId: 'svc_still_not_real' })
  check('changing to an unknown service is refused too', upd.status === 404 && /Service Menu/i.test(String(upd.json?.error)), upd)
}

// ── N15: Help does not describe a module this salon does not have ────────────────────────────────
console.log('\n── N15: Help only describes modules this salon has ──')
{
  const seed = async (co: any) => {
    for (const a of [
      { title: 'Getting Started', content: 'Welcome!', category: 'Getting Started' },
      { title: 'Invoices & Payments', content: 'Create an invoice…', category: 'Billing' },
      { title: 'Marketing campaigns', content: 'Reach your clients from the Marketing page…', category: 'Marketing' },
      { title: 'Our own house rules', content: 'Something the salon wrote themselves.', category: 'Getting Started' },
    ]) await db.insert(supportKnowledgeBase).values({ ...a, isFaq: false, tags: [], published: true, companyId: co.id } as any)
  }
  const titles = (r: any) => (Array.isArray(r.json) ? r.json : []).map((a: any) => a.title)

  const off = await mkCompany('n15-off', ['salon_booking', 'invoices'])
  await seed(off.co)
  const offList = await caller(off.co, off.owner)('GET', '/api/support/kb')
  check('the Marketing article is not offered with Email Marketing switched off', !titles(offList).includes('Marketing campaigns'), titles(offList))
  check('…while Getting Started still is', titles(offList).includes('Getting Started'), titles(offList))
  check('…and so is Invoices, which this salon does have', titles(offList).includes('Invoices & Payments'), titles(offList))
  check('…and an article the salon wrote themselves is never hidden', titles(offList).includes('Our own house rules'), titles(offList))

  const on = await mkCompany('n15-on', ['salon_booking', 'email_marketing'])
  await seed(on.co)
  const onList = await caller(on.co, on.owner)('GET', '/api/support/kb')
  check('with Email Marketing on, the Marketing article comes back', titles(onList).includes('Marketing campaigns'), titles(onList))

  // A tenant the factory has not synced yet answers [] — "we do not know", not "they have nothing". The
  // Help centre must not empty itself on the tenant most likely to need it.
  const unknown = await mkCompany('n15-unsynced', [])
  await seed(unknown.co)
  const unknownList = await caller(unknown.co, unknown.owner)('GET', '/api/support/kb')
  check('an unsynced tenant with no feature list keeps every article', titles(unknownList).length === 4, titles(unknownList))
}

console.log(`\nt27-lows: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
