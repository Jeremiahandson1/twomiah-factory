// website-store — the two calls the storefront makes into crm-store.
//
// These carry a shopper's loyalty balance onto the cart and their chosen reward into checkout, and
// they were the one part of that path with no coverage: the cart itself is browser JS. The rules
// were lifted out of server-static.ts to make this possible — that file calls serve() and starts
// backups and migrations at import, so nothing inside it can be tested at all — and deliberately
// left framework-free, so this needs no web server and no dependencies.
//
// What matters most here is what happens when things go WRONG. A rewards lookup is a nicety; a cart
// is a purchase. Every failure has to leave the customer able to buy.
//
//   bun run tests/shared/storefront-proxy.test.ts
import {
  fetchLoyaltyQuote, forwardCheckout, originFromHeaders, EMPTY_QUOTE,
} from '../../templates/website-store/routes/storeApi.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

/** A stubbed upstream: records what the storefront asked for, answers what the test dictates. */
function stub(handler: (url: string, init: any) => any) {
  const calls: Array<{ url: string; init: any }> = []
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const isEmpty = (q: any) => q?.pointsBalance === 0 && Array.isArray(q?.rewards) && q.rewards.length === 0

const CRM = 'https://crm.example.com'
const QUOTE = {
  pointsBalance: 240,
  punchCard: { enabled: true, visitsRequired: 5, progress: 2, remaining: 3, unclaimed: 0 },
  rewards: [{ id: 'r1', name: '$10 off', pointsCost: 200, discountCents: 1000, available: true, onTheHouse: false }],
}

// ───────────────────────────────────────────────────────── the loyalty quote
{
  const s = stub(() => ok(QUOTE))
  const q: any = await fetchLoyaltyQuote({ crmStoreApiUrl: CRM, fetchImpl: s.fetchImpl }, { email: 'ada@example.com', subtotalCents: '5000' })
  check('quote: the shopper gets their balance and rewards', q.pointsBalance === 240 && q.rewards.length === 1, q)
  check('quote: the card position comes through', q.punchCard?.remaining === 3, q.punchCard)
  check('quote: the email is forwarded, encoded', /email=ada%40example\.com/.test(s.calls[0].url), s.calls[0]?.url)
  check('quote: and the cart subtotal it must be priced against', /subtotalCents=5000/.test(s.calls[0].url), s.calls[0]?.url)
  check('quote: asks crm-store\'s public endpoint', /\/api\/public\/loyalty\?/.test(s.calls[0].url), s.calls[0]?.url)
}
{
  const s = stub(() => ok(QUOTE))
  await fetchLoyaltyQuote({ crmStoreApiUrl: CRM + '///', fetchImpl: s.fetchImpl }, { email: 'a@b.com' })
  check('quote: a trailing slash on the configured URL does not produce a double slash',
    !/\/\/api\/public/.test(s.calls[0].url), s.calls[0]?.url)
}

// ── every failure leaves the cart working ──────────────────────────────────────────────────────
{
  const s = stub(() => ok(QUOTE))
  const q = await fetchLoyaltyQuote({ crmStoreApiUrl: '', fetchImpl: s.fetchImpl }, { email: 'ada@example.com' })
  check('soft: a store with no crm-store connected answers an empty balance', isEmpty(q), q)
  check('soft: ...and calls nothing', s.calls.length === 0, s.calls.length)
}
{
  const s = stub(() => ok(QUOTE))
  const q = await fetchLoyaltyQuote({ crmStoreApiUrl: CRM, fetchImpl: s.fetchImpl }, {})
  check('soft: no email means nobody to look up — empty, no request', isEmpty(q) && s.calls.length === 0, q)
}
{
  const q = await fetchLoyaltyQuote({ crmStoreApiUrl: CRM, fetchImpl: (async () => new Response('nope', { status: 500 })) as any }, { email: 'a@b.com' })
  check('soft: an upstream 500 becomes an empty balance, not an error the cart must handle', isEmpty(q), q)
}
{
  const q = await fetchLoyaltyQuote({ crmStoreApiUrl: CRM, fetchImpl: (async () => { throw new Error('timeout') }) as any }, { email: 'a@b.com' })
  check('soft: a timeout answers an empty balance', isEmpty(q), q)
}
{
  const q = await fetchLoyaltyQuote({ crmStoreApiUrl: CRM, fetchImpl: (async () => new Response('<html>', { status: 200 })) as any }, { email: 'a@b.com' })
  check('soft: a non-JSON answer does not throw', isEmpty(q), q)
}
{
  const s = stub(() => ok(QUOTE))
  await fetchLoyaltyQuote({ crmStoreApiUrl: CRM, fetchImpl: s.fetchImpl }, { email: 'a@b.com', subtotalCents: -500 })
  check('soft: a negative subtotal is floored at 0, never forwarded', /subtotalCents=0/.test(s.calls[0].url), s.calls[0]?.url)
  await fetchLoyaltyQuote({ crmStoreApiUrl: CRM, fetchImpl: s.fetchImpl }, { email: 'a@b.com', subtotalCents: 'abc' })
  check('soft: a nonsense subtotal is floored at 0 too', /subtotalCents=0/.test(s.calls[1].url), s.calls[1]?.url)
}

// ───────────────────────────────────────────────────────────────── checkout
{
  const s = stub(() => ok({ url: 'https://pay.example.com/session/abc' }))
  const out = await forwardCheckout({ crmStoreApiUrl: CRM, fetchImpl: s.fetchImpl }, {
    body: {
      items: [{ sku: 'A', quantity: 2 }],
      customerEmail: 'ada@example.com',
      loyaltyRewardId: 'r1',
      discountCode: 'SAVE10',
    },
    origin: 'https://shop.example.com',
  })
  const sent = JSON.parse(s.calls[0].init.body)

  check('checkout: the payment URL comes back', out.status === 200 && out.body.url === 'https://pay.example.com/session/abc', out)
  check('checkout: the shopper\'s email travels, or there is no balance to credit', sent.customerEmail === 'ada@example.com', sent)
  check('checkout: the chosen reward travels as an ID', sent.loyaltyRewardId === 'r1', sent)
  check('checkout: and ONLY as an id — no amount the browser could have invented',
    !('loyaltyDiscountCents' in sent) && !('discountCents' in sent), sent)
  check('checkout: a discount code still works alongside it', sent.discountCode === 'SAVE10', sent)
  check('checkout: the live origin is attached so payment returns to the right domain', sent.origin === 'https://shop.example.com', sent.origin)
}
{
  const s = stub(() => ok({ url: 'x' }))
  const body = { items: [] }
  await forwardCheckout({ crmStoreApiUrl: CRM, fetchImpl: s.fetchImpl }, { body, origin: 'https://a.com' })
  check('checkout: the caller\'s object is not mutated on its way through', !('origin' in body), body)
}
{
  const out = await forwardCheckout({ crmStoreApiUrl: '', fetchImpl: (async () => ok({})) as any }, { body: { items: [] } })
  check('checkout: an unconnected store says so plainly', out.status === 503, out)
}
{
  const out = await forwardCheckout(
    { crmStoreApiUrl: CRM, fetchImpl: (async () => new Response(JSON.stringify({ error: 'Cart is empty' }), { status: 400 })) as any },
    { body: { items: [] } },
  )
  check('checkout: an upstream refusal keeps its status AND its words — "Cart is empty" is actionable',
    out.status === 400 && out.body.error === 'Cart is empty', out)
}
{
  const out = await forwardCheckout({ crmStoreApiUrl: CRM, fetchImpl: (async () => ok({ ok: true })) as any }, { body: { items: [] } })
  check('checkout: a 200 with no URL is a failure, not a silent dead end', out.status === 502, out)
}
{
  const out = await forwardCheckout({ crmStoreApiUrl: CRM, fetchImpl: (async () => { throw new Error('ECONNREFUSED') }) as any }, { body: { items: [] } })
  check('checkout: an unreachable backend says so rather than hanging', out.status === 502 && /Could not reach/.test(out.body.error || ''), out)
}
{
  const out = await forwardCheckout({ crmStoreApiUrl: CRM, fetchImpl: (async () => ok({ url: 'x' })) as any }, { body: null })
  check('checkout: a malformed body is a 400, not a 500', out.status === 400, out)
}

// ─────────────────────────────────────────────────────────────── the origin
check('origin: the proxy header wins, because that is the domain the customer is on',
  originFromHeaders({ host: 'internal:3000', forwardedHost: 'shop.example.com', forwardedProto: 'https' }) === 'https://shop.example.com')
check('origin: falls back to the host header', originFromHeaders({ host: 'shop.example.com' }) === 'https://shop.example.com')
check('origin: a comma-listed proto takes the first hop', originFromHeaders({ host: 'a.com', forwardedProto: 'https,http' }) === 'https://a.com')
check('origin: with no host at all it uses the configured site URL',
  originFromHeaders({}, 'https://fallback.example.com') === 'https://fallback.example.com')

check('contract: EMPTY_QUOTE is the shape the cart renders against',
  isEmpty(EMPTY_QUOTE) && EMPTY_QUOTE.punchCard.enabled === false, EMPTY_QUOTE)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
