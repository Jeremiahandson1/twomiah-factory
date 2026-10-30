// The speed round (2026-10-29): the first screen's photo is found early and sized for the screen, every photo has sized
// WebP copies served with long caching, every page has a meta description from the owner or its own words, and the
// accessible names include their visible words.
import { describe, test, expect, beforeAll } from 'bun:test'
import sharp from 'sharp'
import { renderSections } from '../server/site/render.ts'
import { pageDescription, clipWords } from '../server/site/pageDescription.ts'
import { variantUrl, srcsetOf, WIDTHS } from '../server/site/variants.ts'
import { SITE_DESIGN_SPECS } from '../server/core/vertical.ts'
import { bootTenant, seedOwner } from './harness.ts'

const ctx = (design = 'classic', settings: Record<string, any> = {}): any => {
  const spec = (SITE_DESIGN_SPECS as any)[design]
  return {
    companyId: 'c', slug: 's', design, features: [], words: { contactAddressLabel: 'Office', contactMessageLabel: 'Message', contactMessageRequired: 'x' },
    settings: { companyName: 'Westridge', phone: '608-555-0142', email: 'a@b.example', nav: [], contactCtaLabel: 'Go', ...settings },
    options: { textSizeToggle: true, shop: false, cover: false, fonts: spec.fonts, schemes: !!spec.schemes, ctaHref: '/contact' },
    colours: { primary: '#b45309', accent: null, secondary: null, page: null, band: null },
  }
}
const render = (sections: any[], settings: Record<string, any> = {}, meta: any = { title: 'Home' }) =>
  renderSections(ctx('classic', settings), sections, meta, { currentPath: '/', origin: 'https://x.example', facts: null, sizedPhotos: true }) // as the site's own server renders (routes.ts)
const hero = (image: string, extra: Record<string, any> = {}) => ({ type: 'hero', variant: 'full-bleed', data: { title: 'Westridge', subtitle: 'Kitchens, baths and additions built the way you pictured them.', image, ...extra } })

describe('the first screen\'s photo', () => {
  test('is preloaded once per screen size, with priority, as the site\'s own WebP', async () => {
    const html = await render([hero('/media/photos/a.jpg')])
    const links = html.match(/<link rel="preload" as="image"[^>]*>/g) || []
    expect(links.length).toBe(3)
    for (const l of links) { expect(l).toContain('fetchpriority="high"'); expect(l).toContain('type="image/webp"'); expect(l).toMatch(/media="\([^"]+\)"/); expect(l).toContain('/img/') }
    expect(links.map((l) => /href="\/img\/(\d+)\//.exec(l)![1])).toEqual(['960', '1280', '1920'])
  })
  test('is drawn from the same copies by rules for the same screen sizes, not an inline original', async () => {
    const html = await render([hero('/media/photos/a.jpg')])
    expect(html).not.toContain("url('/media/photos/a.jpg')")
    expect(html).toContain('data-bg="h0"')
    for (const w of [960, 1280, 1920]) expect(html).toContain(`url("/img/${w}/media/photos/a.jpg")`)
    expect(html).toContain('(max-width: 480px)')
  })
  test('only the first hero is preloaded; a hero lower down is not', async () => {
    const html = await render([hero('/media/photos/a.jpg'), { type: 'about', variant: 'story', data: { title: 'About', paragraphs: ['x'] } }, hero('/media/photos/b.jpg')])
    expect((html.match(/<link rel="preload" as="image"/g) || []).length).toBe(3)
    expect(html).not.toMatch(/<link rel="preload"[^>]*photos\/b\.jpg/)
    expect(html).toContain('/img/960/media/photos/b.jpg') // its rules still use the copies
  })
  test('below-the-fold photos stay lazy and are not preloaded', async () => {
    const html = await render([hero('/media/photos/a.jpg'), { type: 'gallery', variant: 'grid', data: { photos: [{ url: '/media/photos/g1.jpg' }, { url: '/media/photos/g2.jpg' }] } }])
    expect((html.match(/<img[^>]*loading="lazy"/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(html).not.toMatch(/<link rel="preload"[^>]*g1\.jpg/)
  })
  test('the Factory\'s stock photo comes from the site\'s own address', async () => {
    const html = await render([hero('https://twomiah-factory-api.onrender.com/hero-library/contractor/contractor-01.jpg')])
    expect(html).toContain('/img/960/stock/contractor/contractor-01.jpg')
    expect(html).not.toMatch(/<link rel="preload"[^>]*onrender\.com/)
  })
  test('a photo with no copies (an SVG, another site\'s) keeps the old, working markup', async () => {
    const html = await render([hero('https://elsewhere.example/p.jpg')])
    expect(html).toContain("background-image: url('https://elsewhere.example/p.jpg')")
    expect(html).toContain('<link rel="preload" as="image" href="https://elsewhere.example/p.jpg" fetchpriority="high">')
  })
  test('the split hero\'s photo uses the copies too', async () => {
    const html = await render([{ type: 'hero', variant: 'split', data: { title: 'T', image: '/media/photos/a.jpg' } }])
    expect(html).toContain('class="hero__image" data-bg="h0"')
  })
  test('the Tonight board\'s cover gets a srcset of copies, preloaded as that same set', async () => {
    const html = await render([{ type: 'tonight', variant: 'board', data: { title: 'Amber', coverImage: '/media/photos/c.jpg', coverImageSmall: '/media/photos/c-s.jpg' } }])
    expect(html).toContain('srcset="/img/480/media/photos/c.jpg 480w, /img/960/media/photos/c.jpg 960w, /img/1280/media/photos/c.jpg 1280w"')
    expect(html).toMatch(/<link rel="preload" as="image"[^>]*imagesrcset="\/img\/480\/media\/photos\/c\.jpg 480w/)
  })
})

describe('the copies\' addresses', () => {
  test('only uploads and the Factory\'s library have copies; the width snaps to a known one', () => {
    expect(variantUrl('/media/photos/a.jpg', 1000)).toBe('/img/960/media/photos/a.jpg')
    expect(variantUrl('/media/photos/a.svg', 960)).toBeNull()
    expect(variantUrl('https://evil.example/hero-library/x/y.jpg', 960)).toBeNull()
    expect(variantUrl('/images/logo.png', 960)).toBeNull()
    expect(srcsetOf('/media/photos/a.png').split(', ').length).toBe(WIDTHS.length)
  })
})

describe('the copies, through the server', () => {
  let t: Awaited<ReturnType<typeof bootTenant>>
  let png: Buffer
  beforeAll(async () => {
    t = await bootTenant()
    png = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: { r: 200, g: 90, b: 20 } } }).png().toBuffer()
    await t.store.put('photos/big.png', png, 'image/png')
    await t.store.put('photos/small.png', await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } }).png().toBuffer(), 'image/png')
  })
  test('serves WebP, immutable, at the width asked, and stores the copy beside the original', async () => {
    const r = await t.call('/img/960/media/photos/big.png')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/webp')
    expect(r.headers.get('cache-control')).toContain('immutable')
    expect(r.headers.get('cache-control')).toContain('max-age=31536000')
    const body = Buffer.from(await r.arrayBuffer())
    expect(body.subarray(0, 4).toString()).toBe('RIFF')
    expect(body.subarray(8, 12).toString()).toBe('WEBP')
    expect((await sharp(body).metadata()).width).toBe(960)
    expect(body.length).toBeLessThan(png.length)
    expect(await t.store.getObject('variants/960/media/photos/big.png.webp')).toBeTruthy()
  })
  test('the second request comes from the stored copy, not the original', async () => {
    await t.store.remove('photos/big.png')
    const r = await t.call('/img/960/media/photos/big.png')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/webp')
  })
  test('a copy is never larger than its original', async () => {
    const r = await t.call('/img/1920/media/photos/small.png')
    expect((await sharp(Buffer.from(await r.arrayBuffer())).metadata()).width).toBe(300)
  })
  test('only the known widths, and only public photos', async () => {
    expect((await t.call('/img/777/media/photos/small.png')).status).toBe(404)
    expect((await t.call('/img/960/other/photos/small.png')).status).toBe(404)
    const outside = await t.call('/img/960/media/private/x.png', { redirect: 'manual' })
    expect(outside.headers.get('content-type')).not.toBe('image/webp')
    expect((await t.call('/img/960/stock/..%2Fetc/passwd')).status).toBe(404)
  })
  test('a missing photo falls back to the original address, never a hole', async () => {
    const r = await t.call('/img/960/media/photos/gone.png', { redirect: 'manual' })
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/media/photos/gone.png')
  })
})

describe('every page has a meta description', () => {
  const desc = (html: string) => (/<meta name="description" content="([^"]*)">/.exec(html) || [])[1] ?? null
  test('the owner\'s own, when set, wins', async () => {
    expect(desc(await render([hero('/media/photos/a.jpg')], { seoDescription: 'Our own words.' }))).toBe('Our own words.')
    expect(desc(await render([hero('/media/photos/a.jpg')], {}, { title: 'Home', metaDescription: 'This page\'s own.' }))).toBe('This page&#39;s own.')
  })
  test('otherwise it is the page\'s own visible words', async () => {
    expect(desc(await render([hero('/media/photos/a.jpg')]))).toBe('Kitchens, baths and additions built the way you pictured them.')
    expect(desc(await render([{ type: 'about', variant: 'story', data: { title: 'About', paragraphs: ['We started in a garage in 2006 and we still answer the phone.'] } }]))).toBe('We started in a garage in 2006 and we still answer the phone.')
  })
  test('clipped at a word boundary near 155 characters, and never longer', () => {
    const long = 'We build kitchens and baths and additions for families across the valley, and we have done it for twenty years with the same crew, the same trucks and the same promise to finish when we say we will.'
    const out = clipWords(long)
    expect(out.length).toBeLessThanOrEqual(155)
    expect(out.endsWith('…')).toBe(true)
    expect(long.startsWith(out.slice(0, -1))).toBe(true)
    expect(clipWords('Short and plain.')).toBe('Short and plain.')
  })
  test('markup is removed, and nothing is invented: no words, no description', () => {
    expect(pageDescription([{ type: 'hero', data: { subtitle: '<b>Honest</b> work, **plainly** priced, every time.' } }])).toBe('Honest work, plainly priced, every time.')
    expect(pageDescription([{ type: 'hero', data: { title: 'Only a title' } }])).toBe('')
    expect(pageDescription([{ type: 'hero', data: { title: 'T' } }], 'The owner\'s tagline is long enough.')).toBe('The owner\'s tagline is long enough.')
  })
  test('it reaches the social cards too', async () => {
    const html = await render([hero('/media/photos/a.jpg')])
    expect(html).toContain('name="twitter:description" content="Kitchens, baths')
  })
})

describe('accessible names, the icon and the logo', () => {
  test('a name includes the words the control shows', async () => {
    const html = await render([hero('/media/photos/a.jpg')])
    expect(html).toMatch(/aria-label="Call now: Westridge, 608-555-0142"/)
    expect(html).toMatch(/aria-label="Aa, default text size"/)
    const emergency = await render([{ type: 'emergency', variant: 'bar', data: { phone: '608-555-0142' } }])
    expect(emergency).not.toMatch(/emergency-bar__call"[^>]*aria-label/)
  })
  test('with no icon chosen the page says so, so no /favicon.ico 404 lands in the console', async () => {
    expect(await render([hero('/media/photos/a.jpg')])).toContain('<link rel="icon" href="data:,">')
    expect(await render([hero('/media/photos/a.jpg')], { faviconUrl: '/media/photos/f.png' })).toContain('<link rel="icon" href="/media/photos/f.png">')
  })
  test('the header logo keeps its shape when its width is capped', async () => {
    expect(await render([hero('/media/photos/a.jpg')], { logoUrl: '/media/photos/logo.png' })).toContain('object-fit:contain')
  })
})
