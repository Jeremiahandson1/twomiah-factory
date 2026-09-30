import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { product, company, order, orderItem, contact } from '../../db/schema.ts'
import { eq, and, asc, sql } from 'drizzle-orm'
import { isCannabisLine, resolvePurchaseLimitOz, GRAMS_PER_OZ, gramsText, cartCannabisGrams, overPurchaseLimit, uncountableCannabisLines, unweighedCannabisRefusal, ageFromDob, minimumAgeFor } from '../utils/cannabis.ts'
import { matchZoneForAddress, zoneTerms } from '../utils/delivery.ts'
import { loadEquivalencyFactors } from '../services/equivalency.ts'
import { zodRefusal } from '../utils/errors.ts'
// The same batch rule the register runs — one implementation, every door. (T49 B1)
import { resolveSellableStock, recalledProductIds } from '../services/sellableStock.ts'

// Cannabis purchase limit: the company's configured/state limit (utils/cannabis.ts) — was a hardcoded 2.5 oz.
const CANNABIS_TAX_RATE = 0.15 // 15% cannabis excise tax
const SALES_TAX_RATE = 0.0875 // state + local sales tax

const app = new Hono()

// ── the public menu cache, and why it is stamped rather than merely timed ───────────────────────
//
// T52 N8. The menu was cached for 60 seconds flat, so a recall took up to a minute to leave the
// public menu. For a minute the shop was still offering, by name and price, a product it had just
// declared unsafe — and "the website was a minute behind" is not a thing a shop wants to explain
// to a regulator or to the person who bought it.
//
// The obvious fix is to have the recall route clear the cache. That is the fix this codebase has
// now been burned by four times (T48 Q6, T47 P20, T49 B1, T52 M6): a rule that every writer has to
// remember, which works until someone adds the writer that does not. Batch status alone is written
// from batches.ts in five places, wholesale.ts, manufacturing.ts and compliance.ts, and a product
// leaves the menu through `active`, `visible`, price and stock as well as through a recall.
//
// So the cache validates itself instead. A cached menu carries a STAMP — the newest updated_at and
// the row count across this company's products and batches — and it is served only while the shop's
// stock still stamps the same. One small indexed query replaces the twenty the menu build runs, the
// cache keeps doing its job on a hot public page, and no writer anywhere has to know the cache
// exists. A writer added next year gets this for free, which is the whole point.
const menuCache = new Map<string, { data: any; stamp: string; expiresAt: number }>()
const CACHE_TTL_MS = 60_000 // an upper bound only — the stamp is what actually decides

/**
 * What the menu is a picture of. Any insert, update or delete against this company's products or
 * batches changes it; nothing else does.
 */
async function menuStamp(companyId: string): Promise<string> {
  const r: any = await db.execute(sql`
    SELECT
      (SELECT COALESCE(MAX(updated_at), 'epoch'::timestamp) FROM products WHERE company_id = ${companyId}) AS p_at,
      (SELECT COUNT(*) FROM products WHERE company_id = ${companyId}) AS p_n,
      (SELECT COALESCE(MAX(updated_at), 'epoch'::timestamp) FROM batches  WHERE company_id = ${companyId}) AS b_at,
      (SELECT COUNT(*) FROM batches  WHERE company_id = ${companyId}) AS b_n
  `)
  const row = (r.rows || r)[0] || {}
  return `${new Date(row.p_at ?? 0).getTime()}:${row.p_n ?? 0}:${new Date(row.b_at ?? 0).getTime()}:${row.b_n ?? 0}`
}

function getCached(key: string, stamp: string) {
  const entry = menuCache.get(key)
  if (entry && entry.expiresAt > Date.now() && entry.stamp === stamp) return entry.data
  if (entry) menuCache.delete(key)
  return null
}

function setCache(key: string, stamp: string, data: any) {
  menuCache.set(key, { data, stamp, expiresAt: Date.now() + CACHE_TTL_MS })
}

// Which shop this is.
//
// The slug exists because this router was written for a menu served across several shops. A
// tenant CRM has exactly one company in its own database, and its own order-ahead page has no
// slug to send — so every call from it was refused with "Company slug is required" and there was
// no customer-facing ordering path at all. When no slug is given and there is exactly one company
// here, that is the one. Where there is more than one, the slug is still required rather than
// guessed. (T45 H24)
async function resolveSlug(c: any): Promise<string | null> {
  const given = c.req.query('slug') || c.req.header('x-company-slug')
  if (given) return given
  // The shop this database was created for: the first company row in it. A tenant database is
  // one dispensary; a second row is QA debris or an enterprise import, and either way the seeded
  // shop is the oldest. "Exactly one row" was the first version of this and it was too strict —
  // the live test tenant carries two, so its own page was still told "Company slug is required".
  const rows = await db.select({ slug: company.slug })
    .from(company)
    .orderBy(asc(company.createdAt))
    .limit(1)
  return rows[0]?.slug || null
}

// These routes are public — a customer with no session — so requireEnabledFeature, which reads
// the signed-in user, cannot guard them. The switch is read off the resolved company instead.
// Public Menu is a core feature and browsing stays open where it is unset; taking an ORDER needs
// Order Ahead switched on, because a shop that has not turned online ordering on should not find
// orders arriving from it. (T45 H24)
const featureOn = (co: any, id: string) => {
  const list = (co?.enabledFeatures ?? co?.enabled_features) as unknown
  if (!Array.isArray(list)) return true // unset means nothing has been configured yet
  return list.includes(id)
}

// Public menu — NO auth required
// Requires company slug as query param or subdomain
app.get('/', async (c) => {
  const slug = await resolveSlug(c)
  if (!slug) return c.json({ error: 'Company slug is required' }, 400)

  // Resolve company first — the cache is now checked against what the shop's stock actually says,
  // and that question needs a company id. Two indexed lookups on a hit, against the twenty-odd
  // queries the build below runs on a miss.
  const [foundCompany] = await db.select({ id: company.id, name: company.name, logo: company.logo, primaryColor: company.primaryColor })
    .from(company).where(eq(company.slug, slug)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  const cacheKey = `menu:${slug}`
  const stamp = await menuStamp(foundCompany.id)
  const cached = getCached(cacheKey, stamp)
  if (cached) return c.json(cached)

  // Fetch visible, active products
  const products = await db.select().from(product)
    .where(and(
      eq(product.companyId, foundCompany.id),
      eq(product.active, true),
      eq(product.visible, true),
    ))
    .orderBy(asc(product.menuOrder), asc(product.name))

  // A recalled product is not on the menu. (T49 B1)
  //
  // Listing it and refusing it at checkout is a worse experience than not listing it, and it is
  // not what a buyer coming from a Metrc-integrated POS expects: a recalled package disappears
  // from every channel. The order route refuses it too — this is so nobody is offered it.
  const recalled = await recalledProductIds(db, foundCompany.id, products.map((p) => p.id))

  // Group by category
  const categories: Record<string, any[]> = {}
  for (const prod of products) {
    if (recalled.has(prod.id)) continue
    const cat = (prod as any).category || 'other'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push({
      id: prod.id,
      name: prod.name,
      slug: prod.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      description: prod.description,
      brand: (prod as any).brand,
      strain: (prod as any).strain,
      strainType: (prod as any).strainType,
      thcPercent: (prod as any).thcPercent,
      cbdPercent: (prod as any).cbdPercent,
      weight: (prod as any).weight,
      weightUnit: (prod as any).weightUnit,
      price: prod.price,
      imageUrl: (prod as any).imageUrl,
      images: (prod as any).images,
      inStock: (prod as any).trackInventory ? Number(prod.stockQuantity) > 0 : true,
      tags: (prod as any).tags,
      // Whether this is regulated product, answered by the same helper the register uses rather
      // than by the menu guessing from a category name. The checkout asks for a date of birth on
      // the strength of it. (T46 N5)
      isCannabis: isCannabisLine(prod as any),
    })
  }

  // Category display order.
  //
  // This list was the WHOLE menu, not just its order — a category that was not on it did not sort
  // late, it disappeared. `merch`, `preroll`, `beverage`, `capsule`, `seed` and `clone` are all
  // real product categories in this product (schema.ts, and the CSV importer accepts every one of
  // them), and none of them was listed, so those products were on sale in the shop and absent from
  // the shop's own public menu. Known categories keep their order; anything else follows it under
  // its own name rather than vanishing. (T45 H24)
  const categoryOrder = [
    'flower', 'pre_roll', 'preroll', 'edible', 'beverage', 'capsule', 'concentrate', 'vape',
    'cartridge', 'tincture', 'topical', 'seed', 'clone', 'accessory', 'merch', 'apparel', 'other',
  ]
  const categoryLabels: Record<string, string> = {
    flower: 'Flower',
    pre_roll: 'Pre-Rolls',
    preroll: 'Pre-Rolls',
    edible: 'Edibles',
    beverage: 'Drinks',
    capsule: 'Capsules',
    concentrate: 'Concentrates',
    vape: 'Vape',
    cartridge: 'Cartridges',
    tincture: 'Tinctures',
    topical: 'Topicals',
    seed: 'Seeds',
    clone: 'Clones',
    accessory: 'Accessories',
    merch: 'Merch',
    apparel: 'Apparel',
    other: 'Other',
  }

  const titleCase = (key: string) =>
    key.split(/[_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const orderedKeys = [
    ...categoryOrder.filter(cat => categories[cat]?.length > 0),
    ...Object.keys(categories).filter(cat => !categoryOrder.includes(cat)).sort(),
  ]

  const menu = orderedKeys.map(cat => ({
    key: cat,
    label: categoryLabels[cat] || titleCase(cat),
    products: categories[cat],
  }))

  const response = {
    company: foundCompany,
    menu,
    // Count what is ON the menu, not what was fetched before the recall filter ran. It said
    // "2 products" over a list of one from the day the recall filter was added — a small lie, but
    // it is the number a shop quotes and the one a menu-sync would trust.
    totalProducts: menu.reduce((n, cat) => n + cat.products.length, 0),
  }

  setCache(cacheKey, stamp, response)
  return c.json(response)
})

// Public single product detail — NO auth
app.get('/:slug', async (c) => {
  const companySlug = await resolveSlug(c)
  if (!companySlug) return c.json({ error: 'Company slug is required' }, 400)

  const productSlug = c.req.param('slug')

  const [foundCompany] = await db.select({ id: company.id })
    .from(company).where(eq(company.slug, companySlug)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // Match by id OR by slug-ified name.
  //
  // It was slug-only, and the listing this page is reached from returns `id` and `slug` side by
  // side — so a caller holding the id got "Product not found" for every product in the shop. A
  // tester reported exactly that ("every /api/public/menu/:id returns Product not found, even for
  // active products") and could not check the recall exclusion below, because they could never load
  // a product page at all. The id is the stable handle; the slug is a nicety that changes the moment
  // anyone renames the product. Both work. (T50)
  const products = await db.select().from(product)
    .where(and(
      eq(product.companyId, foundCompany.id),
      eq(product.active, true),
      eq(product.visible, true),
    ))

  const found = products.find(p => p.id === productSlug)
    || products.find(p => p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === productSlug)

  if (!found) return c.json({ error: 'Product not found' }, 404)

  // …and the product PAGE goes with the listing. A recalled product that is gone from the menu but
  // still reachable by its own URL is still being offered. (T49 B1)
  if ((await recalledProductIds(db, foundCompany.id, [found.id])).has(found.id)) {
    return c.json({ error: 'Product not found' }, 404)
  }

  return c.json({
    id: found.id,
    name: found.name,
    description: found.description,
    sku: found.sku,
    category: found.category,
    brand: (found as any).brand,
    strain: (found as any).strain,
    strainType: (found as any).strainType,
    thcPercent: (found as any).thcPercent,
    cbdPercent: (found as any).cbdPercent,
    weight: (found as any).weight,
    weightUnit: (found as any).weightUnit,
    price: found.price,
    imageUrl: (found as any).imageUrl,
    images: (found as any).images,
    inStock: (found as any).trackInventory ? Number(found.stockQuantity) > 0 : true,
    tags: (found as any).tags,
    labResults: (found as any).labResults,
  })
})

// Public order submission — NO auth required
app.post('/order', async (c) => {
  const slug = await resolveSlug(c)
  if (!slug) return c.json({ error: 'Company slug is required' }, 400)

  const orderSchema = z.object({
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number().int().min(1),
    })).min(1),
    customerName: z.string().min(1),
    customerPhone: z.string().min(1),
    customerEmail: z.string().email().optional(),
    // T46 N5: public checkout asked for a name, a phone, an email and notes, and nothing else.
    // Anyone at all could place an order for cannabis and the age was only looked at when they
    // turned up. A shop's own menu is advertising and ordering in one, and both are age-restricted
    // — the counter check is the second gate, not the only one.
    dateOfBirth: z.string().optional(),
    orderType: z.enum(['pickup', 'delivery']),
    pickupTime: z.string().optional(),
    deliveryAddress: z.string().optional(),
    deliveryNotes: z.string().optional(),
    notes: z.string().optional(),
  })

  let data: z.infer<typeof orderSchema>
  try {
    data = orderSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json(zodRefusal(err), 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Delivery orders require an address
  if (data.orderType === 'delivery' && !data.deliveryAddress) {
    return c.json({ error: 'Delivery address is required for delivery orders' }, 400)
  }

  // Resolve company
  const [foundCompany] = await db.select({ id: company.id, name: company.name, taxRate: company.taxRate, exciseTaxRate: company.exciseTaxRate, purchaseLimitOz: company.purchaseLimitOz, state: company.state, enabledFeatures: company.enabledFeatures })
    .from(company).where(eq(company.slug, slug)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  if (!featureOn(foundCompany, 'order_ahead')) {
    return c.json({ error: 'Online ordering is not switched on for this shop', code: 'FEATURE_NOT_ENABLED', feature: 'order_ahead' }, 403)
  }

  // Fetch all requested products
  const productIds = data.items.map(i => i.productId)
  const products = await db.select().from(product)
    .where(and(eq(product.companyId, foundCompany.id)))

  const productMap = new Map(products.filter(p => productIds.includes(p.id)).map(p => [p.id, p]))

  // The SAME batch rule the register runs. (T49 B1)
  //
  // This route accepted an order for a recalled product, the till then completed it, and stock
  // came off a product whose only batch with units was recalled. The rule was written out inline
  // in POST /api/orders and nowhere else, so it guarded one of the four doors a sale comes in
  // through. A customer ordering ahead is not a lesser sale than one at the counter.
  const stock = await resolveSellableStock(db, foundCompany.id, productIds, productMap as any)

  // Validate products and calculate totals
  let totalWeightGrams = 0
  let subtotal = 0
  const resolvedItems: any[] = []

  for (const item of data.items) {
    const prod = productMap.get(item.productId)
    if (!prod) return c.json({ error: `Product not found: ${item.productId}` }, 400)
    if (!prod.active) return c.json({ error: `Product is not available: ${prod.name}` }, 400)
    if (!prod.visible) return c.json({ error: `Product is not available: ${prod.name}` }, 400)

    // Worded for a customer rather than a budtender — they cannot "remove it from the order" on
    // somebody else's till — but the same refusal, with the same code.
    const blocked = stock.blockedProducts.get(prod.id)
    if (blocked) {
      return c.json({
        error: blocked === 'recalled'
          ? `${prod.name} has been recalled and is no longer available. Please remove it from your basket.`
          : `${prod.name} is out of stock. Please remove it from your basket.`,
        code: 'batch_not_sellable', productId: prod.id,
      }, 400)
    }
    // …and no more than a held batch leaves outside itself.
    const spare = stock.untrackedUnits.get(prod.id)
    if (spare !== undefined && item.quantity > spare) {
      return c.json({
        error: `Only ${spare} of ${prod.name} ${spare === 1 ? 'is' : 'are'} available.`,
        code: 'batch_not_sellable', productId: prod.id,
      }, 400)
    }

    // Check stock
    if (prod.trackInventory && Number(prod.stockQuantity) < item.quantity) {
      return c.json({ error: `Insufficient stock for ${prod.name}` }, 400)
    }

    // Classification only. The WEIGHING is done once, below, by the same function the register and
    // the kiosk use — this loop used to add prod.weight by hand, which missed weight_grams entirely
    // (every seeded product counted as zero) and never applied the equivalency factors. (T34)
    const isCannabis = isCannabisLine(prod)

    const unitPrice = Number(prod.price)
    const lineTotal = unitPrice * item.quantity
    subtotal += lineTotal

    resolvedItems.push({
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      category: prod.category,
      quantity: item.quantity,
      unitPrice: String(unitPrice),
      lineTotal: String(lineTotal),
      weight: prod.weight,
      weightUnit: prod.weightUnit,
      // Persist the RESOLVED tax category (seeded products have tax_category NULL).
      taxCategory: isCannabis ? 'cannabis' : 'non_cannabis',
    })
  }

  // The SAME purchase limit as the register and the kiosk, through the same three helpers, so a
  // customer ordering online cannot buy what a budtender would have refused. (T34)
  const menuFactors = await loadEquivalencyFactors(foundCompany.id)
  const menuLines = data.items.map((i: any) => ({ product: productMap.get(i.productId), quantity: i.quantity }))
  const uncountable = uncountableCannabisLines(menuLines, menuFactors)
  if (uncountable.length) {
    const sample = menuLines.map((l: any) => l.product).find((pr: any) => pr && uncountable.includes(pr.name))
    return c.json(unweighedCannabisRefusal(uncountable, menuFactors, sample), 400)
  }
  totalWeightGrams = cartCannabisGrams(menuLines, menuFactors)
  const limitOz = resolvePurchaseLimitOz(foundCompany)
  const menuOver = overPurchaseLimit(totalWeightGrams, limitOz)
  if (menuOver) return c.json(menuOver, 400)

  // ── Age ─────────────────────────────────────────────────────────────────────────────────────
  //
  // T46 N5. A basket with cannabis in it is an age-restricted purchase wherever it is rung up, and
  // this one could be placed by anyone with a phone number. The same two helpers the register uses
  // answer it, so the menu and the counter agree on who is old enough — and the date is kept on the
  // customer record, so the counter check has something to check against rather than starting cold.
  //
  // A merchandise-only basket is not age-restricted and is deliberately left alone: a t-shirt does
  // not need a date of birth.
  const menuHasCannabis = resolvedItems.some((i: any) => i.taxCategory === 'cannabis')
  let orderDob: string | null = null
  if (menuHasCannabis) {
    const dob = (data.dateOfBirth || '').trim()
    if (!dob) {
      return c.json({
        error: 'Enter your date of birth to order cannabis — this shop has to check it before it can take the order.',
        code: 'dob_required',
      }, 400)
    }
    const age = ageFromDob(dob)
    if (age == null) {
      return c.json({ error: 'That date of birth is not a real date.', code: 'dob_invalid' }, 400)
    }
    // No medical card is claimable from a public form — an unverifiable card is not a card, which
    // is the rule the register settled on (T43 N1). So the adult-use age is the one that applies.
    const minAge = minimumAgeFor({ isMedical: false, medicalCardNumber: null })
    if (age < minAge) {
      return c.json({
        error: `You have to be ${minAge} or over to order cannabis.`,
        code: 'under_age',
        minimumAge: minAge,
      }, 403)
    }
    orderDob = dob
  }

  // ── Delivery: the fee, and whether this shop delivers there at all ──────────────────────────
  //
  // T46 N3. The register has charged the zone's fee and enforced its minimum since T45 H7; this
  // path charged neither. An in-zone delivery came to $70 + tax with no $5 fee, and a Chicago
  // address was taken by an Ohio shop at the same total. The matching is the register's own, out of
  // utils/delivery.ts, so the two cannot drift again.
  //
  // Where the register is lenient this is not: a budtender taking a delivery by phone can use their
  // judgement about an address just outside a zone, and a web form has nobody to use any. A shop
  // with no zones set up still delivers anywhere, because it has not said otherwise.
  let menuDeliveryFee = 0
  let menuZoneId: string | null = null
  if (data.orderType === 'delivery') {
    const zoneRows: any = await db.execute(sql`
      SELECT * FROM delivery_zones WHERE company_id = ${foundCompany.id} AND COALESCE(active, true) = true
    `)
    const zones = ((zoneRows as any).rows || zoneRows) as any[]
    if (zones.length) {
      const zone = matchZoneForAddress(zones, data.deliveryAddress || '')
      if (!zone) {
        return c.json({
          error: 'This shop does not deliver to that address. Choose collection instead, or call the shop.',
          code: 'outside_delivery_area',
        }, 400)
      }
      menuZoneId = zone.id
      const terms = zoneTerms(zone)
      menuDeliveryFee = terms.fee
      if (terms.minimum > 0 && subtotal < terms.minimum) {
        return c.json({
          error: `${zone.name || 'That area'} has a $${terms.minimum.toFixed(2)} minimum for delivery — this order is $${subtotal.toFixed(2)}.`,
          code: 'below_delivery_minimum',
          minimum: terms.minimum,
          subtotal: Number(subtotal.toFixed(2)),
        }, 400)
      }
    }
  }

  // Calculate taxes
  const cannabisSubtotal = resolvedItems
    .filter(i => i.taxCategory === 'cannabis')
    .reduce((sum: number, i: any) => sum + Number(i.lineTotal), 0)

  // Use the rates configured in Settings so the public menu's totals match what the
  // in-store register charges (orders.ts). Fall back to the defaults only when unset.
  const exciseRate = foundCompany.exciseTaxRate != null && foundCompany.exciseTaxRate !== '' ? Number(foundCompany.exciseTaxRate) / 100 : CANNABIS_TAX_RATE
  const salesRate = foundCompany.taxRate != null && foundCompany.taxRate !== '' ? Number(foundCompany.taxRate) / 100 : SALES_TAX_RATE
  const exciseTax = cannabisSubtotal * (Number.isFinite(exciseRate) ? exciseRate : CANNABIS_TAX_RATE)
  const salesTax = subtotal * (Number.isFinite(salesRate) ? salesRate : SALES_TAX_RATE)
  const totalTax = exciseTax + salesTax
  // The fee sits on top of the taxed total — a service charge, not merchandise, and outside the tax
  // base, which is exactly where the register puts it. (T46 N3)
  const grandTotal = subtotal + totalTax + menuDeliveryFee

  // Find or create contact — by phone, and then CHECKED.
  //
  // T51/T52 N3: this matched on the phone number alone. A public order placed as "T52 Stranger",
  // DOB 1985-05-05, was attached to an existing customer with a different name and a different date
  // of birth, and the order page then showed that customer's email. Anyone who knows a phone number
  // could place orders against someone else's record and read their history back off the order.
  //
  // A phone number is a way to FIND a record, not proof of being the person on it. So the match has
  // to agree on something the real customer knows: their date of birth, which a cannabis order
  // always carries, or failing that their name.
  //
  // A mismatch does not refuse the order — a legitimate customer who mistypes a digit would be
  // turned away at checkout, and the shop would lose the sale over a typo. It simply does not LINK.
  // A duplicate contact is a tidy-up; attaching a stranger to someone's history is not.
  let contactId: string | null = null
  const [existingContact] = await db.select({ id: contact.id, name: contact.name, dateOfBirth: contact.dateOfBirth })
    .from(contact)
    .where(and(eq(contact.phone, data.customerPhone), eq(contact.companyId, foundCompany.id)))
    .limit(1)

  const sameName = (a: unknown, b: unknown) =>
    String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ')
  const existingDob = existingContact?.dateOfBirth ? String(existingContact.dateOfBirth).slice(0, 10) : null
  const identifies = !existingContact
    ? false
    : existingDob
      // The record has a date of birth: the order has to match it.
      ? (!!orderDob && orderDob.slice(0, 10) === existingDob)
      // It has none, so there is nothing stronger than the name to go on.
      : sameName(existingContact.name, data.customerName)

  if (existingContact && identifies) {
    contactId = existingContact.id
    // A returning customer who has now given their date of birth gets it recorded, so the counter
    // check has something to check against. An existing date is never overwritten from a web form.
    if (orderDob) {
      await db.execute(sql`
        UPDATE contact SET date_of_birth = ${orderDob}, updated_at = NOW()
        WHERE id = ${contactId} AND company_id = ${foundCompany.id} AND date_of_birth IS NULL
      `)
    }
  } else {
    const [newContact] = await db.insert(contact).values({
      name: data.customerName,
      phone: data.customerPhone,
      email: data.customerEmail || null,
      dateOfBirth: orderDob,
      // 'client', not 'customer'. This insert bypasses contactSchema, which has normalised the two
      // since T21 L3 — so this door wrote a value the enum does not declare, and the tenant ended up
      // holding 45 clients and 11 customers for one idea. Marketing's Customer segment then matched
      // only the rows THIS route had written: 11 of 56, and none added on the Customers screen.
      // (T49 / T53 / T55 M3)
      type: 'client',
      source: 'online_order',
      companyId: foundCompany.id,
      // When a record with this phone number already existed but did not identify, say so on the
      // new one. Two contacts sharing a number is either a household or a typo, and the person at
      // the counter is the one who can tell which — they cannot if nothing records that it happened.
      notes: existingContact
        ? `Ordered online with a phone number already on another customer's record, but the details did not match, so this was kept separate. Check with the customer before merging.`
        : null,
    } as any).returning()
    contactId = newContact.id
  }

  // Create order in transaction
  const result = await db.transaction(async (tx) => {
    // ONE identifier for one order, from the sequence the Orders list shows. This path stamped a
    // base-36 timestamp — ORD-MUM6CITF — so an order-ahead sale answered to a different kind of
    // name from every sale rung up at the counter, and sorted nowhere near them. The register and
    // the kiosk were brought onto one sequence by T21 L4 and the public menu never was. (T46 N21)
    const [{ maxNum }] = await tx
      .select({ maxNum: sql<number>`COALESCE(MAX(${order.orderNumber}), 1000)` })
      .from(order)
      .where(eq(order.companyId, foundCompany.id))
    const nextOrderNumber = Number(maxNum) + 1
    const orderNumber = `ORD-${nextOrderNumber}`

    const [newOrder] = await tx.insert(order).values({
      number: orderNumber,
      orderNumber: nextOrderNumber,
      type: data.orderType === 'pickup' ? 'pickup' : 'delivery',
      // Where the order came from. Without it the Orders list's "Online" filter found nothing
      // and the analytics online count read 0 while seven order-ahead orders sat in the list.
      // (T46 N21)
      source: 'online',
      status: 'pending',
      contactId,
      customerName: data.customerName,
      customerDob: orderDob,
      subtotal: String(subtotal),
      exciseTax: String(exciseTax),
      salesTax: String(salesTax),
      totalTax: String(totalTax),
      total: String(grandTotal),
      deliveryFee: String(menuDeliveryFee),
      deliveryZoneId: menuZoneId,
      totalWeightGrams: gramsText(totalWeightGrams),
      notes: data.notes,
      pickupTime: data.pickupTime ? new Date(data.pickupTime) : null,
      deliveryAddress: data.deliveryAddress,
      deliveryNotes: data.deliveryNotes,
      companyId: foundCompany.id,
    } as any).returning()

    // Insert order items
    for (const item of resolvedItems) {
      await tx.insert(orderItem).values({
        orderId: newOrder.id,
        ...item,
        companyId: foundCompany.id,
      } as any)
    }

    return newOrder
  })

  return c.json({
    orderNumber: result.number,
    subtotal: subtotal.toFixed(2),
    exciseTax: exciseTax.toFixed(2),
    salesTax: salesTax.toFixed(2),
    totalTax: totalTax.toFixed(2),
    // Shown on the confirmation, because a fee the customer only discovers on the total is a
    // complaint waiting to happen. (T46 N3)
    deliveryFee: menuDeliveryFee.toFixed(2),
    total: grandTotal.toFixed(2),
    status: 'pending',
    type: data.orderType,
    itemCount: data.items.length,
  }, 201)
})

export default app
