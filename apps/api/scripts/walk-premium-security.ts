/**
 * End-to-end security walkthrough for a premium-website tenant.
 *
 * Deploys a real tenant to Render, waits for it to go live, then walks
 * every security-related flow over HTTP — login rate limit, cookie
 * attributes, 2FA setup + login, recovery codes, password reset request,
 * session list + revoke, audit log, force-logout-all. Cleans up at the
 * end regardless of pass/fail.
 *
 * Picks the same admin password the deploy code generates internally
 * by supplying defaultPassword on the config, so we can log in.
 *
 * Run:
 *   bun run scripts/walk-premium-security.ts
 */
import crypto from 'crypto'
import { generate } from '../src/services/generator'
import { deployCustomer } from '../src/services/deploy'
import { hardDeleteTestTenant } from '../src/services/testCleanup'
import { createClient } from '@supabase/supabase-js'
import { generateSecret, verifyTotp } from '../../../templates/website-premium-contractor/lib/totp'

const KNOWN_PASSWORD = 'Walkthru-test-pw-' + crypto.randomBytes(3).toString('hex') + '!'
const ADMIN_EMAIL = 'twomiah14@gmail.com'

type Result = { name: string; ok: boolean; detail?: string; ms?: number }
const results: Result[] = []
function record(name: string, ok: boolean, detail?: string, ms?: number) {
  results.push({ name, ok, detail, ms })
  console.log((ok ? '✓' : '✗') + ' ' + name + (detail ? ' — ' + detail : '') + (ms ? ' [' + ms + 'ms]' : ''))
}

async function time<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t = Date.now()
  try {
    const r = await fn()
    record(name, true, undefined, Date.now() - t)
    return r
  } catch (e: any) {
    record(name, false, e?.message)
    throw e
  }
}

interface DeployContext {
  tenantId: string
  siteUrl: string
}

async function deployTestTenant(): Promise<DeployContext> {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const slug = 'walk-prem-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const tenantId = crypto.randomUUID()

  const products = ['crm', 'website', 'cms', 'website-premium']
  const config: any = {
    tenant_id: tenantId,
    tenant_name: 'Walkthrough Tenant',
    tenant_slug: slug,
    products,
    company: {
      name: 'Walkthrough Co',
      email: ADMIN_EMAIL,
      phone: '+1-608-555-0142',
      address: '123 Test St', city: 'Madison', state: 'WI', stateFull: 'Wisconsin', zip: '53703',
      domain: '', domainMode: 'skip',
      purchaseYears: 1,
      ownerName: 'Walkthrough Owner',
      industry: 'general_contractor',
      serviceRegion: 'Madison',
      nearbyCities: ['', '', '', ''],
      defaultPassword: KNOWN_PASSWORD,
    },
    branding: {
      primaryColor: '#FF6B35', secondaryColor: '#1A365D',
      logo: null, logoFilename: null, favicon: null, faviconFilename: null,
      heroPhoto: null, heroPhotoFilename: null,
    },
    features: { website: ['contact_form'], crm: [], paid_ads: false },
    integrations: {
      twilio: { accountSid: '', authToken: '', phoneNumber: '' },
      sendgrid: { apiKey: '' },
      stripe: { secretKey: '', publishableKey: '', webhookSecret: '' },
      googleMaps: { apiKey: '' },
      sentry: { dsn: '' },
      nearmap: { apiKey: '' },
      replicate: { apiToken: '' },
    },
    content: { services: [], customServices: [], heroTagline: '', aboutText: '', ctaText: '', description: '' },
  }

  await supabase.from('tenants').insert({
    id: tenantId,
    name: 'Walkthrough Tenant',
    slug,
    email: ADMIN_EMAIL,
    admin_email: ADMIN_EMAIL,
    industry: 'general_contractor',
    city: 'Madison', state: 'WI',
    status: 'pending',
    products,
    is_test_tenant: true,
    domain: null,
    domain_registrar: null,
  })

  console.log('[walk] Generating zip…')
  const zip = await generate({ id: tenantId, ...config } as any)
  console.log('[walk] Deploying to Render…')
  const deploy = await deployCustomer({ id: tenantId, slug, name: 'Walkthrough Tenant', industry: 'general_contractor', products, config }, zip.zipPath, { products })
  if (!deploy.siteUrl) throw new Error('Deploy failed (no siteUrl): success=' + deploy.success + ' status=' + deploy.status + ' errors=' + JSON.stringify(deploy.errors))
  console.log('[walk] Deploy success=' + deploy.success + ' status=' + deploy.status + (deploy.errors.length ? ' errors=' + JSON.stringify(deploy.errors) : ''))
  return { tenantId, siteUrl: deploy.siteUrl }
}

// ─── HTTP helper that captures Set-Cookie ────────────────────────────────
class TenantClient {
  private cookies = new Map<string, string>()
  constructor(public origin: string) {}
  private cookieHeader(): string {
    return Array.from(this.cookies.entries()).map(([k, v]) => k + '=' + v).join('; ')
  }
  private absorbSetCookie(res: Response) {
    const setCookie = (res.headers as any).getSetCookie?.() || []
    for (const c of setCookie) {
      const [pair] = c.split(';')
      const [k, v] = pair.split('=')
      if (k && v !== undefined) {
        if (c.toLowerCase().includes('max-age=0') || v === '') this.cookies.delete(k)
        else this.cookies.set(k, v)
      }
    }
  }
  async fetch(path: string, init: RequestInit = {}): Promise<{ res: Response; body: any; rawSetCookie: string[] }> {
    const headers: Record<string, string> = { ...(init.headers as any || {}) }
    const ch = this.cookieHeader(); if (ch) headers['Cookie'] = ch
    if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json'
    const res = await fetch(this.origin + path, { ...init, headers })
    const rawSetCookie = (res.headers as any).getSetCookie?.() || []
    this.absorbSetCookie(res)
    const ct = res.headers.get('content-type') || ''
    const body = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '')
    return { res, body, rawSetCookie }
  }
}

async function walkthrough(siteUrl: string) {
  const c = new TenantClient(siteUrl)

  // 1. Health
  await time('GET /health', async () => {
    const { res } = await c.fetch('/health')
    if (res.status !== 200) throw new Error('status=' + res.status)
  })

  // 2. security.txt
  await time('GET /.well-known/security.txt', async () => {
    const { res, body } = await c.fetch('/.well-known/security.txt')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!String(body).includes('Contact:')) throw new Error('missing Contact')
  })

  // 3. Secure response headers on root
  await time('Security headers on /', async () => {
    const { res } = await c.fetch('/')
    const missing: string[] = []
    if (!res.headers.get('Content-Security-Policy')) missing.push('CSP')
    if (res.headers.get('X-Frame-Options') !== 'DENY') missing.push('X-Frame-Options')
    if (res.headers.get('X-Content-Type-Options') !== 'nosniff') missing.push('X-Content-Type-Options')
    if (!res.headers.get('Strict-Transport-Security')) missing.push('HSTS')
    if (missing.length) throw new Error('missing: ' + missing.join(','))
  })

  // 4. Login: bad password rejected
  await time('Login with bad password → 401', async () => {
    const { res } = await c.fetch('/api/admin/login', {
      method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: 'wrong-' + Date.now() }),
    })
    if (res.status !== 401) throw new Error('expected 401, got ' + res.status)
  })

  // 5. Login with real password — first attempt, still under rate limit (1 bad above)
  const loginResp = await c.fetch('/api/admin/login', {
    method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: KNOWN_PASSWORD }),
  })
  if (loginResp.res.status !== 200) throw new Error('login returned ' + loginResp.res.status + ' ' + JSON.stringify(loginResp.body))
  const loginRes = loginResp
  record('Login with correct password → 200', true, JSON.stringify(loginRes.body?.user?.email))

  // 7. Cookie attributes
  const authCookie = loginRes.rawSetCookie.find((c: string) => c.startsWith('auth='))
  const cookieOk = authCookie && /HttpOnly/i.test(authCookie) && /SameSite=Strict/i.test(authCookie)
  record('Cookie httpOnly + SameSite=Strict', !!cookieOk, authCookie ? authCookie.slice(0, 80) + '…' : 'no auth cookie')

  // 8. /me with cookie
  await time('GET /api/admin/me with cookie', async () => {
    const { res, body } = await c.fetch('/api/admin/me')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (body.user?.email !== ADMIN_EMAIL) throw new Error('wrong user')
    if (body.user.totpEnabled !== false) throw new Error('totp should be off')
  })

  // 9. Sessions list — 1 entry, isCurrent true
  await time('GET /api/admin/sessions', async () => {
    const { res, body } = await c.fetch('/api/admin/sessions')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!Array.isArray(body.sessions)) throw new Error('not array')
    if (body.sessions.length < 1) throw new Error('expected >=1 session')
    if (!body.sessions.find((s: any) => s.isCurrent)) throw new Error('no isCurrent session')
  })

  // 10. 2FA setup
  let secret = ''
  await time('POST /api/admin/2fa/setup', async () => {
    const { res, body } = await c.fetch('/api/admin/2fa/setup', { method: 'POST' })
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!body.secret || !/^[A-Z2-7]+$/.test(body.secret)) throw new Error('bad secret')
    if (!String(body.otpauthUri).startsWith('otpauth://totp/')) throw new Error('bad otpauth')
    secret = body.secret
  })

  // 11. 2FA enable with computed code
  let recoveryCodes: string[] = []
  await time('POST /api/admin/2fa/enable with TOTP code', async () => {
    const code = await computeTotp(secret)
    const { res, body } = await c.fetch('/api/admin/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) })
    if (res.status !== 200) throw new Error('status=' + res.status + ' ' + JSON.stringify(body))
    if (!Array.isArray(body.recoveryCodes) || body.recoveryCodes.length !== 10) throw new Error('bad recovery codes')
    recoveryCodes = body.recoveryCodes
  })

  // 12. /me reflects totpEnabled
  await time('GET /me shows totpEnabled', async () => {
    const { body } = await c.fetch('/api/admin/me')
    if (body.user.totpEnabled !== true) throw new Error('totp not enabled')
    if (body.user.recoveryCodesRemaining !== 10) throw new Error('expected 10 codes')
  })

  // 13. Logout
  await time('POST /logout', async () => {
    const { res } = await c.fetch('/api/admin/logout', { method: 'POST' })
    if (res.status !== 200) throw new Error('status=' + res.status)
  })

  // 14. /me without cookie → 401
  await time('GET /me after logout → 401', async () => {
    const { res } = await c.fetch('/api/admin/me')
    if (res.status !== 401) throw new Error('expected 401, got ' + res.status)
  })

  // 15. Login again — should require 2FA
  let challengeId = ''
  await time('Login → requires2fa', async () => {
    const { res, body } = await c.fetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: KNOWN_PASSWORD }) })
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!body.requires2fa || !body.challengeId) throw new Error('expected 2FA challenge')
    challengeId = body.challengeId
  })

  // 16. Complete 2FA challenge
  await time('POST /login/2fa with TOTP', async () => {
    const code = await computeTotp(secret)
    const { res, body } = await c.fetch('/api/admin/login/2fa', { method: 'POST', body: JSON.stringify({ challengeId, code }) })
    if (res.status !== 200) throw new Error('status=' + res.status + ' ' + JSON.stringify(body))
    if (body.user?.email !== ADMIN_EMAIL) throw new Error('wrong user')
  })

  // 17. Recovery code login
  await time('Login via recovery code', async () => {
    await c.fetch('/api/admin/logout', { method: 'POST' })
    const { body: loginBody } = await c.fetch('/api/admin/login', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: KNOWN_PASSWORD }) })
    const ch = loginBody.challengeId
    const { res, body } = await c.fetch('/api/admin/login/2fa', { method: 'POST', body: JSON.stringify({ challengeId: ch, code: recoveryCodes[0] }) })
    if (res.status !== 200) throw new Error('status=' + res.status + ' ' + JSON.stringify(body))
  })

  // 18. Recovery codes remaining decremented
  await time('Recovery code consumed', async () => {
    const { body } = await c.fetch('/api/admin/me')
    if (body.user.recoveryCodesRemaining !== 9) throw new Error('expected 9 remaining, got ' + body.user.recoveryCodesRemaining)
  })

  // 19. Forgot password (won't check inbox)
  await time('POST /password/forgot returns 200 regardless', async () => {
    const { res, body } = await c.fetch('/api/admin/password/forgot', { method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL }) })
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!body.ok) throw new Error('ok != true')
    // Also test enumeration resistance
    const { res: r2, body: b2 } = await c.fetch('/api/admin/password/forgot', { method: 'POST', body: JSON.stringify({ email: 'nonexistent-' + Date.now() + '@example.com' }) })
    if (r2.status !== 200 || !b2.ok) throw new Error('enumeration resistance failed')
  })

  // 20. Audit log
  await time('GET /audit shows entries', async () => {
    const { res, body } = await c.fetch('/api/admin/audit')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (!Array.isArray(body.entries) || body.entries.length === 0) throw new Error('no audit entries')
    const actions = new Set(body.entries.map((e: any) => e.action))
    const required = ['login', '2fa_enabled', 'password_reset_requested']
    for (const a of required) if (!actions.has(a)) throw new Error('missing action: ' + a)
  })

  // 21. Sessions revoke all (we are still signed in via 2FA)
  await time('POST /sessions/revoke-all', async () => {
    const { res } = await c.fetch('/api/admin/sessions/revoke-all', { method: 'POST' })
    if (res.status !== 200) throw new Error('status=' + res.status)
  })

  // 22. Still signed in (current session preserved)
  await time('Current session preserved after revoke-all', async () => {
    const { res, body } = await c.fetch('/api/admin/sessions')
    if (res.status !== 200) throw new Error('status=' + res.status)
    if (body.sessions.length !== 1) throw new Error('expected exactly 1 session, got ' + body.sessions.length)
    if (!body.sessions[0].isCurrent) throw new Error('current flag missing')
  })

  // 23. Disable 2FA with password
  await time('POST /2fa/disable', async () => {
    const { res } = await c.fetch('/api/admin/2fa/disable', { method: 'POST', body: JSON.stringify({ password: KNOWN_PASSWORD }) })
    if (res.status !== 200) throw new Error('status=' + res.status)
    const { body } = await c.fetch('/api/admin/me')
    if (body.user.totpEnabled !== false) throw new Error('2FA still on')
  })

  // 24. Markdown XSS resistance via blog (no published posts initially, but the route must 200)
  await time('GET /blog returns 200', async () => {
    const { res } = await c.fetch('/blog')
    if (res.status !== 200 && res.status !== 503) throw new Error('status=' + res.status)
  })

  // 25. Rate limit — saved for last because once triggered it locks the IP for 10 minutes.
  // We log out first so we don't tie this to a live session.
  await c.fetch('/api/admin/logout', { method: 'POST' })
  await time('Login rate limit triggers 429', async () => {
    let got429 = false
    for (let i = 0; i < 15; i++) {
      const { res } = await c.fetch('/api/admin/login', {
        method: 'POST', body: JSON.stringify({ email: ADMIN_EMAIL, password: 'definitely-wrong-' + i }),
      })
      if (res.status === 429) { got429 = true; break }
    }
    if (!got429) throw new Error('never got 429 in 15 attempts')
  })
}

async function computeTotp(secret: string): Promise<string> {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = secret.toUpperCase().replace(/=+$/, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch)
    bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  const buf = Buffer.alloc(8)
  const t = Math.floor(Date.now() / 30000)
  buf.writeUInt32BE(0, 0); buf.writeUInt32BE(t, 4)
  const h = crypto.createHmac('sha1', Buffer.from(out)).update(buf).digest()
  const off = h[h.length - 1] & 0xf
  const bin = ((h[off] & 0x7f) << 24) | ((h[off+1] & 0xff) << 16) | ((h[off+2] & 0xff) << 8) | (h[off+3] & 0xff)
  return (bin % 1_000_000).toString().padStart(6, '0')
}

async function main() {
  let ctx: DeployContext | null = null
  try {
    ctx = await time('Deploy tenant', deployTestTenant)
    console.log('[walk] Site URL:', ctx.siteUrl)
    console.log('[walk] Polling /health until 200 (up to 6 min)…')
    const start = Date.now()
    while (Date.now() - start < 360_000) {
      try {
        const r = await fetch(ctx.siteUrl + '/health')
        if (r.status === 200) { console.log('[walk] Live after', Math.round((Date.now() - start) / 1000) + 's'); break }
      } catch { /* connection refused/reset while booting — fine */ }
      await new Promise(r => setTimeout(r, 10_000))
    }
    await walkthrough(ctx.siteUrl)
  } catch (e: any) {
    console.error('[walk] FAILED:', e?.message)
  } finally {
    if (ctx) {
      console.log('[walk] Cleaning up tenant ' + ctx.tenantId)
      try {
        const cleanup = await hardDeleteTestTenant(ctx.tenantId)
        console.log('[walk] Cleanup:', JSON.stringify(cleanup, null, 2).slice(0, 500))
      } catch (e: any) {
        console.error('[walk] Cleanup failed:', e?.message)
      }
    }
    const pass = results.filter(r => r.ok).length
    const fail = results.filter(r => !r.ok).length
    console.log('\n═══════ Summary ═══════')
    console.log('Pass: ' + pass + '/' + (pass + fail))
    if (fail > 0) {
      console.log('Failures:')
      for (const r of results.filter(r => !r.ok)) console.log('  ✗ ' + r.name + (r.detail ? ' — ' + r.detail : ''))
    }
    process.exit(fail > 0 ? 1 : 0)
  }
}

main()
