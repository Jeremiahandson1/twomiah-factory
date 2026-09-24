// Contractor T29 N1 — the Reviews API answered with settings, stats and the request list on a tenant where the
// module is switched off and the menu item is gone. It cannot be gated at the mount, because the link in the
// customer's text is public, so it gates itself — the same shape call tracking and the AI receptionist use.
// Real Postgres (PGlite), the real routes.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, reviewRequest } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'
import { eq } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()
// this tenant does NOT have google_reviews — exactly the contractor tenant's shape
const [co] = await db.insert(company).values({ name: 'No Reviews', slug: 'rev-t29', email: 'n@test.local', settings: { googlePlaceId: 'place-1' }, enabledFeatures: ['jobs', 'invoicing'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'n@test.local', passwordHash: 'x', firstName: 'Nia', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ type: 'client', name: 'Client One', email: 'c1@test.local', companyId: co.id } as any).returning()
const [req] = await db.insert(reviewRequest).values({ companyId: co.id, contactId: client.id, status: 'sent', reviewLink: 'https://example.test/review' } as any).returning()

const app = new Hono()
app.route('/api/reviews', (await import('./src/routes/reviews.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}

// ── switched off: the authenticated endpoints are refused, and say why ───────────────────────────────────────────
for (const [method, path] of [['GET', '/api/reviews/settings'], ['GET', '/api/reviews/stats'], ['GET', '/api/reviews'], ['PUT', '/api/reviews/settings']] as Array<[string, string]>) {
  const r = await call(method, path, method === 'PUT' ? { reviewRequestEnabled: true } : undefined)
  check(`${method} ${path} is refused while the module is off (T29: answered 200)`, r.status === 403, r)
  if (r.status === 403) check(`…with the code every other gated module uses`, r.json?.code === 'FEATURE_NOT_ENABLED', r.json)
}

// ── the customer's link is public and must keep working ──────────────────────────────────────────────────────────
{
  const res = await app.request(`/api/reviews/track/${req.id}/click`, { method: 'GET', redirect: 'manual' })
  check('the review link in the customer\'s text still works with the module off (it is their link, not the tenant\'s screen)', res.status === 302 || res.status === 200, { status: res.status })
  const [row] = await db.select().from(reviewRequest).where(eq(reviewRequest.id, req.id))
  check('…and the click is still recorded', !!row?.clickedAt, { clickedAt: row?.clickedAt })
}

// ── a tenant that HAS the module is unaffected ───────────────────────────────────────────────────────────────────
// A separate company rather than flipping this one's switch: the shared gate caches a company's features for 15s
// by design, so flipping mid-test would only prove the cache works.
{
  const [co2] = await db.insert(company).values({ name: 'Has Reviews', slug: 'rev-t29-on', email: 'y@test.local', settings: { googlePlaceId: 'place-2' }, enabledFeatures: ['jobs', 'invoicing', 'google_reviews'] } as any).returning()
  const [owner2] = await db.insert(user).values({ email: 'y@test.local', passwordHash: 'x', firstName: 'Yves', lastName: 'Owner', role: 'owner', companyId: co2.id } as any).returning()
  const call2 = async (method: string, path: string) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner2.id, 'x-test-company': co2.id, 'x-test-role': 'owner' } })
    const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
    return { status: res.status, json }
  }
  const settings = await call2('GET', '/api/reviews/settings')
  check('a tenant with the module on still gets its settings', settings.status === 200 && settings.json?.googlePlaceId === 'place-2', settings.json)
  const stats = await call2('GET', '/api/reviews/stats')
  check('…and its stats', stats.status === 200, stats.json)
  const list = await call2('GET', '/api/reviews')
  check('…and its request list', list.status === 200, list.json)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
