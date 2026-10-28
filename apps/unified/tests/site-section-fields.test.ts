// The website editor's section forms (web/src/site/sectionFields.ts, drawn by GenericSectionForm) against the sections
// they edit (site/views/sections/<type>/<variant>.ejs), and the "Add a section" picker (GET /api/site/section-types):
//   · every `data.X` a section's view reads is a field the owner can set, or is named below with the reason it has none;
//     every field is one the view reads (a new view field can't be forgotten, a dead field can't linger)
//   · a switch the view reads as on-unless-false (`data.X !== false`) shows ticked when the section never said
//   · parity with the live bar's own editor (templates/website-premium-bar/admin): every section it could edit, edited
//     here with at least the same fields, the same kinds
//   · the picker offers a bar site every bar section, and a section that needs the bar's add-on to no one else
//   · on a bar tenant: each bar section, filled through every field, saves through the admin API, comes back the same,
//     and renders on the public page with what was typed
import { describe, test, expect, beforeAll } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { TRADE_SECTIONS, findTradeSection, type FieldSpec } from '../web/src/site/sectionFields.ts'
import { findSectionDef } from '../web/src/site/sectionSchema.ts'
import { ADDON_SECTIONS, SERVER_BUILT_SECTIONS, offersSection } from '../server/site/admin.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { VIEWS } from '../server/site/render.ts'
import { bootTenant, seedOwner } from './harness.ts'

const SECTIONS = path.join(VIEWS, 'sections')
const BAR_TEMPLATE = path.resolve(import.meta.dir, '..', '..', '..', 'templates', 'website-premium-bar')
const view = (key: string) => fs.readFileSync(path.join(SECTIONS, key + '.ejs'), 'utf8')
const library = () => fs.readdirSync(SECTIONS).flatMap((type) => fs.readdirSync(path.join(SECTIONS, type)).filter((f) => f.endsWith('.ejs')).map((f) => type + '/' + f.slice(0, -4)))
const keyOf = (s: { type: string; variant: string }) => s.type + '/' + s.variant
/** The `data.X` a view reads at the top level of its section data. */
const reads = (src: string) => new Set([...src.matchAll(/\bdata\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))

/**
 * What a view reads that the owner is given no field for, each with why. Keyed by section and field: never a whole
 * section, never a pattern.
 */
const NO_FIELD: Record<string, Record<string, string>> = {
  // The view is the template's own file (site-parity). The bar's cover hides the line (designs/bar.css .board__title-sub):
  // offered as "Line under the lettering", it showed nowhere (bar live test, 2026-10-25). The lines under the name are line1/line2.
  'tonight/board': { titleSub: 'the cover design hides it, so a field for it would do nothing; line1 and line2 are the lines under the name' },
  'menu/sections': { sections: "the fallback menu for a bar whose CRM has none yet; the menu is the CRM's (Bar → Menu), edited there" },
  'timeline/era': { entries: "the fallback when there are no facts; an era's words are the Story timeline's eras (site.timeline), edited there" },
  'timeline/book': { plates: "a per-chapter picture keyed by era name; each chapter's own Plate field sets it, and the eras' photos fill the rest" },
  'location/live-map': {
    mapCenter: 'the map draws only with settings.mapboxPublicToken, which nothing in the app sets: a control for it would do nothing',
    mapZoom: 'the same map; nothing in the app sets its token',
    smsOptIn: "texting sign-up is off until a real one exists (settings.smsSubscribeEnabled, nothing sets it; A2P consent first)",
  },
  'shop/grid': {
    products: "the store's catalogue, drawn live by the site (site/routes.ts) — products are edited on Products",
    onPage: 'set by the site when the grid sits on a composed page under its hero (an h2), not on /shop (the h1)',
  },
  'blog_preview/latest': { posts: "the business's own published posts, filled in by the site (site/routes.ts) — they are edited on Blog" },
  'social/feed': { limit: 'how many posts the grid shows, from settings.recentInstagramPosts, which nothing in the app fills: the section is a follow link' },
}

describe('every field a view reads is one the owner can set', () => {
  for (const s of TRADE_SECTIONS) {
    const key = keyOf(s)
    test(key, () => {
      const src = view(key)
      const read = reads(src)
      const declared = new Set(s.fields.map((f) => f.key))
      const exempt = NO_FIELD[key] || {}
      expect([...read].filter((k) => !declared.has(k) && !exempt[k])).toEqual([])
      // An exemption for a field that has one, or one the view no longer reads, is stale.
      expect(Object.keys(exempt).filter((k) => declared.has(k) || !read.has(k))).toEqual([])
      expect([...declared].filter((k) => !read.has(k))).toEqual([])
    })
  }

  test('the exemptions name only sections that have a form', () => {
    expect(Object.keys(NO_FIELD).filter((k) => !TRADE_SECTIONS.some((s) => keyOf(s) === k))).toEqual([])
  })
})

describe('a switch shows as the page reads it', () => {
  const bools = (fields: FieldSpec[]): FieldSpec[] => fields.flatMap((f) => f.kind === 'bool' ? [f] : f.kind === 'group' ? bools(f.fields) : [])
  for (const s of TRADE_SECTIONS) {
    const top = s.fields.filter((f) => f.kind === 'bool')
    if (!top.length) continue
    test(keyOf(s), () => {
      const src = view(keyOf(s))
      for (const f of bools(s.fields)) {
        const onUnlessFalse = new RegExp(`\\bdata\\.${f.key}\\s*(!==|===)\\s*false\\b`).test(src)
        expect({ key: f.key, defaultOn: !!(f.kind === 'bool' && f.defaultOn) }).toEqual({ key: f.key, defaultOn: onUnlessFalse })
      }
    })
  }
})

/** Fields the bar template's editor offered that do nothing here, each with why: offered, they read as broken. */
const DROPPED: Record<string, Record<string, string>> = {
  'tonight/board': { titleSub: 'the cover design hides it (designs/bar.css) — set, it showed nowhere (bar live test, 2026-10-25)' },
}

describe("parity with the live bar's own editor", () => {
  let TEMPLATE: typeof TRADE_SECTIONS = []
  beforeAll(async () => { TEMPLATE = (await import(path.join(BAR_TEMPLATE, 'admin', 'src', 'sectionFields.ts'))).TRADE_SECTIONS })
  /** Each field as path → kind, list items and groups included. */
  const shape = (fields: FieldSpec[], at = ''): Record<string, string> => Object.assign({}, ...fields.map((f) => ({
    [at + f.key]: f.kind,
    ...(f.kind === 'list' ? shape(f.item, at + f.key + '[].') : f.kind === 'group' ? shape(f.fields, at + f.key + '.') : {}),
  })))

  test('every section the template could edit is edited here, with every one of its fields, of the same kind', () => {
    expect(TEMPLATE.length).toBeGreaterThan(20)
    for (const t of TEMPLATE) {
      const mine = findTradeSection(t.type, t.variant)
      expect(mine ? keyOf(mine) : 'missing ' + keyOf(t)).toBe(keyOf(t))
      const want = shape(t.fields), have = shape(mine!.fields)
      for (const [p, kind] of Object.entries(want)) if (!DROPPED[keyOf(t)]?.[p]) expect({ section: keyOf(t), field: p, kind: have[p] }).toEqual({ section: keyOf(t), field: p, kind })
    }
  })

  test("every section the bar's template drew, bar the ones its server builds, is offered to a bar with a form", async () => {
    const bar = await loadVertical('bar')
    const drawn = fs.readdirSync(path.join(BAR_TEMPLATE, 'views', 'sections')).flatMap((type) =>
      fs.readdirSync(path.join(BAR_TEMPLATE, 'views', 'sections', type)).filter((f) => f.endsWith('.ejs')).map((f) => type + '/' + f.slice(0, -4)))
    expect(drawn).toContain('tonight/board')
    const missing = drawn.filter((k) => !SERVER_BUILT_SECTIONS.has(k)).filter((k) => {
      const [type, variant] = k.split('/')
      return !offersSection(k, bar) || !findSectionDef(type, variant)
    })
    expect(missing).toEqual([])
  })
})

describe('the picker', () => {
  test("every view that reads a vertical's live facts, or posts a vertical's own form, is held to that vertical", () => {
    const held: string[] = []
    for (const k of library()) {
      if (SERVER_BUILT_SECTIONS.has(k)) continue
      const src = view(k)
      const needsFacts = /typeof (site|live) !== 'undefined'|\b(site|live)\.[A-Za-z_]/.test(src.replace(/(['"`])(?:(?!\1).)*\1/g, "''"))
      const postsOwnForm = /name="formType"/.test(src)
      if (needsFacts && !ADDON_SECTIONS[k]?.facts) held.push(k + ' reads facts')
      if (postsOwnForm && !ADDON_SECTIONS[k]?.websiteForms) held.push(k + ' posts its own form')
    }
    expect(held).toEqual([])
    expect(Object.keys(ADDON_SECTIONS).filter((k) => !library().includes(k))).toEqual([])
  })

  test('a contractor (no add-on) is offered none of the bar-only sections; the shared ones still', async () => {
    const contractor = await loadVertical('contractor')
    for (const k of Object.keys(ADDON_SECTIONS)) expect({ k, offered: offersSection(k, contractor) }).toEqual({ k, offered: false })
    for (const k of ['hero/full-bleed', 'services/cards-grid', 'gallery/grid', 'faq/accordion', 'contact/form-info', 'reservation/cta']) expect({ k, offered: offersSection(k, contractor) }).toEqual({ k, offered: true })
  })

  // Store live test, 2026-10-26: "Add a section" offered every trade's sections to every business — an online store saw
  // Age gate, Strains, Care finder, Caregivers, Storm alert, Urgent care, Inventory units, Quote by property size, and no
  // section of its products. Each business is offered the sections its own page plans use (server/site/tradeSections.ts).
  test("each business is offered its own trade's sections, not another's", async () => {
    const [store, contractor, homecare] = await Promise.all([loadVertical('store'), loadVertical('contractor'), loadVertical('homecare')])
    expect(offersSection('shop/grid', store)).toBe(true)
    for (const k of ['age/modal', 'strain/grid', 'care/finder', 'caregivers/grid', 'banner/storm-alert', 'urgent/bar', 'inventory/showcase', 'quote/instant-address', 'events/recurring', 'visit/details'])
      expect({ k, offered: offersSection(k, store) }).toEqual({ k, offered: false })
    expect(offersSection('shop/grid', contractor)).toBe(false)
    expect(offersSection('care/finder', homecare)).toBe(true)
    expect(offersSection('care/finder', contractor)).toBe(false)
    // The routes' own pages are never offered (a product page, a cart, an order-received page).
    for (const k of ['shop/product', 'shop/cart', 'shop/receipt', 'order/page', 'order/done']) expect(offersSection(k, store)).toBe(false)
  })
})

// ── On a bar tenant ─────────────────────────────────────────────────────────────────────────────────────────────────
let t: Awaited<ReturnType<typeof bootTenant>>
let token = ''
const sectionFailures: string[] = []
const consoleError = console.error
console.error = (...a: unknown[]) => { if (String(a[0]).startsWith('[site] section')) sectionFailures.push(String(a[0])); consoleError(...a) }
const as = (p: string, init: any = {}) => t.call(p, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
const allWeek = (open: string, close: string) => Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open, close }]]))

/** A value for every field, as an owner filling the whole form would leave it; text is a marker to find on the page. */
function fill(fields: FieldSpec[], tag: string, markers: string[], top = true): Record<string, any> {
  const out: Record<string, any> = {}
  for (const f of fields) {
    const m = `${tag}x${f.key}`
    switch (f.kind) {
      case 'text': case 'textarea': out[f.key] = m; markers.push(m); break
      case 'number': out[f.key] = 3; break
      case 'image': out[f.key] = `/media/photos/${m}.jpg`; break
      case 'bool': out[f.key] = true; break
      case 'select': out[f.key] = f.options.find((o) => o.value)!.value; break
      case 'choices': out[f.key] = f.options.map((o) => o.value); break
      case 'cta': out[f.key] = { label: m, href: '/contact' }; break
      case 'strings': out[f.key] = f.numbers ? [1, 2] : [m]; break
      case 'list': out[f.key] = [fill(f.item, m, markers, false)]; break
      case 'group': out[f.key] = fill(f.fields, m, markers, false); break
    }
  }
  return out
}

/** Values a marker can't stand in for: a real day and times, era names that match, a door that exists. */
const REAL: Record<string, (d: Record<string, any>) => void> = {
  'events/recurring': (d) => Object.assign(d, { day: 'Friday', startTime: '17:00', endTime: '21:00' }),
  'timeline/eras': (d) => { d.entries[0] = { ...d.entries[0], slug: 'first-pour', yearStart: 1881, yearEnd: 1919, imageYear: 1890 } },
  'timeline/book': (d) => { d.entries[0] = { ...d.entries[0], slug: 'first-pour', yearStart: 1881, yearEnd: 1919, imageYear: 1890 } },
  'timeline/era': (d) => Object.assign(d, { slug: 'first-pour', backHref: '/story' }),
  'speakeasy/door': (d) => { d.riddles[0] = { ...d.riddles[0], doors: ['Left', 'Right'], answer: 0 }; d.doorNumber = '7' },
  'menu/sections': (d) => Object.assign(d, { kind: 'all' }),
}

/**
 * A section whose fields choose between looks: each look is rendered too, and a field passes when any look prints it.
 * The Tonight board with a cover image is the cover alone; without it, the lettering, lines, picture and closing lines.
 */
const ALSO: Record<string, Array<(d: Record<string, any>) => void>> = {
  'tonight/board': [(d) => { delete d.coverImage; delete d.coverImageSmall }, (d) => { delete d.coverImage; delete d.coverImageSmall; delete d.titleImage; delete d.titleImageSmall }],
}

describe('on a bar tenant: each bar section saves, comes back, and renders what was typed', () => {
  const bar = TRADE_SECTIONS.filter((s) => fs.existsSync(path.join(BAR_TEMPLATE, 'views', 'sections', s.type, s.variant + '.ejs')))
  // An era's page and the book read the eras of the `story` page's timeline once there is one (crm/bar/barSite.ts
  // timelineEntries); the book's own chapters only before. So: the book, then the story page, then an era's page.
  const ORDER = ['timeline/book', 'timeline/eras', 'timeline/era']
  bar.sort((a, b) => (ORDER.indexOf(keyOf(a)) + 1 || 99) - (ORDER.indexOf(keyOf(b)) + 1 || 99))

  beforeAll(async () => {
    t = await bootTenant({ vertical: 'bar' })
    const s = await seedOwner(t)
    const companyId = s.company.id
    await t.db.update(t.schema.company).set({ name: 'The Amber Tap', phone: '715-555-0100', address: '12 River St', city: 'Eau Claire', state: 'WI',
      enabledFeatures: ['contacts', 'event_bookings', 'lead_inbox', 'bar_menu', 'bar_tonight'] }).where(eq(t.schema.company.id, companyId))
    token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
    await t.db.insert(t.schema.website).values({ companyId })
    await t.db.insert(t.schema.page).values({ companyId, slug: 'home', title: 'Home', sections: [], isPublished: true })
    const ok = async (r: Response) => { if (r.status >= 300) throw new Error(r.status + ' ' + await r.text()); return r.json() }
    // The speakeasy door shows only while a password is set; the board and hours want hours.
    await ok(await as('/api/bar/settings', { method: 'PUT', json: { hours: { timezone: 'America/Chicago', bar: allWeek('00:00', '23:59'), kitchen: allWeek('00:00', '23:59') }, speakeasyPassword: 'chippewa' } }))
  })

  test('the picker offers this bar every one of them', async () => {
    const body = await (await as('/api/site/section-types')).json()
    for (const s of bar) expect(body.data).toContain(keyOf(s))
    expect(body.data).toContain('tonight/board')
    expect(body.data).not.toContain('menu/item-hero')
    expect(body.data).not.toContain('menu/live')
  })

  for (const s of bar) {
    const key = keyOf(s)
    test(key, async () => {
      const typed: string[] = []
      const data = fill(s.fields, key.replace(/[^a-z]/g, ''), typed)
      REAL[key]?.(data)
      // A field REAL set to a real value is checked by its own section's tests (bar-site), not by marker.
      const markers = typed.filter((m) => JSON.stringify(data).includes(`"${m}"`))
      const slug = key === 'timeline/eras' ? 'story' : 'p-' + key.replace(/[^a-z]+/g, '-')
      expect((await as('/api/site/pages', { method: 'POST', json: { slug, title: s.label } })).status).toBe(201)

      let printed = ''
      for (const look of [(_: Record<string, any>) => {}, ...(ALSO[key] || [])]) {
        const d = structuredClone(data)
        look(d)
        const sections = [{ type: s.type, variant: s.variant, data: d }]
        const saved = await as(`/api/site/pages/${slug}`, { method: 'PATCH', json: { sections, isPublished: true } })
        expect(saved.status).toBe(200)
        // Saved is a draft (site/drafts.ts); published, it is the page.
        expect((await (await as(`/api/site/pages/${slug}`)).json()).draft.sections).toEqual(sections)
        expect((await as(`/api/site/pages/${slug}/publish`, { method: 'POST', json: {} })).status).toBe(200)
        expect((await (await as(`/api/site/pages/${slug}`)).json()).sections).toEqual(sections)

        const before = sectionFailures.length
        const r = await t.call('/' + slug)
        expect(r.status).toBe(200)
        const html = await r.text()
        expect(sectionFailures.slice(before)).toEqual([])
        printed += html + text(html)
      }
      expect(markers.length).toBeGreaterThan(0)
      expect(markers.filter((m) => !printed.includes(m))).toEqual([])
    })
  }
})
