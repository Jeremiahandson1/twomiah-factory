// app.<domain> is the business's admin address (http/adminHost.ts), as the templates' CRM service was: "/" opens the
// admin, a website page goes to the domain itself, the admin's pages and the API answer as on any name, and search
// engines are told to keep out. Through the real server, with the domain wired (SITE_URL) and without.
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { bootTenant } from './harness.ts'
import { isAdminHost, siteDomain } from '../server/http/adminHost.ts'

const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-host-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>Admin</title></head><body><div id="root"></div></body></html>')
let t: Awaited<ReturnType<typeof bootTenant>>
const before = process.env.SITE_URL

beforeAll(async () => {
  t = await bootTenant({ adminDist: dist })
  const [co] = await t.db.insert(t.schema.company).values({ name: 'Acme Remodeling', slug: 'acme' }).returning()
  await t.db.insert(t.schema.website).values({ companyId: co.id })
  await t.db.insert(t.schema.page).values([
    { companyId: co.id, slug: 'home', title: 'Home', sections: [{ type: 'hero', variant: 'centered-stats', data: { title: 'Acme' } }] },
    { companyId: co.id, slug: 'about', title: 'About', sections: [{ type: 'hero', variant: 'centered-stats', data: { title: 'About' } }] },
  ])
})
afterAll(() => { if (before === undefined) delete process.env.SITE_URL; else process.env.SITE_URL = before })

const on = (host: string, p: string, init: RequestInit = {}) => t.call(p, { ...init, headers: { ...(init.headers as any), Host: host } })

describe('the business\'s domain, read from SITE_URL', () => {
  test('a wired domain; the Render address and an unset one are no domain', () => {
    expect(siteDomain('https://acme.com')).toBe('acme.com')
    expect(siteDomain('https://ACME.com/')).toBe('acme.com')
    expect(siteDomain('https://x-app.onrender.com')).toBeNull()
    expect(siteDomain(undefined)).toBeNull()
    expect(siteDomain('not a url')).toBeNull()
  })
  test('only app.<that domain> is the admin address — exact, port ignored', () => {
    const c = (host: string) => ({ req: { header: (k: string) => (k === 'Host' ? host : undefined) } }) as any
    expect(isAdminHost(c('app.acme.com'), 'https://acme.com')).toBe(true)
    expect(isAdminHost(c('APP.acme.com:443'), 'https://acme.com')).toBe(true)
    expect(isAdminHost(c('acme.com'), 'https://acme.com')).toBe(false)
    expect(isAdminHost(c('www.acme.com'), 'https://acme.com')).toBe(false)
    expect(isAdminHost(c('app.other.com'), 'https://acme.com')).toBe(false)
    expect(isAdminHost(c('app.x-app.onrender.com'), 'https://x-app.onrender.com')).toBe(false)
  })
})

describe('on app.<domain>', () => {
  beforeAll(() => { process.env.SITE_URL = 'https://acme.com' })

  test('"/" opens the admin', async () => {
    const r = await on('app.acme.com', '/')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toBe('/crm')
  })
  test('the admin\'s pages are the admin page', async () => {
    for (const p of ['/login', '/crm', '/crm/contacts']) {
      const r = await on('app.acme.com', p)
      expect(r.status).toBe(200)
      expect(await r.text()).toContain('<div id="root">')
    }
  })
  test('a website page goes to the domain itself, query kept, so each page has one address', async () => {
    const r = await on('app.acme.com', '/about?utm_source=x')
    expect(r.status).toBe(301)
    expect(r.headers.get('location')).toBe('https://acme.com/about?utm_source=x')
    expect((await on('app.acme.com', '/book')).headers.get('location')).toBe('https://acme.com/book')
  })
  test('the API answers as on any name — an unknown path is its JSON 404, not a redirect', async () => {
    expect((await on('app.acme.com', '/health')).status).toBe(200)
    const r = await on('app.acme.com', '/api/nowhere')
    expect(r.status).toBe(404)
    expect(r.headers.get('content-type')).toContain('application/json')
  })
  test('a form posted there is not turned into a GET by a redirect', async () => {
    const r = await on('app.acme.com', '/contact', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=A' })
    expect(r.status).not.toBe(301)
    expect(r.status).not.toBe(302)
  })
  test('the page editor\'s live preview (a same-origin frame) shows the website, not the admin, and is kept out of search', async () => {
    const frame = { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'navigate' }
    for (const p of ['/', '/about']) {
      const r = await on('app.acme.com', p, { headers: frame })
      expect(r.status).toBe(200)
      const html = await r.text()
      expect(html).not.toContain('<div id="root">')
      expect(html).toContain(p === '/' ? 'Acme' : 'About')
      expect(r.headers.get('x-robots-tag')).toBe('noindex')
    }
    // A frame from another site gets no such pass.
    const cross = await on('app.acme.com', '/', { headers: { ...frame, 'sec-fetch-site': 'cross-site' } })
    expect(cross.status).toBe(302)
  })
  test('the admin\'s own "View site" link to "/" opens the website on the domain; typed or bookmarked, the admin', async () => {
    const link = await on('app.acme.com', '/', { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'same-origin' } })
    expect(link.status).toBe(302)
    expect(link.headers.get('location')).toBe('https://acme.com/')
    const typed = await on('app.acme.com', '/', { headers: { 'sec-fetch-dest': 'document', 'sec-fetch-site': 'none' } })
    expect(typed.headers.get('location')).toBe('/crm')
  })
  test('search engines keep out of the admin address', async () => {
    const r = await on('app.acme.com', '/robots.txt')
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('User-agent: *\nDisallow: /\n')
  })
  test('the domain itself and www are the website, unchanged', async () => {
    for (const host of ['acme.com', 'www.acme.com']) {
      const r = await on(host, '/')
      expect(r.status).toBe(200)
      expect(await r.text()).not.toContain('<div id="root">')
      expect((await on(host, '/about')).status).toBe(200)
    }
    expect(await (await on('acme.com', '/robots.txt')).text()).not.toBe('User-agent: *\nDisallow: /\n')
  })
})

describe('with no domain wired', () => {
  beforeAll(() => { delete process.env.SITE_URL })
  test('the Render address serves the website at "/", as before', async () => {
    for (const host of ['x-app.onrender.com', 'app.x-app.onrender.com']) {
      const r = await on(host, '/')
      expect(r.status).toBe(200)
      expect(await r.text()).not.toContain('<div id="root">')
    }
  })
})
