// A domain is never charged for until the registrar has everything it needs. (E2E Run 2, 10/15)
//
// A store bought testshopco-1015.site: Stripe took the money, then Namecheap refused — "Parameter RegistrantAddress1 is
// Missing" — and the Factory refunded. The signup collects no address and the only check before charging was a phone.
// This runs services/domainRegistrant.ts and reads the routes to prove every path that takes money asks it first.
const { readFileSync } = await import('node:fs')
const R = await import(new URL('../../apps/api/src/services/domainRegistrant.ts', import.meta.url).href)

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

// ── the rule
const full = { phone: '(715) 555-0100', address: '1 Main St', city: 'Eau Claire', state: 'WI', zip: '54701' }
check('a full contact registers', R.registrantGaps(full).length === 0)
check('the store that failed (a phone, nothing else) is missing street, city, state and ZIP', JSON.stringify(R.registrantGaps({ phone: '7155550100' })) === JSON.stringify(['street address', 'city', 'state', 'ZIP code']))
check('blanks and spaces count as missing', R.registrantGaps({ ...full, address: '   ', zip: '' }).join(',') === 'street address,ZIP code')
check('nothing at all lists all five', R.registrantGaps(null).length === 5)
check('the message names what is missing and says nothing was charged', /street address, city/.test(R.registrantMessage(['street address', 'city'])) && /nothing has been charged/.test(R.registrantMessage(['city'])))

// ── what staff type
const ok = R.cleanRegistrant({ address: ' 1 Main St ', city: 'Eau Claire', state: 'wi', zip: '54701', phone: '715-555-0100' })
check('cleaned: trimmed, state upper-cased', ok.ok && ok.patch.address === '1 Main St' && ok.patch.state === 'WI', ok)
check('a partial form changes only what it sends — never blanks what is on file', (() => { const r = R.cleanRegistrant({ city: 'Madison' }); return r.ok && Object.keys(r.patch).join() === 'city' })())
check('no registrant sent is fine (nothing to change)', (() => { const r = R.cleanRegistrant(undefined); return r.ok && Object.keys(r.patch).length === 0 })())
for (const [bad, why] of [[{ state: 'Wisconsin' }, 'state'], [{ zip: '5470' }, 'ZIP'], [{ phone: '555-0100' }, 'phone'], [{ address: 'x'.repeat(121) }, 'too long']] as const) {
  const r = R.cleanRegistrant(bad)
  check(`refused: ${why}`, !r.ok, r)
}
check('ZIP+4 is accepted', R.cleanRegistrant({ zip: '54701-1234' }).ok)

// ── every path that takes money asks first
const src = (p: string) => readFileSync(new URL('../../apps/api/src/' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const billing = src('routes/factory/billing.ts')
const staff = billing.slice(billing.indexOf("factory.post('/customers/:id/domain/register'"))
const staffBody = staff.slice(0, staff.indexOf('\nfactory.'))
const gapAt = staffBody.indexOf('const gaps = registrantGaps(tenant)')
check('staff route: the address is checked before EITHER path — at-cost registration and the customer checkout', gapAt > 0 && gapAt < staffBody.indexOf("if (body.billing === 'ours')") && gapAt < staffBody.indexOf('createOneTimeCheckoutSession'), gapAt)
check('…and a refusal stops it (422, registrant_incomplete)', /if \(gaps\.length\) return c\.json\(\{ error: registrantMessage\(gaps\), code: 'registrant_incomplete', missing: gaps \}, 422\)/.test(staffBody))
check('…what staff typed is saved on the company first, with an audit row', staffBody.indexOf("supabase.from('tenants').update(cleaned.patch)") > 0 && staffBody.indexOf("supabase.from('tenants').update(cleaned.patch)") < gapAt && /'registrant_updated'/.test(staffBody))
const life = src('routes/factory/lifecycle.ts')
const custAt = life.indexOf('const gaps = registrantGaps(tenant)')
const custCheckout = life.indexOf("purpose: 'domain_registration'")
check('customer\'s own checkout: refused before the checkout is created', custAt > 0 && custCheckout > custAt && /code: 'registrant_incomplete'/.test(life.slice(custAt, custCheckout)))
const handler = billing.slice(billing.indexOf('async function handleDomainRegistration'))
check('the paid webhook keeps the whole check as a backstop (not just the phone)', /const gaps = registrantGaps\(tenant\)[\s\S]{0,300}reason: 'no_registrant'/.test(handler.slice(0, handler.indexOf('registrar.register('))))
const refund = billing.slice(billing.indexOf('async function refundAndEmail'))
check('the refund email no longer sends a store or CRM owner to screens they do not have', !/Go back to your admin|use the "I already own a domain" tab/.test(refund) && /reply to this email/.test(refund))

// ── the panel
const panel = readFileSync(new URL('../../apps/platform/src/components/factory/DomainBilling.tsx', import.meta.url), 'utf8')
check('the panel sends the registrant with the registration, and asks for all five', /registrant: reg \}/.test(panel) && ['Street address', 'City', 'State', 'ZIP', 'Phone'].every((l) => panel.includes(`aria-label="${l}"`)))
const page = readFileSync(new URL('../../apps/platform/src/pages/CustomerDetailPage.tsx', import.meta.url), 'utf8')
check('a panel refresh no longer blanks the company page (the checkout link vanished)', /if \(!tenant \|\| tenant\.id !== id\) setLoading\(true\)/.test(page))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
