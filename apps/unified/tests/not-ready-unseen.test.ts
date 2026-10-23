// A not-ready feature reaches no business and no customer (owner, 2026-10-23: "nothing may advertise or mention
// financing to a business or its customers until financing is actually live and working"). For EVERY feature the
// registry marks not ready (hidden) — its name, its description, and the words it is spoken of in (FeatureDef.words) —
// held on every surface that carries product copy:
//   · the Factory: its wizard (apps/platform) and its price lists, signup and email copy (apps/api; comments stripped);
//   · generated websites: the composer's catalogue, every trade's page recipes, and the copy it and the template
//     content generator write (scrubbed by packages/tenant-backend notReadyCopy.ts);
//   · the unified app: every vertical's help articles, AI-assistant knowledge, first-run and site words; a website page
//     holding a not-ready feature's section; the site editor's section list; the menu; the customer's quote page; the
//     pricebook presentation — for a business that has not got the feature on, which while it is not ready is everyone.
// Each check reads the surface as a person gets it (a rendered page, an API answer, a built catalogue), or the source
// with comments stripped where the surface IS the source (the Factory's static lists).
//
// Not checked, and why: the composer's PROMPTS (apps/api sectionComposer.ts, composerFacts.ts, contentGenerator.ts) are
// instructions to the model — "never invent financing" names it to forbid it — so their OUTPUT is held here instead. The
// RV dealership's F&I desk (crm/rv fi.ts, FIPage.tsx) is the dealer arranging a unit's loan through its own lenders, a
// live feature of the RV CRM that is not consumer_financing; its lead-reply AI drafts are scrubbed like the composer's.
import { describe, test, expect, beforeAll } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { FEATURE_REGISTRY, getAdvertisableFeatures, notReadyPattern, withoutNotReadyCopy } from '@twomiah/tenant-backend'
import { bootTenant, seedOwner } from './harness.ts'

const ROOT = join(import.meta.dir, '..', '..', '..')
const HIDDEN = FEATURE_REGISTRY.filter((f) => f.hidden)
const WORDS = notReadyPattern()
/** Source with comments removed: a note about a rule is not copy anyone reads. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
/** What a not-ready feature's name, description or words appear in `text` as — [] when none. */
function mentions(text: string): string[] {
  const low = text.toLowerCase()
  const out: string[] = []
  for (const f of HIDDEN) {
    if (low.includes(f.name.toLowerCase())) out.push(`name "${f.name}"`)
    if (low.includes(f.description.toLowerCase())) out.push(`description of ${f.id}`)
  }
  const w = WORDS ? text.match(new RegExp(WORDS.source, 'gi')) : null
  if (w) out.push(`words ${[...new Set(w.map((x) => x.toLowerCase()))].join(', ')}`)
  return out
}
const files = (dir: string, re: RegExp): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f)
  return statSync(p).isDirectory() ? (f === 'node_modules' || f === 'dist' ? [] : files(p, re)) : re.test(f) ? [p] : []
})
/** Visible text of an HTML page: no styles, scripts or tags. */
const visible = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ')

describe('the registry', () => {
  test('consumer financing is not ready, and its words are named', () => {
    const f = HIDDEN.find((x) => x.id === 'consumer_financing')
    expect(f).toBeTruthy()
    expect(f!.words).toEqual(expect.arrayContaining(['financing', 'wisetack']))
    expect(WORDS!.test('Financing available')).toBe(true)
  })
  test('nothing not ready is advertised', () => {
    expect(getAdvertisableFeatures().filter((f) => f.hidden)).toEqual([])
  })
})

describe('the Factory', () => {
  // The composer's three files are held by their output below (see the header).
  const PROMPTS = ['sectionComposer.ts', 'composerFacts.ts', 'contentGenerator.ts']
  test('no wizard screen, price list, signup or email copy names a not-ready feature', () => {
    const found: string[] = []
    for (const f of [...files(join(ROOT, 'apps/platform/src'), /\.tsx?$/), ...files(join(ROOT, 'apps/api/src'), /\.ts$/)]) {
      if (/[\\/]config[\\/]featureRegistry\.ts$/.test(f) || PROMPTS.some((p) => f.endsWith(p))) continue
      const m = mentions(code(readFileSync(f, 'utf8')))
      if (m.length) found.push(`${f.slice(ROOT.length + 1)}: ${m.join('; ')}`)
    }
    expect(found).toEqual([])
  })
  test("the wizard's presets and plan lists switch on no not-ready feature (Ads only behind ADS_READY = false)", () => {
    for (const rel of ['apps/platform/src/components/factory/StepFeatures.tsx', 'apps/platform/src/components/factory/planData.ts']) {
      const src = code(readFileSync(join(ROOT, rel), 'utf8'))
      for (const f of HIDDEN) {
        const n = src.split(`'${f.id}'`).length - 1 + (src.match(new RegExp(`\\b${f.id}\\b`, 'g')) || []).length
        if (f.id === 'paid_ads' && rel.endsWith('StepFeatures.tsx')) { expect(src).toMatch(/const ADS_READY = false/); continue }
        expect({ rel, id: f.id, uses: n }).toEqual({ rel, id: f.id, uses: 0 })
      }
    }
  })
  test("the price lists' defaults, as the Factory seeds them, name none", async () => {
    const pricing = await import(join(ROOT, 'apps/api/src/config/pricing.ts'))
    expect(mentions(JSON.stringify(pricing))).toEqual([])
  })
})

describe('generated websites', () => {
  const TRADES = ['general contractor', 'roofing', 'hvac', 'plumbing', 'landscaping', 'rv dealer', 'home care', 'dental office', 'restaurant', 'salon', 'bar', 'veterinary clinic', 'cannabis dispensary', 'food truck', 'coffee shop', 'gym', 'hotel', 'wedding venue', 'online store', '']
  test("the composer's catalogue offers no not-ready feature's section or option", async () => {
    const { composableSchema } = await import(join(ROOT, 'apps/api/src/services/sectionComposer.ts'))
    const schema = composableSchema()
    const sectionTypes = FEATURE_REGISTRY.filter((f) => f.hidden).flatMap((f) => f.siteSections || [])
    expect(sectionTypes).toContain('financing')
    for (const t of sectionTypes) expect(Object.keys(schema)).not.toContain(t)
    expect(mentions(JSON.stringify(Object.entries(schema).map(([t, v]: any) => [t, Object.entries(v).map(([n, s]: any) => [n, s.required, s.optional, s.use_when])])))).toEqual([])
  })
  test("no trade's page recipe asks for one", async () => {
    const { pageRecipesFor } = await import(join(ROOT, 'apps/api/src/services/sectionComposer.ts'))
    for (const trade of TRADES) {
      const recipes = pageRecipesFor(trade)
      expect({ trade, m: mentions(JSON.stringify(recipes)) }).toEqual({ trade, m: [] })
    }
  })
  test('copy the model wrote that names one comes out — a sentence, a list item, a section', async () => {
    const { sanitizeSections } = await import(join(ROOT, 'apps/api/src/services/sectionComposer.ts'))
    const out = sanitizeSections([
      { type: 'financing', variant: 'calculator', data: { heading: 'Roof financing from $99/mo' } },
      { type: 'hero', variant: 'split', data: { title: 'New roofs in Akron', subtitle: 'Free inspections. Financing available through Wisetack.' } },
      { type: 'faq', variant: 'accordion', data: { heading: 'Questions', items: [{ q: 'Do you offer financing?', a: 'Yes.' }, { q: 'Are estimates free?', a: 'Yes.' }] } },
    ])
    expect(out.map((s: any) => s.type)).toEqual(['hero', 'faq'])
    expect(out[0].data.subtitle).toBe('Free inspections.')
    expect(out[1].data.items).toEqual([{ q: 'Are estimates free?', a: 'Yes.' }])
    expect(mentions(JSON.stringify(out))).toEqual([])
  })
  test("the template content generator's copy keeps its shape and loses the mention", () => {
    const content = { homepage: { hero: { title: 'Roofing in Akron', subtitle: 'Easy financing options.' } }, services: [{ name: 'Roof replacement', description: 'Full tear-off. Wisetack financing on approved credit. Ten-year warranty.' }] }
    const out = withoutNotReadyCopy(content)
    expect(out).toEqual({ homepage: { hero: { title: 'Roofing in Akron', subtitle: '' } }, services: [{ name: 'Roof replacement', description: 'Full tear-off. Ten-year warranty.' }] })
  })
})

describe('the unified app, for a business without the feature (everyone, while it is not ready)', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let token = ''
  let companyId = ''
  const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
  const FINANCING = { type: 'financing', variant: 'calculator', data: { heading: 'Roof financing', fromMonthly: 120, apr: 8.99 } }
  const HERO = { type: 'hero', variant: 'centered-stats', data: { title: 'Summit Roofing', subtitle: 'Roofs done right.' } }

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'roofing' })
    const s = await seedOwner(t)
    companyId = s.company.id
    // Everything roofing offers, as a signup gets it — and, as a platform admin could have left it, the lender account.
    const offered = FEATURE_REGISTRY.filter((f) => f.templates.includes('crm-roof') && !f.hidden).map((f) => f.id)
    await t.db.update(t.schema.company).set({ enabledFeatures: offered, integrations: { financing: { wisetack: { merchantId: 'M-1', prequalUrl: 'https://wisetack.us/#/x/prequalify', connectedAt: '2026-10-23' } } } } as any).where(eq(t.schema.company.id, companyId))
    t.services.features.forgetFeatures()
    await t.db.insert(t.schema.website).values({ companyId } as any)
    await t.db.insert(t.schema.page).values({ companyId, slug: 'home', title: 'Home', sections: [HERO, FINANCING] } as any)
    token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json() as any).accessToken
  }, 120_000)

  test("every vertical's help articles, assistant knowledge, first-run and site words name none", async () => {
    const found: string[] = []
    for (const v of readdirSync(join(ROOT, 'apps/unified/verticals'))) {
      const s = (await import(join(ROOT, 'apps/unified/verticals', v, 'settings.ts'))).default
      const m = mentions(JSON.stringify(s))
      if (m.length) found.push(`${v}: ${m.join('; ')}`)
    }
    expect(found).toEqual([])
  })

  test("a page saved with a not-ready feature's section shows the rest and not that", async () => {
    const r = await t.call('/')
    expect(r.status).toBe(200)
    const text = visible(await r.text())
    expect(text).toContain('Roofs done right.')
    expect(mentions(text)).toEqual([])
  })

  test("the site editor's section list does not offer it", async () => {
    const r = await as('/api/site/section-types')
    expect(r.status).toBe(200)
    const types: string[] = ((await r.json()) as any).data
    expect(types.length).toBeGreaterThan(5)
    expect(types.filter((x) => x.startsWith('financing/'))).toEqual([])
  })

  test('the menu names it only behind its own switch', () => {
    const shell = code(readFileSync(join(ROOT, 'apps/unified/web/src/shell.ts'), 'utf8'))
    const items = shell.split('\n').filter((l) => /\{\s*to:\s*'/.test(l) && WORDS!.test(l))
    expect(items.length).toBe(1)
    expect(items[0]).toMatch(/features: \['consumer_financing'\]/)
  })

  test("the customer's quote page, the quote and the pricebook presentation say nothing of it", async () => {
    const [c] = await t.db.insert(t.schema.contact).values({ companyId, name: 'Ann Able', email: 'ann@example.com', type: 'client' } as any).returning()
    const q = await (await as('/api/quotes', { method: 'POST', json: { name: 'Roof', contactId: c.id, lineItems: [{ description: 'Roof', quantity: 1, unitPrice: 9000 }] } })).json() as any
    await as(`/api/quotes/${q.id}/send`, { method: 'POST' })
    const [row] = await t.db.select({ token: t.schema.quote.publicToken }).from(t.schema.quote).where(eq(t.schema.quote.id, q.id))
    expect((await t.call(`/api/financing-public/d/${row.token}`)).status).toBe(404)
    expect(mentions(JSON.stringify(await (await t.call(`/api/portal/d/${row.token}/quotes/${q.id}`)).json().catch(() => ({}))))).toEqual([])
    expect(mentions(JSON.stringify(await (await as(`/api/quotes/${q.id}`)).json()))).toEqual([])
    const item = await (await as('/api/pricebook/items', { method: 'POST', json: { name: 'Roof system', price: 9000 } })).json() as any
    await t.db.update(t.schema.pricebookItem).set({ showToCustomer: true, active: true } as any).where(eq(t.schema.pricebookItem.id, item.id))
    const page = await t.call(`/api/pricebook-present/${item.id}`)
    expect(page.status).toBe(200)
    expect(mentions(visible(await page.text()))).toEqual([])
  })

  test('its own doors are shut', async () => {
    expect((await as('/api/financing/status')).status).toBe(403)
    expect((await t.call('/api/financing-public/webhook/wisetack', { method: 'POST', body: '{}' })).status).toBe(404)
  })
})
