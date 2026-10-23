// Draft and live (site/drafts.ts, site/preview.ts; owner 2026-10-23: "I would think it would change in real time as I
// change things, and if I like it I would click save and then publish. But it only changes when I click save, and it says
// published."). Through the real server:
//   • saving a page, a post, a piece of work or the settings keeps a draft — the public site, its menu, the sitemap,
//     llms.txt and the search tags do not change;
//   • Publish copies the draft to live; Discard goes back to live; an existing record has no draft;
//   • "Show on site" is its own switch, at once, and never publishes;
//   • the preview draws unsaved state through the site's own routes — same page, same stylesheet — without saving, counting
//     a visit, tracking, or leaving the admin's name (app.<domain>);
//   • who may: site:update saves and publishes content, site:settings the settings; staff neither.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { eq } from 'drizzle-orm'
import { bootTenant, seedOwner } from './harness.ts'
import { SITE_CSP } from '../server/http/guards.ts'

let t: Awaited<ReturnType<typeof bootTenant>>
let companyId = ''
const tokens: Record<string, string> = {}
const before = process.env.SITE_URL

const signIn = async (email: string, password: string) => (await (await t.call('/api/auth/login', { method: 'POST', json: { email, password } })).json()).accessToken as string
const as = (who: string, path: string, init: any = {}) => t.call(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${tokens[who]}` } })
const json = async (r: Response) => { const b = await r.json(); return b }
const pub = async (p: string) => (await t.call(p)).text()
const hero = (title: string) => [{ type: 'hero', variant: 'centered-stats', data: { title } }]
const views = async () => t.db.select().from(t.schema.pageView).where(eq(t.schema.pageView.companyId, companyId))
const settle = () => new Promise((r) => setTimeout(r, 50))

beforeAll(async () => {
  delete process.env.SITE_URL
  t = await bootTenant()
  const seeded = await seedOwner(t)
  companyId = seeded.company.id
  for (const [role, email] of [['manager', 'manager@test.example'], ['field', 'staff@test.example']] as const) {
    await t.db.insert(t.schema.user).values({ email, passwordHash: await Bun.password.hash('Pass-word-1', 'bcrypt'), firstName: role, lastName: 'X', role, companyId })
  }
  tokens.owner = await signIn('owner@test.example', seeded.password)
  tokens.manager = await signIn('manager@test.example', 'Pass-word-1')
  tokens.staff = await signIn('staff@test.example', 'Pass-word-1')
  await t.db.insert(t.schema.website).values({ companyId, tagline: 'Live tagline', nav: [{ label: 'About', href: 'about' }], googleTagManagerId: 'GTM-LIVE123' })
  await t.db.insert(t.schema.page).values([
    { companyId, slug: 'home', title: 'Home', sections: hero('Live home headline') },
    { companyId, slug: 'about', title: 'About', sections: [...hero('Live about headline'), { type: 'faq', variant: 'accordion', data: { items: [{ question: 'Q?', answer: 'A.' }] } }], metaDescription: 'Live description' },
  ])
})
afterAll(() => { if (before === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = before })

describe('a page: saved is a draft, published is live', () => {
  test('an existing page is live with no draft', async () => {
    const p = await json(await as('owner', '/api/site/pages/about'))
    expect(p.draft).toBeNull()
    expect(p.hasDraft).toBe(false)
    expect(p.sections[0].data.title).toBe('Live about headline')
  })

  test('saving keeps a draft: the public page, the list and search are unchanged', async () => {
    const r = await as('owner', '/api/site/pages/about', { method: 'PATCH', json: { title: 'About us', sections: hero('Draft about headline'), metaDescription: 'Draft description' } })
    expect(r.status).toBe(200)
    const saved = await r.json()
    expect(saved.hasDraft).toBe(true)
    expect(saved.draft.sections[0].data.title).toBe('Draft about headline')
    expect(saved.draft.title).toBe('About us')
    expect(saved.sections[0].data.title).toBe('Live about headline')
    const html = await pub('/about')
    expect(html).toContain('Live about headline')
    expect(html).not.toContain('Draft about headline')
    expect(html).toContain('Live description')
    expect(await pub('/llms.txt')).toContain('[About](')
    expect(await pub('/llms.txt')).not.toContain('Draft description')
    const list = await json(await as('owner', '/api/site/pages'))
    expect(list.data.find((p: any) => p.slug === 'about').hasDraft).toBe(true)
    expect(list.data.find((p: any) => p.slug === 'about').draft).toBeUndefined()
    expect(list.data.find((p: any) => p.slug === 'home').hasDraft).toBe(false)
  })

  test('saving the live content back is no unpublished change', async () => {
    const live = await json(await as('owner', '/api/site/pages/home'))
    const r = await json(await as('owner', '/api/site/pages/home', { method: 'PATCH', json: { title: live.title, sections: live.sections, metaTitle: null, metaDescription: null } }))
    expect(r.hasDraft).toBe(false)
  })

  test('Publish copies the draft to live, once', async () => {
    const r = await as('owner', '/api/site/pages/about/publish', { method: 'POST', json: {} })
    expect(r.status).toBe(200)
    const p = await r.json()
    expect(p.hasDraft).toBe(false)
    expect(p.title).toBe('About us')
    expect(p.metaDescription).toBe('Draft description')
    const html = await pub('/about')
    expect(html).toContain('Draft about headline')
    expect(html).not.toContain('Live about headline')
    expect(await pub('/llms.txt')).toContain('[About us](')
    const again = await as('owner', '/api/site/pages/about/publish', { method: 'POST', json: {} })
    expect(again.status).toBe(409)
    expect((await again.json()).code).toBe('nothing_to_publish')
  })

  test('Discard goes back to the live page', async () => {
    await as('owner', '/api/site/pages/about', { method: 'PATCH', json: { sections: hero('Thrown away') } })
    const r = await json(await as('owner', '/api/site/pages/about/draft', { method: 'DELETE' }))
    expect(r.hasDraft).toBe(false)
    expect(r.sections[0].data.title).toBe('Draft about headline')
    expect(await pub('/about')).not.toContain('Thrown away')
    expect((await as('owner', '/api/site/pages/about/publish', { method: 'POST', json: {} })).status).toBe(409)
  })

  test('"Show on site" is its own switch: at once, and it publishes nothing', async () => {
    await as('owner', '/api/site/pages/about', { method: 'PATCH', json: { sections: hero('Waiting in the draft') } })
    const hidden = await json(await as('owner', '/api/site/pages/about', { method: 'PATCH', json: { isPublished: false } }))
    expect(hidden.isPublished).toBe(false)
    expect(hidden.hasDraft).toBe(true)
    expect((await t.call('/about')).status).toBe(404)
    await as('owner', '/api/site/pages/about', { method: 'PATCH', json: { isPublished: true } })
    const html = await pub('/about')
    expect(html).toContain('Draft about headline')
    expect(html).not.toContain('Waiting in the draft')
    await as('owner', '/api/site/pages/about/draft', { method: 'DELETE' })
  })

  test('a hidden page published with show: true goes on the site and into the menu', async () => {
    await as('owner', '/api/site/pages', { method: 'POST', json: { slug: 'team', title: 'Team', sections: [], isPublished: false } })
    await as('owner', '/api/site/pages/team', { method: 'PATCH', json: { sections: [{ type: 'faq', variant: 'accordion', data: { items: [{ question: 'Who?', answer: 'Us.' }] } }] } })
    expect((await t.call('/team')).status).toBe(404)
    const p = await json(await as('owner', '/api/site/pages/team/publish', { method: 'POST', json: { show: true } }))
    expect(p.isPublished).toBe(true)
    expect(p.hasDraft).toBe(false)
    expect(await pub('/team')).toContain('Who?')
    const s = await json(await as('owner', '/api/site/settings'))
    expect(s.nav.some((n: any) => n.href === 'team')).toBe(true)
  })

  test('the sitemap date is the live page\'s: a draft save does not move it', async () => {
    const [row] = await t.db.select().from(t.schema.page).where(eq(t.schema.page.slug, 'about'))
    await as('owner', '/api/site/pages/about', { method: 'PATCH', json: { sections: hero('Later') } })
    const [after] = await t.db.select().from(t.schema.page).where(eq(t.schema.page.slug, 'about'))
    expect(after.updatedAt.getTime()).toBe(row.updatedAt.getTime())
    await as('owner', '/api/site/pages/about/draft', { method: 'DELETE' })
  })
})

describe('the settings: saved is a draft, published is live', () => {
  test('saving the look and words keeps a draft; the site and its stylesheet are unchanged', async () => {
    const live = await pub('/')
    expect(live).toContain('Live tagline')
    const r = await as('owner', '/api/site/settings', { method: 'PATCH', json: { tagline: 'Draft tagline', accentColor: '#ff00aa' } })
    expect(r.status).toBe(200)
    const s = await r.json()
    expect(s.hasDraft).toBe(true)
    expect(s.tagline).toBe('Live tagline')
    expect(s.draft.tagline).toBe('Draft tagline')
    expect(s.draft.accentColor).toBe('#ff00aa')
    expect(await pub('/')).not.toContain('Draft tagline')
    expect(await pub('/styles/main.css')).not.toContain('#ff00aa')
  })

  test('a page put in the menu while settings wait in a draft is in both menus', async () => {
    await as('owner', '/api/site/pages', { method: 'POST', json: { slug: 'offers', title: 'Offers', sections: [{ type: 'faq', variant: 'accordion', data: { items: [{ question: 'Deal?', answer: 'Yes.' }] } }] } })
    const s = await json(await as('owner', '/api/site/settings'))
    expect(s.nav.some((n: any) => n.href === 'offers')).toBe(true)
    expect(s.draft.nav.some((n: any) => n.href === 'offers')).toBe(true)
  })

  test('the "Finish your site" list is not part of the draft', async () => {
    const s = await json(await as('owner', '/api/site/settings', { method: 'PATCH', json: { contentGaps: [{ id: 'x', label: 'X', unlocks: 'Y' }] } }))
    expect(s.contentGaps).toEqual([{ id: 'x', label: 'X', unlocks: 'Y' }])
    expect(s.draft.contentGaps).toBeUndefined()
  })

  test('a manager may not publish or discard the settings', async () => {
    expect((await as('manager', '/api/site/settings/publish', { method: 'POST' })).status).toBe(403)
    expect((await as('manager', '/api/site/settings/draft', { method: 'DELETE' })).status).toBe(403)
  })

  test('Publish puts them on the site', async () => {
    const s = await json(await as('owner', '/api/site/settings/publish', { method: 'POST' }))
    expect(s.hasDraft).toBe(false)
    expect(s.tagline).toBe('Draft tagline')
    expect(s.accentColor).toBe('#ff00aa')
    expect(s.nav.some((n: any) => n.href === 'offers')).toBe(true)
    expect(s.contactCtaLabel).toBe('Get in touch')
    expect(await pub('/')).toContain('Draft tagline')
    expect(await pub('/styles/main.css')).toContain('#ff00aa')
    expect((await as('owner', '/api/site/settings/publish', { method: 'POST' })).status).toBe(409)
  })

  test('Discard goes back to what the site shows', async () => {
    await as('owner', '/api/site/settings', { method: 'PATCH', json: { tagline: 'Never mind' } })
    const s = await json(await as('owner', '/api/site/settings/draft', { method: 'DELETE' }))
    expect(s.hasDraft).toBe(false)
    expect(s.tagline).toBe('Draft tagline')
  })
})

describe('posts and portfolio work: the same', () => {
  test('a published post edited is a draft until published; a hidden one goes on with show: true', async () => {
    await as('owner', '/api/site/posts', { method: 'POST', json: { title: 'Spring news', slug: 'spring', body: 'Live words', status: 'published' } })
    const saved = await json(await as('owner', '/api/site/posts/spring', { method: 'PATCH', json: { body: 'Draft words', title: 'Spring news, revised' } }))
    expect(saved.hasDraft).toBe(true)
    expect(saved.status).toBe('published')
    let html = await pub('/blog/spring')
    expect(html).toContain('Live words')
    expect(html).not.toContain('Draft words')
    const published = await json(await as('owner', '/api/site/posts/spring/publish', { method: 'POST', json: {} }))
    expect(published.title).toBe('Spring news, revised')
    html = await pub('/blog/spring')
    expect(html).toContain('Draft words')

    await as('owner', '/api/site/posts', { method: 'POST', json: { title: 'Later', slug: 'later', status: 'draft' } })
    await as('owner', '/api/site/posts/later', { method: 'PATCH', json: { body: 'Coming soon' } })
    expect((await t.call('/blog/later')).status).toBe(404)
    const shown = await json(await as('owner', '/api/site/posts/later/publish', { method: 'POST', json: { show: true } }))
    expect(shown.status).toBe('published')
    expect(shown.publishedAt).toBeTruthy()
    expect(await pub('/blog/later')).toContain('Coming soon')
    expect(await json(await as('owner', '/api/site/posts')).then((b) => b.data.every((r: any) => r.hasDraft === false))).toBe(true)
  })

  test('portfolio work: photos in the draft, published together; discard', async () => {
    await as('owner', '/api/site/portfolio', { method: 'POST', json: { title: 'Oak kitchen', slug: 'oak', status: 'published', summary: 'Live summary' } })
    const saved = await json(await as('owner', '/api/site/portfolio/oak', { method: 'PATCH', json: { summary: 'Draft summary', photos: ['/media/photos/a.jpg'] } }))
    expect(saved.hasDraft).toBe(true)
    expect(saved.photos).toEqual([])
    expect(await pub('/projects/oak')).toContain('Live summary')
    const p = await json(await as('owner', '/api/site/portfolio/oak/publish', { method: 'POST', json: {} }))
    expect(p.photos).toEqual(['/media/photos/a.jpg'])
    expect(await pub('/projects/oak')).toContain('Draft summary')
    await as('owner', '/api/site/portfolio/oak', { method: 'PATCH', json: { summary: 'Oops' } })
    expect((await json(await as('owner', '/api/site/portfolio/oak/draft', { method: 'DELETE' }))).summary).toBe('Draft summary')
  })

  test('staff may not save, publish or discard', async () => {
    expect((await as('staff', '/api/site/pages/about/publish', { method: 'POST', json: {} })).status).toBe(403)
    expect((await as('staff', '/api/site/pages/about/draft', { method: 'DELETE' })).status).toBe(403)
    expect((await as('staff', '/api/site/posts/spring/publish', { method: 'POST', json: {} })).status).toBe(403)
  })

  test('a manager publishes content (site:update), as saving used to make it live', async () => {
    await as('manager', '/api/site/pages/about', { method: 'PATCH', json: { sections: hero('Manager headline') } })
    expect((await as('manager', '/api/site/pages/about/publish', { method: 'POST', json: {} })).status).toBe(200)
    expect(await pub('/about')).toContain('Manager headline')
  })
})

describe('the live preview', () => {
  const preview = (who: string, kind: string, slug: string, data?: unknown) =>
    as(who, `/api/site/preview/${kind}/${slug}`, { method: 'POST', json: { data } })

  test('typed, unsaved: drawn by the site itself, nothing saved, no visit counted', async () => {
    const r = await preview('owner', 'page', 'about', { sections: hero('Typed but not saved') })
    expect(r.status).toBe(200)
    expect((await r.json()).url).toBe('/api/site/preview/page/about')
    const res = await as('owner', '/api/site/preview/page/about')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Typed but not saved')
    // The live page's frame: its stylesheet link, its layout.
    expect(html).toMatch(/<link rel="stylesheet" href="\/styles\/main\.css\?v=/)
    expect(html).toContain('data-preview')
    expect(res.headers.get('content-security-policy')).toBe(SITE_CSP)
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const p = await json(await as('owner', '/api/site/pages/about'))
    expect(p.hasDraft).toBe(false)
    expect(await pub('/about')).not.toContain('Typed but not saved')
  })

  test('a preview is never a visit', async () => {
    await settle()
    const sum = async () => (await views()).filter((v: any) => v.path === '/about').reduce((n: number, v: any) => n + v.count, 0)
    const n0 = await sum()
    await as('owner', '/api/site/preview/page/about')
    await as('owner', '/api/site/preview/page/about')
    await settle()
    expect(await sum()).toBe(n0)
    await t.call('/about')
    await settle()
    expect(await sum()).toBe(n0 + 1)
  })

  test('with nothing held, the preview is the saved draft; a hidden page still previews', async () => {
    await as('owner', '/api/site/pages', { method: 'POST', json: { slug: 'secret', title: 'Secret', sections: hero('Hidden live'), isPublished: false } })
    await as('owner', '/api/site/pages/secret', { method: 'PATCH', json: { sections: hero('Hidden draft') } })
    const html = await (await as('manager', '/api/site/preview/page/secret')).text()
    expect(html).toContain('Hidden draft')
    expect((await t.call('/secret')).status).toBe(404)
  })

  test('each person\'s preview is their own', async () => {
    await preview('owner', 'page', 'secret', { sections: hero('Owner typing') })
    expect(await (await as('manager', '/api/site/preview/page/secret')).text()).not.toContain('Owner typing')
    expect(await (await as('owner', '/api/site/preview/page/secret')).text()).toContain('Owner typing')
  })

  test('settings: the draft look drawn with its own stylesheet inline, and no tracking', async () => {
    expect(await pub('/')).toContain('GTM-LIVE123')
    await preview('owner', 'settings', 'site', { tagline: 'Preview tagline', accentColor: '#12ab34' })
    const html = await (await as('owner', '/api/site/preview/settings/site')).text()
    expect(html).toContain('Preview tagline')
    expect(html).not.toMatch(/<link rel="stylesheet" href="\/styles\/main\.css/)
    expect(html).toContain('#12ab34')
    expect(html).not.toContain('GTM-LIVE123')
    expect(await pub('/')).not.toContain('Preview tagline')
    expect(await pub('/styles/main.css')).not.toContain('#12ab34')
  })

  test('posted state is drawn only for someone who may write it', async () => {
    // A manager has no site:settings: what they post is not drawn; the saved settings are.
    await preview('manager', 'settings', 'site', { tagline: 'Manager forged tagline' })
    expect(await (await as('manager', '/api/site/preview/settings/site')).text()).not.toContain('Manager forged tagline')
    expect((await preview('staff', 'page', 'about', { sections: hero('x') })).status).toBe(403)
    expect((await as('staff', '/api/site/preview/page/about')).status).toBe(403)
    expect((await t.call('/api/site/preview/page/about')).status).toBe(401)
  })

  test('posts and projects preview at their own addresses', async () => {
    await preview('owner', 'post', 'spring', { body: 'Post typed in the editor' })
    expect(await (await as('owner', '/api/site/preview/post/spring')).text()).toContain('Post typed in the editor')
    await preview('owner', 'portfolio', 'oak', { summary: 'Project typed in the editor' })
    expect(await (await as('owner', '/api/site/preview/portfolio/oak')).text()).toContain('Project typed in the editor')
    expect((await preview('owner', 'page', 'nowhere', {})).status).toBe(404)
    expect((await preview('owner', 'nonsense', 'about', {})).status).toBe(404)
  })

  test('on app.<domain>: the preview is the website, not a hand-over to the domain', async () => {
    process.env.SITE_URL = 'https://acme.com'
    try {
      const frame = { Host: 'app.acme.com', 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' }
      await as('owner', '/api/site/preview/page/about', { method: 'POST', json: { data: { sections: hero('On the admin name') } }, headers: { Host: 'app.acme.com' } })
      const r = await as('owner', '/api/site/preview/page/about', { headers: frame })
      expect(r.status).toBe(200)
      const html = await r.text()
      expect(html).toContain('On the admin name')
      expect(html).not.toContain('<div id="root">')
    } finally { delete process.env.SITE_URL }
  })
})
