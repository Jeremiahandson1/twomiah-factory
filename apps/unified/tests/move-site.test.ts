// The website's data move (apps/unified/server/move/site.ts): a premium site's SQLite file, built from the template's
// own migration (templates/website-premium-*/db/migrations), filled the way a live site fills it, and its photo files in
// a folder; moved into a unified database that already holds what the CRM move made (the company, its users, a lead the
// site forwarded, the CRM widget's booking service and hours). Then the unified site is built on that database and its
// pages are read through its own routes.
import { test, expect, beforeAll, describe } from 'bun:test'
import { Database } from 'bun:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/pglite'
import * as schema from '../server/db/schema/index.ts'
import { createApp } from '../server/app.ts'
import { loadVertical } from '../server/core/vertical.ts'
import { memoryStore } from './harness.ts'
import { unifiedDb, putter, ROOT, type Db } from './templateLive.ts'
import { moveSite, filesFromDir, type SiteMoveReport } from '../server/move/site.ts'

const VIEWS = path.join(ROOT, 'apps/unified/site/views/sections')
const knownSection = (k: string) => fs.existsSync(path.join(VIEWS, k + '.ejs'))
const JPEG = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 1, 2, 3])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9])
const ms = (iso: string) => Date.parse(iso + 'Z')

/** A site.db from the template's migration, in a fresh folder, with a writer that takes plain values. */
function siteDb(template: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-move-'))
  const file = path.join(dir, 'site.db')
  const db = new Database(file, { create: true })
  const migrations = path.join(ROOT, 'templates', template, 'db/migrations')
  const journal = JSON.parse(fs.readFileSync(path.join(migrations, 'meta/_journal.json'), 'utf8'))
  for (const e of journal.entries) for (const s of fs.readFileSync(path.join(migrations, e.tag + '.sql'), 'utf8').split('--> statement-breakpoint')) if (s.trim()) db.exec(s)
  const put = (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row)
    const v = cols.map((c) => { const x = row[c]; return x !== null && typeof x === 'object' ? JSON.stringify(x) : typeof x === 'boolean' ? (x ? 1 : 0) : x })
    db.query(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...(v as any[]))
  }
  const files = (rel: string, body: Uint8Array) => { const p = path.join(dir, 'files', rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body) }
  return { dir, file, db, put, files, filesDir: path.join(dir, 'files') }
}

function siteOn(dst: Db, store: ReturnType<typeof memoryStore>, vertical: Awaited<ReturnType<typeof loadVertical>>) {
  const { app } = createApp({ db: drizzle(dst.db, { schema }), vertical, store })
  return (p: string) => app.request(p)
}

describe('a contractor site (website-premium-contractor) beside its CRM', () => {
  let dst: Db
  let report: SiteMoveReport
  let store: ReturnType<typeof memoryStore>
  let get: (p: string) => Promise<Response> | Response
  const did = (s: string) => report.steps.find((x) => x.step === s)?.did ?? ''
  const one = async (sql: string) => (await dst.query(sql)).rows[0]
  const site = siteDb('website-premium-contractor')

  beforeAll(async () => {
    const { put, files } = site
    const t0 = ms('2026-09-01T12:00:00')
    put('settings', {
      id: 's1', company_name: 'Higgs-like Builders LLC', tagline: 'Two Brothers. One Standard.', phone: '817-555-0100', email: 'office@higgs.example', address: '7061 Example Lane, Fort Worth, TX',
      seo_title: 'Remodeling in Fort Worth', seo_description: 'Interior and exterior remodeling.', nav: [{ label: 'About', href: '/about' }, { label: 'Blog', href: '/blog' }],
      photo_credits: [{ photographer: 'Pat Pexels', source: 'pexels' }], content_gaps: [{ id: 'license', label: 'Licence number' }], service_areas: ['Fort Worth', 'Keller'],
      inventory_feed_url: null, contact_cta_label: 'Free estimate', primary_color: '#B22234', secondary_color: '#0B0B0B', accent_color: '#C9A227', logo_url: '/media/photos/logo-1.png',
      favicon_url: null, google_analytics_id: 'G-TEST123', customizer_token: 'cust-tok', booking_hero_title: 'Book a free estimate', booking_thanks_message: 'See you soon.',
      booking_default_drive_time_minutes: 15, booking_ical_feed_token: 'ical-tok-1', crm_url: 'https://crm.example', crm_ready_at: t0, updated_at: t0,
    })
    put('users', { id: 'su-wes', email: 'Wesley@Higgs.example', password_hash: 'x', name: 'Wesley', role: 'admin', totp_secret: 'S', totp_enabled_at: t0, created_at: t0 })
    put('users', { id: 'su-billy', email: 'billy@higgs.example', password_hash: 'x', name: 'Billy', role: 'editor', created_at: t0 })
    put('sessions', { id: 'ss1', user_id: 'su-wes', jti: 'j1', created_at: t0, last_seen_at: t0 })
    put('user_tokens', { id: 'ut1', user_id: 'su-billy', kind: 'password_reset', token_hash: 'h', expires_at: t0, created_at: t0 })

    // Photos: an R2 upload, a local-disk upload, a library photo on another site, and one whose file is gone.
    files('media/photos/hero-1.jpg', JPEG(1))
    files('uploads/photos/old-2.jpg', JPEG(2))
    files('media/photos/logo-1.png', PNG)
    files('images/badge.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))
    put('photos', { id: 'ph1', url: '/media/photos/hero-1.jpg', storage_key: 'photos/hero-1.jpg', alt: 'A finished kitchen', width: 1600, height: 900, bytes: 8, content_type: 'image/jpeg', tag: 'hero', created_at: t0 })
    put('photos', { id: 'ph2', url: '/uploads/photos/old-2.jpg', storage_key: 'photos/old-2.jpg', alt: null, content_type: 'image/jpeg', tag: null, created_at: t0 + 1 })
    put('photos', { id: 'ph3', url: 'https://images.pexels.com/photos/1/x.jpeg', storage_key: null, alt: 'Stock', created_at: t0 + 2 })
    put('photos', { id: 'ph4', url: '/media/photos/gone.jpg', storage_key: 'photos/gone.jpg', created_at: t0 + 3 })

    put('pages', { id: 'pg-home', slug: 'home', title: 'Home', is_published: 1, nav_order: 0, created_at: t0, updated_at: t0, sections: [
      { type: 'hero', variant: 'split', data: { title: 'Two Brothers. One Standard.', subtitle: 'Remodeling across Fort Worth.', image: '/media/photos/hero-1.jpg' } },
      { type: 'services', variant: 'cards-grid', data: { heading: 'What we do', items: [{ title: 'Kitchens', description: 'Full remodels.', image: '/uploads/photos/old-2.jpg' }, { title: 'Decks', description: 'Built to last.', image: 'https://images.pexels.com/photos/1/x.jpeg' }] } },
      { type: 'trust', variant: 'badges', data: { heading: 'Credentials', items: [{ name: 'Insured', image: '/images/badge.svg' }] } },
      { type: 'hero', variant: 'no-such-variant', data: { title: 'ghost' } },
    ] })
    put('pages', { id: 'pg-about', slug: 'about', title: 'About', is_published: 1, nav_order: 1, created_at: t0, updated_at: t0, meta_title: 'About the brothers',
      sections: [{ type: 'about', variant: 'story', data: { title: 'Two paths', paragraphs: ['Two paths, one business.'], portrait: '/media/photos/gone.jpg' } }] })
    put('pages', { id: 'pg-draft', slug: 'specials', title: 'Specials', is_published: 0, nav_order: 5, created_at: t0, updated_at: t0, sections: [] })
    put('posts', { id: 'po1', slug: 'kitchen-tips', title: 'Kitchen tips', excerpt: 'Five things.', body: 'Plan first.\n\n![Kitchen](/media/photos/hero-1.jpg)', cover_image_url: '/uploads/photos/old-2.jpg',
      status: 'published', published_at: t0, created_at: t0, updated_at: t0 })
    put('projects', { id: 'pj1', slug: 'keller-kitchen', title: 'Keller kitchen', location: 'Keller, TX', summary: 'A full gut.', body: 'Done in six weeks.', cover_image_url: '/media/photos/hero-1.jpg',
      photos: ['/media/photos/hero-1.jpg', '/uploads/photos/old-2.jpg'], status: 'published', sort_order: 0, published_at: t0, created_at: t0, updated_at: t0 })

    // Leads: one the forward delivered (the CRM has it, 5 s later), one it never reached, one the owner marked spam.
    put('leads', { id: 'sl1', name: 'Lena Lead', email: 'LENA@x.example', phone: '555-0101', message: 'Kitchen quote please', source: '/contact', status: 'replied', notes: 'Called back Tue', created_at: ms('2026-09-10T15:00:00') })
    put('leads', { id: 'sl2', name: 'Omar Orphan', email: 'omar@x.example', phone: null, message: 'Deck repair?', source: '/contact', status: 'new', created_at: ms('2026-09-11T09:00:00') })
    put('leads', { id: 'sl3', name: 'Spam Bot', email: 'bot@spam.example', message: 'Buy links', status: 'spam', created_at: ms('2026-09-12T09:00:00') })

    // Bookings: a service the CRM widget also had (same name, other case), and one of the site's own.
    put('booking_services', { id: 'ss-insp', slug: 'inspection', name: 'Roof  Inspection', duration_minutes: 60, price_cents: null, buffer_before_minutes: 10, buffer_after_minutes: 15, slot_granularity_minutes: 30,
      capacity_per_slot: 1, is_active: 1, display_order: 1, created_at: t0, updated_at: t0 })
    put('booking_services', { id: 'ss-est', slug: 'free-estimate', name: 'Free Estimate', description: 'On site, 1 hour', duration_minutes: 60, price_cents: 0, deposit_amount_cents: 2500,
      buffer_before_minutes: 0, buffer_after_minutes: 0, slot_granularity_minutes: 60, capacity_per_slot: 1, tip_presets_percent: [15, 20], is_active: 1, display_order: 0, rebook_interval_days: 365, created_at: t0, updated_at: t0 })
    put('booking_availability_rules', { id: 'r-mon', user_id: null, day_of_week: 1, start_minute: 480, end_minute: 1020, is_active: 1, created_at: t0 })
    put('booking_availability_rules', { id: 'r-tue', user_id: 'su-wes', day_of_week: 2, start_minute: 480, end_minute: 1020, is_active: 1, created_at: t0 })
    put('booking_availability_rules', { id: 'r-wed', user_id: null, day_of_week: 3, start_minute: 480, end_minute: 1020, is_active: 0, created_at: t0 })
    put('booking_availability_rules', { id: 'r-thu', user_id: 'su-billy', day_of_week: 4, start_minute: 540, end_minute: 900, is_active: 1, created_at: t0 })
    put('booking_blackouts', { id: 'bo-xmas', user_id: null, date: '2026-12-25', reason: 'Christmas', created_at: t0 })
    put('booking_blackouts', { id: 'bo-billy', user_id: 'su-billy', date: '2026-11-02', start_minute: 480, end_minute: 720, created_at: t0 })
    put('booking_service_zones', { id: 'z-wes', user_id: 'su-wes', zip_list: '76179, 76131', center_lat: '32.9', center_lng: '-97.4', radius_miles: 20, created_at: t0 })
    put('booking_service_zones', { id: 'z-billy', user_id: 'su-billy', zip_list: '76244', created_at: t0 })
    put('booking_series', { id: 'ser1', service_id: 'ss-est', frequency: 'biweekly', interval_count: 1, first_start_at: ms('2026-10-06T15:00:00'), occurrences_count: null,
      until_date: ms('2026-12-31T05:59:00'), customer_name: 'Pat Client', customer_email: 'pat@x.example', assigned_user_id: 'su-wes', confirmation_token: 'series-token-aaaaaaaaaaaaaaaaaaaaaa', status: 'active', created_at: t0, updated_at: t0 })
    put('bookings', { id: 'bk1', service_id: 'ss-insp', start_at: ms('2026-10-21T14:00:00'), end_at: ms('2026-10-21T15:00:00'), customer_name: 'Pat Client', customer_email: 'PAT@x.example',
      customer_zip: '76179', status: 'confirmed', assigned_user_id: 'su-wes', source: 'public_form', source_path: '/book/inspection', confirmation_token: 'tok-bk1-aaaaaaaaaaaaaaaaaaaaaaaaa',
      reminder_24h_sent_at: ms('2026-10-20T14:00:00'), review_request_sms_sent_at: null, external_calendar_event_id: 'gcal-evt-1', created_at: t0, updated_at: t0 })
    put('bookings', { id: 'bk2', service_id: 'ss-est', series_id: 'ser1', series_index: 1, start_at: ms('2026-10-06T15:00:00'), end_at: ms('2026-10-06T16:00:00'), customer_name: 'Pat Client',
      customer_email: 'pat@x.example', status: 'completed', source: 'series', confirmation_token: 'tok-bk2-aaaaaaaaaaaaaaaaaaaaaaaaa', review_request_sms_sent_at: ms('2026-10-07T12:00:00'), created_at: t0, updated_at: t0 })
    put('bookings', { id: 'bk3', service_id: 'ss-est', start_at: ms('2026-10-28T16:00:00'), end_at: ms('2026-10-28T17:00:00'), customer_name: 'Dee Deposit', customer_email: 'dee@x.example',
      status: 'confirmed', assigned_user_id: 'su-billy', source: 'admin_manual', confirmation_token: 'tok-bk3-aaaaaaaaaaaaaaaaaaaaaaaaa', deposit_amount_cents: 2500, deposit_status: 'pending', tip_amount_cents: 375, created_at: t0, updated_at: t0 })
    put('booking_waitlist', { id: 'w1', service_id: 'ss-insp', customer_name: 'Wait Er', customer_email: 'wait@x.example', preferred_from: '2026-10-20', status: 'converted', converted_booking_id: 'bk1', created_at: t0 })
    put('booking_bans', { id: 'ban1', email: 'no@x.example', phone: '5550199', reason: 'No-shows', added_by_user_id: 'su-wes', created_at: t0 })
    put('booking_webhooks', { id: 'wh1', url: 'https://hooks.example/b', secret: 'whsec', events: 'booking.created, booking.cancelled', is_active: 1, failure_count: 0, created_at: t0 })
    put('booking_calendar_connections', { id: 'cal1', user_id: 'su-wes', provider: 'google', external_account_email: 'wes@gmail.example', access_token: 'at', refresh_token: 'rt', created_at: t0 })
    put('page_views', { id: 'pv1', day: '2026-10-01', path: '/', count: 42 })
    put('page_views', { id: 'pv2', day: '2026-10-01', path: '/about', count: 7 })
    put('audit_log', { id: 'al1', user_id: 'su-wes', user_email: 'Wesley@Higgs.example', action: 'patch /pages/home', target: 'pages/home', ip: '1.2.3.4', meta: { field: 'sections' }, created_at: t0 })
    put('audit_log', { id: 'al2', user_id: null, user_email: 'x@y.example', action: 'login_failed', target: null, created_at: t0 + 1 })
    put('email_alias', { id: 'ea1', local_part: 'support', routing_mode: 'forward', forward_to: 'wes@hotmail.example', enabled: 1, created_at: t0, updated_at: t0 })
    put('email_alias', { id: 'ea2', local_part: 'info', routing_mode: 'forward', forward_to: 'wes@hotmail.example', enabled: 1, created_at: t0, updated_at: t0 })
    site.db.close()

    // What the CRM move made (move-crm-steps.test.ts covers how).
    dst = await unifiedDb()
    const crm = putter(dst)
    await crm('company', { id: 'co1', name: 'Higgs Heritage Builders', slug: 'higgs', phone: '817-888-5135', email: 'office@higgs.example', logo: null, primary_color: '#B22234', enabled_features: JSON.stringify(['lead_inbox', 'online_booking']) })
    await crm('user', { id: 'u-wes', company_id: 'co1', email: 'wesley@higgs.example', first_name: 'Wesley', last_name: 'Higgs', role: 'owner' })
    await crm('contact', { id: 'c-pat', company_id: 'co1', name: 'Pat Client', type: 'client', email: 'pat@x.example', created_at: '2026-08-01 10:00:00' })
    await crm('lead', { id: 'crm-l1', company_id: 'co1', source_platform: 'website', homeowner_name: 'Lena Lead', email: 'lena@x.example', description: 'Kitchen quote please', received_at: '2026-09-10 15:00:05', raw_payload: JSON.stringify({ source: 'website' }) })
    await crm('booking_settings', { id: 'bs-crm', company_id: 'co1', timezone: 'America/Chicago', hero_title: 'Book online' })
    await crm('booking_hours', { id: 'bh_bs-crm_1', company_id: 'co1', user_id: null, day_of_week: 1, start_minute: 540, end_minute: 960 })
    await crm('booking_service', { id: 's-crm', company_id: 'co1', slug: 'roof-inspection', name: 'Roof inspection', duration_minutes: 90, slot_step_minutes: 30, capacity: 1, active: true })
    await crm('booking', { id: 'b-crm', company_id: 'co1', service_id: 's-crm', start_at: '2026-09-01 15:00:00', end_at: '2026-09-01 16:30:00', customer_name: 'Old', customer_email: 'old@x.example', token: 'crm-token' })
    await crm('email_alias', { id: 'crm-ea', local_part: 'support', routing_mode: 'forward', forward_to: 'whiggs@hotmail.example' })

    store = memoryStore()
    report = await moveSite({ siteDb: site.file, files: filesFromDir(site.filesDir), write: dst.query, store, knownSection })
    get = siteOn(dst, store, await loadVertical('contractor'))
  }, 300_000)

  test('the move matches and every step reported', () => {
    expect(report.mismatches).toEqual([])
    expect(report.steps.map((s) => s.step)).toEqual(['site: company', 'site: photos', 'site: website settings', 'site: pages, posts, portfolio', 'site: leads',
      'site: booking settings, hours, days off, zones', 'site: booking services', 'site: bookings', 'site: booking bans and webhooks', 'site: page views and audit log', 'site: not moved', 'site: counts'])
  })

  test('the moved site renders: home, a page, a post, a project — with every photo at its new address, and the photos served', async () => {
    const home = await (await get('/')).text()
    expect(home).toContain('Two Brothers. One Standard.')
    // The hero is at its new address — the original, or its sized copy (the speed round: /img/<width>/media/<key>).
    expect(home).toMatch(/url\(['"]\/(img\/\d+\/)?media\/photos\/hero-1\.jpg['"]\)/)
    expect(home).toContain("url('/media/photos/old-2.jpg')")
    // The badges view draws an icon, not the image; the stored section carries the new address.
    expect(JSON.stringify((await one(`SELECT sections FROM page WHERE slug = 'home'`)).sections)).toContain('"image":"/media/photos/site/images/badge.svg"')
    expect(home).toContain('https://images.pexels.com/photos/1/x.jpeg')
    expect(home).toContain('Higgs Heritage Builders')
    expect(home).not.toContain('/uploads/')
    const about = await get('/about')
    expect(about.status).toBe(200)
    expect(await about.text()).toContain('Two paths, one business.')
    expect((await get('/specials')).status).toBe(404) // unpublished stays unpublished
    const post = await (await get('/blog/kitchen-tips')).text()
    expect(post).toContain('src="/media/photos/old-2.jpg"')
    expect(post).toContain('/media/photos/hero-1.jpg')
    const proj = await get('/projects/keller-kitchen')
    expect(proj.status).toBe(200)
    expect(await proj.text()).toContain('Keller kitchen')
    const img = await get('/media/photos/hero-1.jpg')
    expect(img.status).toBe(200)
    expect(img.headers.get('content-type')).toBe('image/jpeg')
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(JPEG(1))
    expect(new Uint8Array(await (await get('/media/photos/old-2.jpg')).arrayBuffer())).toEqual(JPEG(2))
    expect((await get('/media/photos/logo-1.png')).headers.get('content-type')).toBe('image/png')
    // An SVG shows as an image (the moved badge), never runs or loads anything when opened directly.
    const svg = await get('/media/photos/site/images/badge.svg')
    expect(svg.headers.get('content-type')).toBe('image/svg+xml')
    expect(svg.headers.get('content-disposition')).toBeNull()
    expect(svg.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox")
  })

  test('the photo library: rows for the stored files, a missing file kept and reported, the off-site one left out', async () => {
    expect((await dst.query(`SELECT id, filename, public_url, is_public, alt, tags FROM photo ORDER BY created_at`)).rows).toEqual([
      { id: 'ph1', filename: 'photos/hero-1.jpg', public_url: '/media/photos/hero-1.jpg', is_public: true, alt: 'A finished kitchen', tags: ['hero'] },
      { id: 'ph2', filename: 'photos/old-2.jpg', public_url: '/media/photos/old-2.jpg', is_public: true, alt: null, tags: [] },
      { id: 'ph4', filename: 'photos/gone.jpg', public_url: '/media/photos/gone.jpg', is_public: true, alt: null, tags: [] },
    ])
    expect([...store.objects.keys()].sort()).toEqual(['photos/hero-1.jpg', 'photos/logo-1.png', 'photos/old-2.jpg', 'photos/site/images/badge.svg'])
    expect(did('site: photos')).toContain('1 row(s) name a file on another site')
    expect(did('site: photos')).toContain('/media/photos/gone.jpg')
    expect(did('site: photos')).toContain('/images/badge.svg (image/svg+xml)')
    // The page that named the missing file still names it (it was missing before the move too).
    expect(JSON.stringify((await one(`SELECT sections FROM page WHERE slug = 'about'`)).sections)).toContain('/media/photos/gone.jpg')
  })

  test("settings: the site's own on the website row, the CRM's company facts kept, empty ones filled, differences said", async () => {
    expect(await one(`SELECT tagline, seo_title, nav, service_areas, contact_cta_label, accent_color, google_analytics_id, customizer_token FROM website WHERE company_id = 'co1'`)).toEqual({
      tagline: 'Two Brothers. One Standard.', seo_title: 'Remodeling in Fort Worth', nav: [{ label: 'About', href: '/about' }, { label: 'Blog', href: '/blog' }], service_areas: ['Fort Worth', 'Keller'],
      contact_cta_label: 'Free estimate', accent_color: '#C9A227', google_analytics_id: 'G-TEST123', customizer_token: 'cust-tok',
    })
    // The site's one-line address goes in as street, city and state — which the site prints joined again, the same line.
    expect(await one(`SELECT name, phone, address, city, state, logo, primary_color, secondary_color FROM company`)).toEqual({
      name: 'Higgs Heritage Builders', phone: '817-888-5135', address: '7061 Example Lane', city: 'Fort Worth', state: 'TX', logo: '/media/photos/logo-1.png', primary_color: '#B22234', secondary_color: '#0B0B0B',
    })
    const d = did('site: company')
    expect(d).toContain(`name: the CRM's "Higgs Heritage Builders" kept, the site had "Higgs-like Builders LLC"`)
    expect(d).toContain('filled from the site: secondary colour, address')
    expect(d).toContain('1 matched a CRM user by email, 1 not (billy@higgs.example (editor))')
    expect(d).toContain('two-factor on the site (Wesley@Higgs.example) does not carry')
    expect(did('site: website settings')).toContain('crm_url, crm_ready_at end')
    expect(did('site: pages, posts, portfolio')).toContain('hero/no-such-variant')
    expect(did('site: pages, posts, portfolio')).not.toContain('hero/split')
  })

  test('leads: the forwarded one not doubled (the site inbox status added to it), the lost one into the Lead Inbox', async () => {
    const rows = (await dst.query(`SELECT id, homeowner_name, status, raw_payload FROM lead ORDER BY received_at`)).rows
    expect(rows.map((r: any) => [r.id, r.status])).toEqual([['crm-l1', 'new'], ['sl2', 'new'], ['sl3', 'dismissed']])
    expect(rows[0].raw_payload).toEqual({ source: 'website', siteInbox: { status: 'replied', notes: 'Called back Tue' } })
    expect(did('site: leads')).toBe('3 lead(s): 1 already in the CRM (its forward reached it), 2 into the Lead Inbox, 0 as lead contacts')
  })

  test("booking settings and hours: the site's words, drive time and feed token; its hours replace the CRM widget's", async () => {
    expect(await one(`SELECT hero_title, thanks_message, drive_time_minutes, ical_feed_token, timezone FROM booking_settings`)).toEqual({
      hero_title: 'Book a free estimate', thanks_message: 'See you soon.', drive_time_minutes: 15, ical_feed_token: 'ical-tok-1', timezone: 'America/Chicago',
    })
    expect((await dst.query(`SELECT user_id, day_of_week, start_minute, end_minute FROM booking_hours ORDER BY day_of_week`)).rows).toEqual([
      { user_id: null, day_of_week: 1, start_minute: 480, end_minute: 1020 },
      { user_id: 'u-wes', day_of_week: 2, start_minute: 480, end_minute: 1020 },
      { user_id: null, day_of_week: 4, start_minute: 540, end_minute: 900 },
    ])
    const d = did('site: booking settings, hours, days off, zones')
    expect(d).toContain(`replacing the CRM widget's hero_title "Book online"`)
    expect(d).toContain(`"anyone" opening window(s) replaced`)
    expect(d).toContain('1 switched-off hour rule(s) not moved')
    expect(d).toContain('hours of billy@higgs.example (no account) moved as "anyone"')
    expect((await dst.query(`SELECT date, user_id FROM booking_blackout`)).rows).toEqual([{ date: '2026-12-25', user_id: null }])
    expect((await dst.query(`SELECT user_id, zips FROM booking_zone`)).rows).toEqual([{ user_id: 'u-wes', zips: ['76179', '76131'] }])
    expect(d).toContain('1 of a person with no account not moved (2026-11-02 (billy@higgs.example))')
    expect(d).toContain('1 had a centre/radius')
  })

  test("booking services: the CRM's same-named one kept once with the site's rules and address; the site's own added in dollars", async () => {
    expect((await dst.query(`SELECT id, slug, name, duration_minutes, price::text AS price, deposit_amount::text AS dep, buffer_before_minutes AS bb, buffer_after_minutes AS ba, slot_step_minutes AS step,
        tip_presets, rebook_interval_days AS rebook, active FROM booking_service ORDER BY sort_order`)).rows).toEqual([
      { id: 'ss-est', slug: 'free-estimate', name: 'Free Estimate', duration_minutes: 60, price: '0.00', dep: '25.00', bb: 0, ba: 0, step: 60, tip_presets: [15, 20], rebook: 365, active: true },
      { id: 's-crm', slug: 'inspection', name: 'Roof  Inspection', duration_minutes: 60, price: null, dep: null, bb: 10, ba: 15, step: 30, tip_presets: null, rebook: null, active: true },
    ])
    expect(await one(`SELECT service_id FROM booking WHERE id = 'b-crm'`)).toEqual({ service_id: 's-crm' })
    expect(did('site: booking services')).toContain('"Roof  Inspection" → s-crm')
  })

  test('bookings, series, waitlist: tokens kept (the customer links work), cents to dollars, sources, contacts, the series every 2 weeks', async () => {
    const b = (await dst.query(`SELECT id, service_id, contact_id, series_id, to_char(start_at, 'YYYY-MM-DD HH24:MI') AS s, status, assigned_user_id AS who, source, token, deposit_amount::text AS dep,
        deposit_status AS ds, tip_amount::text AS tip, to_char(reminder_email_sent_at, 'YYYY-MM-DD HH24:MI') AS rem, review_request_sent_at IS NOT NULL AS reviewed, external_event_id AS ev, external_provider AS prov
        FROM booking WHERE id LIKE 'bk%' ORDER BY id`)).rows
    expect(b).toEqual([
      { id: 'bk1', service_id: 's-crm', contact_id: 'c-pat', series_id: null, s: '2026-10-21 14:00', status: 'confirmed', who: 'u-wes', source: 'public', token: 'tok-bk1-aaaaaaaaaaaaaaaaaaaaaaaaa', dep: null, ds: 'none', tip: null, rem: '2026-10-20 14:00', reviewed: false, ev: 'gcal-evt-1', prov: 'google' },
      { id: 'bk2', service_id: 'ss-est', contact_id: 'c-pat', series_id: 'ser1', s: '2026-10-06 15:00', status: 'completed', who: null, source: 'series', token: 'tok-bk2-aaaaaaaaaaaaaaaaaaaaaaaaa', dep: null, ds: 'none', tip: null, rem: null, reviewed: true, ev: null, prov: null },
      { id: 'bk3', service_id: 'ss-est', contact_id: null, series_id: null, s: '2026-10-28 16:00', status: 'confirmed', who: null, source: 'staff', token: 'tok-bk3-aaaaaaaaaaaaaaaaaaaaaaaaa', dep: '25.00', ds: 'pending', tip: '3.75', rem: null, reviewed: false, ev: null, prov: null },
    ])
    expect(await one(`SELECT frequency, interval_count, until_date, token, assigned_user_id FROM booking_series`)).toEqual({ frequency: 'weekly', interval_count: 2, until_date: '2026-12-30', token: 'series-token-aaaaaaaaaaaaaaaaaaaaaa', assigned_user_id: 'u-wes' })
    expect(await one(`SELECT status, booking_id FROM booking_waitlist`)).toEqual({ status: 'booked', booking_id: 'bk1' })
    const d = did('site: bookings')
    expect(d).toContain('1 with a deposit checkout still open (bk3)')
    expect(d).toContain('assigned to a person with no account (billy@higgs.example): left unassigned')
    // The customer's link opens their booking on the unified site.
    expect((await get('/booking/tok-bk1-aaaaaaaaaaaaaaaaaaaaaaaaa')).status).toBe(200)
  })

  test('bans, webhooks, visits, audit; aliases, sign-ins and calendars stay behind and are said', async () => {
    expect(await one(`SELECT email, phone, added_by_user_id FROM booking_ban`)).toEqual({ email: 'no@x.example', phone: '5550199', added_by_user_id: 'u-wes' })
    expect(await one(`SELECT url, secret, events, active FROM booking_webhook`)).toEqual({ url: 'https://hooks.example/b', secret: 'whsec', events: ['booking.created', 'booking.cancelled'], active: true })
    expect((await dst.query(`SELECT day, path, count FROM page_view WHERE day = '2026-10-01' ORDER BY path`)).rows).toEqual([{ day: '2026-10-01', path: '/', count: 42 }, { day: '2026-10-01', path: '/about', count: 7 }])
    expect((await dst.query(`SELECT action, entity, entity_id, user_id, user_email, metadata FROM audit_log ORDER BY created_at`)).rows).toEqual([
      { action: 'patch /pages/home', entity: 'website', entity_id: 'pages/home', user_id: 'u-wes', user_email: 'Wesley@Higgs.example', metadata: { field: 'sections' } },
      { action: 'login_failed', entity: 'website', entity_id: null, user_id: null, user_email: 'x@y.example', metadata: null },
    ])
    expect((await dst.query(`SELECT local_part, forward_to FROM email_alias`)).rows).toEqual([{ local_part: 'support', forward_to: 'whiggs@hotmail.example' }])
    const d = did('site: not moved')
    expect(d).toContain('info@ → wes@hotmail.example')
    expect(d).toContain('1 site session(s) and 1 reset/verify link(s) end')
    expect(d).toContain('1 calendar connection(s) not moved (google wes@gmail.example for Wesley@Higgs.example)')
  })

  test('a failure part-way leaves nothing: no rows, no files', async () => {
    const fresh = await unifiedDb()
    await putter(fresh)('company', { id: 'co1', name: 'Higgs Heritage Builders', slug: 'higgs', enabled_features: '[]' })
    // A page the target already has: the pages step meets it after the photos were copied.
    await putter(fresh)('page', { id: 'pg-other', company_id: 'co1', slug: 'about', title: 'Already here' })
    const s2 = memoryStore()
    await expect(moveSite({ siteDb: site.file, files: filesFromDir(site.filesDir), write: fresh.query, store: s2 })).rejects.toThrow()
    expect(s2.objects.size).toBe(0)
    expect((await fresh.query(`SELECT (SELECT count(*) FROM photo)::int AS p, (SELECT count(*) FROM website)::int AS w, (SELECT count(*) FROM page)::int AS pg`)).rows[0]).toEqual({ p: 0, w: 0, pg: 1 })
    await fresh.db.close()
  }, 120_000)
})

describe('a bar site (website-premium-bar) beside crm-bar, Lead Inbox off', () => {
  let dst: Db
  let report: SiteMoveReport
  let get: (p: string) => Promise<Response> | Response
  const site = siteDb('website-premium-bar')

  beforeAll(async () => {
    const { put } = site
    const t0 = ms('2026-10-01T18:00:00')
    put('settings', { id: 's1', company_name: 'Amber-like Inn', tagline: 'Cold taps, warm room.', phone: '715-555-0100', service_areas: [], nav: [{ label: 'Visit', href: '/visit' }],
      photo_credits: [], content_gaps: [], contact_cta_label: 'Plan a party', primary_color: '#8a4b14', updated_at: t0 })
    put('users', { id: 'su1', email: 'owner@amber.example', password_hash: 'x', role: 'admin', created_at: t0 })
    put('pages', { id: 'p-home', slug: 'home', title: 'Home', is_published: 1, nav_order: 0, created_at: t0, updated_at: t0, sections: [
      { type: 'hero', variant: 'full-bleed', data: { title: 'Amber-like Inn', subtitle: 'Opening soon on Main Street.', image: 'https://images.pexels.com/photos/2/bar.jpeg' } },
      { type: 'tonight', variant: 'board', data: {} },
      { type: 'jukebox', variant: 'queue', data: {} },
    ] })
    put('pages', { id: 'p-visit', slug: 'visit', title: 'Visit', is_published: 1, nav_order: 1, created_at: t0, updated_at: t0,
      sections: [{ type: 'about', variant: 'story', data: { title: 'Find us', paragraphs: ['Main Street, next to the mill.'] } }] })
    // One party request the CRM got as a lead contact, one it did not.
    put('leads', { id: 'bl1', name: 'Party Pat', email: 'pp@x.example', message: 'Birthday for 20', status: 'new', created_at: ms('2026-10-05T20:00:00') })
    put('leads', { id: 'bl2', name: 'Quiet Quinn', email: 'qq@x.example', message: 'Do you do trivia?', status: 'closed', notes: 'Told her Thursdays', created_at: ms('2026-10-06T20:00:00') })
    site.db.close()

    dst = await unifiedDb()
    const crm = putter(dst)
    await crm('company', { id: 'bar1', name: 'Amber-like Inn', slug: 'amber', phone: '715-555-0100', primary_color: '#8a4b14', logo: '/logo.svg', enabled_features: '[]' })
    await crm('user', { id: 'u1', company_id: 'bar1', email: 'owner@amber.example', first_name: 'Bo', last_name: 'Owner', role: 'owner' })
    await crm('contact', { id: 'c-pp', company_id: 'bar1', name: 'Party Pat', type: 'lead', email: 'pp@x.example', source: 'website', created_at: '2026-10-05 20:00:02' })
    report = await moveSite({ siteDb: site.file, files: filesFromDir(site.filesDir), write: dst.query, store: memoryStore(), knownSection })
    get = siteOn(dst, memoryStore(), await loadVertical('bar'))
  }, 300_000)

  test('the move matches; pages render; a section the unified site has no view for is named', async () => {
    expect(report.mismatches).toEqual([])
    const home = await get('/')
    expect(home.status).toBe(200)
    const html = await home.text()
    expect(html).toContain('Opening soon on Main Street.')
    expect(html).toContain('https://images.pexels.com/photos/2/bar.jpeg')
    expect(await (await get('/visit')).text()).toContain('next to the mill')
    const pages = report.steps.find((s) => s.step === 'site: pages, posts, portfolio')!.did
    expect(pages).toContain('jukebox/queue')
    expect(pages).not.toContain('hero/full-bleed')
    expect(await (async () => (await dst.query(`SELECT logo, primary_color FROM company`)).rows[0])()).toEqual({ logo: '/logo.svg', primary_color: '#8a4b14' })
  })

  test('leads with the Lead Inbox off: the forwarded one not doubled, the other a lead contact carrying the site notes; no booking rows made', async () => {
    expect((await dst.query(`SELECT id, name, type, notes FROM contact ORDER BY created_at`)).rows).toEqual([
      { id: 'c-pp', name: 'Party Pat', type: 'lead', notes: null },
      { id: 'bl2', name: 'Quiet Quinn', type: 'lead', notes: 'Do you do trivia?\n\nWebsite inbox notes: Told her Thursdays' },
    ])
    expect((await dst.query(`SELECT count(*)::int AS n FROM lead`)).rows[0].n).toBe(0)
    expect((await dst.query(`SELECT (SELECT count(*) FROM booking_settings)::int AS s, (SELECT count(*) FROM booking_service)::int AS v`)).rows[0]).toEqual({ s: 0, v: 0 })
  })
})
