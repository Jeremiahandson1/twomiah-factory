// Salon T20 lows — L1, L2, L3, L4 (L5 is a boot-time theme change, asserted in the guard; L6 could not
// be reproduced, see the commit message).
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu } from './db/schema.ts'
import { eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'
// Before the fix there is no isRealDate: stand in with the shape-only check the booking service used,
// so this file reports the gap rather than dying on a missing export.
const timeMod: any = await import('./src/shared/booking/time.ts').catch(() => ({}))
const isRealDate: (s: unknown) => boolean = timeMod.isRealDate
  ?? ((s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s))

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 240)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shear', slug: 'shear-low', email: 'lo@test.local', settings: { plan: 'pro', seats: 5 }, enabledFeatures: ['appointments'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'lo@test.local', passwordHash: 'x', firstName: 'Lo', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.route('/api/service-menu', (await import('./src/routes/serviceMenu.ts')).default)
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}

// ── L1: a settings key can be removed, not only added ─────────────────────────────────────────────
{
  await call('PUT', '/api/company', { settings: { t20JunkKey: 'junk' } })
  const withJunk = await call('GET', '/api/company')
  check('a key can be written', withJunk.json?.settings?.t20JunkKey === 'junk', withJunk.json?.settings)

  const removed = await call('PUT', '/api/company', { settings: { t20JunkKey: null } })
  check('L1: writing it back as null REMOVES it (it used to store null)', removed.status === 200 && !('t20JunkKey' in (removed.json?.settings || {})), removed.json?.settings)

  const after = await call('GET', '/api/company')
  check('…and it stays gone', !('t20JunkKey' in (after.json?.settings || {})), after.json?.settings)
  check('…while the rest of the blob is untouched', after.json?.settings?.plan === 'pro' && Number(after.json?.settings?.seats) === 5, after.json?.settings)

  // the merge itself must still hold — that was the T12 fix
  await call('PUT', '/api/company', { settings: { newKey: 'kept' } })
  const merged = await call('GET', '/api/company')
  check('…and a partial write still merges rather than replacing', merged.json?.settings?.plan === 'pro' && merged.json?.settings?.newKey === 'kept', merged.json?.settings)
}

// ── L2: a refusal names the real reason ───────────────────────────────────────────────────────────
{
  check('L2: 2026-02-30 is not a real date', isRealDate('2026-02-30') === false, null)
  check('L2: 2026-13-01 is not a real date', isRealDate('2026-13-01') === false, null)
  check('…a real leap day is', isRealDate('2028-02-29') === true, null)
  check('…and a non-leap 29 Feb is not', isRealDate('2027-02-29') === false, null)
  check('…an ordinary date is', isRealDate('2026-09-19') === true, null)
  check('…and the wrong shape still is not', isRealDate('19/09/2026') === false, null)

  const badPrice = await call('POST', '/api/service-menu', { name: 'Trim', price: 'abc', durationMin: 30 })
  check('L2: a price of "abc" is refused for not being a number', badPrice.status === 400 && /must be a number/.test(String(badPrice.json?.error)), badPrice.json)
  const negPrice = await call('POST', '/api/service-menu', { name: 'Trim', price: -5, durationMin: 30 })
  check('…and a negative price still says negative', negPrice.status === 400 && /cannot be negative/.test(String(negPrice.json?.error)), negPrice.json)
  const okPrice = await call('POST', '/api/service-menu', { name: 'Trim', price: 25, durationMin: 30 })
  check('…while a real price is accepted', okPrice.status === 201 || okPrice.status === 200, okPrice.json)
}

// ── L3: the roster refusal names the stylist, not a foreign key ───────────────────────────────────
{
  const [ct] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Ref Usal', email: 'ref@test.local' } as any).returning()
  const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0)
  const bad = await call('POST', '/api/appointments', { contactId: ct.id, stylistId: 'no-such-stylist', startTime: d.toISOString() })
  check('L3: an unknown stylist is refused in plain words, not "A related record does not exist"', bad.status === 400 && !/related record/i.test(String(bad.json?.error)), bad.json)
  check('…naming what to do about it', /Pick one from the team list/.test(String(bad.json?.error)), bad.json?.error)
}

// ── L4: the clients list ships no portal secret ───────────────────────────────────────────────────
{
  const [ct] = await db.insert(contact).values({
    companyId: co.id, type: 'client', name: 'Portia Portal', email: 'portia@test.local',
    portalToken: 'super-secret-token', portalTokenExp: new Date(Date.now() + 86400000),
  } as any).returning()

  const list = await call('GET', '/api/clients?limit=50')
  const row = (list.json?.data || []).find((r: any) => r.id === ct.id)
  check('the client is listed', !!row, (list.json?.data || []).length)
  check('L4: the list carries no portalToken (it shipped one for every client that had one)', row && !('portalToken' in row), Object.keys(row || {}).filter(k => /portal/i.test(k)))
  check('…nor its expiry', row && !('portalTokenExp' in row), Object.keys(row || {}).filter(k => /portal/i.test(k)))
  check('…while the client is otherwise intact', row?.name === 'Portia Portal' && row?.email === 'portia@test.local', row)
  // the secret is still in the database — this is about what leaves in a list response
  const [stored] = await db.select().from(contact).where(eq(contact.id, ct.id))
  check('…and the token still exists on the record itself', (stored as any).portalToken === 'super-secret-token', null)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
