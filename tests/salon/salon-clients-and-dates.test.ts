// Salon T20 M2 + M4.
//   M2 — GET /api/clients returned all 74 contacts, 8 of them type "lead". The Clients page
//        ("Everyone who sits in your chairs") listed them and the dashboard tile read "Clients 74 — In
//        your book", while /api/contacts/stats reported the split correctly. The number the owner is
//        most likely to quote was the wrong one of the two the product already had.
//   M4 — POST /api/service-records accepted performedAt 2027-06-15, nine months out, with no warning.
//        It immediately headed Recent Services on the dashboard and Recent Activity on the portal,
//        above every real visit: the "most recent" panels were showing the furthest-FUTURE records.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, serviceRecord } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-cd', email: 'cd@test.local', settings: {}, enabledFeatures: ['appointments'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'cd@test.local', passwordHash: 'x', firstName: 'Cee', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cut', price: '30', durationMin: 30 } as any).returning()

// 3 clients, 2 leads, 1 vendor
const clients = []
for (const n of ['Cara Client', 'Carl Client', 'Cleo Client']) clients.push((await db.insert(contact).values({ companyId: co.id, type: 'client', name: n, email: `${n.split(' ')[0].toLowerCase()}@test.local` } as any).returning())[0])
for (const n of ['Lena Lead', 'Liam Lead']) await db.insert(contact).values({ companyId: co.id, type: 'lead', name: n, email: `${n.split(' ')[0].toLowerCase()}@test.local` } as any)
await db.insert(contact).values({ companyId: co.id, type: 'vendor', name: 'Vic Vendor', email: 'vic@test.local' } as any)

const app = new Hono()
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/service-records', (await import('./src/routes/serviceRecords.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}

// ── M2: the client book is clients ────────────────────────────────────────────────────────────────
{
  const list = await call('GET', '/api/clients?limit=100')
  const rows = list.json?.data || []
  const names = rows.map((r: any) => r.name)
  check('M2: the Clients page lists only people who sit in the chair', rows.length === 3, names)
  check('…no leads', !names.some((n: string) => n.includes('Lead')), names)
  check('…and still no vendors', !names.some((n: string) => n.includes('Vendor')), names)
  check('…the count agrees with the list', Number(list.json?.pagination?.total) === 3, list.json?.pagination)

  const stats = await call('GET', '/api/dashboard/stats')
  check('M2: the dashboard Clients tile counts the same people (it counted every contact row)', Number(stats.json?.clients?.total) === 3, stats.json?.clients)

  // converting a lead makes them a client, on both surfaces
  const [lena] = await db.select().from(contact).where(eq(contact.name, 'Lena Lead'))
  await db.update(contact).set({ type: 'client' } as any).where(eq(contact.id, lena.id))
  const after = await call('GET', '/api/clients?limit=100')
  const afterStats = await call('GET', '/api/dashboard/stats')
  check('a converted lead becomes a client on the list', (after.json?.data || []).length === 4, (after.json?.data || []).length)
  check('…and on the tile', Number(afterStats.json?.clients?.total) === 4, afterStats.json?.clients)
}

// ── M4: a visit is something that happened ────────────────────────────────────────────────────────
{
  const future = new Date(); future.setMonth(future.getMonth() + 9)
  const iso = (d: Date) => d.toISOString().slice(0, 10)

  const bad = await call('POST', '/api/service-records', { contactId: clients[0].id, serviceId: svc.id, priceCharged: 30, performedAt: iso(future) })
  check('M4: a visit nine months out is refused (it was accepted without a word)', bad.status === 400 && bad.json?.code === 'FUTURE_VISIT', { status: bad.status, body: bad.json })
  check('…and the message points at the year', /Check the year/.test(String(bad.json?.error)), bad.json?.error)

  const today = await call('POST', '/api/service-records', { contactId: clients[0].id, serviceId: svc.id, priceCharged: 30 })
  check('a visit logged today is fine', today.status === 201, today.json)
  const past = await call('POST', '/api/service-records', { contactId: clients[1].id, serviceId: svc.id, priceCharged: 30, performedAt: '2026-08-01' })
  check('…and so is one backdated to a real day', past.status === 201, past.json)

  // an edit must not be the way one gets in
  const edited = await call('PUT', `/api/service-records/${today.json?.id}`, { performedAt: iso(future) })
  check('M4: an edit cannot push a visit into the future either', edited.status === 400 && edited.json?.code === 'FUTURE_VISIT', { status: edited.status, body: edited.json })

  // and the Recent panel is led by a real visit, not a future one
  const act = await call('GET', '/api/dashboard/recent-activity')
  const recent = act.json?.recentServices || []
  check('M4: Recent Services is led by a visit that has happened', recent.length > 0 && new Date(recent[0].performedAt).getTime() <= Date.now() + 86400000, recent.map((r: any) => r.performedAt))

  const all = await db.select().from(serviceRecord).where(eq(serviceRecord.companyId, co.id))
  check('…and no future visit was stored at all', all.every((r: any) => new Date(r.performedAt).getTime() <= Date.now() + 86400000), all.map((r: any) => r.performedAt))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
