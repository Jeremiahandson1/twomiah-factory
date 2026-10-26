// A signup's website (owner's decisions, 2026-10-25): the AI builder's composition when it is ready, the per-trade
// template composition otherwise (services/signupSite.ts, services/instantComposer.ts) — and going live per industry
// (unified/factory.ts engineForSignup / signupRefusal, UNIFIED_LIVE_VERTICALS). The model is never called: every AI
// compose here is a stand-in.
import { test, expect, describe } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { composeInstant, toComposition } from '../../../apps/api/src/services/instantComposer'
import { enforceIntakeFacts, extractNumbers } from '../../../apps/api/src/services/composerFacts'
import { SECTION_SCHEMA, pageRecipesFor, type ComposerInput, type SiteResult } from '../../../apps/api/src/services/sectionComposer'
import { premiumSitePages } from '../../../apps/api/src/services/premiumSitePages'
import {
  signupComposition, signupComposerInput, composeSignupSite, settleSignupSite, composeDecision, resumeSignupComposes,
  MAX_ATTEMPTS, MAX_PHOTO_BYTES, SIGNUP_PHOTO_FILE, decodeSignupPhoto, storeSignupPhoto, type SignupSiteDeps,
} from '../../../apps/api/src/services/signupSite'
import {
  engineForSignup, signupRefusal, unifiedLiveVerticals, unifiedVerticalFor, UNIFIED_VERTICAL_IDS, deployUnifiedTenant, provisionSite,
  type UnifiedDeps,
} from '../../../apps/api/src/unified/factory'
import { fakeStore } from './fakeStore'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')

// Every industry the signup pickers offer (apps/platform StepCompany INDUSTRY_OPTIONS, and the twomiah.com trades in
// config/websiteTrades.ts), plus the free-text kinds the intake reads (food truck, bar, cleaning).
const TRADES = [
  'general_contractor', 'roofing', 'hvac', 'plumbing', 'electrical', 'remodeling', 'painting', 'landscaping', 'concrete',
  'flooring', 'windows_doors', 'siding', 'insulation', 'solar', 'pool_spa', 'pest_control', 'commercial_construction',
  'field_service', 'home_care', 'automotive', 'rv', 'veterinary', 'dispensary', 'salon', 'restaurant', 'store', 'other',
  'food_truck', 'bar', 'cleaning', 'general_handyman', 'locksmith', 'garage_door', 'fitness', 'hospice', 'remodeler', 'painter',
]

const requiredOf = (type: string, variant: string) => (((SECTION_SCHEMA as any)[type]?.[variant]?.required) || []) as readonly string[]
const allowedFor = (bt: string) => new Set(Object.values(pageRecipesFor(bt)).flatMap((r) => [...r.allowed_types]))
const signupAnswers = (bt: string, over: Partial<ComposerInput> = {}): ComposerInput =>
  ({ businessName: 'Acme Co', businessType: bt, city: 'Eau Claire', state: 'WI', email: 'owner@acme.example', services: [], goals: [], ...over })

/** Every href in a page's sections (buttons and cards). */
function hrefsOf(value: any, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) hrefsOf(v, out)
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { if (k === 'href' && typeof v === 'string') out.push(v); else hrefsOf(v, out) }
  return out
}
/** All prose a page set prints. */
const prose = (pages: Record<string, any[]>) => JSON.stringify(pages)

// ─── 1. The template composer ────────────────────────────────────────────────

describe('the template composer (the fallback), for every trade the signup offers', () => {
  for (const bt of TRADES) {
    test(bt + ': several linked pages from the signup\'s answers alone, nothing invented', () => {
      const input = signupAnswers(bt)
      const site = composeInstant(input)
      const published = Object.keys(site.pages).filter((s) => !site.heldPages.includes(s))
      // A real menu: more than Home and Contact.
      expect(published.filter((s) => s !== 'home' && s !== 'contact').length).toBeGreaterThanOrEqual(1)
      expect(published).toContain('home')
      // Home and Contact always; every page is one of the trade's plan, an added services page, or a service's own.
      const plan = Object.keys(pageRecipesFor(bt))
      for (const slug of Object.keys(site.pages)) expect(plan.includes(slug) || slug === 'contact' || slug === 'services').toBe(true)
      // It already passed the facts gate: run again, the gate removes nothing and holds nothing more.
      const again = enforceIntakeFacts(site.pages, input, { requiredOf, allowedTypes: allowedFor(bt) })
      expect(again.removedClaims).toEqual([])
      expect(again.heldPages.sort()).toEqual([...site.heldPages].sort())
      expect(site.removedClaims).toEqual([])
      // No claim the owner did not make: no years, credentials, guarantees, free offers, round-the-clock promises,
      // and no number at all (the signup gave none but the phone and email, which are not claims).
      const all = prose(site.pages)
      expect(all).not.toMatch(/\b(19|20)\d\d\b|\byears?\b|licensed|insured|bonded|warrant|guarantee|free estimate|free inspection|24\/7|same[\s-]day|award|certified/i)
      for (const slug of published) for (const s of site.pages[slug]) expect(extractNumbers(JSON.stringify(s.data)).filter((n) => !['21'].includes(n))).toEqual([])
      // Never names the catch-all as a trade.
      expect(all).not.toMatch(/"Other|Other ·/)
      // Every link goes to a page that is live (a held page's links are removed by the gate).
      for (const slug of published) {
        for (const href of hrefsOf(site.pages[slug])) {
          const target = href.replace(/^\//, '').replace(/[?#].*$/, '')
          if (!target || /^https?:|^tel:|^mailto:/.test(href)) continue
          expect(published.includes(target)).toBe(true)
        }
      }
    })
  }

  test('the owner\'s services each get a page, linked from their card; the facts they gave appear, and only those', () => {
    const input = signupAnswers('general_contractor', {
      services: ['Kitchen remodels', 'Decks', 'Blog'],
      description: 'Two brothers who grew up in Texas. Interior and exterior remodeling.',
      ownerName: 'Wesley Higgs', phone: '817-888-5135', goals: ['bookings'],
      facts: { credentials: ['Licensed and insured'], freeEstimates: true, hours: 'Mon-Fri 8-5', testimonials: [{ quote: 'Rebuilt our deck in a week.', author: 'Pat K.' }] },
    })
    const site = composeInstant(input)
    expect(site.pages['kitchen-remodels']).toBeDefined()
    expect(site.pages.decks).toBeDefined()
    // A service named like one of the site's own addresses gets a page of its own name, not the site's.
    expect(site.pages['blog-service']).toBeDefined()
    expect(site.titles).toMatchObject({ 'kitchen-remodels': 'Kitchen remodels', decks: 'Decks', 'blog-service': 'Blog' })
    const cards = site.pages.services.find((s) => s.type === 'services' && s.data.heading === 'What we do')!
    expect(cards.data.items).toEqual([{ title: 'Kitchen remodels', href: 'kitchen-remodels' }, { title: 'Decks', href: 'decks' }, { title: 'Blog', href: 'blog-service' }])
    expect(site.heldPages).not.toContain('kitchen-remodels')
    // Their facts: the review, the free estimate on the booking button, the hours, the owner's own words.
    const all = prose(site.pages)
    expect(all).toContain('Rebuilt our deck in a week.')
    expect(all).toContain('Schedule a free estimate')
    expect(all).toContain('Two brothers who grew up in Texas.')
    expect(JSON.stringify(site.pages.contact)).toContain('Mon-Fri 8-5')
    expect(JSON.stringify(site.pages.about)).toContain('Wesley Higgs')
    // The titles reach the site's pages.
    const pages = premiumSitePages(toComposition(site))
    expect(pages.find((p) => p.slug === 'kitchen-remodels')?.title).toBe('Kitchen remodels')
  })

  test('with no services listed, one stand-in card for the trade, no page for it, and nothing but its title', () => {
    const site = composeInstant(signupAnswers('roofing'))
    const cards = site.pages.home.find((s) => s.type === 'services')!
    expect(cards.data.items).toEqual([{ title: 'Roofing' }])
    expect(Object.keys(site.pages).some((s) => s.startsWith('roofing'))).toBe(false)
  })

  test('a bar keeps its live-board site', () => {
    const site = composeInstant(signupAnswers('bar_and_grill'))
    expect(site.pages.home[0].type).toBe('tonight')
    for (const slug of ['menu', 'taps', 'events', 'parties', 'visit']) expect(Object.keys(site.pages)).toContain(slug)
    expect(site.heldPages).toEqual([])
  })

  test('deterministic: the same answers compose the same site', () => {
    const a = composeInstant(signupAnswers('landscaping', { services: ['Lawn mowing', 'Spring cleanup'] }))
    const b = composeInstant(signupAnswers('landscaping', { services: ['Lawn mowing', 'Spring cleanup'] }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(Object.keys(a.pages)).toContain('packages')
    expect(a.heldPages).not.toContain('packages')
  })
})

// ─── 2. The AI site, its fallback and a restart ─────────────────────────────

const aiSite = (name: string): SiteResult => ({
  pages: {
    home: { sections: [{ type: 'hero', variant: 'centered-stats', data: { title: name + ' — written by the AI' } }] },
    services: { sections: [{ type: 'services', variant: 'cards-grid', data: { items: [{ title: 'Roof repair', description: 'AI copy' }] } }] },
    contact: { sections: [{ type: 'contact', variant: 'form-info', data: { heading: 'Talk to us' } }] },
  },
  heldPages: [], contentGaps: [], removedClaims: [], rationale: 'stand-in',
})

function siteStage(opts: { compose?: (input: ComposerInput) => Promise<SiteResult>; state?: Record<string, any>; bootedAt?: number } = {}) {
  const input = signupAnswers('roofing', { businessName: 'Acme Roofing', services: ['Roof repair'] })
  const stored = signupComposition(input, { ai: true })
  if (opts.state) stored.aiCompose = { ...stored.aiCompose, ...opts.state }
  const store = fakeStore({ tenants: [{ id: 't-1', slug: 'acme-roofing', status: 'pending', created_at: new Date().toISOString(), preview_premium_pages: stored }] })
  const calls: ComposerInput[] = []
  const deps: SignupSiteDeps = {
    db: store, bootedAt: opts.bootedAt ?? Date.now() - 60_000,
    compose: async (i) => { calls.push(i); return opts.compose ? opts.compose(i) : aiSite(i.businessName) },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
  }
  return { store, deps, calls, input, row: () => store.tables.tenants[0] }
}

describe('the signup\'s site', () => {
  test('the signup stores the template composition at once, with the AI compose pending and the answers it composes from', () => {
    const input = signupComposerInput(
      { name: ' Acme Roofing ', industry: 'roofing', city: 'Eau Claire', state: 'WI', phone: '715-555-0100', email: 'o@acme.example', owner_first_name: 'Jo', owner_last_name: 'Tester', description: 'not a signup field' },
      { services: ['Roof repair'], goals: ['bookings'] },
    )
    expect(input).toMatchObject({ businessName: 'Acme Roofing', businessType: 'roofing', ownerName: 'Jo Tester', services: ['Roof repair'], goals: ['bookings'] })
    // Only what the signup form sends is read: it has no description field.
    expect(input.description).toBeUndefined()
    const stored = signupComposition(input, { ai: true })
    expect(stored.composer).toBe('template')
    expect(stored.aiCompose).toEqual({ status: 'pending', attempts: 0, input })
    expect(stored.pages.storm.sections.length).toBeGreaterThan(0)
    expect(signupComposition(input, { ai: false }).aiCompose).toBeUndefined()
  })

  test('the AI compose (a stand-in for the model) is stored as the site', async () => {
    const s = siteStage()
    await composeSignupSite('t-1', s.deps)
    const c = s.row().preview_premium_pages
    expect(c.composer).toBe('ai')
    expect(c.pages.home.sections[0].data.title).toBe('Acme Roofing — written by the AI')
    expect(c.aiCompose).toMatchObject({ status: 'done', attempts: 1, attemptId: null })
    expect(s.calls).toHaveLength(1)
    expect(s.calls[0]).toMatchObject({ businessName: 'Acme Roofing', businessType: 'roofing', services: ['Roof repair'] })
    // Done is done: nothing composes it again.
    expect(await settleSignupSite('t-1', s.deps, 1000)).toBe('ai')
    expect(s.calls).toHaveLength(1)
  })

  test('an AI failure falls back to the template composition — retried once, then given up', async () => {
    const s = siteStage({ compose: async () => { throw new Error('Anthropic 529 overloaded') } })
    const template = JSON.stringify(s.row().preview_premium_pages.pages)
    expect(await settleSignupSite('t-1', s.deps, 5_000)).toBe('template')
    const c = s.row().preview_premium_pages
    expect(s.calls).toHaveLength(MAX_ATTEMPTS)
    expect(c.aiCompose).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, lastError: 'Anthropic 529 overloaded' })
    expect(c.composer).toBe('template')
    expect(JSON.stringify(c.pages)).toBe(template)
  })

  test('a compose cut off by a restart is run again by the next settle', async () => {
    // The row says "composing", begun before this process booted: the process that ran it is gone.
    const s = siteStage({ state: { status: 'composing', attempts: 1, attemptId: 'dead-attempt', lastAttemptAt: new Date(Date.now() - 5 * 60_000).toISOString() }, bootedAt: Date.now() - 60_000 })
    expect(composeDecision(s.row().preview_premium_pages.aiCompose, { now: Date.now(), bootedAt: s.deps.bootedAt!, runningHere: false })).toBe('compose')
    expect(await settleSignupSite('t-1', s.deps, 5_000)).toBe('ai')
    expect(s.row().preview_premium_pages.aiCompose).toMatchObject({ status: 'done', attempts: 2 })
    // …and the dead attempt's late answer, if it ever came, would not be written: its attemptId is not the row's.
  })

  test('the preview sweep resumes a lost compose before anyone pays', async () => {
    const s = siteStage({ state: { status: 'composing', attempts: 1, attemptId: 'dead', lastAttemptAt: new Date(Date.now() - 5 * 60_000).toISOString() } })
    expect(await resumeSignupComposes(s.deps)).toEqual(['t-1'])
    expect(s.row().preview_premium_pages.composer).toBe('ai')
  })

  test('a compose that runs past the build\'s wait: the template site stands and the late AI answer is dropped', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const s = siteStage({ compose: async (i) => { await gate; return aiSite(i.businessName) } })
    expect(await settleSignupSite('t-1', s.deps, 200)).toBe('template')
    expect(s.row().preview_premium_pages.aiCompose).toMatchObject({ status: 'timed_out', attemptId: null })
    release()
    await new Promise((r) => setTimeout(r, 50))
    // The stored composition is still the one the build seeded the site with.
    expect(s.row().preview_premium_pages.composer).toBe('template')
  })

  test('a composition not waiting on the AI (an intake\'s, a staff recompose) is never touched', async () => {
    const store = fakeStore({ tenants: [{ id: 't-1', preview_premium_pages: { pages: { home: { sections: [] } } } }] })
    let called = false
    expect(await settleSignupSite('t-1', { db: store, compose: async () => { called = true; return aiSite('x') } }, 100)).toBe('none')
    expect(called).toBe(false)
  })

  test('the signup route stores the composition, starts the AI compose without waiting on it, and the builds settle it', () => {
    const intake = fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/intake.ts'), 'utf8')
    const signup = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))
    expect(signup).toMatch(/premiumPages = signupComposition\(\s*signupComposerInput\(body,/)
    expect(signup).toMatch(/preview_premium_pages: premiumPages/)
    // Started after the insert, never awaited (the checkout below must not wait on a model).
    expect(signup).toMatch(/liveSignupSiteDeps\(\)\.then\(\(d\) => composeSignupSite\(tenant\.id, d\)\)/)
    expect(signup).not.toMatch(/await[^\n]*composeSignupSite/)
    expect(signup.indexOf('composeSignupSite(')).toBeGreaterThan(signup.indexOf(".from('tenants').insert(tenantRecord)"))
    expect(signup.indexOf('composeSignupSite(')).toBeLessThan(signup.indexOf('createSubscriptionCheckout('))
    // The template build settles too, before it generates (premium-site-bootstrap reads the stored composition).
    const deploy = fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/deploy.ts'), 'utf8')
    const run = deploy.slice(deploy.indexOf('export async function runDeploy('))
    expect(run.indexOf('settleSignupSite(')).toBeGreaterThan(0)
    expect(run.indexOf('settleSignupSite(')).toBeLessThan(run.indexOf('await generate('))
  })
})

// ─── 2b. The owner's photo ───────────────────────────────────────────────────

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
const dataUrl = (mime: string, b: Buffer) => 'data:' + mime + ';base64,' + b.toString('base64')

describe('the signup photo', () => {
  test('only a real JPEG, PNG or WebP within the size limit is taken', () => {
    expect(decodeSignupPhoto(dataUrl('image/jpeg', JPEG))).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' })
    expect(decodeSignupPhoto(dataUrl('image/png', PNG))).toMatchObject({ ext: 'png' })
    // Bytes that are not what the header says, another type, too large, or not a data URL at all.
    expect(decodeSignupPhoto(dataUrl('image/jpeg', PNG))).toBeNull()
    expect(decodeSignupPhoto(dataUrl('image/svg+xml', Buffer.from('<svg onload=alert(1)>')))).toBeNull()
    expect(decodeSignupPhoto(dataUrl('image/jpeg', Buffer.concat([JPEG, Buffer.alloc(MAX_PHOTO_BYTES)])))).toBeNull()
    expect(decodeSignupPhoto('https://example.com/a.jpg')).toBeNull()
    expect(decodeSignupPhoto(undefined)).toBeNull()
  })

  test('stored with the intake\'s assets and named by a lasting Factory address — never a data URL in the composition', async () => {
    const uploads: any[] = []
    const upload = async (bytes: Buffer, filename: string, contentType: string, slug: string) => {
      uploads.push({ bytes, filename, contentType, slug })
      return { storageKey: 'intake/' + slug + '/1761400000000-' + filename, storageType: 's3' as const }
    }
    const photo = await storeSignupPhoto(dataUrl('image/jpeg', JPEG), 'acme-roofing', { upload, factoryUrl: 'https://factory.test/' })
    expect(photo).toEqual({ url: 'https://factory.test/api/v1/factory/public/signup-photo/acme-roofing/1761400000000-hero.jpg', storageKey: 'intake/acme-roofing/1761400000000-hero.jpg', storageType: 's3' })
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({ filename: 'hero.jpg', contentType: 'image/jpeg', slug: 'acme-roofing' })
    expect(uploads[0].bytes.equals(JPEG)).toBe(true)
    expect(SIGNUP_PHOTO_FILE.test('1761400000000-hero.jpg')).toBe(true)
    // A bad photo stores nothing and costs the signup nothing.
    expect(await storeSignupPhoto(dataUrl('image/jpeg', PNG), 'acme-roofing', { upload, factoryUrl: 'https://factory.test' })).toBeNull()
    expect(uploads).toHaveLength(1)

    // Both composers get it: the template site's hero is the owner's photo, and the AI compose's input carries it.
    const input = signupComposerInput({ name: 'Acme Roofing', industry: 'roofing', city: 'Eau Claire', state: 'WI' },
      { services: [], goals: [], photos: [{ url: photo!.url, tag: 'hero', alt: 'Acme Roofing' }] })
    const stored = signupComposition(input, { ai: true })
    const hero = stored.pages.home.sections.find((s: any) => s.type === 'hero')
    expect(hero).toMatchObject({ variant: 'full-bleed', data: { image: photo!.url } })
    expect(stored.aiCompose.input.customerPhotos).toEqual([{ url: photo!.url, tag: 'hero', alt: 'Acme Roofing' }])
    expect(JSON.stringify(stored)).not.toContain('data:image')
    // A hero photo may be of the team or the place: it never stands in a gallery of "our work".
    expect(stored.heldPages).toContain('projects')

    const s = siteStage()
    s.row().preview_premium_pages = stored
    await composeSignupSite('t-1', s.deps)
    expect(s.calls[0].customerPhotos).toEqual([{ url: photo!.url, tag: 'hero', alt: 'Acme Roofing' }])
  })

  test('the signup route stores the photo before composing, records it for the library seed, and serves only that name', () => {
    const intake = fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/intake.ts'), 'utf8')
    const signup = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))
    expect(signup).toMatch(/storeSignupPhoto\(heroPhoto, slug, \{ upload: uploadIntakeAsset, factoryUrl \}\)/)
    expect(signup.indexOf('storeSignupPhoto(')).toBeLessThan(signup.indexOf('premiumPages = signupComposition('))
    expect(signup).toMatch(/photos: ownPhoto \? \[\{ url: ownPhoto\.url, tag: 'hero'/)
    expect(signup).toMatch(/photos: \[\{ storageKey: ownPhoto\.storageKey, storageType: ownPhoto\.storageType \}\]/)
    const route = intake.slice(intake.indexOf("factory.get('/public/signup-photo/:slug/:file'"), intake.indexOf("factory.post('/public/signup'"))
    expect(route).toMatch(/SIGNUP_PHOTO_FILE\.test\(file\)/)
    expect(route).toMatch(/intakeAssetLink\(slug, file/)
  })
})

// ─── 3. The unified build uses the AI's site ────────────────────────────────

function buildStage(compose: SignupSiteDeps['compose']) {
  const input = signupAnswers('roofing', { businessName: 'Acme Roofing', services: ['Roof repair'] })
  const store = fakeStore({
    tenants: [{
      id: 't-1', slug: 'acme-roofing', name: 'Acme Roofing', email: 'twomiah14+e2e@gmail.com', admin_email: 'twomiah14+e2e@gmail.com',
      phone: '715-555-0100', industry: 'roofing', city: 'Eau Claire', state: 'WI', plan: 'starter10', products: ['crm', 'website'],
      features: ['contacts'], status: 'deploying', engine: 'unified', admin_password: 'pw', created_at: new Date().toISOString(),
      preview_premium_pages: signupComposition(input, { ai: true }),
    }],
    factory_jobs: [{ id: 'job-1', tenant_id: 't-1', template: 'unified', status: 'deploying', created_at: '2026-10-25T00:00:00Z', config: { company: { plan: 'starter10' } } }],
  })
  const provisioned: any[] = []
  const hosts: any = {
    repoFullName: (n: string) => 'acct/' + n, getRepo: async () => null, findService: async () => null, findDatabase: async () => null,
    getEnv: async () => ({}), createDatabase: async () => ({ id: 'dpg-1' }), getDatabase: async () => ({ status: 'available', suspended: 'not_suspended' }),
    databaseUrl: async () => 'postgres://u:p@dpg-1-a/acme', createRepo: async () => ({}),
    createService: async () => ({ id: 'srv-1', url: 'https://acme-roofing-app.onrender.com' }), setEnv: async () => {}, deploy: async () => {},
    updateServiceCommands: async () => {}, health: async () => ({ commit: 'c0ffee1' }),
    callTenant: async (_u: string, _p: string, _k: string, body: any) => { provisioned.push(body); return { status: 201, body: {} } },
  }
  const siteDeps: SignupSiteDeps = { db: store, compose, bootedAt: Date.now() - 60_000 }
  const deps: UnifiedDeps = {
    db: store, io: { hosts, push: async () => 'c0ffee1', sleep: async () => {} }, root: ROOT, version: 'abcdef1', factoryUrl: 'https://factory.test',
    fetch: async () => new Response('{}', { status: 200 }),
    owned: async () => ({ repos: new Set(), serviceIds: new Set(), databaseIds: new Set(), hosts: new Set() }) as any,
    integrationEnv: async () => () => [], hashPassword: async () => '$2b$04$' + 'a'.repeat(53), audit: async () => {},
    notify: { complete: async () => {}, failed: async () => {}, stillWorking: async () => {} },
    pushSubscription: async () => {}, r2: { configured: () => false, ensureBucket: async () => ({ bucketName: '', created: false }), envVars: () => [] },
    seedPhotos: async () => {}, domains: { targets: async () => null, wire: async () => ({ success: true, steps: [], errors: [] }), reconcileAliases: () => {} },
    stillWorkingMs: 60 * 60_000, waitMs: 0,
    settleSite: (id) => settleSignupSite(id, siteDeps, 5_000),
  }
  return { store, deps, provisioned }
}

describe('the unified build', () => {
  test('seeds the site with the AI composition, composed while the build ran', async () => {
    const s = buildStage(async (i) => aiSite(i.businessName))
    const r = await deployUnifiedTenant('t-1', s.deps)
    expect(r.errors).toEqual([])
    expect(s.provisioned).toHaveLength(1)
    const site = s.provisioned[0].site
    expect(site.pages.map((p: any) => p.slug)).toEqual(['home', 'services', 'contact'])
    expect(site.pages[0].sections[0].data.title).toBe('Acme Roofing — written by the AI')
    expect(s.store.tables.tenants[0].preview_premium_pages.composer).toBe('ai')
  }, 180_000)

  test('an AI failure: the build seeds the template site — the roofer\'s whole plan, not a skeleton', async () => {
    const s = buildStage(async () => { throw new Error('model refused') })
    const r = await deployUnifiedTenant('t-1', s.deps)
    expect(r.errors).toEqual([])
    const site = s.provisioned[0].site
    const live = site.pages.filter((p: any) => p.isPublished).map((p: any) => p.slug)
    expect(live).toEqual(expect.arrayContaining(['home', 'storm', 'about', 'contact', 'roof-repair']))
    expect(site.nav.map((n: any) => n.label)).toEqual(expect.arrayContaining(['Storm damage', 'About']))
    expect(site.pages.find((p: any) => p.slug === 'roof-repair').title).toBe('Roof repair')
  }, 180_000)

  test('provisionSite: a tenant with no stored composition gets the template composer\'s', () => {
    const body: any = provisionSite({ name: 'Acme Lawn', industry: 'landscaping', city: 'Eau Claire', state: 'WI', intake_data: { intake: { services: ['Mowing'] } } })
    expect(body.pages.filter((p: any) => p.isPublished).map((p: any) => p.slug)).toEqual(expect.arrayContaining(['home', 'services', 'packages', 'about', 'contact', 'mowing']))
  })
})

// ─── 4. Going live per industry ──────────────────────────────────────────────

describe('UNIFIED_LIVE_VERTICALS', () => {
  const LIVE = 'contractor,fieldservice,landscaping,roofing,homecare,restaurant,bar,salon'
  const live = unifiedLiveVerticals({ UNIFIED_LIVE_VERTICALS: LIVE })
  const real = (industry: string) => ({ industry, email: 'owner@business.example' })
  const testSignup = (industry: string) => ({ industry, email: 'twomiah14+run@gmail.com' })

  test('read in one place: known ids only; unset, empty or all-unknown is no list', () => {
    expect([...live!].sort()).toEqual(LIVE.split(',').sort())
    expect(unifiedLiveVerticals({})).toBeNull()
    expect(unifiedLiveVerticals({ UNIFIED_LIVE_VERTICALS: ' ' })).toBeNull()
    expect(unifiedLiveVerticals({ UNIFIED_LIVE_VERTICALS: 'roofer, hvac' })).toBeNull()
    expect([...unifiedLiveVerticals({ UNIFIED_LIVE_VERTICALS: 'Roofing  salon,typo' })!]).toEqual(['roofing', 'salon'])
    for (const id of LIVE.split(',')) expect(UNIFIED_VERTICAL_IDS).toContain(id)
  })

  test('the tested industries map onto the list (food trucks and caterers run as restaurants)', () => {
    for (const ind of ['general_contractor', 'remodeling', 'hvac', 'plumbing', 'electrical', 'cleaning', 'pest_control', 'handyman', 'landscaping', 'roofing', 'home_care', 'restaurant', 'food_truck', 'catering', 'bar', 'salon']) {
      expect(live!.has(unifiedVerticalFor(ind)!)).toBe(true)
    }
    for (const ind of ['veterinary', 'rv', 'store', 'other']) expect(live!.has(unifiedVerticalFor(ind)!)).toBe(false)
  })

  test('off: the list changes nothing — every signup on the templates, nobody refused', () => {
    for (const ind of ['roofing', 'veterinary', 'dispensary']) {
      expect(engineForSignup(real(ind), 'off', live)).toBe('templates')
      expect(signupRefusal(real(ind), 'off', live)).toBeNull()
    }
  })

  test('test, no list (today\'s behaviour): test signups unified, real ones on the templates, nobody refused', () => {
    expect(engineForSignup(testSignup('veterinary'), 'test', null)).toBe('unified')
    expect(engineForSignup(real('roofing'), 'test', null)).toBe('templates')
    expect(signupRefusal(real('veterinary'), 'test', null)).toBeNull()
  })

  test('test + the list: real signups for a live industry go unified; any other is refused, never put on the templates', () => {
    for (const ind of ['roofing', 'hvac', 'home_care', 'food_truck', 'salon', 'bar', 'general_contractor', 'landscaping', 'restaurant']) {
      expect(engineForSignup(real(ind), 'test', live)).toBe('unified')
      expect(signupRefusal(real(ind), 'test', live)).toBeNull()
    }
    for (const ind of ['veterinary', 'rv', 'store', 'other', 'dispensary']) {
      expect(engineForSignup(real(ind), 'test', live)).toBe('templates')
      expect(signupRefusal(real(ind), 'test', live)).toMatch(/are not open yet/)
    }
    expect(signupRefusal(real('veterinary'), 'test', live)).toBe('Sign-ups for Veterinary Care businesses are not open yet. We are getting Twomiah ready for you — please check back soon.')
    expect(signupRefusal(real('other'), 'test', live)).toMatch(/^Sign-ups for this kind of business/)
  })

  test('test + the list: a test signup still goes unified for every vertical, and is never refused', () => {
    for (const ind of ['veterinary', 'rv', 'store', 'other', 'roofing', 'salon']) {
      expect(engineForSignup(testSignup(ind), 'test', live)).toBe('unified')
      expect(signupRefusal(testSignup(ind), 'test', live)).toBeNull()
    }
    expect(signupRefusal({ industry: 'veterinary', email: 'x@y.example', is_test_tenant: true }, 'test', live)).toBeNull()
  })

  test('all: every industry with a unified vertical goes unified; with the list set, one without (dispensary) is refused', () => {
    expect(engineForSignup(real('veterinary'), 'all', live)).toBe('unified')
    expect(signupRefusal(real('veterinary'), 'all', live)).toBeNull()
    expect(engineForSignup(real('dispensary'), 'all', live)).toBe('templates')
    expect(signupRefusal(real('dispensary'), 'all', live)).toMatch(/not open yet/)
    expect(signupRefusal(real('dispensary'), 'all', null)).toBeNull()
  })

  test('the signup refuses before anything is made, and the form can ask first', () => {
    const intake = fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/intake.ts'), 'utf8')
    const signup = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))
    const refuse = signup.indexOf('signupRefusal(')
    expect(refuse).toBeGreaterThan(0)
    expect(refuse).toBeLessThan(signup.indexOf('allocateSlug('))
    expect(signup).toMatch(/if \(refusal\) return c\.json\(\{ error: refusal, code: 'INDUSTRY_NOT_OPEN' \}, 422\)/)
    expect(intake).toMatch(/factory\.get\('\/public\/signup\/industry-open'/)
  })
})
