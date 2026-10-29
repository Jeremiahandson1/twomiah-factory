// Shared by the per-trade phone-tile tests (mobile-trade-tiles.test.ts …): the phone's natives replaced, a tenant served over real HTTP
// with seats, the home resolved exactly as the home screen does, and every tile held to its list. Same code as mobile-home-tiles.test.ts.
import { plugin } from 'bun'
import { expect } from 'bun:test'
import { eq, sql } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'

// ── the phone, replaced where it is native ──────────────────────────────────────────────────
const secure = new Map<string, string>()
const kv = new Map<string, string>()
plugin({
  name: 'phone natives',
  setup(build) {
    build.module('expo-secure-store', () => ({ loader: 'object', exports: {
      AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'x', getItemAsync: async (k: string) => secure.get(k) ?? null,
      setItemAsync: async (k: string, v: string) => { secure.set(k, v) }, deleteItemAsync: async (k: string) => { secure.delete(k) },
    } }))
    build.module('@react-native-async-storage/async-storage', () => ({ loader: 'object', exports: { default: {
      getItem: async (k: string) => kv.get(k) ?? null, setItem: async (k: string, v: string) => { kv.set(k, v) }, removeItem: async (k: string) => { kv.delete(k) },
    } } }))
    build.module('react-native', () => ({ loader: 'object', exports: { Linking: { openURL: async () => {} } } }))
  },
})
export const app = {
  client: await import('../../mobile/src/api/client.ts'),
  signIn: await import('../../mobile/src/auth/signIn.ts'),
  roles: await import('../../mobile/src/auth/roles.ts'),
  tiles: await import('../../mobile/src/home/tiles.ts'),
  detect: await import('../../mobile/src/vertical/detectVertical.ts'),
}
export const { get, clearTokens } = app.client
export const { tilesFor, resolveTiles, sourcesFor, reqUrl, roofStages } = app.tiles

export const PASS = 'Seat-pass-1'
export const only = (process.env.ONLY || '').split(',').filter(Boolean)
export const want = (trade: string) => !only.length || only.includes(trade)
export const ymd = (d: Date) => d.toISOString().slice(0, 10)
export const dayMarker = (s: string) => new Date(`${s}T00:00:00.000Z`)
export const TODAY = ymd(new Date())
export const TOMORROW = ymd(new Date(Date.now() + 86_400_000))
export const YESTERDAY = ymd(new Date(Date.now() - 86_400_000))

export type Tenant = Awaited<ReturnType<typeof bootTenant>>
export interface Site { t: Tenant; url: string; stop: () => void; companyId: string; ownerId: string; ownerPassword: string; people: Record<string, { id: string; email: string }>; features: string[]; excluded: string[]; excludedOnly: Record<string, string[]> }

export async function serve(vertical: string, features: string[], seats: Array<[string, string]>): Promise<Site> {
  const t = await bootTenant({ vertical })
  const s = await seedOwner(t)
  // UTC, so "today" is the same day for the test and the server whatever the hour (the zone rules have their own tests).
  await t.db.update(t.schema.company).set({ enabledFeatures: features, timezone: 'UTC' } as any).where(eq(t.schema.company.id, s.company.id))
  const people: Site['people'] = {}
  for (const [who, role] of seats) {
    const email = `${who}@tiles.example`
    const [u] = await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash(PASS, 'bcrypt'), firstName: who[0].toUpperCase() + who.slice(1), lastName: 'Seat', role, companyId: s.company.id } as any).returning()
    people[who] = { id: u.id, email }
  }
  const server = Bun.serve({ port: 0, fetch: (req) => t.app.fetch(req) })
  return { t, url: `http://localhost:${server.port}`, stop: () => server.stop(true), companyId: s.company.id, ownerId: s.owner.id, ownerPassword: s.password, people, features, excluded: [], excludedOnly: {} }
}

/** Sign in as the phone does, then ask for the home exactly as the home screen does. */
export async function homeAs(site: Site, who: string, vertical: string) {
  secure.clear(); kv.clear(); await clearTokens()
  const email = who === 'owner' ? 'owner@test.example' : site.people[who].email
  const step = await app.signIn.signInWithPassword(site.url, email, who === 'owner' ? site.ownerPassword : PASS)
  if (step.kind !== 'signedIn') throw new Error('sign-in: ' + JSON.stringify(step))
  const perms: string[] = Array.isArray(step.data.permissions) ? step.data.permissions.map(String) : []
  const feats: string[] = (step.data.company?.enabledFeatures || []).map((f: string) => String(f).toLowerCase())
  const ctx = { can: (p: string) => app.roles.permits(perms, p), hasFeature: (f: string) => feats.includes(f.toLowerCase()) }
  const v = app.detect.detectVertical(step.data.company?.vertical, step.data.company?.enabledFeatures) as any
  expect(v).toBe(vertical)
  const answers: Record<string, any> = {}
  for (const src of sourcesFor(v, ctx)) { const r = await get(src); if (r.ok) answers[src] = r.data }
  const shown = resolveTiles(v, ctx, answers)
  return { ctx, answers, shown, ids: shown.map((x: any) => x.def.id), vertical: v }
}

/** For every tile: open its list as the phone does and hold the list to the number. Returns what each tile said. */
export async function holdTilesToTheirLists(site: Site, home: Awaited<ReturnType<typeof homeAs>>) {
  const said: Record<string, number> = {}
  for (const { def, value } of home.shown) {
    const withLimit = { ...def.list, query: { ...(def.list.query || {}), limit: '200' } }
    const r = await get(reqUrl(withLimit))
    expect({ tile: def.id, ok: r.ok, status: (r as any).status }).toEqual({ tile: def.id, ok: true, status: (r as any).status })
    said[def.id] = value
    const body = r.data
    const isMoney = def.id === 'outstanding' || def.id === 'month-revenue'
    if (def.id === 'outstanding') {
      const sum = Math.round((body.data as any[]).reduce((n, x) => n + Number(x.balance ?? 0), 0) * 100) / 100
      expect({ tile: def.id, sum }).toEqual({ tile: def.id, sum: value })
    } else if (def.id === 'month-revenue') {
      expect({ tile: def.id, total: def.total(body) }).toEqual({ tile: def.id, total: value })
    }
    if (!isMoney) expect({ tile: def.id, rows: def.total(body) }).toEqual({ tile: def.id, rows: value })
    // …and the row count is the rows themselves, not just a total printed beside a shorter list.
    if (!isMoney && Array.isArray(body?.data) && def.id !== 'inventory') expect({ tile: def.id, listed: body.data.length }).toEqual({ tile: def.id, listed: value })
    // No row the tile does not count may be in the list.
    const text = JSON.stringify(body)
    for (const id of [...site.excluded, ...(site.excludedOnly[def.id] || [])]) expect({ tile: def.id, leaked: text.includes(id) ? id : null }).toEqual({ tile: def.id, leaked: null })
  }
  return said
}

