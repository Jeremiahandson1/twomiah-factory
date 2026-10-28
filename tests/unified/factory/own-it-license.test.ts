// The own-it licence ("Buy it outright and take the code", twomiah.com): the price is 36× the monthly, what is shown before
// payment, who may start it, and — once paid — the handover happens by itself and only once. Every outside thing (Stripe,
// GitHub, the business's app, storage, email) is a fake here; nothing leaves the machine.
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
delete process.env.STRIPE_SECRET_KEY // no Stripe client: nothing here may reach Stripe
const L = await import('../../../apps/api/src/services/ownItLicense.ts')
const { handleFactoryWebhook } = await import('../../../apps/api/src/services/factoryStripe.ts')

const tenant = (over: Record<string, unknown> = {}): any => ({
  id: 't1', slug: 'acme-builders', name: 'Acme Builders', email: 'owner@acme.example', plan: 'starter10', engine: 'unified',
  billing_status: 'active', stripe_subscription_id: 'sub_1', next_billing_date: '2026-11-20T00:00:00Z', github_repo: 'https://github.com/twomiah-org/acme-builders-app', render_backend_url: 'https://acme.example', ...over,
})
const agreed = { githubUsername: 'acme-owner', hosting: 'twomiah', acceptedTerms: true, termsVersion: L.LICENSE_TERMS_VERSION, returnTo: 'https://acme.example/crm/settings/billing' }

function fakeStore() {
  const rows: any[] = []
  return {
    rows,
    bySession: async (s: string) => rows.find((r) => r.stripe_session_id === s) ?? null,
    byTenant: async (t: string) => rows.find((r) => r.tenant_id === t) ?? null,
    insert: async (r: any) => { if (rows.some((x) => x.stripe_session_id === r.stripe_session_id)) return null; const row = { id: 'lic' + (rows.length + 1), ...r }; rows.push(row); return row },
    update: async (id: string, patch: any) => { Object.assign(rows.find((r) => r.id === id), patch) },
  }
}
function fakes(o: { inviteFails?: boolean; exportFails?: boolean; hostingFails?: boolean; noSubscription?: boolean } = {}) {
  const store = fakeStore(), calls: string[] = []
  const deps = {
    store,
    inviteCollaborator: async (repo: string, user: string) => { calls.push(`invite ${repo} ${user}`); if (o.inviteFails) throw new Error('GitHub 404'); return 'invited' as const },
    endHostingAtPeriodEnd: async () => { calls.push('end-hosting'); if (o.hostingFails) throw new Error('Stripe 500'); return o.noSubscription ? null : { endsAt: new Date('2026-11-20T00:00:00Z') } },
    makeExport: async () => { calls.push('export'); if (o.exportFails) throw new Error('the app answered 502'); return { url: 'https://r2.example/x.zip', expiresAt: new Date('2026-11-04T00:00:00Z'), files: 40, rows: 1234 } },
    sendEmail: async (_t: any, e: any) => { calls.push(`email invited=${e.repoInvited} export=${!!e.export} hosting=${e.hosting}${e.hostingEndsAt ? ' ends=' + e.hostingEndsAt.toISOString().slice(0, 10) : ''}`); return true },
    alertStaff: async (s: string) => { calls.push('staff ' + s) },
    audit: async () => { calls.push('audit') },
    now: () => new Date('2026-10-28T12:00:00Z'),
  }
  return { store, calls, deps }
}
const paid = { id: 'cs_1', payment_intent: 'pi_1', amount_total: 356400, payment_status: 'paid', metadata: { purpose: 'own_it_license', tenant_id: 't1', github_username: 'acme-owner', hosting: 'twomiah', repo: 'twomiah-org/acme-builders-app', plan_id: 'starter10', monthly_cents: '9900', months: '36', terms_version: L.LICENSE_TERMS_VERSION } }

describe('the offer', () => {
  test('the price is 36 times the plan’s monthly list price, in cents', () => {
    const o = L.licenseOffer(tenant(), null)
    expect(o.eligible).toBe(true)
    expect(o.monthlyCents).toBe(9900)
    expect(o.priceCents).toBe(356400)
    expect(o.months).toBe(36)
    for (const [plan, monthly] of [['website', 49], ['team25', 139], ['business50', 199]] as const) expect(L.licenseOffer(tenant({ plan }), null).priceCents).toBe(monthly * 36 * 100)
  })
  test('it says what comes with it, and that it is not for reselling (Terms §7), before any payment', () => {
    const o = L.licenseOffer(tenant(), null)
    expect(o.includes.join(' ')).toMatch(/GitHub/)
    expect(o.includes.join(' ')).toMatch(/export/i)
    expect(o.terms.join(' ')).toMatch(/not a licence to resell/)
    expect(o.terms.join(' ')).toMatch(/§7/)
    expect(o.terms.join(' ')).toMatch(/does not by itself change your hosting/)
  })
  test('who cannot buy: a lapsed subscription, a test account, one that already owns it, an unknown plan, no repo', () => {
    expect(L.licenseOffer(tenant({ billing_status: 'canceled' }), null).eligible).toBe(false)
    expect(L.licenseOffer(tenant({ is_test_tenant: true }), null).eligible).toBe(false)
    expect(L.licenseOffer(tenant({ plan: 'mystery' }), null).eligible).toBe(false)
    expect(L.licenseOffer(tenant({ github_repo: null, engine: 'templates' }), null).eligible).toBe(false)
    const owns = L.licenseOffer(tenant(), { paid_at: '2026-10-01T00:00:00Z', github_username: 'x', amount_cents: 1, handover_status: 'complete', repo_invited_at: 'y', export_sent_at: 'z' } as any)
    expect(owns.eligible).toBe(false)
    expect(owns.license?.handoverStatus).toBe('complete')
  })
  test('the repo is the one the deploy recorded, else <slug>-app in the Factory’s org', () => {
    expect(L.licenseRepo(tenant())).toBe('twomiah-org/acme-builders-app')
    expect(L.licenseRepo(tenant({ github_repo: null }), 'twomiah-org')).toBe('twomiah-org/acme-builders-app')
    expect(L.licenseRepo(tenant({ github_repo: 'org/old-name' }))).toBe('org/old-name')
  })
})

describe('starting the checkout', () => {
  const session = () => { const made: any[] = []; return { made, deps: { createSession: async (p: any) => { made.push(p); return { url: 'https://checkout.stripe.example/c/1', sessionId: 'cs_1', stripeCustomerId: 'cus_1' } }, githubUserExists: async (u: string) => u !== 'nobody-here' } } }
  test('an accepted, valid request opens a checkout for exactly the price, with the handover in its metadata', async () => {
    const s = session()
    const r: any = await L.startLicenseCheckout(tenant(), null, agreed, s.deps)
    expect(r.ok).toBe(true)
    expect(r.url).toContain('checkout.stripe.example')
    expect(s.made).toHaveLength(1)
    expect(s.made[0].priceCents).toBe(356400)
    expect(s.made[0].metadata).toMatchObject({ purpose: 'own_it_license', tenant_id: 't1', github_username: 'acme-owner', repo: 'twomiah-org/acme-builders-app', months: '36', monthly_cents: '9900' })
    expect(s.made[0].metadata.factory_customer_id).toBeUndefined() // a licence is not a plan change
    expect(s.made[0].successUrl).toBe('https://acme.example/crm/settings/billing?license=paid')
    expect(s.made[0].termsNote).toMatch(/not to resell/)
  })
  test('terms not accepted (or an old version of them): refused, no checkout', async () => {
    for (const bad of [{ acceptedTerms: false }, { acceptedTerms: undefined }, { termsVersion: '1999-01-01' }]) {
      const s = session()
      const r: any = await L.startLicenseCheckout(tenant(), null, { ...agreed, ...bad }, s.deps)
      expect(r.ok).toBe(false); expect(r.code).toBe('terms_not_accepted'); expect(s.made).toHaveLength(0)
    }
  })
  test('a GitHub name that is not one, or that GitHub does not know, is refused before payment; @ is forgiven', async () => {
    for (const name of ['', '   ', 'two words', '-lead', 'trail-', 'a--b', 'x'.repeat(40), 'sam@home']) {
      const s = session()
      const r: any = await L.startLicenseCheckout(tenant(), null, { ...agreed, githubUsername: name }, s.deps)
      expect(r.ok).toBe(false); expect(r.code).toBe('bad_github_username'); expect(s.made).toHaveLength(0)
    }
    const s = session()
    const unknown: any = await L.startLicenseCheckout(tenant(), null, { ...agreed, githubUsername: 'nobody-here' }, s.deps)
    expect(unknown.code).toBe('github_user_not_found'); expect(s.made).toHaveLength(0)
    const at: any = await L.startLicenseCheckout(tenant(), null, { ...agreed, githubUsername: '@acme-owner' }, s.deps)
    expect(at.ok).toBe(true); expect(s.made[0].metadata.github_username).toBe('acme-owner')
  })
  test('what the offer refuses, the checkout refuses (409); GitHub being unreachable does not block it', async () => {
    const s = session()
    expect(((await L.startLicenseCheckout(tenant({ billing_status: 'canceled' }), null, agreed, s.deps)) as any).status).toBe(409)
    const down = { ...s.deps, githubUserExists: async () => { throw new Error('offline') } }
    expect(((await L.startLicenseCheckout(tenant(), null, agreed, down)) as any).ok).toBe(true)
  })
})

describe('paid: the handover', () => {
  test('records the licence once, invites the GitHub user, makes the export, emails the owner — complete', async () => {
    const f = fakes()
    const r = await L.completeLicensePurchase(paid, tenant(), f.deps)
    expect(r.status).toBe('complete')
    expect(f.calls).toEqual(['audit', 'invite twomiah-org/acme-builders-app acme-owner', 'export', 'email invited=true export=true hosting=twomiah'])
    expect(f.store.rows).toHaveLength(1)
    expect(f.store.rows[0]).toMatchObject({ tenant_id: 't1', amount_cents: 356400, monthly_cents: 9900, months: 36, github_username: 'acme-owner', terms_version: L.LICENSE_TERMS_VERSION, hosting: 'twomiah', hosting_end_at: null, handover_status: 'complete', repo_invite_note: 'invitation sent', export_note: 'emailed' })
  })
  test('Stripe delivering the event again hands over nothing twice', async () => {
    const f = fakes()
    await L.completeLicensePurchase(paid, tenant(), f.deps)
    const again = await L.completeLicensePurchase(paid, tenant(), f.deps)
    expect(again.status).toBe('complete')
    expect(f.store.rows).toHaveLength(1)
    expect(f.calls.filter((c) => c.startsWith('invite'))).toHaveLength(1)
    expect(f.calls.filter((c) => c === 'export')).toHaveLength(1)
    expect(f.calls.filter((c) => c.startsWith('email'))).toHaveLength(1)
  })
  test('an unpaid session records nothing', async () => {
    const f = fakes()
    await expect(L.completeLicensePurchase({ ...paid, payment_status: 'unpaid' }, tenant(), f.deps)).rejects.toThrow(/not paid/)
    expect(f.store.rows).toHaveLength(0)
  })
  test('a failed invitation: the export still goes, staff are told, the status says a person is needed', async () => {
    const f = fakes({ inviteFails: true })
    const r = await L.completeLicensePurchase(paid, tenant(), f.deps)
    expect(r.status).toBe('needs_attention')
    expect(f.store.rows[0].repo_invite_note).toMatch(/FAILED/)
    expect(f.calls).toContain('export')
    expect(f.calls).toContain('email invited=false export=true hosting=twomiah')
    expect(f.calls.some((c) => c.startsWith('staff'))).toBe(true)
  })
  test('a retry after a failure does only what is left — never a second invitation or a second export', async () => {
    const f = fakes({ exportFails: true })
    const first = await L.completeLicensePurchase(paid, tenant(), f.deps)
    expect(first.status).toBe('needs_attention')
    const ok = fakes()
    ok.store.rows.push(...f.store.rows) // the same database, the problem fixed
    const second = await L.completeLicensePurchase({ ...paid, metadata: {} }, tenant(), ok.deps)
    expect(second.status).toBe('complete')
    expect(ok.calls.filter((c) => c.startsWith('invite'))).toHaveLength(0)
    expect(ok.calls.filter((c) => c === 'export')).toHaveLength(1)
  })
})

describe('the hosting choice', () => {
  const session = () => { const made: any[] = []; return { made, deps: { createSession: async (p: any) => { made.push(p); return { url: 'https://checkout.stripe.example/c/1', sessionId: 'cs_1' } }, githubUserExists: async () => true } } }
  test('both choices are on the offer with what each does — and the date the paid period ends', () => {
    const o = L.licenseOffer(tenant(), null)
    expect(o.hostingChoices.map((h: any) => h.label)).toEqual(['Keep Twomiah hosting it', 'I’ll host it myself'])
    expect(o.hostingChoices[0].effect).toMatch(/subscription carries on/)
    expect(o.hostingChoices[1].effect).toMatch(/end when the period you have already paid for ends \(November 20, 2026\)/)
    expect(o.hostingChoices[1].effect).toMatch(/nothing is cut off before it/)
    expect(o.periodEnd).toBe('2026-11-20T00:00:00Z')
  })
  test('no choice (or a made-up one) is refused before any checkout; each real choice goes into the metadata', async () => {
    for (const hosting of [undefined, '', 'both', null]) {
      const s = session()
      const r: any = await L.startLicenseCheckout(tenant(), null, { ...agreed, hosting }, s.deps)
      expect(r.ok).toBe(false); expect(r.code).toBe('hosting_not_chosen'); expect(s.made).toHaveLength(0)
    }
    for (const hosting of ['twomiah', 'self']) {
      const s = session()
      const r: any = await L.startLicenseCheckout(tenant(), null, { ...agreed, hosting }, s.deps)
      expect(r.ok).toBe(true)
      expect(s.made[0].metadata.hosting).toBe(hosting)
      expect(s.made[0].priceCents).toBe(356400) // the choice never changes the price
    }
    const s = session()
    await L.startLicenseCheckout(tenant(), null, { ...agreed, hosting: 'self' }, s.deps)
    expect(s.made[0].termsNote).toMatch(/subscription will end when the period already paid for ends/)
  })
  test('"I\'ll host it myself": on payment the subscription is set to end at the period’s end — once — and the licence records it', async () => {
    const f = fakes()
    const r = await L.completeLicensePurchase({ ...paid, metadata: { ...paid.metadata, hosting: 'self' } }, tenant(), f.deps)
    expect(r.status).toBe('complete')
    expect(f.calls.filter((c) => c === 'end-hosting')).toHaveLength(1)
    expect(f.calls).toContain('email invited=true export=true hosting=self ends=2026-11-20')
    expect(f.store.rows[0]).toMatchObject({ hosting: 'self', hosting_end_at: '2026-11-20T00:00:00.000Z', hosting_note: 'set to end at the end of the paid period' })
    await L.completeLicensePurchase({ ...paid, metadata: { ...paid.metadata, hosting: 'self' } }, tenant(), f.deps) // Stripe redelivers
    expect(f.calls.filter((c) => c === 'end-hosting')).toHaveLength(1)
  })
  test('"Keep Twomiah hosting it": the subscription is not touched', async () => {
    const f = fakes()
    await L.completeLicensePurchase(paid, tenant(), f.deps)
    expect(f.calls).not.toContain('end-hosting')
    expect(f.store.rows[0]).toMatchObject({ hosting: 'twomiah', hosting_end_at: null })
  })
  test('if ending the subscription fails the licence still hands over, staff are told, and a retry ends it (and only that)', async () => {
    const f = fakes({ hostingFails: true })
    const first = await L.completeLicensePurchase({ ...paid, metadata: { ...paid.metadata, hosting: 'self' } }, tenant(), f.deps)
    expect(first.status).toBe('needs_attention')
    expect(f.store.rows[0].hosting_note).toMatch(/FAILED/)
    expect(f.calls.some((c) => c.startsWith('staff'))).toBe(true)
    const ok = fakes(); ok.store.rows.push(...f.store.rows)
    const second = await L.completeLicensePurchase({ ...paid, metadata: {} }, tenant(), ok.deps)
    expect(second.status).toBe('complete')
    expect(ok.calls.filter((c) => c === 'end-hosting')).toHaveLength(1)
    expect(ok.calls.filter((c) => c.startsWith('invite'))).toHaveLength(0)
  })
  test('self-hosting with no subscription on file (a comp account) is recorded as such, not an error', async () => {
    const f = fakes({ noSubscription: true })
    const r = await L.completeLicensePurchase({ ...paid, metadata: { ...paid.metadata, hosting: 'self' } }, tenant(), f.deps)
    expect(r.status).toBe('complete')
    expect(f.store.rows[0]).toMatchObject({ hosting: 'self', hosting_end_at: null, hosting_note: 'no subscription to end' })
  })
  test('the real Stripe call is cancel_at_period_end (never an immediate cancel), and the route needs the tenant’s subscription', () => {
    const src = readFileSync(new URL('../../../apps/api/src/services/factoryStripe.ts', import.meta.url), 'utf8')
    const fn = src.slice(src.indexOf('export async function endSubscriptionAtPeriodEnd'), src.indexOf('// ── Premium-website checkout'))
    expect(fn).toMatch(/subscriptions\.update\(subscriptionId, \{ cancel_at_period_end: true \}\)/)
    expect(fn).not.toMatch(/subscriptions\.(cancel|del)/)
    const live = readFileSync(new URL('../../../apps/api/src/services/ownItLicenseLive.ts', import.meta.url), 'utf8')
    expect(live).toMatch(/endSubscriptionAtPeriodEnd\(t\.stripe_subscription_id\)/)
  })
})

describe('wiring', () => {
  test('the Stripe event is not a plan change: no factory_customer_id, so billing and the auto-deploy are left alone', async () => {
    const r = await handleFactoryWebhook({ type: 'checkout.session.completed', data: { object: { ...paid, customer: 'cus_1' } } } as any)
    expect(r.handled).toBe(false)
  })
  test('the Factory routes: key-authenticated offer and checkout, a staff retry; the webhook hands a paid licence over', () => {
    const life = readFileSync(new URL('../../../apps/api/src/routes/factory/lifecycle.ts', import.meta.url), 'utf8')
    expect(life).toMatch(/factory\.get\('\/customers\/:id\/license'[\s\S]{0,700}checkFactoryKey/)
    expect(life).toMatch(/factory\.post\('\/customers\/:id\/license-checkout'[\s\S]{0,900}checkFactoryKey/)
    expect(life).toMatch(/license\/retry-handover', requireRole\('owner', 'admin'\)/)
    const bill = readFileSync(new URL('../../../apps/api/src/routes/factory/billing.ts', import.meta.url), 'utf8')
    expect(bill).toMatch(/purpose === 'own_it_license'[\s\S]{0,600}completeLicensePurchase/)
  })
  test('the checkout is an inline price built from the offer, and carries no tenant billing identity', () => {
    const src = readFileSync(new URL('../../../apps/api/src/services/factoryStripe.ts', import.meta.url), 'utf8')
    const fn = src.slice(src.indexOf('export async function createOwnItLicenseCheckout'), src.indexOf('// ── Premium-website checkout'))
    expect(fn).toMatch(/unit_amount: o\.priceCents/)
    expect(fn).not.toMatch(/factory_customer_id/)
  })
})

describe('the GitHub invite is read-only or not made', () => {
  test('only an organization’s repo may be invited to — a personal account’s repo would give the buyer write access', () => {
    expect(L.readOnlyInviteRefusal('Organization')).toBeNull()
    expect(L.readOnlyInviteRefusal('User')).toMatch(/cannot give read-only access/)
    expect(L.readOnlyInviteRefusal(undefined)).toMatch(/cannot give read-only access/)
  })
  test('the live invite reads the repo’s owner first and refuses before any PUT', async () => {
    process.env.SUPABASE_URL ||= 'http://localhost:1'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test'
    const { handoverDeps } = await import('../../../apps/api/src/services/ownItLicenseLive.ts')
    const real = globalThis.fetch, seen: string[] = []
    for (const [type, expectPut] of [['User', false], ['Organization', true]] as const) {
      seen.length = 0
      globalThis.fetch = (async (url: string, init: any = {}) => {
        seen.push((init.method || 'GET') + ' ' + String(url).replace('https://api.github.com', ''))
        return String(url).includes('/collaborators/') ? new Response(null, { status: 201 }) : Response.json({ owner: { type } })
      }) as any
      try {
        const r = handoverDeps.inviteCollaborator('twomiah-apps/acme-app', 'acme-owner')
        if (expectPut) expect(await r).toBe('invited'); else await expect(r).rejects.toThrow(/read-only/)
      } finally { globalThis.fetch = real }
      expect(seen[0]).toBe('GET /repos/twomiah-apps/acme-app')
      expect(seen.some((x) => x.startsWith('PUT '))).toBe(expectPut)
    }
  })
})
