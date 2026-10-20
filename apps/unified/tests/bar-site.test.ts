// The bar's website on the unified app (templates/website-premium-bar, ported): its design, every section it had, the
// night read live from the bar add-on in the same database (crm/bar/barSite.ts), and its two forms.
//   · the bar's CRM writes (a tap, tonight's special, the menu, an event, the hours) show on the pages that render them
//   · every bar section renders on a real page, 200, with its real content; pages the facts make (a signature item,
//     an era of the story) are served and in the sitemap
//   · the party request opens a party enquiry; the Regulars sign-up tags the guest with the words its box showed
//   · a feature the owner switched off gives the section's own fallback line, never a 500
//   · the stylesheet is the bar's look over the base, its faces and scripts are served
import { describe, test, expect, beforeAll } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { EMAIL_CONSENT_TEXT } from '../server/crm/bar/barSite.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
let token = ''
let ipCount = 0
// A section that throws is logged and left off the page (home.ejs): every one here must render.
const sectionFailures: string[] = []
const consoleError = console.error
console.error = (...a: unknown[]) => { if (String(a[0]).startsWith('[site] section')) sectionFailures.push(String(a[0])); consoleError(...a) }
const FEATURES = ['contacts', 'event_bookings', 'lead_inbox', 'bar_menu', 'bar_tonight']
const as = (path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } })
const page = async (path: string) => {
  const r = await t.call(path)
  return { status: r.status, html: await r.text() }
}
/** Text as a reader sees it: tags dropped, entities for quotes and ampersands read. */
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
// The browser's own post of the form: urlencoded, from its own address, as a person (a dwell time well past 1.5 s).
const postForm = (fields: Record<string, string>) => t.call('/api/leads', {
  method: 'POST', body: new URLSearchParams({ t: String(Date.now() - 10_000), ...fields }).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'X-Forwarded-For': `198.51.100.${++ipCount}` },
})
const future = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)
const allWeek = (open: string, close: string) => Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open, close }]]))

const PAGES: Record<string, any[]> = {
  home: [
    { type: 'tonight', variant: 'board', data: { title: 'The Amber Tap', intro: 'Est. 1881 on the river.' } },
    { type: 'about', variant: 'story', data: { title: 'About the Amber Tap', paragraphs: ['A tavern on the river since 1881.'] } },
    { type: 'speakeasy', variant: 'door', data: { heading: 'There is a door in the leather.', doorNumber: '7', password: { question: 'What do the regulars call the river?' } } },
    { type: 'cta', variant: 'banner', data: { heading: 'Visit the Amber Tap', primaryCta: { label: 'Find us', href: 'visit' } } },
  ],
  taps: [{ type: 'taps', variant: 'wall', data: { asHeading: true } }],
  menu: [
    { type: 'menu', variant: 'sections', data: { asHeading: true } },
    { type: 'menu', variant: 'cards', data: { heading: 'House favourites', items: [{ name: 'Cheese curds', price: '$9', description: 'Ellsworth curds, beer batter.' }] } },
  ],
  events: [
    { type: 'events', variant: 'list', data: { asHeading: true, recurring: [{ title: 'Friday fish fry', when: 'Fridays 4–9' }] } },
    { type: 'events', variant: 'recurring', data: { asHeading: false, title: 'Tuesday trivia', day: 'Tuesday', startTime: '19:00', endTime: '21:00', price: 'Free' } },
  ],
  parties: [{ type: 'parties', variant: 'inquiry-form', data: { heading: 'Private parties', asHeading: true, occasions: ['Birthday', 'Work party'] } }],
  regulars: [{ type: 'regulars', variant: 'signup', data: { heading: 'The Regulars', asHeading: true, perks: ['A birthday round on us'] } }],
  visit: [
    { type: 'visit', variant: 'details', data: { heading: 'Find us', asHeading: true } },
    { type: 'hours', variant: 'table', data: {} },
    { type: 'location', variant: 'live-map', data: { heading: 'Out on the patio', currentAddress: '12 River St' } },
    { type: 'social', variant: 'feed', data: { heading: 'On Instagram', handle: 'ambertap' } },
  ],
  story: [
    { type: 'timeline', variant: 'eras', data: { heading: 'The story', asHeading: true, entries: [
      { slug: '1881', title: 'The first pour', yearStart: 1881, sortOrder: 1, body: 'Opened by a brewer from Bavaria.' },
      { slug: 'prohibition', title: 'The dry years', yearStart: 1920, sortOrder: 2, body: 'Root beer at the front, something else at the back.' },
    ] } },
    { type: 'timeline', variant: 'book', data: { heading: 'The book' } },
  ],
}

beforeAll(async () => {
  t = await bootTenant({ vertical: 'bar' })
  const s = await seedOwner(t)
  companyId = s.company.id
  await t.db.update(t.schema.company).set({ name: 'The Amber Tap', phone: '715-555-0100', address: '12 River St', city: 'Eau Claire', state: 'WI', enabledFeatures: FEATURES })
    .where(eq(t.schema.company.id, companyId))
  token = (await (await t.call('/api/auth/login', { method: 'POST', json: { email: 'owner@test.example', password: s.password } })).json()).accessToken
  await t.db.insert(t.schema.website).values({ companyId, tagline: 'A tavern on the river', nav: Object.keys(PAGES).filter((p) => p !== 'home').map((p) => ({ label: p, href: p })) })
  let order = 0
  for (const [slug, sections] of Object.entries(PAGES)) {
    await t.db.insert(t.schema.page).values({ companyId, slug, title: slug === 'home' ? 'Home' : slug[0].toUpperCase() + slug.slice(1), sections, isPublished: true, navOrder: order++ })
  }

  // The night, written through the bar's own CRM screens' API.
  const ok = async (r: Response) => { if (r.status >= 300) throw new Error(r.status + ' ' + await r.text()); return r.json() }
  await ok(await as('/api/bar/settings', { method: 'PUT', json: { hours: { timezone: 'America/Chicago', bar: allWeek('00:00', '23:59'), kitchen: allWeek('00:00', '23:59') }, speakeasyPassword: 'chippewa', speakeasyNote: 'A root beer on the house' } }))
  await ok(await as('/api/bar/taps', { method: 'POST', json: { lineNumber: 3, beerName: 'Leinenkugel Honey Weiss', brewery: 'Leinenkugel', style: 'Wheat', abv: 4.9, price: '5.50' } }))
  await ok(await as('/api/bar/specials', { method: 'POST', json: { title: 'Walleye basket', description: 'Beer-battered, with slaw', price: '14' } }))
  const sec = await ok(await as('/api/bar/menu/sections', { method: 'POST', json: { name: 'Burgers', kind: 'food' } }))
  await ok(await as('/api/bar/menu/items', { method: 'POST', json: { sectionId: sec.id, name: 'Peanut Butter Bacon Burger', price: '13', isSignature: true, description: 'The one people drive for.' } }))
  await ok(await as('/api/bar/events', { method: 'POST', json: { title: 'Polka night', description: 'The **Sauerkraut Kings** play.', startsAt: new Date(Date.now() + 3 * 86400000).toISOString() } }))
})

describe('every bar section, on a real page, with the night it reads', () => {
  test('home: the Tonight board with the special just posted, the tap, the story, the speakeasy door', async () => {
    const { status, html } = await page('/')
    expect(status).toBe(200)
    const words = text(html)
    expect(html).toContain('class="board"')
    expect(words).toContain('Walleye basket, $14')
    expect(words).toContain('— Leinenkugel Honey Weiss')
    expect(words).toMatch(/Kitchen Open/)
    // One h1: the board's. The story under it is an h2 (it was the page's second h1 before the merge).
    expect(html.match(/<h1\b/g)!.length).toBe(1)
    expect(html).toContain('<h2 class="story__title">About the Amber Tap</h2>')
    expect(html).toContain('id="speakeasy"')
    expect(html).toContain('/scripts/live.js')
    // The bar's frame: dark, its own faces, the cover, its Visit button.
    expect(html).toContain('<html lang="en" data-theme="dark">')
    expect(html).toContain('/styles/fonts.css')
    expect(html).toContain('<div class="cover">')
    expect(html).toContain('class="header-cta" href="/visit"')
    // Its own JSON-LD: a BarOrPub with the bar and kitchen hours, not the generic LocalBusiness.
    expect(html).toContain('"@type":"BarOrPub"')
    expect(html).toContain('"openingHoursSpecification"')
    expect(html).not.toContain('"@type":"LocalBusiness"')
  })

  test('taps: the tap the bar typed in, with its brewery, style, ABV and price', async () => {
    const { status, html } = await page('/taps')
    expect(status).toBe(200)
    const words = text(html)
    expect(words).toContain('Leinenkugel Honey Weiss')
    expect(words).toContain('Wheat')
    expect(words).toContain('4.9% ABV')
    expect(words).toContain('$5.50')
    expect(html).toContain('<h1 class="section-title" id="taps-heading">')
  })

  test('menu: the live menu by section, the signature item linked to its own page; the owner\'s cards too', async () => {
    const { status, html } = await page('/menu')
    expect(status).toBe(200)
    const words = text(html)
    expect(words).toContain('Burgers')
    expect(words).toContain('Peanut Butter Bacon Burger')
    expect(html).toContain('href="/burgers/peanut-butter-bacon-burger"')
    expect(words).toContain('Cheese curds')
    expect(html).toContain('"@type":"Menu"')
  })

  test('a signature item has its own page (MenuItem JSON-LD); an item that is not one does not', async () => {
    const item = await page('/burgers/peanut-butter-bacon-burger')
    expect(item.status).toBe(200)
    expect(text(item.html)).toContain('Peanut Butter Bacon Burger')
    expect(item.html).toContain('"@type":"MenuItem"')
    expect((await page('/burgers/no-such-burger')).status).toBe(404)
  })

  test('events: the event the bar posted (its markdown rendered) and the standing weekly ones', async () => {
    const { status, html } = await page('/events')
    expect(status).toBe(200)
    const words = text(html)
    expect(words).toContain('Polka night')
    expect(html).toContain('<strong>Sauerkraut Kings</strong>')
    expect(words).toContain('Friday fish fry')
    expect(words).toContain('Tuesday trivia')
    expect(html).toContain('"@type":"Event"')
  })

  test('visit: the address, the bar and kitchen hours from the CRM, the live map, the social feed', async () => {
    const { status, html } = await page('/visit')
    expect(status).toBe(200)
    const words = text(html)
    expect(words).toContain('12 River St')
    expect(html).toContain('class="hours"')
    expect(words).toMatch(/Monday/)
    expect(words).not.toContain('Hours are being set up')
    expect(words).toContain('Out on the patio')
    expect(words).toContain('On Instagram')
  })

  test('story: the eras and the book, each era at its own page, and both kinds of page in the sitemap', async () => {
    const story = await page('/story')
    expect(story.status).toBe(200)
    expect(text(story.html)).toContain('The dry years')
    expect(story.html).toContain('/scripts/book.js')
    const era = await page('/story/prohibition')
    expect(era.status).toBe(200)
    expect(text(era.html)).toContain('The dry years')
    const map = await (await t.call('/sitemap.xml')).text()
    expect(map).toContain('/story/1881</loc>')
    expect(map).toContain('/burgers/peanut-butter-bacon-burger</loc>')
  })
})

describe('the two forms', () => {
  test('the party form posts formType party and opens a party enquiry for that date and that many', async () => {
    const { html } = await page('/parties')
    expect(html).toContain('<input type="hidden" name="formType" value="party">')
    expect(html).toContain('action="/api/leads"')
    const r = await postForm({ formType: 'party', source: '/parties', name: 'Pat Kowalski', phone: '715-555-0142', requestedDate: future, partySize: '30', occasion: 'Birthday', message: 'Back room please' })
    expect(r.status).toBe(200)
    expect((await r.json()).message).toBe("Got it. We'll call you back about your party.")
    const [ev] = await t.db.select().from(t.schema.event).where(eq(t.schema.event.companyId, companyId))
    expect(ev).toMatchObject({ status: 'enquiry', guestCount: 30, eventType: 'birthday', name: 'Birthday — Pat Kowalski', source: 'website' })
    expect(String(ev.eventDate).slice(0, 10)).toBe(future)
  })

  test('the Regulars form shows the consent words; ticked, the guest is tagged and those words are the evidence', async () => {
    const { html } = await page('/regulars')
    expect(html).toContain('<input type="hidden" name="formType" value="regulars">')
    expect(text(html)).toContain(EMAIL_CONSENT_TEXT)
    expect(html).toContain('name="emailConsent" value="yes"')
    const r = await postForm({ formType: 'regulars', source: '/regulars', name: 'Lou Regular', phone: '715-555-0177', email: 'lou@example.com', birthdayMonth: '3', birthdayDay: '9', emailConsent: 'yes' })
    expect(r.status).toBe(200)
    expect((await r.json()).message).toBe("You're on the list.")
    const [g] = await t.db.select().from(t.schema.contact).where(and(eq(t.schema.contact.companyId, companyId), eq(t.schema.contact.email, 'lou@example.com')))
    expect(g.tags).toContain('regular')
    const cf = g.customFields as any
    expect(cf.birthday).toEqual({ month: 3, day: 9 })
    expect(cf.marketingConsent).toHaveLength(1)
    expect(cf.marketingConsent[0]).toMatchObject({ channel: 'email', text: EMAIL_CONSENT_TEXT, source: 'website:/regulars' })
  })

  test('unticked, the guest is still tagged but no consent is recorded', async () => {
    expect((await postForm({ formType: 'regulars', source: '/regulars', name: 'Quiet Guest', phone: '715-555-0166', email: 'quiet@example.com' })).status).toBe(200)
    const [g] = await t.db.select().from(t.schema.contact).where(and(eq(t.schema.contact.companyId, companyId), eq(t.schema.contact.email, 'quiet@example.com')))
    expect(g.tags).toContain('regular')
    expect((g.customFields as any)?.marketingConsent).toBeUndefined()
  })
})

describe('the bar\'s files and the board\'s live answers', () => {
  test('the stylesheet is the bar\'s look over the base layer, with the company\'s colours', async () => {
    const css = await (await t.call('/styles/main.css')).text()
    expect(css.startsWith('@layer base {')).toBe(true)
    expect(css).toContain('THE COVER')
    expect(css).not.toContain('{{')
  })

  test('the faces, their sheet and the section scripts are served; the poller and the door ask the add-on', async () => {
    expect((await t.call('/fonts/Lora-400.woff2')).headers.get('content-type')).toBe('font/woff2')
    expect((await t.call('/fonts/nope.woff2')).status).toBe(404)
    expect(await (await t.call('/styles/fonts.css')).text()).toContain("font-family: 'Lora'")
    expect((await t.call('/styles/speakeasy.css')).status).toBe(200)
    const live = await (await t.call('/scripts/live.js')).text()
    expect(live).toContain('/api/public/bar/live')
    expect(await (await t.call('/scripts/speakeasy.js')).text()).toContain('/api/public/bar/speakeasy')
    expect((await t.call('/scripts/book.js')).status).toBe(200)
    const state = await (await t.call('/api/public/bar/live')).json()
    expect(state.special.title).toBe('Walleye basket')
    const door = await t.call('/api/public/bar/speakeasy', { method: 'POST', json: { answer: 'Chippewa' } })
    expect(await door.json()).toEqual({ ok: true, note: 'A root beer on the house' })
  })
})

describe('no section failed', () => {
  test('every section on every page above rendered', () => expect(sectionFailures).toEqual([]))
})

describe('a switched-off feature', () => {
  test('menu and taps off: their sections say so in their own words, and the pages still answer 200', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'bar_menu') }).where(eq(t.schema.company.id, companyId))
    try {
      const taps = await page('/taps')
      expect(taps.status).toBe(200)
      expect(text(taps.html)).toContain('The tap list is being typed in.')
      expect(text(taps.html)).not.toContain('Honey Weiss')
      const menu = await page('/menu')
      expect(menu.status).toBe(200)
      expect(text(menu.html)).toContain('The menu is being typed up.')
      expect((await page('/burgers/peanut-butter-bacon-burger')).status).toBe(404)
      // The board still has tonight (bar_tonight is on).
      expect(text((await page('/')).html)).toContain('Walleye basket')
    } finally {
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES }).where(eq(t.schema.company.id, companyId))
    }
  })

  test('Tonight off: the board falls back to its call-us line; the speakeasy door is not shown', async () => {
    await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES.filter((f) => f !== 'bar_tonight') }).where(eq(t.schema.company.id, companyId))
    try {
      const { status, html } = await page('/')
      expect(status).toBe(200)
      expect(text(html)).toContain('Hours are being set up. Call 715-555-0100')
      expect(html).not.toContain('id="speakeasy"')
    } finally {
      await t.db.update(t.schema.company).set({ enabledFeatures: FEATURES }).where(eq(t.schema.company.id, companyId))
    }
  })
})
