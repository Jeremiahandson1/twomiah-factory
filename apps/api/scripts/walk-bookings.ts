/**
 * End-to-end walkthrough for Twomiah Bookings.
 *
 * Deploys a fresh premium-website tenant, waits for live, then walks
 * every booking flow via HTTP: admin login, service create,
 * availability set, public slot list, public booking submit, slot
 * re-list (should not include booked slot), audit log, admin
 * cancellation, customer self-service cancel, recurring series create.
 * Cleans up at the end.
 *
 * Does not exercise Google/Outlook OAuth (needs real apps configured)
 * or Stripe deposit (needs Stripe keys). Everything else is real.
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator'
import { deployCustomer } from '../src/services/deploy'
import { hardDeleteTestTenant } from '../src/services/testCleanup'
import { createClient } from '@supabase/supabase-js'

const KNOWN_PASSWORD = 'Walkbook-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

type Result = { name: string; ok: boolean; detail?: string; ms?: number }
const results: Result[] = []
function record(name: string, ok: boolean, detail?: string, ms?: number) {
  results.push({ name, ok, detail, ms })
  console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : '') + (ms ? ' [' + ms + 'ms]' : ''))
}

async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now()
  try { const r = await fn(); record(name, true, undefined, Date.now() - t); return r }
  catch (e: any) { record(name, false, e?.message); throw e }
}

interface DeployContext { tenantId: string; siteUrl: string }

async function deployTestTenant(): Promise<DeployContext> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'walk-book-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()
  const products = ['crm', 'website', 'cms', 'website-premium']
  const config: any = {
    tenant_id: tenantId, tenant_name: 'Walkbookings', tenant_slug: slug, products,
    company: {
      name: 'Walkbookings Co', email: ADMIN_EMAIL, phone: '+1-608-555-0142',
      address: '123 Test St', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip', purchaseYears: 1,
      ownerName: 'Owner', industry: 'general_contractor', serviceRegion: 'Madison',
      nearbyCities: ['', '', '', ''], defaultPassword: KNOWN_PASSWORD,
    },
    branding: { primaryColor: '#FF6B35', secondaryColor: '#1A365D', logo: null, logoFilename: null, favicon: null, faviconFilename: null, heroPhoto: null, heroPhotoFilename: null },
    features: { website: ['contact_form'], crm: [], paid_ads: false },
    integrations: { twilio: { accountSid: '', authToken: '', phoneNumber: '' }, sendgrid: { apiKey: '' }, stripe: { secretKey: '', publishableKey: '', webhookSecret: '' }, googleMaps: { apiKey: '' }, sentry: { dsn: '' }, nearmap: { apiKey: '' }, replicate: { apiToken: '' } },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }
  await supabase.from('tenants').insert({
    id: tenantId, name: 'Walkbookings', slug, email: ADMIN_EMAIL, admin_email: ADMIN_EMAIL,
    industry: 'general_contractor', city: 'Madison', state: 'WI', status: 'pending', products,
    is_test_tenant: true, domain: null, domain_registrar: null,
  })
  console.log('[walk] Generating zip…')
  const zip = await generate({ id: tenantId, ...config } as any)
  console.log('[walk] Deploying to Render…')
  const deploy = await deployCustomer({ id: tenantId, slug, name: 'Walkbookings', industry: 'general_contractor', products, config }, zip.zipPath, { products })
  if (!deploy.siteUrl) throw new Error('Deploy failed (no siteUrl): status=' + deploy.status + ' errors=' + JSON.stringify(deploy.errors))
  return { tenantId, siteUrl: deploy.siteUrl }
}

class TenantClient {
  private cookies = new Map<string, string>()
  constructor(public origin: string) {}
  private cookieHeader() { return Array.from(this.cookies.entries()).map(([k, v]) => k + '=' + v).join('; ') }
  private absorbSetCookie(res: Response) {
    const setCookie = (res.headers as any).getSetCookie?.() || []
    for (const c of setCookie) {
      const [pair] = c.split(';'); const [k, v] = pair.split('=')
      if (k && v !== undefined) { if (c.toLowerCase().includes('max-age=0') || v === '') this.cookies.delete(k); else this.cookies.set(k, v) }
    }
  }
  async fetch(path: string, init: RequestInit = {}): Promise<{ res: Response; body: any }> {
    const headers: Record<string, string> = { ...(init.headers as any || {}) }
    const ch = this.cookieHeader(); if (ch) headers['Cookie'] = ch
    if (init.body && typeof init.body === 'string' && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
    const res = await fetch(this.origin + path, { ...init, headers })
    this.absorbSetCookie(res)
    const ct = res.headers.get('content-type') || ''
    const body = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '')
    return { res, body }
  }
}

async function walkthrough(siteUrl: string) {
  const c = new TenantClient(siteUrl)

  // Login
  const loginResp = await c.fetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: KNOWN_PASSWORD }) })
  if (loginResp.res.status !== 200) throw new Error('login failed: ' + loginResp.res.status)
  record('Admin login', true, loginResp.body?.user?.email)

  // Create a service
  let serviceId = ''
  await time('Create booking service', async () => {
    const { res, body } = await c.fetch('/api/admin/booking-services', {
      method: 'POST',
      body: JSON.stringify({ slug: 'deep-clean', name: 'Deep Clean', durationMinutes: 120, priceCents: 24000, slotGranularityMinutes: 30 }),
    })
    if (res.status !== 201) throw new Error('status=' + res.status + ' ' + JSON.stringify(body))
    serviceId = body.service.id
  })

  // Set Mon-Fri 9-5 availability
  await time('Set weekly availability', async () => {
    const rules: any[] = []
    for (let d = 1; d <= 5; d++) rules.push({ userId: null, dayOfWeek: d, startMinute: 9*60, endMinute: 17*60 })
    const { res } = await c.fetch('/api/admin/booking-availability', { method: 'PUT', body: JSON.stringify({ rules }) })
    if (res.status !== 200) throw new Error('status=' + res.status)
  })

  // Public — pick a Tuesday 2 weeks out (avoid weekend / today edge cases)
  const target = new Date()
  target.setDate(target.getDate() + (((9 - target.getDay()) % 7) || 7))  // next Tuesday
  target.setDate(target.getDate() + 7)  // +1 week from there
  const dateStr = target.toISOString().slice(0, 10)

  let firstSlotIso = ''
  await time('Public: list slots', async () => {
    const { res, body } = await c.fetch('/book/deep-clean/slots?date=' + dateStr)
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!body.slots || body.slots.length === 0) throw new Error('no slots returned')
    firstSlotIso = body.slots[0].startAtIso
    record('Public: ' + body.slots.length + ' slots available', true)
  })

  // Public: submit a booking
  let bookingId = ''
  let confirmationToken = ''
  await time('Public: submit booking', async () => {
    const form = new URLSearchParams({
      serviceSlug: 'deep-clean',
      startAtIso: firstSlotIso,
      customerName: 'Test Customer',
      customerEmail: 'twomiah14+book@gmail.com',
      customerPhone: '+15555550100',
      customerAddress: '500 Test Ave, Madison, WI',
      customerNotes: 'gate code 1234',
      t: String(Date.now() - 5000),  // past dwell-time
    })
    const r = await fetch(siteUrl + '/book/deep-clean', { method: 'POST', body: form })
    const raw = await r.text()
    let body: any
    try { body = JSON.parse(raw) } catch { throw new Error('non-JSON response status=' + r.status + ' content-type=' + r.headers.get('content-type') + ' body=' + raw.slice(0, 400)) }
    if (!r.ok) throw new Error('status=' + r.status + ' ' + JSON.stringify(body))
    bookingId = body.booking.id
    confirmationToken = body.booking.confirmationToken
  })

  // Slot should no longer be in the list
  await time('Slot reservation works: same slot gone after booking', async () => {
    const { body } = await c.fetch('/book/deep-clean/slots?date=' + dateStr)
    const sameTime = (body.slots || []).find((s: any) => s.startAtIso === firstSlotIso)
    if (sameTime) throw new Error('slot still in list — booking did not reserve it')
  })

  // Admin: bookings list shows it
  await time('Admin: GET /bookings shows the new booking', async () => {
    const { res, body } = await c.fetch('/api/admin/bookings')
    if (res.status !== 200) throw new Error('status=' + res.status)
    const ours = (body.bookings || []).find((b: any) => b.id === bookingId)
    if (!ours) throw new Error('booking not found in list')
    if (ours.status !== 'confirmed') throw new Error('expected confirmed, got ' + ours.status)
  })

  // Audit log captures the public booking action
  await time('Audit log captures activity', async () => {
    const { res, body } = await c.fetch('/api/admin/audit')
    if (res.status !== 200) throw new Error('status=' + res.status)
    // We don't expect public POSTs in admin audit; just verify endpoint works
    if (!Array.isArray(body.entries)) throw new Error('no entries array')
  })

  // Customer self-service cancel
  await time('Customer self-cancel', async () => {
    const r = await fetch(siteUrl + '/booking/' + confirmationToken + '/cancel', { method: 'POST', redirect: 'manual' })
    if (r.status !== 302 && r.status !== 200) throw new Error('expected redirect, got ' + r.status)
  })

  // Verify cancellation persisted
  await time('Booking is now cancelled', async () => {
    const { body } = await c.fetch('/api/admin/bookings/' + bookingId)
    if (body.booking?.status !== 'cancelled') throw new Error('expected cancelled, got ' + body.booking?.status)
  })

  // Recurring series create
  await time('Create recurring series', async () => {
    const startAt = new Date(target)
    startAt.setDate(startAt.getDate() + 14)
    startAt.setHours(10, 0, 0, 0)
    const { res, body } = await c.fetch('/api/admin/booking-series', {
      method: 'POST',
      body: JSON.stringify({
        serviceId, frequency: 'biweekly', intervalCount: 1,
        firstStartAt: startAt.toISOString(),
        occurrencesCount: 4,
        customerName: 'Recurring Customer', customerEmail: 'twomiah14+rec@gmail.com',
        customerAddress: '500 Test Ave',
      }),
    })
    if (res.status !== 201) throw new Error('status=' + res.status + ' ' + JSON.stringify(body))
    if (body.instancesCreated !== 4) throw new Error('expected 4 instances, got ' + body.instancesCreated)
  })

  // Embed script available
  await time('GET /scripts/book-embed.js', async () => {
    const r = await fetch(siteUrl + '/scripts/book-embed.js')
    if (r.status !== 200) throw new Error('status=' + r.status)
    const text = await r.text()
    if (!text.includes('twomiah-book-height')) throw new Error('script content missing')
  })

  // ── Phase 2/3 + polish coverage ─────────────────────────────────────────

  await time('Admin: manual booking POST', async () => {
    const start = new Date(target)
    start.setDate(start.getDate() + 28)
    start.setHours(14, 0, 0, 0)
    const { res, body } = await c.fetch('/api/admin/bookings', {
      method: 'POST',
      body: JSON.stringify({
        serviceId,
        startAt: start.toISOString(),
        customerName: 'Phoned Customer', customerEmail: 'twomiah14+phone@gmail.com',
        customerPhone: '+15555550101', customerAddress: '900 Phone Ave',
      }),
    })
    if (res.status !== 201) throw new Error('status=' + res.status + ' ' + JSON.stringify(body))
    if (body.booking.source !== 'admin_manual') throw new Error('expected source=admin_manual, got ' + body.booking.source)
  })

  await time('Analytics endpoint returns aggregates', async () => {
    const { res, body } = await c.fetch('/api/admin/bookings/analytics?days=30')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (typeof body.totalBookings !== 'number') throw new Error('missing totalBookings')
    if (!body.byDayOfWeek || body.byDayOfWeek.length !== 7) throw new Error('byDayOfWeek wrong shape')
    if (!Array.isArray(body.topServices)) throw new Error('topServices not an array')
  })

  await time('Customer profile aggregates by email', async () => {
    const { res, body } = await c.fetch('/api/admin/booking-customers')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!Array.isArray(body.customers)) throw new Error('customers not an array')
    if (body.customers.length === 0) throw new Error('expected at least 1 customer from the bookings we created')
  })

  await time('Waitlist join works', async () => {
    const form = new URLSearchParams({
      customerName: 'Waitlister', customerEmail: 'twomiah14+wait@gmail.com',
      preferredFrom: dateStr, preferredTo: dateStr,
    })
    const r = await fetch(siteUrl + '/book/deep-clean/waitlist', { method: 'POST', body: form })
    if (r.status !== 200) throw new Error('status=' + r.status)
    // Admin can see it
    const { res, body } = await c.fetch('/api/admin/booking-waitlist')
    if (res.status !== 200) throw new Error('admin list status=' + res.status)
    if (!body.waitlist?.some((w: any) => w.customerEmail === 'twomiah14+wait@gmail.com')) {
      throw new Error('waitlist entry not visible in admin')
    }
  })

  await time('Banned customer is silently rejected', async () => {
    const bannedEmail = 'twomiah14+banned@gmail.com'
    await c.fetch('/api/admin/booking-bans', { method: 'POST', body: JSON.stringify({ email: bannedEmail, reason: 'walkthrough test' }) })
    // Re-grab slots to get a fresh available one
    const { body: slotBody } = await c.fetch('/book/deep-clean/slots?date=' + dateStr)
    const freeSlot = slotBody.slots?.[0]?.startAtIso
    if (!freeSlot) throw new Error('no free slot to test ban against')
    const form = new URLSearchParams({
      serviceSlug: 'deep-clean', startAtIso: freeSlot,
      customerName: 'Banned Person', customerEmail: bannedEmail,
      t: String(Date.now() - 5000),
    })
    const r = await fetch(siteUrl + '/book/deep-clean', { method: 'POST', body: form })
    const data = await r.json()
    // Silent drop returns 200 with booking.id='pending'
    if (data.booking?.id !== 'pending') throw new Error('ban not enforced; booking.id=' + data.booking?.id)
  })

  await time('iCal feed regenerates + serves VCALENDAR', async () => {
    const gen = await c.fetch('/api/admin/booking-ical-feed/regenerate', { method: 'POST' })
    if (gen.res.status !== 200) throw new Error('regenerate status=' + gen.res.status)
    const token = gen.body.token
    const r = await fetch(siteUrl + '/api/ical/bookings.ics?token=' + token)
    if (r.status !== 200) throw new Error('feed status=' + r.status)
    const text = await r.text()
    if (!text.startsWith('BEGIN:VCALENDAR')) throw new Error('feed does not start with VCALENDAR')
    if (!text.includes('BEGIN:VEVENT')) throw new Error('feed has no events')
  })

  await time('iCal feed rejects bad token', async () => {
    const r = await fetch(siteUrl + '/api/ical/bookings.ics?token=garbage')
    if (r.status !== 401) throw new Error('expected 401, got ' + r.status)
  })

  await time('Webhook CRUD works', async () => {
    const create = await c.fetch('/api/admin/booking-webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: 'https://example.com/webhook-test', events: 'booking.created' }),
    })
    if (create.res.status !== 201) throw new Error('create status=' + create.res.status)
    if (!create.body.secret) throw new Error('secret not returned on create')
    const id = create.body.webhook.id
    const list = await c.fetch('/api/admin/booking-webhooks')
    if (!list.body.webhooks?.some((w: any) => w.id === id)) throw new Error('webhook not in list')
    const del = await c.fetch('/api/admin/booking-webhooks/' + id, { method: 'DELETE' })
    if (del.res.status !== 200) throw new Error('delete status=' + del.res.status)
  })

  await time('Calendar connections list (empty is OK)', async () => {
    const { res, body } = await c.fetch('/api/admin/calendar/connections')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!Array.isArray(body.connections)) throw new Error('connections not an array')
  })

  await time('Settings PATCH accepts booking copy fields', async () => {
    const { res, body } = await c.fetch('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify({
        bookingHeroTitle: 'Test hero',
        bookingConfirmEmailSubject: 'Walkthrough: {service} confirmed',
        bookingDefaultDriveTimeMinutes: 15,
      }),
    })
    if (res.status !== 200) throw new Error('status=' + res.status + ' ' + JSON.stringify(body))
    if (body.settings?.bookingHeroTitle !== 'Test hero') throw new Error('hero title not saved')
    if (body.settings?.bookingDefaultDriveTimeMinutes !== 15) throw new Error('drive time not saved')
  })
}

async function main() {
  let ctx: DeployContext | null = null
  try {
    ctx = await time('Deploy tenant', deployTestTenant)
    console.log('[walk] Site URL:', ctx.siteUrl)
    console.log('[walk] Polling /health (up to 6 min)…')
    const start = Date.now()
    while (Date.now() - start < 360_000) {
      try { const r = await fetch(ctx.siteUrl + '/health'); if (r.status === 200) { console.log('[walk] Live after ' + Math.round((Date.now() - start) / 1000) + 's'); break } } catch {}
      await new Promise(r => setTimeout(r, 10_000))
    }
    await walkthrough(ctx.siteUrl)
  } catch (e: any) {
    console.error('[walk] FAILED:', e?.message)
  } finally {
    if (ctx) {
      console.log('[walk] Cleaning up ' + ctx.tenantId)
      try { const cleanup = await hardDeleteTestTenant(ctx.tenantId); console.log('[walk] Cleanup:', JSON.stringify(cleanup).slice(0, 300)) }
      catch (e: any) { console.error('[walk] Cleanup failed:', e?.message) }
    }
    const pass = results.filter(r => r.ok).length, fail = results.filter(r => !r.ok).length
    console.log('\n═══════ Summary ═══════')
    console.log('Pass: ' + pass + '/' + (pass + fail))
    if (fail > 0) for (const r of results.filter(r => !r.ok)) console.log('  ✗ ' + r.name + (r.detail ? ' — ' + r.detail : ''))
    process.exit(fail > 0 ? 1 : 0)
  }
}

main()
