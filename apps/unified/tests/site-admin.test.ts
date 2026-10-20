// The website's admin API through the real server: who may do what, pages that show on the public site at once,
// the website's own settings (and only those), photos stored and served only under the public prefix, the blog and
// portfolio, and the visit numbers.
import { describe, test, expect, beforeAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { bootTenant, seedOwner } from './harness.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
const tokens: Record<string, string> = {}

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })

beforeAll(async () => {
  t = await bootTenant()
  const seeded = await seedOwner(t)
  for (const [role, email] of [['manager', 'manager@test.example'], ['field', 'staff@test.example']] as const) {
    await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash('Pass-word-1', 'bcrypt'), firstName: role, lastName: 'X', role, companyId: seeded.company.id })
  }
  tokens.owner = await signIn('owner@test.example', seeded.password)
  tokens.manager = await signIn('manager@test.example', 'Pass-word-1')
  tokens.staff = await signIn('staff@test.example', 'Pass-word-1')
  await t.db.insert(t.schema.page).values({ companyId: seeded.company.id, slug: 'home', title: 'Home', sections: [] })
})

describe('who may do what', () => {
  test('staff are refused the website admin; signed-out people too', async () => {
    expect((await as('staff', '/api/site/pages')).status).toBe(403)
    expect((await t.call('/api/site/pages')).status).toBe(401)
  })

  test('a manager edits content but not the settings, and deletes nothing', async () => {
    expect((await as('manager', '/api/site/pages')).status).toBe(200)
    expect((await as('manager', '/api/site/pages', { method: 'POST', json: { slug: 'about', title: 'About' } })).status).toBe(201)
    expect((await as('manager', '/api/site/settings', { method: 'PATCH', json: { tagline: 'x' } })).status).toBe(403)
    expect((await as('manager', '/api/site/pages/about', { method: 'DELETE' })).status).toBe(403)
  })
})

describe('pages', () => {
  test('the section library is offered without the ones the server builds itself', async () => {
    const body = await (await as('owner', '/api/site/section-types')).json()
    expect(body.data).toContain('hero/full-bleed')
    expect(body.data).toContain('contact/form-info')
    expect(body.data).not.toContain('projects/grid')
    // A contractor has no bar add-on: nothing that reads the bar's night or posts its forms (ADDON_SECTIONS).
    for (const k of ['tonight/board', 'taps/wall', 'speakeasy/door', 'parties/inquiry-form', 'regulars/signup', 'timeline/eras', 'menu/item-hero']) expect(body.data).not.toContain(k)
    expect(body.data).toContain('events/recurring')
    expect(body.pagination.total).toBe(body.data.length)
  })

  test('a reserved or repeated slug is refused', async () => {
    expect((await as('owner', '/api/site/pages', { method: 'POST', json: { slug: 'crm', title: 'X' } })).status).toBe(400)
    expect((await as('owner', '/api/site/pages', { method: 'POST', json: { slug: 'Bad Slug', title: 'X' } })).status).toBe(400)
    expect((await as('owner', '/api/site/pages', { method: 'POST', json: { slug: 'about', title: 'Again' } })).status).toBe(409)
  })

  test('a saved page shows on the public site at once', async () => {
    const sections = [{ type: 'hero', variant: 'centered-stats', data: { title: 'Fresh from the editor' } }]
    const res = await as('owner', '/api/site/pages/about', { method: 'PATCH', json: { sections, metaDescription: 'About us' } })
    expect(res.status).toBe(200)
    expect((await res.json()).sections).toEqual(sections)
    expect(await (await t.call('/about')).text()).toContain('Fresh from the editor')
  })

  test('the home page cannot be deleted; another page can', async () => {
    expect((await as('owner', '/api/site/pages/home', { method: 'DELETE' })).status).toBe(400)
    await as('owner', '/api/site/pages', { method: 'POST', json: { slug: 'temp', title: 'Temp' } })
    expect((await as('owner', '/api/site/pages/temp', { method: 'DELETE' })).status).toBe(200)
    expect((await t.call('/temp')).status).toBe(404)
  })
})

describe("the website's settings", () => {
  test('the website\'s own fields save; a company fact is not edited here', async () => {
    const res = await as('owner', '/api/site/settings', { method: 'PATCH', json: { tagline: 'Built to last', seoTitle: 'Builders', serviceAreas: ['Verona'] } })
    expect(res.status).toBe(200)
    const s = await res.json()
    expect(s.tagline).toBe('Built to last')
    expect(s.serviceAreas).toEqual(['Verona'])
    expect((await as('owner', '/api/site/settings', { method: 'PATCH', json: { companyName: 'Elsewhere' } })).status).toBe(400)
  })

  test('the design is one of the designs; the stylesheet follows it', async () => {
    expect((await as('owner', '/api/site/settings', { method: 'PATCH', json: { design: 'nonsense' } })).status).toBe(400)
    expect((await as('owner', '/api/site/settings', { method: 'PATCH', json: { design: 'landscaping' } })).status).toBe(200)
    expect(await (await t.call('/styles/main.css')).text()).toContain('Season-aware delight')
  })

  test('the designs on offer are the distinct looks, the vertical\'s marked as the default', async () => {
    const body = await (await as('manager', '/api/site/designs')).json()
    expect(body.data.map((d: any) => d.id)).toEqual(['classic', 'bar', 'dispensary', 'fieldservice', 'homecare', 'landscaping', 'roofing', 'showcase'])
    expect(body.data.filter((d: any) => d.isDefault).map((d: any) => d.id)).toEqual(['classic'])
    expect((await as('staff', '/api/site/designs')).status).toBe(403)
  })

  test('the preview in the editor is not counted as a visit; a real visit is', async () => {
    const before = (await (await as('owner', '/api/site/analytics')).json()).viewsLast30
    await t.call('/', { headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'same-origin' } })
    await Bun.sleep(50)
    expect((await (await as('owner', '/api/site/analytics')).json()).viewsLast30).toBe(before)
    await t.call('/', { headers: { 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Site': 'none' } })
    await Bun.sleep(50)
    expect((await (await as('owner', '/api/site/analytics')).json()).viewsLast30).toBe(before + 1)
  })

  test('an inventory feed must be https', async () => {
    expect((await as('owner', '/api/site/settings', { method: 'PATCH', json: { inventoryFeedUrl: 'http://feed.example/units.json' } })).status).toBe(400)
  })
})

describe('photos', () => {
  let photoId = ''
  let publicUrl = ''

  test('an upload is stored under the public prefix, re-encoded, and listed', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#b45309' } }).png().toBuffer()
    const form = new FormData()
    form.append('file', new File([jpeg], 'kitchen.png', { type: 'image/png' }))
    form.append('alt', 'A finished kitchen')
    form.append('tag', 'projects')
    const res = await as('owner', '/api/site/photos', { method: 'POST', body: form })
    expect(res.status).toBe(201)
    const row = await res.json()
    photoId = row.id
    publicUrl = row.publicUrl
    expect(row.isPublic).toBe(true)
    expect(publicUrl).toMatch(/^\/media\/photos\/.+\.jpg$/)
    expect(row.width).toBe(40)
    expect(t.store.objects.get(row.filename)?.contentType).toBe('image/jpeg')
    const listed = await (await as('owner', '/api/site/photos?tag=projects')).json()
    expect(listed.data.map((p: any) => p.id)).toContain(photoId)
  })

  test('the public site serves it; /media serves nothing outside the public prefix', async () => {
    const res = await t.call(publicUrl)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/jpeg')
    t.store.objects.set('company/private/contract.pdf', { body: Buffer.from('%PDF-secret'), contentType: 'application/pdf' })
    expect((await t.call('/media/company/private/contract.pdf')).status).toBe(404)
    expect((await t.call('/media/photos/../company/private/contract.pdf')).status).toBe(404)
  })

  test('alt text changes; a deleted photo is gone from the store', async () => {
    const patched = await as('owner', `/api/site/photos/${photoId}`, { method: 'PATCH', json: { alt: 'The Oak kitchen' } })
    expect((await patched.json()).alt).toBe('The Oak kitchen')
    const [row] = await t.db.select().from(t.schema.photo).where(eq(t.schema.photo.id, photoId))
    expect((await as('owner', `/api/site/photos/${photoId}`, { method: 'DELETE' })).status).toBe(200)
    expect(t.store.objects.has(row.filename)).toBe(false)
  })

  test('a file that is not an image is refused', async () => {
    const form = new FormData()
    form.append('file', new File([Buffer.from('not an image')], 'x.png', { type: 'image/png' }))
    expect((await as('owner', '/api/site/photos', { method: 'POST', body: form })).status).toBe(400)
  })
})

describe('blog and portfolio', () => {
  test('a published post is on the public blog; a draft is not', async () => {
    expect((await as('owner', '/api/site/posts', { method: 'POST', json: { slug: 'spring', title: 'Spring news', status: 'published', body: 'Hello' } })).status).toBe(201)
    expect((await as('owner', '/api/site/posts', { method: 'POST', json: { slug: 'later', title: 'Later news' } })).status).toBe(201)
    const blog = await (await t.call('/blog')).text()
    expect(blog).toContain('Spring news')
    expect(blog).not.toContain('Later news')
    const pub = await as('owner', '/api/site/posts/later', { method: 'PATCH', json: { status: 'published' } })
    expect((await pub.json()).publishedAt).toBeTruthy()
  })

  test('the first published piece of work adds Projects to the nav, once', async () => {
    expect((await as('owner', '/api/site/portfolio', { method: 'POST', json: { slug: 'oak-kitchen', title: 'Oak kitchen', status: 'published' } })).status).toBe(201)
    expect((await as('owner', '/api/site/portfolio', { method: 'POST', json: { slug: 'deck', title: 'Deck', status: 'published' } })).status).toBe(201)
    const s = await (await as('owner', '/api/site/settings')).json()
    expect(s.nav.filter((n: any) => n.href === '/projects').length).toBe(1)
    expect(await (await t.call('/projects')).text()).toContain('Oak kitchen')
  })
})

describe('visits and enquiries', () => {
  test('page views and website enquiries are counted for the last 30 days', async () => {
    await t.call('/about')
    await t.call('/api/leads', { method: 'POST', json: { name: 'Pat Jones', email: 'pat@example.com', message: 'Call me please' }, headers: { 'X-Forwarded-For': '203.0.113.90' } })
    await new Promise((r) => setTimeout(r, 30))
    const a = await (await as('owner', '/api/site/analytics')).json()
    expect(a.viewsLast30).toBeGreaterThan(0)
    expect(a.leadsLast30).toBe(1)
    expect(a.topPages.some((p: any) => p.path === '/about')).toBe(true)
  })
})
