// Domain renewals are billed to the customer, then renewed by us — once, and only once paid. (10/14)
// Runs services/domainRenewal.ts and factoryStripe.createDomainRenewalInvoice against an in-memory tenants table and a
// stand-in Stripe client: nothing here reaches Supabase, Stripe or Namecheap.
delete process.env.STRIPE_SECRET_KEY
const { readFileSync } = await import('node:fs')
const R = await import(new URL('../../apps/api/src/services/domainRenewal.ts', import.meta.url).href)
const { createDomainRenewalInvoice } = await import(new URL('../../apps/api/src/services/factoryStripe.ts', import.meta.url).href)
const P = await import(new URL('../../apps/api/src/config/domainPricing.ts', import.meta.url).href)
const { parseOneYearCostCents } = await import(new URL('../../apps/api/src/services/registrar/namecheap.ts', import.meta.url).href)

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const DAY = 86_400_000
const NOW = new Date('2027-09-10T12:00:00Z')

// ── a tenants table that evaluates the filters the module uses: eq, is(null), not(is null), lte, gt ──
function table(rows: any[]) {
  const q = (op: 'select' | 'update', patch?: any) => {
    const filters: Array<(r: any) => boolean> = []
    const api: any = {
      eq: (k: string, v: any) => (filters.push((r) => r[k] === v), api),
      is: (k: string, v: null) => (filters.push((r) => (r[k] ?? null) === v), api),
      not: (k: string, _op: 'is', v: null) => (filters.push((r) => (r[k] ?? null) !== v), api),
      lte: (k: string, v: string) => (filters.push((r) => r[k] != null && new Date(r[k]).getTime() <= new Date(v).getTime()), api),
      gt: (k: string, v: string) => (filters.push((r) => r[k] != null && new Date(r[k]).getTime() > new Date(v).getTime()), api),
      select: (_cols?: string) => { const hit = rows.filter((r) => filters.every((f) => f(r))); if (op === 'update') hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null }) },
      then: (res: any, rej: any) => { const hit = rows.filter((r) => filters.every((f) => f(r))); if (op === 'update') hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit, error: null }).then(res, rej) },
    }
    return api
  }
  return { from: (_t: string) => ({ select: (_c: string) => q('select'), update: (p: any) => q('update', p) }), rows }
}

const higgs = () => ({ id: 'higgs', name: 'Higgs', domain: 'higgsheritagebuilders.com', domain_registrar: 'namecheap', domain_expires_at: '2027-10-03T23:29:41Z', stripe_customer_id: 'cus_h', status: 'active', domain_renewal_price_cents: null, admin_email: 'w@h.test' })

// ══ pure rules ══
// ── pricing: at cost plus the Stripe fee (owner's decision, 10/14) ──
check('the Stripe fee is added so exactly the cost is left: $15.00 → $15.76', P.withStripeFee(1500) === 1576 && Math.floor(1576 * (1 - 0.029)) - 30 >= 1500)
check('…and $9.29 → $9.88', P.withStripeFee(929) === 988)
check('a renewal is the live renewal cost plus the fee — no markup', R.renewalPriceCents({ domain: 'a.com', domain_renewal_price_cents: null }, 1598) === P.withStripeFee(1598))
check('a price staff set by hand wins', R.renewalPriceCents({ domain: 'a.com', domain_renewal_price_cents: 2000 }, 1598) === 2000)
check('no live price → no price (never billed a guess)', R.renewalPriceCents({ domain: 'a.com', domain_renewal_price_cents: null }, null) === null)
check('one year bought: the live registration price plus the fee', JSON.stringify(P.purchaseChargeCents(299, 3000, 1)) === JSON.stringify({ ok: true, cents: P.withStripeFee(299), costCents: 299 }))
check('three years bought: year one at the registration price, years two and three at the RENEWAL price — one fee', (() => { const r = P.purchaseChargeCents(299, 3000, 3); return r.ok && r.costCents === 299 + 2 * 3000 && r.cents === P.withStripeFee(6299) })())
check('more than a year with no live renewal price is refused, not guessed', P.purchaseChargeCents(299, null, 2).ok === false)
check('a TLD we do not sell is refused', P.checkTld('a.weird').ok === false && P.checkTld('a.com').ok === true)
// ── reading Namecheap's price (users.getPricing) — defensive, because customers are charged from it ──
const pricingXml = (attrs: string, name = 'com') => '<ApiResponse Status="OK"><CommandResponse Type="namecheap.users.getPricing"><UserGetPricingResult><ProductType Name="domains"><ProductCategory Name="renew"><Product Name="' + name + '"><Price Duration="1" DurationType="YEAR" ' + attrs + ' /><Price Duration="2" DurationType="YEAR" Price="30.00" YourPrice="30.00" /></Product></ProductCategory></ProductType></UserGetPricingResult></CommandResponse></ApiResponse>'
check("reads our account's 1-year price plus the ICANN fee", parseOneYearCostCents(pricingXml('Price="16.98" YourPrice="15.78" YourAdditonalCost="0.20" AdditionalCost="0.20"'), 'com') === 1598)
check('falls back to the list price when there is no account price', parseOneYearCostCents(pricingXml('Price="14.98" AdditionalCost="0.20"'), 'com') === 1518)
check('another TLD in the reply is not mistaken for this one', parseOneYearCostCents(pricingXml('Price="14.98"', 'net'), 'com') === null)
check('an error reply, or a nonsense price, is null', parseOneYearCostCents('<ApiResponse Status="ERROR"></ApiResponse>', 'com') === null && parseOneYearCostCents(pricingXml('Price="0.01"'), 'com') === null && parseOneYearCostCents(pricingXml('Price="9999"'), 'com') === null)
check('due inside 30 days → charge', R.renewalAction(higgs(), NOW).act === 'charge')
check('more than 30 days out → not yet', R.renewalAction(higgs(), new Date('2027-08-01T00:00:00Z')).act === 'skip')
check('already billed → skip', R.renewalAction({ ...higgs(), domain_renewal_invoice_id: 'in_1' }, NOW).act === 'skip')
check('a domain they brought (byod) is never billed', R.renewalAction({ ...higgs(), domain_registrar: 'byod' }, NOW).act === 'skip')
check('a company that is leaving is not billed — the domain is theirs to transfer', R.renewalAction({ ...higgs(), offboard_started_at: '2027-09-01T00:00:00Z' }, NOW).act === 'skip')
check('a past problem waits for staff', R.renewalAction({ ...higgs(), domain_renewal_error: 'x' }, NOW).act === 'skip')
check('a domain we cover ($0) is never billed', R.renewalAction({ ...higgs(), domain_renewal_price_cents: 0, stripe_customer_id: null }, NOW).act === 'skip')
{
  // …and the daily run neither charges it nor emails staff that there is no card
  const db = table([{ ...higgs(), domain_renewal_price_cents: 0, stripe_customer_id: null }])
  const invoices: any[] = [], alerts: any[] = []
  const out = await R.chargeDueDomainRenewals(NOW, { supabase: db, renewalCostCents: async () => 1598, createInvoice: async (o: any) => (invoices.push(o), { invoiceId: 'x', paid: true }), notifyPaymentNeeded: async () => {}, alertStaff: async (...a: any[]) => alerts.push(a) })
  check('a domain we cover: no invoice, no staff email, no error on the row', invoices.length === 0 && alerts.length === 0 && !db.rows[0].domain_renewal_error && out.skipped === 1, { out, row: db.rows[0] })
}
{
  const src = readFileSync(new URL('../../apps/api/src/routes/factory/billing.ts', import.meta.url), 'utf8')
  check('staff can set a domain to free (priceCents 0), which clears any renewal problem', /else if \(body\.priceCents === 0\) Object\.assign\(patch, \{ domain_renewal_price_cents: 0, domain_renewal_error: null \}\)/.test(src))
}
check('the new expiry is a year after the OLD expiry, not after today', R.nextExpiry('2027-10-03T23:29:41Z').toISOString() === '2028-10-03T23:29:41.000Z')

// ══ the daily charge ══
{
  const db = table([higgs(), { ...higgs(), id: 'later', domain_expires_at: new Date(NOW.getTime() + 90 * DAY).toISOString() }, { ...higgs(), id: 'leaving', offboard_started_at: '2027-09-01T00:00:00Z' }])
  const invoices: any[] = [], mails: any[] = [], alerts: any[] = []
  const out = await R.chargeDueDomainRenewals(NOW, {
    supabase: db, renewalCostCents: async () => 1598,
    createInvoice: async (o: any) => (invoices.push(o), { invoiceId: 'in_' + o.tenantId, paid: true }),
    notifyPaymentNeeded: async (...a: any[]) => mails.push(a), alertStaff: async (...a: any[]) => alerts.push(a),
  })
  check('bills the one that is due, at the live renewal cost plus the fee', invoices.length === 1 && invoices[0].tenantId === 'higgs' && invoices[0].amountCents === P.withStripeFee(1598) && invoices[0].customerId === 'cus_h', invoices)
  check('…and records the invoice on the tenant', db.rows.find((r: any) => r.id === 'higgs').domain_renewal_invoice_id === 'in_higgs')
  check('a paid charge emails nobody', mails.length === 0 && alerts.length === 0 && out.paid === 1, out)
  const again = await R.chargeDueDomainRenewals(NOW, { supabase: db, renewalCostCents: async () => 1598, createInvoice: async (o: any) => (invoices.push(o), { invoiceId: 'x', paid: true }), notifyPaymentNeeded: async () => {}, alertStaff: async () => {} })
  check('running again the same day bills nothing twice', invoices.length === 1 && again.billed === 0, again)
}
{
  const db = table([higgs()])
  const mails: any[] = []
  await R.chargeDueDomainRenewals(NOW, { supabase: db, renewalCostCents: async () => 1598, createInvoice: async () => ({ invoiceId: 'in_open', paid: false, hostedUrl: 'https://pay.test/in_open' }), notifyPaymentNeeded: async (t: any, o: any) => mails.push(o), alertStaff: async () => {} })
  check('a card that fails: the customer is emailed the pay link', mails.length === 1 && mails[0].hostedUrl === 'https://pay.test/in_open' && mails[0].amountCents === P.withStripeFee(1598), mails)
}
{
  const db = table([{ ...higgs(), stripe_customer_id: null }])
  const alerts: any[] = []
  await R.chargeDueDomainRenewals(NOW, { supabase: db, renewalCostCents: async () => 1598, createInvoice: async () => { throw new Error('should not be called') }, notifyPaymentNeeded: async () => {}, alertStaff: async (...a: any[]) => alerts.push(a) })
  check('nobody to bill: staff are told, the reason is kept, nothing is charged', alerts.length === 1 && /no Stripe customer/.test(db.rows[0].domain_renewal_error || ''), db.rows[0])
}

{
  const db = table([higgs()])
  const invoices: any[] = [], alerts: any[] = []
  await R.chargeDueDomainRenewals(NOW, { supabase: db, renewalCostCents: async () => null, createInvoice: async (o: any) => (invoices.push(o), { invoiceId: 'x', paid: true }), notifyPaymentNeeded: async () => {}, alertStaff: async (...a: any[]) => alerts.push(a) })
  check("Namecheap's price unavailable: nobody is billed, staff are told", invoices.length === 0 && alerts.length === 1 && /could not price/.test(db.rows[0].domain_renewal_error || ''), db.rows[0])
}

// ══ the paid webhook ══
const invoice = (id: string) => ({ id, metadata: { purpose: 'domain_renewal', tenant_id: 'higgs', domain: 'higgsheritagebuilders.com' } })
{
  const db = table([{ ...higgs(), domain_renewal_invoice_id: 'in_1', domain_renewal_warned_7d_at: '2027-09-28T00:00:00Z' }])
  const renewals: any[] = []
  const deps = { supabase: db, renew: async (d: string, y: number) => (renewals.push([d, y]), { success: true }), alertStaff: async () => {} }
  const first = await R.completePaidDomainRenewal(invoice('in_1'), deps)
  check('paid → renewed at Namecheap for exactly one year', first.renewed === true && renewals.length === 1 && renewals[0][0] === 'higgsheritagebuilders.com' && renewals[0][1] === 1, { first, renewals })
  const row = db.rows[0]
  check('…the expiry moves on a year, and the renewal is closed', row.domain_expires_at === '2028-10-03T23:29:41.000Z' && row.domain_renewal_invoice_id === null && row.domain_renewal_paid_invoice_id === null, row)
  check("…and next year's reminders will go out again", row.domain_renewal_warned_7d_at === null)
  const second = await R.completePaidDomainRenewal(invoice('in_1'), deps)
  check('the same event delivered again renews NOTHING', renewals.length === 1 && second.renewed === undefined && !!second.skipped, second)
}
{
  // Stripe can deliver the same event twice AT ONCE: the second arrives while the first is still at Namecheap. The
  // claim (paid_invoice_id still null) is what stops it — the invoice id is still set at that moment.
  const db = table([{ ...higgs(), domain_renewal_invoice_id: 'in_c' }])
  const renewals: any[] = []
  const slowRenew = async (d: string, y: number) => { renewals.push([d, y]); await new Promise((r) => setTimeout(r, 30)); return { success: true } }
  const deps = { supabase: db, renew: slowRenew, alertStaff: async () => {} }
  await Promise.all([R.completePaidDomainRenewal(invoice('in_c'), deps), R.completePaidDomainRenewal(invoice('in_c'), deps)])
  check('two deliveries at the same moment renew once', renewals.length === 1, renewals)
}
{
  const db = table([{ ...higgs(), domain_renewal_invoice_id: 'in_2' }])
  const renewals: any[] = []
  await R.completePaidDomainRenewal(invoice('in_other'), { supabase: db, renew: async () => (renewals.push(1), { success: true }), alertStaff: async () => {} })
  check('an invoice that is not the outstanding renewal renews nothing', renewals.length === 0)
}
{
  const db = table([{ ...higgs(), domain_renewal_invoice_id: 'in_3' }])
  const alerts: any[] = []
  const r = await R.completePaidDomainRenewal(invoice('in_3'), { supabase: db, renew: async () => ({ success: false, error: 'insufficient funds' }), alertStaff: async (...a: any[]) => alerts.push(a) })
  check('paid but Namecheap refused: staff alerted, reason kept, and it is not retried by itself', r.renewed === false && alerts.length === 1 && /PAID/.test(db.rows[0].domain_renewal_error) && db.rows[0].domain_renewal_paid_invoice_id === 'in_3', db.rows[0])
}
check('any other paid invoice is not a domain renewal', (await R.completePaidDomainRenewal({ id: 'in_x', metadata: {} }, { supabase: table([]), renew: async () => ({ success: true }), alertStaff: async () => {} })).handled === false)

// ══ the Stripe invoice ══
{
  const calls: any[] = []
  const fake = {
    customers: { retrieve: async () => ({ invoice_settings: { default_payment_method: null } }) },
    subscriptions: { list: async () => ({ data: [{ default_payment_method: 'pm_sub' }] }) },
    paymentMethods: { list: async () => ({ data: [] }) },
    invoices: {
      create: async (p: any, o: any) => (calls.push(['create', p, o]), { id: 'in_new' }),
      finalizeInvoice: async () => ({ hosted_invoice_url: 'https://pay.test/in_new' }),
      pay: async (id: string, p: any) => (calls.push(['pay', id, p]), { status: 'paid' }),
    },
    invoiceItems: { create: async (p: any, o: any) => (calls.push(['item', p, o]), {}) },
  }
  const r = await createDomainRenewalInvoice({ customerId: 'cus_h', amountCents: 929, domain: 'higgsheritagebuilders.com', tenantId: 'higgs', expiresAt: '2027-10-03T23:29:41Z' }, fake)
  const create = calls.find((c) => c[0] === 'create'), item = calls.find((c) => c[0] === 'item'), pay = calls.find((c) => c[0] === 'pay')
  check('the invoice says what it is for, so the paid webhook can find it', create?.[1]?.metadata?.purpose === 'domain_renewal' && create[1].metadata.tenant_id === 'higgs' && create[1].pending_invoice_items_behavior === 'exclude')
  check('…charges the price on one line', item?.[1]?.amount === 929 && item[1].invoice === 'in_new')
  check('…with the card their subscription uses, off-session', pay?.[2]?.payment_method === 'pm_sub' && pay[2].off_session === true && r.paid === true, { pay, r })
  check('…and the same tenant + expiry cannot be billed twice (idempotency key)', create?.[2]?.idempotencyKey === 'domain-renewal-higgs-2027-10-03')
}
{
  const fake = {
    customers: { retrieve: async () => ({ invoice_settings: {} }) }, subscriptions: { list: async () => ({ data: [] }) }, paymentMethods: { list: async () => ({ data: [] }) },
    invoices: { create: async () => ({ id: 'in_n' }), finalizeInvoice: async () => ({ hosted_invoice_url: 'https://pay.test/in_n' }), pay: async () => { throw new Error('must not try to pay without a card') } },
    invoiceItems: { create: async () => ({}) },
  }
  const r = await createDomainRenewalInvoice({ customerId: 'c', amountCents: 1900, domain: 'a.com', tenantId: 't', expiresAt: '2027-10-03T00:00:00Z' }, fake)
  check('no saved card: not attempted, the pay link comes back for the email', r.paid === false && r.hostedUrl === 'https://pay.test/in_n', r)
}

// ══ the doors ══
{
  const src = (p: string) => readFileSync(new URL('../../apps/api/src/' + p, import.meta.url), 'utf8')
  const intake = src('routes/factory/intake.ts')
  check("signup refuses domainMode 'buy' — no domain is registered before payment", /if \(body\.domainMode === 'buy'\) \{\r?\n\s*return c\.json\(\{ error: 'Domains are bought after sign-up/.test(intake))
  const signupBlock = intake.slice(intake.indexOf("factory.post('/public/signup'"), intake.indexOf("factory.get('/public/signup/:id/next'"))
  check('…and the signup handler calls the registrar nowhere', !/registrar\.register\(|getRegistrar\(/.test(signupBlock))
  const billing = src('routes/factory/billing.ts')
  check('nothing sets a fixed renewal price behind the scenes (everyone is at cost + fee)', !/domain_renewal_price_cents: p\.costCents/.test(billing))
  check('the Factory domain routes are staff-only', ['get(\'/customers/:id/domain/billing\'', 'post(\'/customers/:id/domain/billing/sync\'', 'patch(\'/customers/:id/domain/billing\'', 'post(\'/customers/:id/domain/register\''].every((r) => billing.includes('factory.' + r + ", requireRole('owner', 'admin')")))
  check('the paid webhook hands a domain_renewal invoice to completePaidDomainRenewal', /event\.type === 'invoice\.paid' && event\.data\?\.object\?\.metadata\?\.purpose === 'domain_renewal'[\s\S]{0,300}completePaidDomainRenewal\(event\.data\.object/.test(billing))
  check('the daily cron bills due renewals', /chargeDueDomainRenewals\(now, \{/.test(src('routes/factory/lifecycle.ts')))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
