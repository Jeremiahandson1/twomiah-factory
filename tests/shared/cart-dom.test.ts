// website-store — the cart's own behaviour, in a real DOM.
//
// The cart is dependency-free browser JS, and the part of it that carries loyalty has a property no
// amount of extracting can test: the whole order summary is re-rendered on every change, so any
// state living in an input is destroyed the moment a shopper adjusts a quantity. I hit exactly that
// while writing it — a typed email vanished when a line changed — and found it by reading rather
// than by testing. This is the harness that would have caught it.
//
// In-process happy-dom: no browser binary, no network, no server. cart.js is loaded EXACTLY as the
// browser gets it, unmodified, which is the point — a test that needed the source rearranged would
// be testing a different file from the one that ships.
//
//   bun run tests/shared/cart-dom.test.ts
import { Window } from 'happy-dom'
import { readFileSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const SLUG = 'demo-store'
const CART_KEY = `${SLUG}-cart`
const SRC = readFileSync(
  new URL('../../templates/website-store/build/scripts/cart.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  'utf8',
  // The Factory substitutes this at generation; do the same so the test drives the real key.
).replaceAll('{{COMPANY_SLUG}}', SLUG)

const QUOTE = {
  pointsBalance: 240,
  punchCard: { enabled: true, visitsRequired: 5, progress: 2, remaining: 3, unclaimed: 0 },
  rewards: [
    { id: 'r1', name: '$10 off', pointsCost: 200, discountCents: 1000, available: true, onTheHouse: false },
    { id: 'r2', name: '$50 off', pointsCost: 200, discountCents: 5000, available: false, reason: 'Spend at least 400.00 to use this', onTheHouse: false },
  ],
}

interface Harness {
  win: any
  doc: any
  calls: { loyalty: string[]; checkout: any[] }
  flush: () => Promise<void>
}

/** A page with a cart in localStorage and cart.js running against it. */
function boot(cart: Array<{ sku: string; name: string; unitPriceCents: number; qty: number }>): Harness {
  const win: any = new Window({ url: 'https://shop.example.com/cart' })
  const doc = win.document
  doc.body.innerHTML = '<div id="cart-root"></div><span data-cart-count></span>'
  win.localStorage.setItem(CART_KEY, JSON.stringify(cart))

  const calls = { loyalty: [] as string[], checkout: [] as any[] }
  win.fetch = async (url: string, init?: any) => {
    const u = String(url)
    if (u.startsWith('/api/loyalty')) {
      calls.loyalty.push(u)
      return { ok: true, json: async () => QUOTE }
    }
    if (u.startsWith('/api/checkout')) {
      calls.checkout.push(JSON.parse(init.body))
      return { ok: true, json: async () => ({ url: 'https://pay.example.com/go' }) }
    }
    return { ok: false, json: async () => ({}) }
  }

  // cart.js is an IIFE that reads document/window/localStorage off the global scope and self-inits.
  win.eval(SRC)

  return {
    win, doc, calls,
    // The debounce is 500ms and the fetches are promises; let both settle.
    flush: async () => { await new Promise((r) => setTimeout(r, 620)) },
  }
}

const q = (h: Harness, sel: string) => h.doc.querySelector(sel)
const typeEmail = (h: Harness, value: string) => {
  const el = q(h, '[data-customer-email]')
  el.value = value
  el.dispatchEvent(new h.win.Event('input', { bubbles: true }))
}

const CART = [{ sku: 'A', name: 'Widget', unitPriceCents: 2500, qty: 2 }]

// ─────────────────────────────────────────────────────── the cart still works
{
  const h = boot(CART)
  check('cart: the page renders its lines', !!q(h, '.cart-line'), h.doc.body.innerHTML.slice(0, 120))
  check('cart: with the email field for loyalty', !!q(h, '[data-customer-email]'))
  check('cart: and the loyalty panel starts hidden', q(h, '[data-loyalty-panel]')?.style.display === 'none')
  check('cart: nothing is asked for before an email is given', h.calls.loyalty.length === 0, h.calls.loyalty)
}

// ───────────────────────────────────────────── the quote, once there is an email
{
  const h = boot(CART)
  typeEmail(h, 'ada@example.com')
  await h.flush()

  check('quote: asked once an email is typed', h.calls.loyalty.length === 1, h.calls.loyalty)
  check('quote: sends the email', /email=ada%40example\.com/.test(h.calls.loyalty[0] || ''), h.calls.loyalty[0])
  check('quote: and the cart subtotal — 2 x $25.00 is 5000c', /subtotalCents=5000/.test(h.calls.loyalty[0] || ''), h.calls.loyalty[0])

  const panel = q(h, '[data-loyalty-panel]')
  check('quote: the panel is shown', panel?.style.display === 'block', panel?.style.display)
  check('quote: the balance is on screen', /240/.test(panel?.textContent || ''), panel?.textContent)
  check('quote: the card position is spelled out, not a number to decode',
    /2 of 5 orders/.test(panel?.textContent || ''), panel?.textContent)

  const opts = Array.from(q(h, '[data-loyalty-reward]')?.options || []) as any[]
  check('quote: a "no reward" choice exists so it is opt-in', opts[0]?.value === '', opts[0]?.value)
  check('quote: the affordable reward is selectable', opts.find((o) => o.value === 'r1')?.disabled === false)
  check('quote: the unaffordable one is disabled rather than hidden', opts.find((o) => o.value === 'r2')?.disabled === true)
  check('quote: ...and says why', /Spend at least/.test(opts.find((o) => o.value === 'r2')?.text || ''), opts.find((o) => o.value === 'r2')?.text)
}

// ── THE REGRESSION: a re-render must not wipe what the shopper typed ───────────────────────────
{
  const h = boot(CART)
  typeEmail(h, 'ada@example.com')
  await h.flush()

  const sel: any = q(h, '[data-loyalty-reward]')
  sel.value = 'r1'
  sel.dispatchEvent(new h.win.Event('change', { bubbles: true }))

  // Nudge a line quantity — this re-renders the whole summary.
  const qty: any = q(h, '[data-line-qty]')
  qty.value = '3'
  qty.dispatchEvent(new h.win.Event('change', { bubbles: true }))
  await h.flush()

  check('re-render: the email survives a quantity change', q(h, '[data-customer-email]')?.value === 'ada@example.com',
    q(h, '[data-customer-email]')?.value)
  check('re-render: the quote is re-asked against the NEW subtotal — 3 x $25.00',
    h.calls.loyalty.some((u) => /subtotalCents=7500/.test(u)), h.calls.loyalty)
  check('re-render: the panel is still on screen', q(h, '[data-loyalty-panel]')?.style.display === 'block')
  check('re-render: and the chosen reward is still selected',
    q(h, '[data-loyalty-reward]')?.value === 'r1', q(h, '[data-loyalty-reward]')?.value)
}

// ───────────────────────────────────────────────── what checkout actually sends
{
  const h = boot(CART)
  typeEmail(h, 'ada@example.com')
  await h.flush()
  const sel: any = q(h, '[data-loyalty-reward]')
  sel.value = 'r1'
  sel.dispatchEvent(new h.win.Event('change', { bubbles: true }))

  q(h, '[data-discount-code]').value = 'SAVE10'
  q(h, '[data-checkout]').click()
  await h.flush()

  const sent = h.calls.checkout[0]
  check('checkout: the cart lines are sent', sent?.items?.[0]?.sku === 'A' && sent.items[0].quantity === 2, sent)
  check('checkout: the email travels, or there is no balance to credit', sent?.customerEmail === 'ada@example.com', sent)
  check('checkout: the chosen reward travels as an id', sent?.loyaltyRewardId === 'r1', sent)
  check('checkout: and ONLY as an id — no amount the browser could have invented',
    !('loyaltyDiscountCents' in (sent || {})) && !('discountCents' in (sent || {})), sent)
  check('checkout: a discount code still rides alongside', sent?.discountCode === 'SAVE10', sent)
}

// ── loyalty is optional: a shopper who ignores it checks out exactly as before ─────────────────
{
  const h = boot(CART)
  q(h, '[data-checkout]').click()
  await h.flush()
  const sent = h.calls.checkout[0]
  check('optional: no email means no loyalty fields at all',
    !!sent && !('customerEmail' in sent) && !('loyaltyRewardId' in sent), sent)
  check('optional: and the sale still goes through', h.calls.checkout.length === 1)
}
{
  const h = boot(CART)
  typeEmail(h, 'ada@example.com')
  await h.flush()
  // Chose a reward, then changed their mind back to "No reward".
  const sel: any = q(h, '[data-loyalty-reward]')
  sel.value = 'r1'; sel.dispatchEvent(new h.win.Event('change', { bubbles: true }))
  sel.value = ''; sel.dispatchEvent(new h.win.Event('change', { bubbles: true }))
  q(h, '[data-checkout]').click()
  await h.flush()
  check('optional: deselecting a reward really removes it', !('loyaltyRewardId' in (h.calls.checkout[0] || {})), h.calls.checkout[0])
}

// ─────────────────────── a half-typed address must not be asked about on every keystroke
{
  const h = boot(CART)
  typeEmail(h, 'a')
  typeEmail(h, 'ad')
  typeEmail(h, 'ada')
  await h.flush()
  check('debounce: an address with no @ is never sent', h.calls.loyalty.length === 0, h.calls.loyalty)

  typeEmail(h, 'a@b.com')
  typeEmail(h, 'a@b.como')
  typeEmail(h, 'a@b.com')
  await h.flush()
  check('debounce: rapid typing produces ONE request, not one per keystroke', h.calls.loyalty.length === 1, h.calls.loyalty)
}

// ───────────────────────────────── a broken lookup must never block a purchase
{
  const h = boot(CART)
  h.win.fetch = async (url: string, init?: any) => {
    if (String(url).startsWith('/api/loyalty')) throw new Error('offline')
    h.calls.checkout.push(JSON.parse(init.body))
    return { ok: true, json: async () => ({ url: 'https://pay.example.com/go' }) }
  }
  typeEmail(h, 'ada@example.com')
  await h.flush()
  check('resilient: a failed quote leaves the panel hidden rather than showing an error',
    q(h, '[data-loyalty-panel]')?.style.display === 'none')

  q(h, '[data-checkout]').click()
  await h.flush()
  check('resilient: and the customer can still check out', h.calls.checkout.length === 1, h.calls.checkout)
  check('resilient: their email still travels, so the order still earns points',
    h.calls.checkout[0]?.customerEmail === 'ada@example.com', h.calls.checkout[0])
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
