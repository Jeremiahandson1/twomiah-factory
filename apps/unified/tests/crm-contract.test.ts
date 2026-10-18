// The contract every route of the app keeps, read from the app itself (its Hono route table and the registry's
// mounts), so it can't drift from what is served. The unified counterpart of the CRM templates' shared
// tests/harness/contract.test.ts, which reads the routes from a template's index.ts source.
//
//   1. Signed out, nothing is readable: a route behind sign-in answers 401, and a public route answers no 2xx with a
//      made-up id, except the doors that are meant to be open (sign-in, the booking widget, a customer's link…).
//   2. Every route, called properly by the owner with every feature on, answers without a 5xx — a declared "not
//      configured" 503 excepted.
//   3. A module whose feature is off is refused at the server (403), whatever the menu shows.
//   4. No reply carries a customer's portal token, the credential that opens their portal.
// The Factory, answered here: a tenant's billing, account and domain routes ask it, and a test never calls the real one.
process.env.FACTORY_URL = 'https://factory.contract.local'
process.env.FACTORY_SYNC_KEY = 'contract-key'
process.env.TENANT_ID = 'tenant-contract'
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input)
  if (!url.startsWith(process.env.FACTORY_URL!)) return realFetch(input, init)
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { FEATURE_REGISTRY } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import type { Mount } from '../server/http/registry.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let seeded: Awaited<ReturnType<typeof seedOwner>>
let token: string
let mounts: Mount[]
const GHOST = 'zzzzzzzzzzzzzzzzzzzzzzzz'
const PORTAL_TOKEN = 'contract-portal-token-do-not-leak'
const ids: Record<string, string> = {}

const ALL_FEATURES = [...new Set(FEATURE_REGISTRY.map((f) => f.id))]
const setFeatures = async (f: string[]) => {
  await t.db.update(t.schema.company).set({ enabledFeatures: f }).where(eq(t.schema.company.id, seeded.company.id))
  t.services.features.forgetFeatures()
}

type Route = { method: string; path: string; mount: Mount }
let routes: Route[] = []

/** The mount a path belongs to: the longest mount path it sits under. */
const mountOf = (path: string) => mounts.filter((m) => !m.site && !m.admin && (path === m.path || path.startsWith(m.path + '/')))
  .sort((a, b) => b.path.length - a.path.length)[0]

const fill = (path: string) => path.replace(/:(\w+)\{[^}]*\}|:(\w+)/g, (_m, a, b) => ids[a || b] || GHOST)

const call = (method: string, path: string, signedIn = true) => t.call(path, {
  method,
  headers: signedIn ? { Authorization: `Bearer ${token}` } : {},
  ...(['POST', 'PUT', 'PATCH'].includes(method) ? { json: {} } : {}),
})

beforeAll(async () => {
  t = await bootTenant()
  seeded = await seedOwner(t)
  await setFeatures(ALL_FEATURES)
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
  mounts = t.services.mounts
  // Real rows where the paths name them, so a handler runs past its lookup; the contact holds a live portal token.
  const [contact] = await t.db.insert(t.schema.contact).values({
    companyId: seeded.company.id, name: 'Contract Client', type: 'client', email: 'client@contract.example',
    portalEnabled: true, portalToken: PORTAL_TOKEN, portalTokenExp: new Date(Date.now() + 90 * 86400000),
  }).returning()
  const [project] = await t.db.insert(t.schema.project).values({ companyId: seeded.company.id, number: 'PRJ-CONTRACT', name: 'Contract Project', contactId: contact.id } as any).returning()
  ids.contactId = contact.id
  ids.projectId = project.id

  const seen = new Set<string>()
  for (const r of t.app.routes as { method: string; path: string }[]) {
    if (!r.path.startsWith('/api/') || r.path.includes('*') || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(r.method)) continue
    const m = mountOf(r.path)
    if (!m || m.access === 'factory') continue
    const key = r.method + ' ' + r.path
    if (seen.has(key)) continue
    seen.add(key)
    routes.push({ method: r.method, path: r.path, mount: m })
  }
  // Deletes last, so they don't take the seeded rows from the routes after them.
  routes = [...routes.filter((r) => r.method !== 'DELETE'), ...routes.filter((r) => r.method === 'DELETE')]
}, 60_000)

/** Doors meant to answer without a session. */
const OPEN = new RegExp([
  '^/api/auth/(login|forgot-password|reset-password|refresh|verify|accept-invite|mfa)',
  '^/api/book(/|$)', '^/api/leads$', '^/api/public/', '^/api/portal/p/', '^/api/vendor-portal/v/', '^/api/pricebook-present',
  '/marketing/(track|unsubscribe)/', '/reviews/track/', '/(webhook|webhooks|callback)(/|$)', '/stripe/factory-event',
].join('|'))
// A declared refusal: an integration that isn't set up (503), or a service upstream that failed (502: the Factory, here
// a stand-in that answers {}). Neither is the app crashing.
const declared = (status: number, body: string) => status === 502 || status === 503 && /not[ _]configured|not connected|not set up|not enabled|unavailable|PROVIDER_NOT_CONFIGURED/i.test(body)

describe('the app contract, over every route', () => {
  test('the route table is read', () => {
    expect(routes.length).toBeGreaterThan(400)
  })

  test('signed out, nothing is readable', async () => {
    const holes: string[] = []
    for (const r of routes) {
      const res = await call(r.method, fill(r.path), false)
      if (r.mount.access === 'user') { if (res.status !== 401) holes.push(`${r.method} ${r.path} ${res.status}`) }
      else if (res.status < 300 && !OPEN.test(r.path)) holes.push(`${r.method} ${r.path} ${res.status} (public mount)`)
    }
    expect(holes).toEqual([])
  }, 120_000)

  test('signed in with every feature on, no route answers a server error, and none hands out a portal token', async () => {
    await setFeatures(ALL_FEATURES)
    const crashes: string[] = []
    const leaks: string[] = []
    for (const r of routes) {
      const res = await call(r.method, fill(r.path))
      const body = await res.text()
      if (res.status >= 500 && !declared(res.status, body)) crashes.push(`${r.method} ${r.path} ${res.status} ${body.slice(0, 140)}`)
      if (body.includes(PORTAL_TOKEN) && !/\/portal\//.test(r.path)) leaks.push(`${r.method} ${r.path}`)
    }
    expect(crashes).toEqual([])
    expect(leaks).toEqual([])
  }, 300_000)

  test('a module whose feature is off is refused at the server', async () => {
    await setFeatures([])
    const open: string[] = []
    for (const m of mounts.filter((x) => x.access === 'user' && x.feature)) {
      const r = routes.find((x) => x.mount === m && x.method === 'GET') || routes.find((x) => x.mount === m)
      if (!r) continue
      const res = await call(r.method, fill(r.path))
      if (res.status !== 403) open.push(`${m.path} (${[m.feature].flat().join('|')}) ${res.status}`)
    }
    await setFeatures(ALL_FEATURES)
    expect(open).toEqual([])
  }, 60_000)
})
