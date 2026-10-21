// The move's job (apps/unified/server/move/run.ts runMove): a contractor tenant's database, as a live tenant has it,
// moved into an empty unified one — first as a rehearsal that keeps nothing, then for real; a second run refused; and the
// website that comes with it, either a fresh one written after the records or the old premium site moved as it is.
import { test, expect, describe } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../server/db/schema/index.ts'
import { runMove } from '../server/move/run.ts'
import { writeFreshSite, parseSitePackage } from '../server/move/siteSource.ts'
import { memoryStore } from './harness.ts'
import { loadSiteContext } from '../server/site/context.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { liveTemplate, unifiedDb, putter, ROOT, type Db } from './templateLive.ts'

const count = async (d: Db, table: string) => Number((await d.query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n)
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 7, 1, 2, 3])

async function contractor() {
  const src = await liveTemplate('crm')
  const put = putter(src)
  await put('company', { id: 'co1', name: 'Higgs-like Builders', slug: 'higgs-like' })
  await put('user', { id: 'u1', company_id: 'co1', email: 'owner@x.example', first_name: 'Ann', last_name: 'Owner', role: 'owner' })
  await put('contact', { id: 'c1', company_id: 'co1', name: 'Pat Client', type: 'client', email: 'pat@x.example' })
  await put('invoice', { id: 'i1', company_id: 'co1', contact_id: 'c1', number: 'INV-1', total: '123.45', amount_paid: '0' })
  return src
}

const fresh = parseSitePackage({ fresh: { tagline: 'Built right', pages: [
  { slug: 'home', title: 'Home', sections: [{ type: 'hero', variant: 'split', data: { title: 'Remodeling done right' } }] },
  { slug: 'about', title: 'About', sections: [] },
] } })

/** A premium site.db as the template builds it, with its settings, one page and one photo the old site serves. */
function premiumPackage(address = '1 Main St, Eau Claire, WI') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-run-'))
  const file = path.join(dir, 'site.db')
  const db = new Database(file, { create: true })
  const migrations = path.join(ROOT, 'templates/website-premium-contractor/db/migrations')
  const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8'))
  for (const e of journal.entries) for (const s of fs.readFileSync(path.join(migrations, e.tag + '.sql'), 'utf8').split('--> statement-breakpoint')) if (s.trim()) db.exec(s)
  const t0 = Date.parse('2026-09-01T12:00:00Z')
  db.query(`INSERT INTO settings (id, company_name, tagline, phone, address, primary_color, nav, photo_credits, content_gaps, service_areas, updated_at)
    VALUES ('s1', 'Amber-like Inn Bar & Grill', 'Supper club since 1946', '715-555-0199', ?, '#C79D67', '[]', '[]', '[]', '[]', ?)`).run(address, t0)
  db.query(`INSERT INTO photos (id, url, storage_key, alt, content_type, created_at) VALUES ('ph1', '/media/photos/hero-1.jpg', 'photos/hero-1.jpg', 'The dining room', 'image/jpeg', ?)`).run(t0)
  db.query(`INSERT INTO pages (id, slug, title, is_published, nav_order, created_at, updated_at, sections) VALUES ('pg-home', 'home', 'Home', 1, 0, ?, ?, ?)`)
    .run(t0, t0, JSON.stringify([{ type: 'hero', variant: 'split', data: { title: 'Supper club', image: '/media/photos/hero-1.jpg' } }]))
  db.close()
  const site = parseSitePackage({ premium: { siteDb: fs.readFileSync(file).toString('base64'), filesBase: 'https://old-site.example' } })
  const asked: string[] = []
  const fetchImpl = (async (u: string) => {
    asked.push(String(u))
    return String(u) === 'https://old-site.example/media/photos/hero-1.jpg'
      ? new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } })
      : new Response('no', { status: 404 })
  }) as unknown as typeof fetch
  return { site, fetchImpl, asked }
}

describe('a records move with a fresh site', () => {
  test('a rehearsal runs every step, counts every row, and keeps nothing', async () => {
    const src = await contractor()
    const dst = await unifiedDb()
    let wrote = 0
    const report = await runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'check', site: fresh, store: memoryStore(), writeFresh: async () => ++wrote })
    expect(report.ok).toBe(true)
    expect(report.mode).toBe('check')
    expect(report.mismatches).toEqual([])
    expect(report.tables.find((t: any) => t.table === 'contact')).toMatchObject({ source: 1 })
    // Rolled back: the new database is as empty as it started, and no site was written.
    expect(await count(dst, 'company')).toBe(0)
    expect(await count(dst, 'contact')).toBe(0)
    expect(wrote).toBe(0)
    expect(report.site).toEqual({ fresh: true, pages: 2, oldSiteEnquiries: null })
  }, 180_000)

  test('the move copies the records, writes the fresh site for the moved business, and a second run is refused', async () => {
    const src = await contractor()
    const dst = await unifiedDb()
    const db = drizzle(dst.db, { schema })
    const report = await runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'move', site: fresh, store: memoryStore(), writeFresh: (s) => writeFreshSite(db, s) })
    expect(report.ok).toBe(true)
    expect(report.mismatches).toEqual([])
    expect((await dst.query(`SELECT id, name FROM company`)).rows).toEqual([{ id: 'co1', name: 'Higgs-like Builders' }])
    expect((await dst.query(`SELECT name, email FROM contact`)).rows).toEqual([{ name: 'Pat Client', email: 'pat@x.example' }])
    expect((await dst.query(`SELECT number FROM invoice`)).rows).toEqual([{ number: 'INV-1' }])
    expect(report.site).toEqual({ fresh: true, pages: 2, oldSiteEnquiries: null })
    expect((await dst.query(`SELECT company_id, tagline FROM website`)).rows).toEqual([{ company_id: 'co1', tagline: 'Built right' }])
    expect((await dst.query(`SELECT slug FROM page WHERE company_id = 'co1' ORDER BY slug`)).rows.map((r: any) => r.slug)).toEqual(['about', 'home'])

    await expect(runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'move', site: null, store: memoryStore(), writeFresh: async () => 0 }))
      .rejects.toThrow(/already holds 1 business/)
    expect(await count(dst, 'contact')).toBe(1)
  }, 180_000)
})

/** An old contractor site.db holding only its settings and enquiries (what move.ts sends with a fresh site). */
function oldSiteLeads(leads: { id: string; name: string; email: string; at: string }[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'move-run-leads-'))
  const file = path.join(dir, 'site.db')
  const db = new Database(file, { create: true })
  const migrations = path.join(ROOT, 'templates/website-premium-contractor/db/migrations')
  const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8'))
  for (const e of journal.entries) for (const s of fs.readFileSync(path.join(migrations, e.tag + '.sql'), 'utf8').split('--> statement-breakpoint')) if (s.trim()) db.exec(s)
  db.query(`INSERT INTO settings (id, company_name, nav, photo_credits, content_gaps, service_areas, updated_at) VALUES ('s1', 'Old site', '[]', '[]', '[]', '[]', 0)`).run()
  for (const l of leads) db.query(`INSERT INTO leads (id, name, email, message, source, status, created_at) VALUES (?, ?, ?, 'A quote please', '/contact', 'new', ?)`).run(l.id, l.name, l.email, Date.parse(l.at))
  db.close()
  return fs.readFileSync(file).toString('base64')
}

describe("a fresh site, with the old site's enquiries carried", () => {
  test('every enquiry the old site took reaches the CRM — one its forward already delivered is matched, not doubled; a rehearsal keeps none', async () => {
    const src = await contractor()
    // The forward reached the CRM for Lena (5 s later), not for Omar.
    await putter(src)('contact', { id: 'c-lena', company_id: 'co1', name: 'Lena Lead', type: 'lead', email: 'lena@x.example', created_at: '2026-10-13 22:03:00' })
    const siteDb = oldSiteLeads([{ id: 'sl1', name: 'Lena Lead', email: 'LENA@x.example', at: '2026-10-13T22:02:55Z' }, { id: 'sl2', name: 'Omar Orphan', email: 'omar@x.example', at: '2026-10-19T05:58:48Z' }])
    const site = parseSitePackage({ fresh: { pages: [{ slug: 'home', title: 'Home', sections: [] }] }, leadsFrom: { siteDb } })

    const rehearsal = await unifiedDb()
    const r1 = await runMove({ src: src.query, dst: rehearsal.query, kind: 'crm', mode: 'check', site, store: memoryStore(), writeFresh: async () => 0 })
    expect((r1.site as any).oldSiteEnquiries.steps.find((x: any) => x.step === 'site: leads').did).toBe('2 lead(s): 1 already in the CRM (its forward reached it), 0 into the Lead Inbox, 1 as lead contacts')
    expect(await count(rehearsal, 'contact')).toBe(0)

    const dst = await unifiedDb()
    const db = drizzle(dst.db, { schema })
    await runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'move', site, store: memoryStore(), writeFresh: (s) => writeFreshSite(db, s) })
    expect((await dst.query(`SELECT name FROM contact ORDER BY name`)).rows.map((r: any) => r.name)).toEqual(['Lena Lead', 'Omar Orphan', 'Pat Client'])
    expect(await count(dst, 'website')).toBe(1)
  }, 180_000)

  test("a package naming the old site's enquiries without their database is refused", () => {
    expect(() => parseSitePackage({ fresh: { pages: [] }, leadsFrom: {} })).toThrow(/database is missing/)
  })
})

describe('a records move with the old premium site, as it is', () => {
  test('a rehearsal leaves neither rows nor photo files behind', async () => {
    const src = await contractor()
    const dst = await unifiedDb()
    const store = memoryStore()
    const { site, fetchImpl, asked } = premiumPackage()
    const report = await runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'check', site, store, fetchImpl, writeFresh: async () => { throw new Error('not a fresh site') } })
    expect(report.ok).toBe(true)
    expect(asked).toContain('https://old-site.example/media/photos/hero-1.jpg')
    expect(await count(dst, 'website')).toBe(0)
    expect(await count(dst, 'page')).toBe(0)
    expect([...store.objects.keys()]).toEqual([])
  }, 180_000)

  test("the site's address with its ZIP: the CRM's street, city and state kept, the ZIP filled — and the new site prints the same line", async () => {
    const src = await contractor()
    await src.query(`UPDATE company SET address = '1 Main St', city = 'Eau Claire', state = 'WI', zip = NULL WHERE id = 'co1'`)
    const dst = await unifiedDb()
    const { site, fetchImpl } = premiumPackage('1 Main St, Eau Claire, WI 54703')
    const report = await runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'move', site, store: memoryStore(), fetchImpl, writeFresh: async () => 0 })
    expect((await dst.query(`SELECT address, city, state, zip FROM company`)).rows).toEqual([{ address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54703' }])
    expect(report.steps.find((x: any) => x.step === 'site: company')!.did).toContain('filled from the site: phone, ZIP')
    const ctx = await loadSiteContext(drizzle(dst.db, { schema }), await loadVertical('bar'))
    expect(ctx!.settings.address).toBe('1 Main St, Eau Claire, WI 54703')
  }, 180_000)

  test('in the business\'s one bucket, a rehearsal never removes the file the old site still serves; a different file there is refused', async () => {
    const src = await contractor()
    const dst = await unifiedDb()
    // The old site's own file, already at the key the move would write (the bucket the old site and CRM share).
    const store = memoryStore()
    await store.put('photos/hero-1.jpg', Buffer.from(JPEG), 'image/jpeg')
    const { site, fetchImpl } = premiumPackage()
    const report = await runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'check', site, store, fetchImpl, writeFresh: async () => 0 })
    expect(report.ok).toBe(true)
    expect(Buffer.from(store.objects.get('photos/hero-1.jpg')!.body)).toEqual(Buffer.from(JPEG))

    const other = memoryStore()
    await other.put('photos/hero-1.jpg', Buffer.from('a different file'), 'image/jpeg')
    await expect(runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'move', site: premiumPackage().site, store: other, fetchImpl, writeFresh: async () => 0 }))
      .rejects.toThrow(/already holds a different file at photos\/hero-1.jpg/)
    expect(String(other.objects.get('photos/hero-1.jpg')!.body)).toBe('a different file')
    expect(await count(dst, 'company')).toBe(0)
  }, 180_000)

  test('the move brings the site\'s settings, pages and photo files in with the records', async () => {
    const src = await contractor()
    const dst = await unifiedDb()
    const store = memoryStore()
    const { site, fetchImpl } = premiumPackage()
    const report = await runMove({ src: src.query, dst: dst.query, kind: 'crm', mode: 'move', site, store, fetchImpl, writeFresh: async () => { throw new Error('not a fresh site') } })
    expect(report.ok).toBe(true)
    expect((await dst.query(`SELECT company_id, tagline FROM website`)).rows).toEqual([{ company_id: 'co1', tagline: 'Supper club since 1946' }])
    // AS IT IS: the site shows the company's name, phone, address and colour, so the site's replace the CRM's — and say so.
    expect((await dst.query(`SELECT name, phone, address, city, state, primary_color FROM company`)).rows).toEqual([
      { name: 'Amber-like Inn Bar & Grill', phone: '715-555-0199', address: '1 Main St', city: 'Eau Claire', state: 'WI', primary_color: '#C79D67' },
    ])
    const said = report.steps.find((x: any) => x.step === 'site: company')!.did
    expect(said).toContain(`name: the site's "Amber-like Inn Bar & Grill" replaced the CRM's "Higgs-like Builders"`)
    const [home] = (await dst.query(`SELECT sections FROM page WHERE slug = 'home'`)).rows
    const sections = typeof home.sections === 'string' ? JSON.parse(home.sections) : home.sections
    expect(sections[0].data.title).toBe('Supper club')
    // The photo's file was carried into the business's storage, under the key the unified /media serves at the SAME
    // address the page already uses — so the page's links are unchanged.
    expect([...store.objects.keys()]).toEqual(['photos/hero-1.jpg'])
    expect(Buffer.from(store.objects.get('photos/hero-1.jpg')!.body)).toEqual(Buffer.from(JPEG))
    expect(sections[0].data.image).toBe('/media/photos/hero-1.jpg')
    expect((await dst.query(`SELECT count(*)::int AS n FROM photo`)).rows[0].n).toBe(1)
  }, 180_000)
})
