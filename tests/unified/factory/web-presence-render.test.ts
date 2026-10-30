// The one page the plan publishes: drawn by the unified renderer (never a second template system), one page only, the forms in or out
// as the owner set them; the first page the composer makes for each trade; the cleaning every saved field goes through; the files that
// are published. Nothing here touches the network.
import { describe, test, expect } from 'bun:test'
import { renderOnePage } from '../../../apps/unified/server/site/onePage'
import { composeOnePage, onePageHref } from '../../../apps/api/src/webPresence/compose'
import { buildSpec, canonicalise } from '../../../apps/api/src/webPresence/spec'
import { buildSiteFiles, redirectsFile, headersFile, formsHtml } from '../../../apps/api/src/webPresence/publish'
import { unifiedVerticalOf } from '../../../apps/api/src/webPresence/service'
import { sectionAllowed, offeredFor } from '../../../apps/api/src/webPresence/sections'
import { signupComposition, signupComposerInput } from '../../../apps/api/src/services/signupSite'
import { verticalFor, type Vertical } from '../../../apps/api/src/config/industryRouting'
import { cleanLine, cleanLink, cleanImage, cleanModel, cleanDate, cleanEmail, cleanPhone, effectiveForms, checkImage, checkResume, modelTooBig } from '../../../apps/api/src/webPresence/site/clean.mjs'
import { mintSession, verifySession, rateLimit, safeEqual } from '../../../apps/api/src/webPresence/site/session.mjs'
import { LIMITS } from '../../../apps/api/src/webPresence/site/shapes.mjs'

const capsOf = (industry: string) => Object.fromEntries(Object.entries(buildSpec(industry).caps).map(([k, v]: [string, any]) => [k, { anchor: v.anchor, ...(v.nav ? { nav: v.nav } : {}) }]))
const input = (industry: string) => signupComposerInput({ name: 'Acme ' + industry, industry, city: 'Madison', state: 'WI', phone: '6085551234', email: 'owner@acme.test' }, { services: ['Roof repair', 'Gutters', 'Inspections'], goals: [] })
function first(industry: string, over: Record<string, any> = {}) {
  const comp = signupComposition(input(industry), { ai: false }) as any
  const pages = Object.fromEntries(Object.entries(comp.pages).map(([k, p]: [string, any]) => [k, p.sections ?? p]))
  const composed = composeOnePage(input(industry) as any, { pages } as any, {})
  const model = canonicalise(composed.model, buildSpec(industry), null).model
  return { composed, model: { ...model, ...over } as any }
}
const draw = (industry: string, model: any) => renderOnePage({ model, vertical: unifiedVerticalOf(industry), caps: capsOf(industry), origin: 'https://acme.netlify.app' })

const TRADES = ['roofing', 'restaurant', 'food truck', 'salon', 'bar', 'home care', 'retail store', 'landscaping', 'plumbing', 'general contractor']

describe('the first page, for each trade', () => {
  for (const industry of TRADES) {
    test(`${industry}: only that trade's sections, on one page, with no link to a page that does not exist`, () => {
      const v = verticalFor(industry) as Vertical
      const { composed, model } = first(industry)
      expect(model.sections.length).toBeGreaterThan(0)
      for (const s of model.sections) expect(sectionAllowed(v, s.type, s.variant)).toBe(true)
      const links = JSON.stringify(model.sections).match(/"(?:href|url)":"([^"]*)"/g) || []
      for (const l of links) expect(l).not.toMatch(/"(?:href|url)":"\/(?!media|hero-library)/)
      expect(model.sections.some((s: any) => s.type === 'contact')).toBe(true)
      expect(composed.droppedTypes).toBeDefined()
    })
  }
  test('page links become in-page anchors, and a link to a page that is not on the one page is dropped, not left dead', () => {
    expect(onePageHref('/contact')).toBe('#contact'); expect(onePageHref('/services/roof-repair')).toBe('#services')
    expect(onePageHref('/blog/x')).toBe(''); expect(onePageHref('https://example.com/a')).toBe('https://example.com/a')
    expect(onePageHref('tel:+16085551234')).toBe('tel:+16085551234'); expect(onePageHref('javascript:alert(1)')).toBe('')
  })
})

describe('the published page', () => {
  test('one page: home + privacy, with the sitemap, robots and llms that go with it — nothing else', async () => {
    const { model } = first('roofing'); const out = await draw('roofing', model)
    const pages = Object.keys(out.files).filter((f) => f.endsWith('.html')).sort()
    expect(pages).toEqual(['index.html', 'privacy/index.html'])
    for (const f of ['sitemap.xml', 'robots.txt', 'llms.txt', 'styles/main.css']) expect(Object.keys(out.files)).toContain(f)
    const sitemap = String(out.files['sitemap.xml'])
    expect((sitemap.match(/<loc>/g) || []).length).toBeLessThanOrEqual(2)
    expect(sitemap).not.toMatch(/services\/|blog/)
    expect(String(out.files['robots.txt'])).toMatch(/Disallow: \/edit\//); expect(String(out.files['robots.txt'])).toMatch(/Disallow: \/api\//)
    const html = String(out.files['index.html'])
    expect(html).not.toMatch(/href="\/(services|blog|about|contact|terms)/)
    expect(html).not.toMatch(/>\s*Terms\s*</)
    expect(html).toContain('href="/privacy"')
  })
  test('the menu is in-page anchors to sections that exist', async () => {
    const { model } = first('roofing'); const html = String((await draw('roofing', model)).files['index.html'])
    const anchors = [...html.matchAll(/<nav class="primary-nav"[\s\S]*?<\/nav>/g)].flatMap((m) => [...m[0].matchAll(/href="(#[^"]+)"/g)].map((x) => x[1]))
    expect(anchors.length).toBeGreaterThan(0)
    for (const a of anchors) expect(html).toMatch(new RegExp(`id="${a.slice(1)}"`))
  })
  test('adding a section stays on the one page', async () => {
    const { model } = first('roofing')
    const spec = buildSpec('roofing')
    const withGallery = canonicalise({ ...model, sections: [...model.sections.filter((s: any) => s.id !== 'gallery'), { id: 'gallery', type: 'gallery', variant: 'grid', data: { heading: 'Our work', images: [] } }] }, spec, model).model
    const out = await draw('roofing', withGallery)
    expect(Object.keys(out.files).filter((f) => f.endsWith('.html')).sort()).toEqual(['index.html', 'privacy/index.html'])
    expect(withGallery.sections.some((s: any) => s.id === 'gallery')).toBe(true)
  })
  test('a hidden section is not drawn', async () => {
    const { model } = first('roofing')
    const hide = { ...model, sections: model.sections.map((s: any) => (s.type === 'services' ? { ...s, hidden: true } : s)) }
    const html = String((await draw('roofing', hide)).files['index.html'])
    expect(html).not.toContain('id="services"')
  })
  test('lead form on: the form is there and posts to the site; off: the form, its script and its endpoint are all absent', async () => {
    const { model } = first('roofing')
    expect(String((await draw('roofing', model)).files['index.html'])).toContain('action="/api/leads"')
    const off = { ...model, forms: { ...model.forms, lead: { ...model.forms.lead, on: false } } }
    const html = String((await draw('roofing', off)).files['index.html'])
    expect(html).not.toContain('/api/leads'); expect(html).not.toContain('<form')
    expect(html).toContain('tel:')   // the details stay
  })
  test('hiring: absent unless it is on AND its section is shown; the form states its resume limit', async () => {
    const { model } = first('roofing')
    expect(String((await draw('roofing', model)).files['index.html'])).not.toContain('/api/apply')
    const section = { id: 'hiring', type: 'hiring', variant: 'form', hidden: false, data: { heading: 'Now hiring', jobs: [{ title: 'Roofer', blurb: 'Full time', kind: 'Full-time' }] } }
    const on = { ...model, forms: { ...model.forms, hiring: { on: true, inbox: 'jobs@acme.test' } }, sections: [...model.sections, section] }
    const html = String((await draw('roofing', on)).files['index.html'])
    expect(html).toContain('/api/apply'); expect(html).toMatch(/PDF or Word|\.pdf/i); expect(html).toContain(`${LIMITS.resumeMb} MB`)
    const sectionHidden = { ...on, sections: on.sections.map((s: any) => (s.id === 'hiring' ? { ...s, hidden: true } : s)) }
    expect(String((await draw('roofing', sectionHidden)).files['index.html'])).not.toContain('/api/apply')
    const formOff = { ...on, forms: { ...on.forms, hiring: { on: false, inbox: '' } } }
    expect(String((await draw('roofing', formOff)).files['index.html'])).not.toContain('/api/apply')
  })
  test('no applicant or visitor detail is anywhere in the page source', async () => {
    const { model } = first('roofing'); const html = String((await draw('roofing', model)).files['index.html'])
    expect(html).not.toMatch(/analytics|gtag|googletagmanager|fbq\(|hotjar/i)
  })
  test('the privacy page says where each form goes, and the resume limits when hiring is on', async () => {
    const { model } = first('roofing')
    const p = String((await draw('roofing', model)).files['privacy/index.html'])
    expect(p).toMatch(/emailed|email/i); expect(p).toMatch(/owner|business/i)
    const section = { id: 'hiring', type: 'hiring', variant: 'form', hidden: false, data: { jobs: [{ title: 'Roofer' }] } }
    const on = { ...model, forms: { ...model.forms, hiring: { on: true, inbox: 'jobs@acme.test' } }, sections: [...model.sections, section] }
    const p2 = String((await draw('roofing', on)).files['privacy/index.html'])
    expect(p2).toMatch(/application|resume/i); expect(p2).toContain(`${LIMITS.resumeMb} MB`)
  })
  test('the same renderer draws every look: the page changes with the look, the sections do not', async () => {
    const { model } = first('roofing')
    const pages = await Promise.all(['foundry', 'heritage', 'studio', 'market'].map(async (design) => String((await draw('roofing', { ...model, look: { ...model.look, design } })).files['index.html'])))
    expect(new Set(pages).size).toBeGreaterThan(1)
    for (const p of pages) expect(p).toContain('id="contact"')
  })
})

describe('the files that are published', () => {
  test('redirects: every route is listed by name; there is no catch-all that could expose a path', () => {
    const r = redirectsFile()
    expect(r).not.toMatch(/^\/\*/m)
    for (const p of ['/api/signin', '/api/signout', '/api/link', '/api/model', '/api/upload', '/api/leads', '/api/apply', '/api/me', '/api/usage', '/api/export', '/api/adopt', '/api/domain/status', '/api/domain/attach', '/api/domain/buy', '/privacy', '/media']) expect(r).toContain(p)
    expect(r).toMatch(/\/edit\s+\/edit\/\s+301/)
  })
  test('headers: the editor and the API are never cached or framed', () => {
    const h = headersFile()
    expect(h).toMatch(/\/edit\/[\s\S]*Cache-Control: no-store/i); expect(h).toMatch(/X-Frame-Options|frame-ancestors/i)
  })
  test('the forms Netlify must see: lead and apply, each with a honeypot, and the two trade questions', () => {
    const f = formsHtml()
    expect(f).toContain('name="lead"'); expect(f).toContain('name="apply"')
    expect((f.match(/bot-field/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(f).toContain('extra1'); expect(f).toContain('extra2'); expect(f).toContain('type="file"')
  })
  test('the deploy: static files and one function, byte-for-byte the same twice (so Netlify skips unchanged uploads)', async () => {
    const { model } = first('roofing'); const out = await draw('roofing', model)
    const a = await buildSiteFiles(out, buildSpec('roofing')); const b = await buildSiteFiles(out, buildSpec('roofing'))
    expect(Object.keys(a.functions)).toEqual(['site']); expect(Buffer.from(a.functions.site).equals(Buffer.from(b.functions.site))).toBe(true)
    expect(Object.keys(a.files)).not.toContain('index.html')
    expect(Object.keys(a.files)).toContain('edit/index.html')
    for (const [name, content] of Object.entries(a.files)) if (typeof content === 'string') expect(content, name).not.toMatch(/NETLIFY_AUTH_TOKEN|WEB_PRESENCE_SECRET_KEY/)
    expect(a.functions.site.length).toBeLessThan(2_000_000)
  })
})

describe('everything a site saves is cleaned on the server', () => {
  const spec = () => buildSpec('roofing')
  test('words: control and direction-changing characters are gone, whitespace collapsed, length capped', () => {
    expect(cleanLine('  Hello\u0000 there\n\tfriend  ', 50)).toBe('Hello there friend')
    expect(cleanLine('a'.repeat(500), 20).length).toBe(20)
    expect(cleanLine('line1\nline2', 50)).not.toContain('\n')
    expect(cleanLine('abc\u202edef', 50)).toBe('abcdef')
    expect(cleanLine(null as any, 20)).toBe(''); expect(cleanLine({ toString: () => 'x' } as any, 20)).toBe('')
  })
  test('markup typed into any field is drawn as text, never as markup', async () => {
    const { model } = first('roofing')
    const evil = '<script>alert(1)</script><img src=x onerror=alert(2)>'
    const hacked = { ...model, business: { ...model.business, name: evil, tagline: evil }, sections: model.sections.map((s: any) => (s.type === 'hero' || s.type === 'about' ? { ...s, data: Object.fromEntries(Object.entries(s.data).map(([k, v]) => [k, typeof v === 'string' && k !== 'image' && !/href|url|src/i.test(k) ? evil : v])) } : s)) }
    const { model: cleaned } = canonicalise(hacked, buildSpec('roofing'), model)
    const html = String((await draw('roofing', cleaned)).files['index.html'])
    expect(html).not.toContain('<script>alert(1)</script>'); expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
  })
  test('links: https, tel, mailto and in-page anchors only — never javascript:, data: or http', () => {
    for (const ok of ['https://example.com/a', 'tel:+16085551234', 'mailto:a@b.co', '#contact']) expect(cleanLink(ok)).toBe(ok)
    for (const bad of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'data:text/html,<script>', 'http://example.com', '//evil.test', 'vbscript:x']) expect(cleanLink(bad)).toBe('')
  })
  test('images: only the site\'s own photos, the library, or https', () => {
    const h = 'a'.repeat(40)
    expect(cleanImage('/media?h=' + h)).toBe('/media?h=' + h)
    expect(cleanImage('/media?h=zzz')).toBe(''); expect(cleanImage('javascript:alert(1)')).toBe(''); expect(cleanImage('data:image/png;base64,AAAA')).toBe('')
    expect(cleanImage('https://images.example.com/a.jpg')).toBe('https://images.example.com/a.jpg')
  })
  test('dates, emails, phones', () => {
    expect(cleanDate('2026-10-31')).toBe('2026-10-31'); expect(cleanDate('31/10/2026')).toBe(''); expect(cleanDate('2026-13-45')).toBe('')
    expect(cleanEmail(' A@B.co ')).toBe('a@b.co'); expect(cleanEmail('not an email')).toBe(''); expect(cleanEmail('a@b.co\nbcc:x@y.z')).toBe('')
    expect(cleanPhone('(608) 555-1234')).toBe('(608) 555-1234'); expect(cleanPhone('6085551234')).toBe('(608) 555-1234'); expect(cleanPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958'); expect(cleanPhone('call me <script>')).toBe('')
  })
  test('the model: unknown things are dropped, ids are unique, at most the allowed number of sections, a toggle never seen is ON', () => {
    const { model } = first('roofing')
    const messy: any = { ...model, evil: '<script>', sections: [...model.sections, ...model.sections, ...Array.from({ length: 60 }, (_, i) => ({ id: 'x' + i, type: 'banner', variant: 'announcement', data: {} }))] }
    const m = cleanModel(messy, { ...spec(), ...require('../../../apps/api/src/webPresence/spec').cleanerSpec(spec()) }, model)
    expect((m as any).evil).toBeUndefined()
    const ids = m.sections.map((s: any) => s.id); expect(new Set(ids).size).toBe(ids.length)
    expect(m.sections.length).toBeLessThanOrEqual(LIMITS.sections)
    const noFlag = cleanModel({ ...model, sections: model.sections.map((s: any) => { const { hidden, ...r } = s; return r }) }, require('../../../apps/api/src/webPresence/spec').cleanerSpec(spec()), model)
    expect(noFlag.sections.every((s: any) => s.hidden === false)).toBe(true)
  })
  test('saving the page as it is says nothing about layouts — for every trade', () => {
    // 10/30 live: every save said "Contact: that layout no such layout." (contact has no layout choice).
    for (const trade of ['landscaping', 'roofing', 'restaurant', 'salon', 'home care', 'plumbing']) {
      const { model } = first(trade)
      expect([trade, canonicalise(model, buildSpec(trade), model).notes]).toEqual([trade, []])
    }
  })
  test('a section type or layout the trade does not offer is not accepted from a request', () => {
    const { model } = first('roofing')
    const bogus = { ...model, sections: [...model.sections, { id: 'spot', type: 'spot', variant: 'today', data: {} }, { id: 'hero2', type: 'hero', variant: 'nope', data: {} }] }
    const { model: out } = canonicalise(bogus, buildSpec('roofing'), model)
    expect(out.sections.some((s: any) => s.type === 'spot')).toBe(false)
    expect(out.sections.every((s: any) => buildSpec('roofing').typeVariants[s.type]?.includes(s.variant))).toBe(true)
  })
  test('colours: only real hex colours that stay readable; fonts, corners and spacing only from the safe lists', () => {
    const { model } = first('roofing')
    const bad = { ...model, look: { design: 'foundry', palette: { brand: 'red; background:url(x)', band: '#ffffff', page: '#ffffff' }, style: { fonts: 'Comic Sans', corners: '999', spacing: 'x' } } }
    const { model: out } = canonicalise(bad, buildSpec('roofing'), model)
    expect(JSON.stringify(out.look)).not.toMatch(/url\(|Comic|999/)
  })
  test('the forms switch: lead needs a shown contact section, hiring needs a shown hiring section', () => {
    const f = (lead: boolean, hiring: boolean, contactHidden = false, hiringHidden = false) => effectiveForms({ forms: { lead: { on: lead }, hiring: { on: hiring } }, sections: [{ id: 'contact', hidden: contactHidden }, { id: 'hiring', hidden: hiringHidden }] })
    expect(f(true, true)).toEqual({ lead: true, hiring: true }); expect(f(false, false)).toEqual({ lead: false, hiring: false })
    expect(f(true, true, true, true)).toEqual({ lead: false, hiring: false })
    expect(effectiveForms({ forms: {}, sections: [] })).toEqual({ lead: false, hiring: false })
  })
  test('a model that is too big is flagged', () => { expect(modelTooBig({ x: 'y'.repeat(LIMITS.modelBytes) })).toBe(true); expect(modelTooBig({ x: 'y' })).toBe(false) })
  test('photos by their bytes, not their name; resumes by name AND bytes', () => {
    const png = new Uint8Array(20); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const jpg = new Uint8Array(20); jpg.set([0xff, 0xd8, 0xff])
    const webp = new Uint8Array(20); webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
    for (const b of [png, jpg, webp]) expect(checkImage(b).ok).toBe(true)
    expect(checkImage(new TextEncoder().encode('<svg onload=alert(1)></svg>    ')).ok).toBe(false)
    expect(checkImage(new Uint8Array(LIMITS.imageBytes + 10)).ok).toBe(false)
    expect(checkResume({ name: 'a.pdf', size: 100, head: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }).ok).toBe(true)
    expect(checkResume({ name: 'a.exe', size: 100, head: new Uint8Array([0x4d, 0x5a]) }).ok).toBe(false)
    expect(checkResume({ name: 'a.pdf', size: 100, head: new Uint8Array([0x4d, 0x5a, 0, 0]) }).ok).toBe(false)
    expect(checkResume({ name: 'a.pdf', size: (LIMITS.resumeMb + 1) * 1024 * 1024, head: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }).ok).toBe(false)
    expect(checkResume({ name: 'a.docx', size: 0, head: new Uint8Array([0x50, 0x4b]) }).ok).toBe(false)
  })
})

describe('sessions and limits', () => {
  test('a session token cannot be altered, moved to another site, or used after it ends', async () => {
    const t = await mintSession('secret-a', 'site-a', 1_000_000)
    expect((await verifySession('secret-a', t, 'site-a', 1_000_000 + 1000)).ok).toBe(true)
    expect((await verifySession('secret-a', t, 'site-b', 1_000_000 + 1000)).ok).toBe(false)
    expect((await verifySession('secret-b', t, 'site-a', 1_000_000 + 1000)).ok).toBe(false)
    expect((await verifySession('secret-a', t.slice(0, -2) + 'xx', 'site-a', 1_000_000 + 1000)).ok).toBe(false)
    expect((await verifySession('secret-a', t, 'site-a', 1_000_000 + 13 * 3600_000)).ok).toBe(false)
    const [v, payload, sig] = t.split('.'); const forged = [v, btoa(JSON.stringify({ k: 'ses', s: 'site-a', e: 9e9, i: 'x' })).replace(/=+$/, ''), sig].join('.')
    expect((await verifySession('secret-a', forged, 'site-a', 1_000_000)).ok).toBe(false)
    void payload
  })
  test('a sign-in token cannot be used as a session, nor a session as a sign-in', async () => {
    const { mintSignin, verifySignin } = await import('../../../apps/api/src/webPresence/site/session.mjs')
    const s = await mintSession('k', 'a', 1e6); const i = await mintSignin('k', 'a', 1e6)
    expect((await verifySession('k', i, 'a', 1e6)).ok).toBe(false)
    expect((await verifySignin('k', s, 'a', 1e6)).ok).toBe(false)
  })
  test('the rate limit counts per key and per window', async () => {
    const m = new Map<string, string>(); const store = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v) } }
    const res = []; for (let i = 0; i < 4; i++) res.push((await rateLimit(store, 'k', 3, 60, 1_000_000)).allowed)
    expect(res).toEqual([true, true, true, false])
    expect((await rateLimit(store, 'other', 3, 60, 1_000_000)).allowed).toBe(true)
    expect((await rateLimit(store, 'k', 3, 60, 1_000_000 + 61_000)).allowed).toBe(true)
    expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('abc', 'ab')).toBe(false)
  })
})
