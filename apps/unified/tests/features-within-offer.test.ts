// A feature an industry is not offered is not switched on — for a business made before it was withdrawn too (live
// retest 2026-10-22, home care): the shared Invoices was taken off home care that day, but an existing agency still had
// it on — a second billing book whose $160 cash payment neither the agency's dashboard nor its Billing counted, its pages
// reachable only by a typed address — and Time Tracking was on with no menu entry (its Time page is the trades'; an
// agency's clock-ins are EVV). One rule, withinOffer (packages/tenant-backend featureRegistry.ts), applied by every door
// that writes the list — the boot sweep (modules/company.ts dropUnofferedFeatures), the Factory's sync, the owner's
// Settings › Features save, a first setup — so everything that reads the list reads the offer.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { withinOffer, getFeaturesForTemplate } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'
import { featureSyncVerdict } from '../../api/src/services/featureSyncVerdict.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const stored = async () => ((await t.db.select({ f: t.schema.company.enabledFeatures }).from(t.schema.company).where(eq(t.schema.company.id, companyId)))[0].f as string[]).slice().sort()
const store = async (f: string[]) => { await t.db.update(t.schema.company).set({ enabledFeatures: f } as any).where(eq(t.schema.company.id, companyId)); t.services.features.forgetFeatures() }
// What an agency made before 2026-10-22 could hold: home care's own, plus the two it no longer has, plus a retired id.
const OLD_AGENCY = ['contacts', 'dashboard', 'scheduling', 'team', 'two_way_texting', 'reports', 'invoices', 'time_tracking', 'service_dispatch']

beforeAll(async () => {
  t = await bootTenant({ vertical: 'homecare' })
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: seeded.password } })).json()).accessToken
}, 120_000)

describe('the rule', () => {
  test('home care keeps what it is offered and loses the shared Invoices, Time Tracking and ids no industry has', () => {
    expect(withinOffer('crm-homecare', OLD_AGENCY).sort()).toEqual(['contacts', 'dashboard', 'reports', 'scheduling', 'team', 'two_way_texting'])
    // The trades keep both.
    expect(withinOffer('crm', ['invoices', 'time_tracking'])).toEqual(['invoices', 'time_tracking'])
    // A not-ready feature this industry lists stays where a platform admin switched it on (withoutNotReady governs ON).
    expect(withinOffer('crm-roof', ['measurement_reports'])).toEqual(['measurement_reports'])
    // Settings › Features no longer lists Time Tracking or Invoices to an agency.
    const offered = getFeaturesForTemplate('crm-homecare').map((f) => f.id)
    expect(offered).not.toContain('time_tracking')
    expect(offered).not.toContain('invoices')
  })
})

describe('an agency made before the change', () => {
  test('the boot sweep switches off what it is not offered; the shared Invoices answers FEATURE_NOT_ENABLED', async () => {
    await store(OLD_AGENCY)
    // Before: the second book is open to the agency.
    expect((await as('/api/invoices')).status).toBe(200)
    const changed = await (t.services as any).dropUnofferedFeatures()
    expect(changed).toEqual([{ companyId, dropped: ['invoices', 'time_tracking', 'service_dispatch'] }])
    expect(await stored()).toEqual(['contacts', 'dashboard', 'reports', 'scheduling', 'team', 'two_way_texting'])
    const after = await as('/api/invoices')
    expect([after.status, ((await after.json()) as any).code]).toEqual([403, 'FEATURE_NOT_ENABLED'])
    expect((await as('/api/time')).status).toBe(403)
    // What the screens read (the menu, Settings › Features' switches) is the same list.
    const me = await (await as('/api/auth/me')).json() as any
    const features: string[] = me.company?.enabledFeatures ?? me.user?.company?.enabledFeatures
    expect(features.slice().sort()).toEqual(['contacts', 'dashboard', 'reports', 'scheduling', 'team', 'two_way_texting'])
    // A second boot has nothing to do.
    expect(await (t.services as any).dropUnofferedFeatures()).toEqual([])
  })

  test('the Factory’s sync cannot switch them back on from an older row', async () => {
    const was = process.env.FACTORY_SYNC_KEY
    process.env.FACTORY_SYNC_KEY = 'k'.repeat(32)
    try {
      const sync = async (features: string[]) => {
        const r = await t.call('/api/internal/sync-features', { method: 'POST', headers: { 'X-Factory-Key': 'k'.repeat(32) }, json: { features } })
        return { status: r.status, body: await r.json() as any }
      }
      const r = await sync(OLD_AGENCY)
      expect(r.status).toBe(200)
      expect(await stored()).toEqual(['contacts', 'dashboard', 'reports', 'scheduling', 'team', 'two_way_texting'])
      // The reply is the list as stored, and the Factory's admin save reads it (apps/api featureSyncVerdict): what
      // withinOffer withheld is named missing — the save is not shown as in sync.
      expect(r.body.features.slice().sort()).toEqual(await stored())
      expect(r.body.withheld).toEqual(['invoices', 'time_tracking', 'service_dispatch'])
      const off = featureSyncVerdict(OLD_AGENCY, r.status, r.body)
      expect([off.synced, off.error]).toEqual([false, 'CRM returned divergent feature list (missing: invoices, time_tracking, service_dispatch)'])
      // A save of what home care is offered reads as in sync.
      const fine = ['contacts', 'dashboard', 'scheduling', 'team', 'reports', 'documents']
      const ok = await sync(fine)
      expect(featureSyncVerdict(fine, ok.status, ok.body)).toEqual({ synced: true, received: fine, missing: [], error: null })
    } finally { if (was === undefined) delete process.env.FACTORY_SYNC_KEY; else process.env.FACTORY_SYNC_KEY = was }
  })

  test('the owner’s Settings › Features save drops them rather than refusing the save', async () => {
    await store(OLD_AGENCY)
    // The page sends back what it was given: the save succeeds, and the withdrawn ones are gone.
    const r = await as('/api/company/features', { method: 'PUT', json: { features: OLD_AGENCY } })
    expect(r.status).toBe(200)
    expect(await stored()).toEqual(['branded_email', 'contacts', 'dashboard', 'google_business', 'reports', 'scheduling', 'team', 'two_way_texting'])
    // One it never had and is not offered is still refused, as before.
    const bad = await as('/api/company/features', { method: 'PUT', json: { features: ['contacts', 'projects'] } })
    expect(bad.status).toBe(400)
    const catalog = await (await as('/api/company/features/catalog')).json() as any
    expect(catalog.features.map((f: any) => f.id)).not.toContain('time_tracking')
  })
})
