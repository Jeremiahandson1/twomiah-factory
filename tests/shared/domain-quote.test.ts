// A domain's price — the first year AND every year after — shown before anyone pays. (Owner, 10/15)
//
// E2E Run 2: a .site cost $1.53 for the first year and renews at $31.40; the buy page showed no price and the Stripe
// page only $1.53. Owner: "close to first year, but we can just make it real transparent too, let them know in bold
// the next year cost." Namecheap is answered here; nothing leaves the machine.
//   bun tests/shared/domain-quote.test.ts
import { readFileSync, readdirSync } from 'node:fs'
import { quoteDomain, pricedSuggestions, renewsClose, forgetDomainPrices, quoteWords } from '../../apps/api/src/services/domainQuote'
import { domainChargeDescription, withStripeFee } from '../../apps/api/src/config/domainPricing'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

// Namecheap's cost to us, by ending: .site is the E2E Run 2 one.
const COST: Record<string, { REGISTER: number | null; RENEW: number | null }> = {
  com: { REGISTER: 1128, RENEW: 1598 }, site: { REGISTER: 118, RENEW: 3018 }, net: { REGISTER: 1298, RENEW: 1698 },
  co: { REGISTER: null, RENEW: 3299 },
}
let calls = 0
const source = { async getCostCents(tld: string, action: 'REGISTER' | 'RENEW') { calls++; return COST[tld]?.[action] ?? null } }

{
  check('close: a .com at $11.28 renewing at $15.98 stays close', renewsClose(withStripeFee(1128), withStripeFee(1598)))
  check('close: a .site at $1.53 renewing at $31.40 does not', !renewsClose(withStripeFee(118), withStripeFee(3018)))
  check('close: a cheap ending within $5.00 is close even past half again ($1.00 → $5.50)', renewsClose(100, 550))
}
{
  forgetDomainPrices(); calls = 0
  const q = await quoteDomain(source, 'testshopco-1015b.site')
  check(`quote: the .site is $1.53 now and $31.40 a year after — what the customer is charged (${JSON.stringify(q)})`, q?.firstYearCents === 153 && q?.renewalCents === 3140 && q?.renewsHigher === true)
  check('quote: the words say both', !!q && quoteWords(q) === '$1.53 for the first year, then $31.40 a year')
  const c0 = calls
  await quoteDomain(source, 'another.site')
  check(`cache: the same ending again within the hour asks Namecheap nothing (${calls - c0} calls)`, calls === c0)
  check('quote: an ending we do not sell has no quote', (await quoteDomain(source, 'shop.xyz')) === null)
  check('quote: an ending Namecheap cannot price has no quote — and a failed read is not cached', (await quoteDomain(source, 'shop.co')) === null)
  COST.co.REGISTER = 2999
  check('cache: …so once Namecheap answers, it is priced', (await quoteDomain(source, 'shop.co'))?.firstYearCents === withStripeFee(2999))
  COST.co.REGISTER = null; forgetDomainPrices()
}
{
  const out = await pricedSuggestions(source, [{ domain: 'a.site' }, { domain: 'a.net' }, { domain: 'a.xyz' }, { domain: 'a.com' }, { domain: 'a.co' }])
  check(`suggestions: close renewers first, cheapest renewal next; unpriced and unsold left out (${out.map((s) => s.domain).join(', ')})`, out.map((s) => s.domain).join(',') === 'a.com,a.net,a.site', out)
  check('suggestions: each carries its quote', out.every((s) => s.quote.renewalCents > 0))
}
{
  const d = domainChargeDescription('testshopco-1015b.site', 1, 3140)
  check(`Stripe: the checkout line states the renewal ("${d}")`, /Renews at \$31\.40 a year after that$/.test(d))
  check('Stripe: without a renewal price the line is as before', domainChargeDescription('x.com', 1) === 'x.com — 1 year (registration + WHOIS privacy), at cost plus card processing')
}
{
  // Both buy routes read the renewal for every purchase and pass it to the Stripe line.
  const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  for (const f of ['apps/api/src/routes/factory/lifecycle.ts', 'apps/api/src/routes/factory/billing.ts']) {
    const src = readFileSync(ROOT + f, 'utf8')
    check(`${f}: the Stripe line is given the renewal price`, /domainChargeDescription\(domain, years, renewalChargeCents\(renewCost\)\)/.test(src) && /const renewCost = await registrar\.getCostCents\(tld\.tld, 'RENEW'\)/.test(src))
  }
  const intake = readFileSync(ROOT + 'apps/api/src/routes/factory/intake.ts', 'utf8')
  check('availability: an available domain is answered with its quote; suggestions are priced', /quote: primary\.premium \? null : await quoteDomain\(registrar, domain\)/.test(intake) && /await pricedSuggestions\(registrar,/.test(intake))
  // The premium admin's Domain page, every copy.
  const dirs = readdirSync(ROOT + 'templates').filter((d) => d.startsWith('website-premium-'))
  for (const d of dirs) {
    const page = readFileSync(ROOT + `templates/${d}/admin/src/pages/DomainPage.tsx`, 'utf8')
    check(`${d}: both prices, the renewal in bold, a warning when it jumps, no Register without a price`,
      /<strong>\{usd\(check\.quote\.renewalCents\)\} a year<\/strong>/.test(page) && /check\.quote\.renewsHigher &&/.test(page) && /disabled=\{byodSubmitting \|\| !check\.quote\}/.test(page) && /<strong>\{usd\(s\.quote\.renewalCents\)\}\/yr<\/strong>/.test(page))
  }
}

console.log(`\ndomain quote: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
