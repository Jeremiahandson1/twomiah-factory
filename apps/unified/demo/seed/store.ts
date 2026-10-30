// Sample Maple Mercantile: a small online shop — candles, kitchen goods and gifts — with a catalogue, a few weeks of orders in
// every stage, shoppers, reviews, discount codes and a gift card. Every name is invented; people are they/them. No product
// photos: the shop's own screens show their placeholder, and nothing is fetched from outside the demo.
// Products, codes, cards and settings go through the server's own routes; orders and reviews (which the server makes only from
// a paid checkout on a payment provider) are written to their tables in the shape the checkout writes them.
import { orderNumberFor } from '../../server/crm/store/checkout/checkoutService.ts'
import type { Kit } from './kit.ts'

type Line = { variant: { id: string; sku: string; name: string; priceCents: number }; product: { id: string; name: string }; quantity: number }

export default async function seed(k: Kit) {
  const { post, patch, put, day, at } = k
  const db = k.t.db as any
  const S = k.t.schema as any

  await patch('/api/admin/settings', {
    flatShippingCents: 600, freeShippingThresholdCents: 5000, taxRateBps: 550, reviewsEnabled: true, reviewRequestDays: 7,
    pickupEnabled: true, pickupAddress: '1200 Sample Street, Eau Claire, WI 54701', pickupHours: 'Tue–Sat 10am–5pm',
    abandonedCartEnabled: true,
    shippingZones: [{ name: 'Wisconsin and Minnesota', countries: ['US'], states: ['WI', 'MN'], rateCents: 450, freeThresholdCents: 4000 }],
  })

  // ── the catalogue ──────────────────────────────────────────────────────────────────────────────────────────
  const make = async (p: { name: string; category: string; tagline: string; description: string; brand?: string; featured?: boolean; status?: string; variants: Array<{ sku: string; name: string; priceCents: number; compareAtPriceCents?: number; qty: number | null; weightOz?: number; options?: Record<string, string> }> }) => {
    const product = await post('/api/admin/products', { name: p.name, category: p.category, tagline: p.tagline, description: p.description, brand: p.brand ?? 'Maple Mercantile', featured: p.featured ?? false, status: p.status ?? 'active' })
    const variants = [] as Array<{ id: string; sku: string; name: string; priceCents: number }>
    for (const [i, v] of p.variants.entries()) {
      const made = await post(`/api/admin/products/${product.id}/variants`, { sku: v.sku, name: v.name, priceCents: v.priceCents, compareAtPriceCents: v.compareAtPriceCents, inventoryQty: v.qty, weightOz: v.weightOz, options: v.options, position: i })
      variants.push({ id: made.id, sku: made.sku, name: made.name, priceCents: made.priceCents })
    }
    return { product: { id: product.id as string, name: product.name as string }, variants }
  }

  const candle = await make({
    name: 'Cedar & Smoke Soy Candle', category: 'Candles', tagline: 'Hand-poured, 40-hour burn', featured: true,
    description: 'A slow-burning soy candle with notes of cedar, smoked vanilla and a little black pepper. Poured in small batches in a reusable tin.',
    variants: [
      { sku: 'CND-CS-8', name: '8 oz tin', priceCents: 2400, qty: 36, weightOz: 12, options: { Size: '8 oz' } },
      { sku: 'CND-CS-16', name: '16 oz jar', priceCents: 3800, compareAtPriceCents: 4200, qty: 14, weightOz: 24, options: { Size: '16 oz' } },
    ],
  })
  const orchard = await make({
    name: 'Orchard Apple Soy Candle', category: 'Candles', tagline: 'Crisp apple, cinnamon bark',
    description: 'Bright apple skin, cinnamon bark and a hint of clove. Seasonal, while the batch lasts.',
    variants: [{ sku: 'CND-OA-8', name: '8 oz tin', priceCents: 2400, qty: 4, weightOz: 12, options: { Size: '8 oz' } }],
  })
  const mug = await make({
    name: 'Stoneware Mug', category: 'Kitchen', tagline: 'Wheel-thrown look, dishwasher safe', featured: true,
    description: 'A 12 oz stoneware mug with a speckled glaze and a comfortable handle. Microwave and dishwasher safe.',
    variants: [
      { sku: 'MUG-OAT', name: 'Oat', priceCents: 1800, qty: 22, weightOz: 16, options: { Colour: 'Oat' } },
      { sku: 'MUG-SLATE', name: 'Slate', priceCents: 1800, qty: 18, weightOz: 16, options: { Colour: 'Slate' } },
      { sku: 'MUG-SAGE', name: 'Sage', priceCents: 1800, qty: 0, weightOz: 16, options: { Colour: 'Sage' } },
    ],
  })
  const board = await make({
    name: 'Maple Serving Board', category: 'Kitchen', tagline: 'Solid maple, food-safe oil finish',
    description: 'A thick serving board in solid maple, finished with food-safe mineral oil. Each board has its own grain.',
    variants: [
      { sku: 'BRD-S', name: 'Small (10 in)', priceCents: 3200, qty: 12, weightOz: 28, options: { Size: 'Small' } },
      { sku: 'BRD-L', name: 'Large (16 in)', priceCents: 5400, qty: 7, weightOz: 56, options: { Size: 'Large' } },
    ],
  })
  const towels = await make({
    name: 'Linen Tea Towels (set of 2)', category: 'Kitchen', tagline: 'Washed linen, gets softer every wash',
    description: 'Two washed-linen tea towels, 20 by 28 inches, in a matching stripe.',
    variants: [{ sku: 'TWL-2', name: 'Set of 2', priceCents: 2200, qty: 40, weightOz: 8 }],
  })
  const syrup = await make({
    name: 'Wisconsin Maple Syrup', category: 'Pantry', tagline: 'Dark and robust, from a family sugarbush',
    description: 'Grade A dark, robust maple syrup from a small family sugarbush, bottled by the pint or the quart.',
    variants: [
      { sku: 'SYR-PT', name: 'Pint', priceCents: 1600, qty: 30, weightOz: 26, options: { Size: 'Pint' } },
      { sku: 'SYR-QT', name: 'Quart', priceCents: 2800, qty: 16, weightOz: 48, options: { Size: 'Quart' } },
    ],
  })
  const tin = await make({
    name: 'Gift Box — Cozy Evening', category: 'Gifts', tagline: 'A candle, a mug and a tea towel, boxed', featured: true,
    description: 'A ready-to-give box with an 8 oz candle, a stoneware mug and a linen tea towel, wrapped in kraft paper.',
    variants: [{ sku: 'GFT-COZY', name: 'Boxed', priceCents: 5200, compareAtPriceCents: 5900, qty: 9, weightOz: 40 }],
  })
  await make({
    name: 'Cinnamon Stick Bundle', category: 'Pantry', tagline: 'Coming this fall', status: 'draft',
    description: 'Whole cinnamon sticks, tied with twine. Not on sale yet.',
    variants: [{ sku: 'PNT-CIN', name: 'Bundle of 12', priceCents: 900, qty: 0 }],
  })
  await make({
    name: 'Holiday Wreath Candle', category: 'Candles', tagline: 'Last year\'s design', status: 'archived',
    description: 'A seasonal candle from last year, no longer made.',
    variants: [{ sku: 'CND-HW-8', name: '8 oz tin', priceCents: 2600, qty: 3 }],
  })

  // Cross-sells: "Frequently bought together" on the candle and the mug.
  await patch(`/api/admin/products/${candle.product.id}`, { boughtTogetherIds: [mug.product.id, towels.product.id], alsoLikeIds: [orchard.product.id, tin.product.id] })
  await patch(`/api/admin/products/${mug.product.id}`, { boughtTogetherIds: [candle.product.id, syrup.product.id] })

  // ── shoppers ───────────────────────────────────────────────────────────────────────────────────────────────
  const shopper = (name: string, email: string, city: string, state: string, phone: string) => post('/api/contacts', { type: 'customer', name, email, phone, city, state, source: 'website' })
  const wren = await shopper('Wren Alder', 'wren.alder@example.com', 'Eau Claire', 'WI', '(715) 555-0201')
  const dale = await shopper('Dale Hartwell', 'dale.hartwell@example.com', 'Menomonie', 'WI', '(715) 555-0202')
  const priya = await shopper('Priya Nandakumar', 'priya.n@example.com', 'Minneapolis', 'MN', '(612) 555-0203')
  const ellis = await shopper('Ellis Moreau', 'ellis.moreau@example.com', 'Madison', 'WI', '(608) 555-0204')
  const sage = await shopper('Sage Whitlock', 'sage.whitlock@example.com', 'Chippewa Falls', 'WI', '(715) 555-0205')
  const noor = await shopper('Noor Castellan', 'noor.castellan@example.com', 'Eau Claire', 'WI', '(715) 555-0206')
  await post('/api/contacts', { type: 'lead', name: 'Fern Okafor', email: 'fern.okafor@example.com', phone: '(715) 555-0211', source: 'website', notes: 'Asked whether we do wholesale for her gift shop.' })
  await post('/api/contacts', { type: 'lead', name: 'Reese Lindqvist', email: 'reese.l@example.com', phone: '(715) 555-0212', source: 'website', notes: 'Wants 40 gift boxes for a company event in December.' })
  await post('/api/contacts', { type: 'vendor', name: 'North Bay Tins & Jars', company: 'North Bay Tins & Jars', email: 'orders@northbay.example', phone: '(715) 555-0221' })

  // ── orders ─────────────────────────────────────────────────────────────────────────────────────────────────
  let n = 0
  const addr = (name: string, line1: string, city: string, state: string, postal_code: string) => ({ name, line1, line2: null, city, state, postal_code, country: 'US' })
  const order = async (o: {
    who: { id: string }; name: string; email: string; phone: string; address: ReturnType<typeof addr> | null; ageDays: number; hour?: string; status: string
    lines: Line[]; shippingCents?: number; discountCode?: string; discountCents?: number; fulfillment?: 'ship' | 'pickup'; note?: string; internalNote?: string
    tracking?: { carrier: string; number: string }; refundedCents?: number
  }) => {
    n++
    const subtotal = o.lines.reduce((sum, l) => sum + l.variant.priceCents * l.quantity, 0)
    const shipping = o.fulfillment === 'pickup' ? 0 : (o.shippingCents ?? 0)
    const discount = o.discountCents ?? 0
    const tax = Math.round((subtotal - discount) * 0.055)
    const total = subtotal - discount + shipping + tax
    const created = new Date(at(-o.ageDays, o.hour ?? '10:30'))
    const shipped = ['fulfilled', 'shipped', 'delivered', 'picked_up'].includes(o.status)
    const [row] = await db.insert(S.storeOrder).values({
      companyId: k.companyId, contactId: o.who.id, provider: 'stripe', providerSessionId: `cs_sample_${n}`, providerPaymentId: o.status === 'pending' ? null : `pi_sample_${n}`,
      status: o.status, customerEmail: o.email, customerName: o.name, customerPhone: o.phone, shippingAddress: o.address, billingAddress: o.address,
      subtotalCents: subtotal, shippingCents: shipping, taxCents: tax, discountCents: discount, totalCents: total, discountCode: o.discountCode ?? null,
      customerNote: o.note ?? null, internalNote: o.internalNote ?? null,
      fulfillment: o.fulfillment ?? 'ship', refundedCents: o.refundedCents ?? 0, refundedAt: o.refundedCents ? new Date(created.getTime() + 2 * 86_400_000) : null,
      trackingCarrier: o.tracking?.carrier ?? null, trackingNumber: o.tracking?.number ?? null,
      fulfilledAt: shipped ? new Date(created.getTime() + 86_400_000) : null,
      pickedUpAt: o.status === 'picked_up' ? new Date(created.getTime() + 86_400_000) : null,
      createdAt: created, updatedAt: created,
    }).returning()
    await db.update(S.storeOrder).set({ orderNumber: orderNumberFor(row.id) }).where((await import('drizzle-orm')).eq(S.storeOrder.id, row.id))
    for (const l of o.lines) {
      await db.insert(S.storeOrderItem).values({
        orderId: row.id, productId: l.product.id, variantId: l.variant.id, productName: l.product.name, variantName: l.variant.name, sku: l.variant.sku,
        unitPriceCents: l.variant.priceCents, quantity: l.quantity, lineTotalCents: l.variant.priceCents * l.quantity,
      })
    }
    return row as { id: string }
  }
  const line = (p: { product: { id: string; name: string }; variants: Array<{ id: string; sku: string; name: string; priceCents: number }> }, variantIndex: number, quantity = 1): Line => ({ product: p.product, variant: p.variants[variantIndex], quantity })

  const o1 = await order({ who: wren, name: 'Wren Alder', email: 'wren.alder@example.com', phone: '(715) 555-0201', address: addr('Wren Alder', '214 Birch Street', 'Eau Claire', 'WI', '54701'), ageDays: 0, hour: '08:40', status: 'paid', shippingCents: 600, lines: [line(candle, 0, 2), line(mug, 0)], note: 'Please leave on the porch if I am out.' })
  await order({ who: dale, name: 'Dale Hartwell', email: 'dale.hartwell@example.com', phone: '(715) 555-0202', address: addr('Dale Hartwell', '88 Ridge Road', 'Menomonie', 'WI', '54751'), ageDays: 1, hour: '19:05', status: 'paid', shippingCents: 450, lines: [line(board, 1)], discountCode: 'WELCOME10', discountCents: 540 })
  await order({ who: priya, name: 'Priya Nandakumar', email: 'priya.n@example.com', phone: '(612) 555-0203', address: addr('Priya Nandakumar', '1507 Lyndale Ave S', 'Minneapolis', 'MN', '55403'), ageDays: 2, hour: '12:15', status: 'paid', shippingCents: 450, lines: [line(tin, 0, 2)], internalNote: 'Gift — add a card if there is room in the box.' })
  const o4 = await order({ who: ellis, name: 'Ellis Moreau', email: 'ellis.moreau@example.com', phone: '(608) 555-0204', address: addr('Ellis Moreau', '31 Willow Court', 'Madison', 'WI', '53703'), ageDays: 4, status: 'shipped', shippingCents: 600, lines: [line(syrup, 1, 2), line(towels, 0)], tracking: { carrier: 'USPS', number: '9400111899223344556677' } })
  await order({ who: sage, name: 'Sage Whitlock', email: 'sage.whitlock@example.com', phone: '(715) 555-0205', address: addr('Sage Whitlock', '9 Pine Lane', 'Chippewa Falls', 'WI', '54729'), ageDays: 6, hour: '15:20', status: 'shipped', shippingCents: 450, lines: [line(mug, 1, 2), line(orchard, 0)], tracking: { carrier: 'USPS', number: '9400111899223344558899' } })
  const o6 = await order({ who: wren, name: 'Wren Alder', email: 'wren.alder@example.com', phone: '(715) 555-0201', address: addr('Wren Alder', '214 Birch Street', 'Eau Claire', 'WI', '54701'), ageDays: 12, status: 'delivered', shippingCents: 600, lines: [line(candle, 1)], tracking: { carrier: 'UPS', number: '1Z999AA10123456784' } })
  const o7 = await order({ who: noor, name: 'Noor Castellan', email: 'noor.castellan@example.com', phone: '(715) 555-0206', address: null, ageDays: 9, hour: '11:00', status: 'picked_up', fulfillment: 'pickup', lines: [line(board, 0), line(syrup, 0)] })
  await order({ who: noor, name: 'Noor Castellan', email: 'noor.castellan@example.com', phone: '(715) 555-0206', address: null, ageDays: 1, hour: '16:45', status: 'paid', fulfillment: 'pickup', lines: [line(tin, 0)], note: 'I will come by Saturday afternoon.' })
  await order({ who: dale, name: 'Dale Hartwell', email: 'dale.hartwell@example.com', phone: '(715) 555-0202', address: addr('Dale Hartwell', '88 Ridge Road', 'Menomonie', 'WI', '54751'), ageDays: 20, status: 'delivered', shippingCents: 450, lines: [line(towels, 0, 2), line(mug, 0, 2)], tracking: { carrier: 'USPS', number: '9400111899223344550011' } })
  await order({ who: priya, name: 'Priya Nandakumar', email: 'priya.n@example.com', phone: '(612) 555-0203', address: addr('Priya Nandakumar', '1507 Lyndale Ave S', 'Minneapolis', 'MN', '55403'), ageDays: 16, status: 'refunded', shippingCents: 450, lines: [line(board, 0)], refundedCents: 3796, internalNote: 'Arrived with a chip in the corner — full refund, no return needed.' })
  await order({ who: ellis, name: 'Ellis Moreau', email: 'ellis.moreau@example.com', phone: '(608) 555-0204', address: addr('Ellis Moreau', '31 Willow Court', 'Madison', 'WI', '53703'), ageDays: 23, status: 'cancelled', shippingCents: 600, lines: [line(candle, 1)], internalNote: 'Cancelled at the customer\'s request before it shipped.' })
  void o1; void o4

  // ── reviews: a mix waiting for a decision and published ────────────────────────────────────────────────────
  const review = (productId: string, authorName: string, rating: number, title: string, body: string, status: string, verified: boolean, ageDays: number, orderId?: string) =>
    db.insert(S.productReview).values({ companyId: k.companyId, productId, orderId: orderId ?? null, authorName, authorEmail: `${authorName.split(' ')[0].toLowerCase()}@example.com`, rating, title, body, status, verifiedPurchase: verified, createdAt: new Date(at(-ageDays, '13:00')), updatedAt: new Date(at(-ageDays, '13:00')) })
  await review(candle.product.id, 'Wren A.', 5, 'Smells like a cabin', 'The cedar is warm and the smoke is faint. Burned clean all evening.', 'approved', true, 8, o6.id)
  await review(mug.product.id, 'Sage W.', 5, 'The right size', 'Holds a full cup of tea and the handle is comfortable.', 'approved', true, 3)
  await review(board.product.id, 'Noor C.', 4, 'Lovely grain', 'Beautiful board. I wish it came with a little oil for the first use.', 'approved', true, 6, o7.id)
  await review(syrup.product.id, 'Ellis M.', 5, 'Robust and rich', 'Great on pancakes and in coffee.', 'pending', true, 1)
  await review(tin.product.id, 'Dale H.', 3, 'Nice but pricey', 'Good quality, though I would have liked a second candle in the box.', 'pending', false, 2)
  await review(towels.product.id, 'Priya N.', 2, 'Thinner than expected', 'They are fine, a little lighter than the photo suggested.', 'rejected', false, 14)

  // ── promotions, rewards and cards ──────────────────────────────────────────────────────────────────────────
  await post('/api/admin/discounts', { code: 'WELCOME10', type: 'percent', value: 10, minSubtotalCents: 2000 })
  await post('/api/admin/discounts', { code: 'FREESHIP', type: 'fixed', value: 600, minSubtotalCents: 3500, maxUses: 100 })
  await post('/api/admin/discounts', { code: 'HARVEST15', type: 'percent', value: 15, active: false, expiresAt: new Date(at(-3, '12:00')).toISOString() })
  await put('/api/admin/loyalty/config', { loyaltyEnabled: true, loyaltyPointsPerDollar: 1, loyaltyWelcomePoints: 50, loyaltyPunchCard: { visitsRequired: 5, rewardName: 'Free 8 oz candle' } })
  await post('/api/admin/loyalty/rewards', { name: '$5 off your order', pointsCost: 250, type: 'fixed', valueCents: 500, minSubtotalCents: 2500 })
  await post('/api/admin/loyalty/rewards', { name: '10% off your order', pointsCost: 400, type: 'percent', valueCents: 10 })
  await post('/api/admin/gift-cards', { cents: 2500, recipientName: 'Wren Alder', message: 'Thank you for being a regular.' })
  await post('/api/admin/gift-cards', { cents: 5000, recipientName: 'Sample Recipient' })
}
