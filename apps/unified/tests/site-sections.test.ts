// The new site sections (why-choose, testimonials carousel, map, blog preview, gallery filter, values, call button): each renders
// from the owner's facts in every whole look, renders NOTHING when it has none of them, is offered by the website editor, and
// lays itself out by its own width (a container query) in the base and in every look.
import { describe, test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { SITE_DESIGNS, SITE_DESIGN_SPECS } from '../server/core/vertical.ts'
import { renderSections } from '../server/site/render.ts'
import { siteStylesheet } from '../server/site/routes.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { offersSection } from '../server/site/admin.ts'
import { findTradeSection } from '../web/src/site/sectionFields.ts'
import { findSectionDef } from '../web/src/site/sectionSchema.ts'
import { Window } from 'happy-dom'
import { bootTenant } from './harness.ts'

const DESIGNS_DIR = path.resolve(import.meta.dir, '..', 'site', 'designs')
const LOOKS = SITE_DESIGNS.filter((d) => SITE_DESIGN_SPECS[d].build === 'whole' && !SITE_DESIGN_SPECS[d].frame)

const ctx = (design: string, over: Record<string, any> = {}): any => {
  const spec = (SITE_DESIGN_SPECS as any)[design]
  return {
    companyId: 'c', slug: 's', design, features: [], words: { contactAddressLabel: 'Office', contactMessageLabel: 'Message', contactMessageRequired: 'x' },
    settings: { companyName: 'Westridge', phone: '608-555-0142', email: 'a@b.example', nav: [], contactCtaLabel: 'Go', accentColor: '#0e7490', ...over },
    options: { textSizeToggle: false, shop: false, cover: false, fonts: spec.fonts, schemes: !!spec.schemes, ctaHref: '/contact' },
    colours: { primary: '#b45309', accent: '#0e7490', secondary: '#1e3a5f' },
  }
}
const render = (design: string, sections: any[], over: Record<string, any> = {}) =>
  renderSections(ctx(design, over), sections, { title: 'Home' }, { currentPath: '/', origin: 'https://x.example', facts: null })
const HERO = { type: 'hero', variant: 'centered-stats', data: { title: 'T' } }

describe('every look styles every new block, and each block asks its own width', () => {
  // [section class, the container name its base rule declares]
  const BLOCKS: Array<[string, string]> = [['.why-choose', 'why-choose'], ['.testimonials-carousel', 'testimonials-carousel'], ['.map-area', 'map-area'], ['.blog-preview', 'blog-preview']]
  for (const [cls, name] of BLOCKS) {
    test(cls, () => {
      const base = fs.readFileSync(path.resolve(DESIGNS_DIR, '..', 'public', 'styles', 'main.css'), 'utf8')
      expect(base).toContain(`container: ${name} / inline-size`)
      expect(base).toContain(`@container ${name} (`)
      // no layout of the block by the screen's width
      expect(base.split('\n').filter((l) => l.includes(cls) && /@media \(max-width/.test(l))).toEqual([])
      for (const look of LOOKS) expect([look, fs.readFileSync(path.join(DESIGNS_DIR, look + '.css'), 'utf8').includes(cls)]).toEqual([look, true])
    })
  }
})

describe('why choose us', () => {
  const sec = (items: any[]) => ({ type: 'why_choose', variant: 'grid', data: { heading: 'Why Westridge', items } })
  test('the owner\'s reasons render, in every look, numbered, with their sentence only when given', async () => {
    for (const look of LOOKS) {
      const html = await render(look, [HERO, sec([{ title: 'Licensed and insured', description: 'License on file.' }, { title: 'Free estimates' }])])
      expect(html).toContain('Why Westridge')
      expect(html).toContain('Licensed and insured')
      expect(html).toContain('License on file.')
      expect(html).toContain('Free estimates')
      expect((html.match(/why-choose__desc/g) || []).length).toBe(1)
      expect(html).toContain('>01<')
      expect(html).toContain('>02<')
    }
  })
  test('with no reasons the section renders nothing — never a heading over an empty list', async () => {
    for (const items of [[], [{ title: '' }, { description: 'orphan' }]]) {
      const html = await render('foundry', [HERO, sec(items)])
      expect(html).not.toContain('why-choose')
      expect(html).not.toContain('Why Westridge')
    }
    expect(await render('foundry', [HERO, { type: 'why_choose', variant: 'grid', data: {} }])).not.toContain('Why choose us')
  })
  test('the website editor offers it, with a field for everything the view reads', async () => {
    expect(findTradeSection('why_choose', 'grid')).toBeDefined()
    expect(findSectionDef('why_choose', 'grid')?.defaultData).toMatchObject({ items: [] })
    for (const id of ['contractor', 'roofing', 'homecare', 'store']) expect([id, offersSection('why_choose/grid', await loadVertical(id))]).toEqual([id, true])
    const css = siteStylesheet(ctx('foundry'))
    expect(css).toContain('.why-choose__item')
  })
})

describe('the testimonials carousel (real reviews only; keyboard and reduced-motion safe)', () => {
  const REVIEWS = [{ quote: 'Rebuilt our deck in a week.', author: 'Pat K.', role: 'Verona' }, { quote: 'Fair price, clean site.', author: 'Dana R.' }, { quote: 'Answered the phone every time.' }]
  const carousel = (items: any[]) => ({ type: 'testimonials', variant: 'carousel', data: { heading: 'What customers say', items } })

  test('each real review is a labelled slide in every look; a review with no quote is not shown; no stars, no invented rating', async () => {
    for (const look of LOOKS) {
      const html = await render(look, [HERO, carousel([...REVIEWS, { author: 'No Quote' }, null as any])])
      expect(html).toContain('aria-roledescription="carousel"')
      expect((html.match(/testimonials-carousel__slide/g) || []).length).toBe(3)
      for (const q of REVIEWS) expect(html).toContain(q.quote)
      expect(html).toContain('Review 3 of 3')
      expect(html).not.toContain('No Quote')
      expect(html).not.toMatch(/★|&#9733;|star|rating|aggregateRating/i)
    }
  })

  test('without script it still works: the track is a native scroll strip and the buttons stay hidden until the script runs', async () => {
    const html = await render('foundry', [HERO, carousel(REVIEWS)])
    expect(html.includes('hidden data-controls')).toBe(true)
    expect(html).toContain('tabindex="0"')
    const css = await siteStylesheet(ctx('foundry'))
    expect(css).toContain('scroll-snap-type: x mandatory')
  })

  test('no reviews, nothing: the section renders nothing; one review has no buttons or script', async () => {
    expect(await render('heritage', [HERO, carousel([])])).not.toContain('testimonials-carousel')
    expect(await render('heritage', [HERO, carousel([{ author: 'x' }])])).not.toContain('testimonials-carousel')
    const one = await render('heritage', [HERO, carousel([REVIEWS[0]])])
    expect(one).toContain('Rebuilt our deck in a week.')
    expect(one).not.toContain('data-controls')
    expect(one).not.toContain('data-next')
  })

  test('it never moves by itself, and smooth scrolling is only for a visitor who has not asked for reduced motion', async () => {
    const view = fs.readFileSync(path.resolve(import.meta.dir, '..', 'site', 'views', 'sections', 'testimonials', 'carousel.ejs'), 'utf8')
    // the code, not the comment that explains it
    expect(view.replace(/^<%[\s\S]*?%>/, '')).not.toMatch(/setInterval|setTimeout|autoplay/i)
    const css = fs.readFileSync(path.resolve(DESIGNS_DIR, '..', 'public', 'styles', 'main.css'), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{ \.testimonials-carousel__track \{ scroll-behavior: smooth; \} \}/)
    // outside that media query nothing smooths the track
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[^\n]*\} \}/g, '')
    expect(outside).not.toMatch(/\.testimonials-carousel__track[^{]*\{[^}]*scroll-behavior: smooth/)
  })

  function boot(html: string, reduced: boolean) {
    const win: any = new Window({ url: 'https://site.example.com/', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } } as any)
    for (const k of ['Number', 'Date', 'Math', 'JSON', 'String', 'Array', 'Object', 'RegExp', 'Boolean', 'Error', 'Promise']) if (typeof win[k] === 'undefined') win[k] = (globalThis as any)[k]
    win.matchMedia = (q: string) => ({ matches: reduced && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })
    win.document.write(html)
    const doc = win.document
    const track = doc.querySelector('[data-track]')
    const slides = [...track.children]
    slides.forEach((el: any, i: number) => { Object.defineProperty(el, 'offsetWidth', { value: 300 }); Object.defineProperty(el, 'offsetLeft', { value: i * 320 }) })
    const calls: any[] = []
    track.scrollTo = (o: any) => { calls.push(o); track.scrollLeft = o.left }
    return { win, doc, track, calls }
  }

  test('with script: the buttons appear; the arrow keys, buttons and dots move one review; Home and End jump; the dot follows', async () => {
    const html = await render('foundry', [HERO, carousel(REVIEWS)])
    const { win, doc, track, calls } = boot(html, false)
    expect(doc.querySelector('[data-controls]').hidden).toBe(false)
    const key = (k: string) => track.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    key('ArrowRight')
    expect(calls.pop()).toMatchObject({ left: 320, behavior: 'smooth' })
    key('ArrowLeft'); expect(calls.pop()).toMatchObject({ left: 0 })
    key('End'); expect(calls.pop()).toMatchObject({ left: 640 })
    key('Home'); expect(calls.pop()).toMatchObject({ left: 0 })
    doc.querySelector('[data-next]').click(); expect(calls.pop()).toMatchObject({ left: 320 })
    doc.querySelectorAll('[data-dot]')[2].click(); expect(calls.pop()).toMatchObject({ left: 640 })
    track.scrollLeft = 640
    track.dispatchEvent(new win.Event('scroll'))
    await new Promise((r) => setTimeout(r, 50))
    expect(doc.querySelectorAll('[data-dot]')[2].getAttribute('aria-current')).toBe('true')
    expect(doc.querySelectorAll('[data-dot]')[0].getAttribute('aria-current')).toBe('false')
    // past the ends it stays on the first or last review
    track.scrollLeft = 0; key('ArrowLeft'); expect(calls.pop()).toMatchObject({ left: 0 })
  })

  test('a visitor who asked for reduced motion gets instant jumps, not a glide', async () => {
    const html = await render('market', [HERO, carousel(REVIEWS)])
    const { win, track, calls } = boot(html, true)
    track.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(calls.pop()).toMatchObject({ left: 320, behavior: 'auto' })
  })
})

describe('map: where to find us', () => {
  const map = (data: any = {}) => ({ type: 'map', variant: 'area', data })
  const ADDRESS = { streetAddress: '12 Main St', addressLocality: 'Verona', addressRegion: 'WI', postalCode: '53593', serviceAreas: ['Verona', { name: 'Madison' }] }

  test('the business\'s own address and areas, in every look, with plain links — no embed, no script, no third-party request', async () => {
    for (const look of LOOKS) {
      const html = await render(look, [HERO, map({ intro: 'Come by.' })], ADDRESS)
      const section = html.slice(html.indexOf('class="map-area"'), html.indexOf('</section>', html.indexOf('class="map-area"')))
      expect(section).toContain('12 Main St, Verona, WI 53593')
      expect(section).toContain('Come by.')
      expect(section).toContain('>Verona<')
      expect(section).toContain('>Madison<')
      expect(section).toContain('href="/service-areas"')
      // links only, each opened on the visitor's own click
      expect(section).toContain('href="https://www.openstreetmap.org/search?query=12%20Main%20St%2C%20Verona%2C%20WI%2053593"')
      expect(section).toContain('https://www.google.com/maps/search/?api=1&amp;query=')
      expect(section).toContain('https://maps.apple.com/?q=')
      expect((section.match(/rel="noopener noreferrer"/g) || []).length).toBe(4)
      // nothing loads from a map provider: no iframe, no script, no tile or image request, no key
      expect(section).not.toMatch(/<iframe|<script|<img|src=|tile|api[_-]?key|mapbox|googleapis/i)
    }
  })

  test('with no address and no area the section renders nothing; an address alone, or areas alone, is enough', async () => {
    expect(await render('market', [HERO, map()], {})).not.toContain('map-area')
    expect(await render('market', [HERO, map()], { address: '   ' })).not.toContain('map-area')
    const only = await render('market', [HERO, map()], { address: '5 Elm Rd, Eau Claire, WI' })
    expect(only).toContain('5 Elm Rd, Eau Claire, WI')
    expect(only).not.toContain('We serve')
    const areas = await render('market', [HERO, map()], { serviceAreas: ['Altoona'] })
    expect(areas).toContain('We serve')
    expect(areas).toContain('Where we work')
    expect(areas).not.toContain('>Address<')
  })

  test('the owner cannot type an address into it (the section reads the business\'s settings), and the editor offers it', async () => {
    const html = await render('foundry', [HERO, map({ address: '1 Fake Ln, Nowhere', serviceAreas: ['Atlantis'] })], ADDRESS)
    expect(html).not.toContain('Fake Ln')
    expect(html).not.toContain('Atlantis')
    expect(findTradeSection('map', 'area')).toBeDefined()
    for (const id of ['contractor', 'roofing', 'homecare']) expect([id, offersSection('map/area', await loadVertical(id))]).toEqual([id, true])
  })
})

describe('latest blog posts (only when posts exist)', () => {
  const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: 'post-' + (i + 1), title: 'Post <b>' + (i + 1) + '</b>', excerpt: 'Excerpt ' + (i + 1), cover: i === 0 ? '/media/c.jpg' : '', date: '2026-09-0' + (i + 1) + 'T12:00:00Z' }))
  const sec = (data: any) => ({ type: 'blog_preview', variant: 'latest', data })

  test('the posts render in every look as links to /blog/<slug>, escaped, with a date and an "All posts" link', async () => {
    for (const look of LOOKS) {
      const html = await render(look, [HERO, sec({ heading: 'News', posts: posts(3) })])
      expect(html).toContain('News')
      expect(html).toContain('href="/blog/post-1"')
      expect(html).toContain('Post &lt;b&gt;1&lt;/b&gt;')
      expect(html).not.toContain('<b>1</b>')
      expect(html).toContain('September 1, 2026')
      expect(html).toContain('href="/blog"')
      expect(html).toContain("background-image: url('/media/c.jpg')")
    }
  })
  test('with no posts the section renders nothing — no heading over an empty list; count caps what is shown', async () => {
    for (const data of [{}, { posts: [] }, { posts: [{ title: 'No slug' }] }]) expect(await render('foundry', [HERO, sec(data)])).not.toContain('blog-preview')
    const two = await render('heritage', [HERO, sec({ count: 2, posts: posts(5) })])
    expect((two.match(/blog-preview__item/g) || []).length).toBe(2)
    expect((await render('heritage', [HERO, sec({ posts: posts(5) })]).then((h) => h.match(/blog-preview__item/g) || [])).length).toBe(3)
  })

  test('through the real server: the business\'s published posts, newest first; drafts never; none, nothing — and it follows the blog', async () => {
    const t = await bootTenant()
    const [co] = await t.db.insert(t.schema.company).values({ name: 'Westridge', slug: 'westridge', email: 'o@w.example', primaryColor: '#b45309' }).returning()
    await t.db.insert(t.schema.website).values({ companyId: co.id, design: 'studio' })
    await t.db.insert(t.schema.page).values({ companyId: co.id, slug: 'home', title: 'Home', sections: [HERO, sec({ heading: 'Latest news', count: 2 })] })
    const home = async () => (await (await t.call('/')).text())
    expect(await home()).not.toContain('Latest news')
    await t.db.insert(t.schema.post).values([
      { companyId: co.id, slug: 'old', title: 'Oldest post', status: 'published', publishedAt: new Date('2026-01-01T12:00:00Z') },
      { companyId: co.id, slug: 'mid', title: 'Middle post', excerpt: 'About the middle.', status: 'published', publishedAt: new Date('2026-05-01T12:00:00Z') },
      { companyId: co.id, slug: 'new', title: 'Newest post', status: 'published', publishedAt: new Date('2026-09-01T12:00:00Z') },
      { companyId: co.id, slug: 'draft', title: 'Secret draft', status: 'draft' },
    ])
    const html = await home()
    expect(html).toContain('Latest news')
    expect(html.indexOf('Newest post')).toBeGreaterThan(-1)
    expect(html.indexOf('Newest post')).toBeLessThan(html.indexOf('Middle post'))
    expect(html).toContain('About the middle.')
    expect(html).not.toContain('Oldest post')
    expect(html).not.toContain('Secret draft')
    expect((await t.call('/blog/new')).status).toBe(200)
  }, 60_000)
})

describe('gallery filter bar', () => {
  const photo = (n: number, category?: string) => ({ url: `/img/${n}.jpg`, alt: `Photo ${n}`, ...(category ? { category } : {}) })
  const gallery = async (photos: any[]) => String(await render('foundry', [HERO, { type: 'gallery', variant: 'grid', data: { heading: 'Our work', photos } }]))

  test('no bar, no script and no data attributes when the owner has sorted nothing, or only one group', async () => {
    for (const photos of [[photo(1), photo(2)], [photo(1, 'Decks'), photo(2, 'Decks'), photo(3)]]) {
      const out = await gallery(photos)
      expect(out).not.toContain('data-filter')
      expect(out).not.toContain('gallery-filter')
    }
  })

  test('two or more groups: a labelled bar with an All button, one button per group, every photo still in the page', async () => {
    const out = await gallery([photo(1, 'Decks'), photo(2, 'Kitchens'), photo(3, 'Decks')])
    expect(out).toContain('role="group" aria-label="Filter photos"')
    expect((out.match(/class="gallery-filter__btn"/g) || []).length).toBe(3)
    expect(out).toContain('data-cat="Kitchens"')
    expect((out.match(/<figure/g) || []).length).toBe(3)
    expect(out).toMatch(/data-filter hidden/) // revealed by the script, so a page without JavaScript shows the photos and no dead buttons
  })

  test('the script reveals the bar; a button shows only its group, keeps its pressed state and says how many are showing', async () => {
    const out = await gallery([photo(1, 'Decks'), photo(2, 'Kitchens'), photo(3, 'Decks')])
    const win: any = new Window({ url: 'https://site.example.com/', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, suppressInsecureJavaScriptEnvironmentWarning: true } } as any)
    for (const k of ['Number', 'Date', 'Math', 'JSON', 'String', 'Array', 'Object', 'RegExp', 'Boolean', 'Error', 'Promise']) if (typeof win[k] === 'undefined') win[k] = (globalThis as any)[k]
    win.document.write(out.slice(out.indexOf('<section class="gallery-section')))
    const doc = win.document
    expect(doc.querySelector('[data-filter]').hidden).toBe(false)
    const btn = (c: string) => doc.querySelector(`.gallery-filter__btn[data-cat="${c}"]`)
    btn('Decks').click()
    expect([...doc.querySelectorAll('.gallery-grid__item')].map((e: any) => e.hidden)).toEqual([false, true, false])
    expect(btn('Decks').getAttribute('aria-pressed')).toBe('true')
    expect(btn('').getAttribute('aria-pressed')).toBe('false')
    expect(doc.querySelector('[data-filter-status]').textContent).toBe('Showing 2 photos of Decks')
    btn('').click()
    expect([...doc.querySelectorAll('.gallery-grid__item')].some((e: any) => e.hidden)).toBe(false)
  })
})
