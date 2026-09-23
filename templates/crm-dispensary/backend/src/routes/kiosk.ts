import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { ageFromDob, ADULT_USE_MIN_AGE, cartCannabisGrams, resolvePurchaseLimitOz, overPurchaseLimit, GRAMS_PER_OZ, isCannabisLine, unitGramsOf } from '../utils/cannabis.ts'
import { loadEquivalencyFactors } from '../services/equivalency.ts'
import { createRateLimiter, isWrite, KIOSK_WINDOW_MS, KIOSK_MAX_SESSIONS, KIOSK_MAX_CHECKOUTS } from '../middleware/rateLimit.ts'
import { deviceForToken, claimPairingCode, kioskEnforcement, newPairingCode, PAIRING_TTL_MS, type PairedDevice } from '../services/kioskDevice.ts'
import { isFeatureEnabled } from '../middleware/enabledFeature.ts'

// Typed context: the signed-in user on the manager routes, and the paired tablet on the customer ones.
// Untyped, every c.get(...) in this file was a TS2769 — two of them before this change, six after it.
const app = new Hono<{ Variables: { user: any; kioskDevice?: PairedDevice; kioskCompanyId?: string } }>()

// The two endpoints an anonymous caller can use to MAKE something — a session and an order — are bucketed
// well below the app-wide write allowance (1,200 per 15 minutes, i.e. 1,200 fabricated orders). Sized for a
// busy shop sharing one public address, not for one customer. Reads (the menu) are left alone: the menu is
// public by design and browsing it costs nothing. See middleware/rateLimit.ts for why this is mitigation
// rather than a cure. (Dispensary T20 B2)
app.use('/session/start', createRateLimiter(KIOSK_WINDOW_MS, KIOSK_MAX_SESSIONS, isWrite))
app.use('/session/:token/checkout', createRateLimiter(KIOSK_WINDOW_MS, KIOSK_MAX_CHECKOUTS, isWrite))

/**
 * Which paired tablet this is. The kiosk cannot authenticate a USER — a customer is standing at it — so the
 * credential belongs to the device: paired once from Settings, revocable on its own. A shop that has paired
 * a tablet is enforcing — see kioskEnforcement(); one that has not still works and is recorded instead, so
 * this cannot black out a shop mid-onboarding. (Dispensary T21 B1, reopened four runs running as T23 B1)
 */
const requireDevice = async (c: any, next: any) => {
  const token = c.req.header('x-kiosk-token') || c.req.header('X-Kiosk-Token')
  const device = await deviceForToken(token)
  // A paired device names its own company; otherwise no company is known yet at /session/start, so
  // read it from the company this request resolves to.
  const companyId = device?.companyId || c.get('kioskCompanyId') || (await resolveCompanyId(null))
  // A shop that does not have the kiosk switched on has no kiosk, and therefore no reason to accept a
  // kiosk write from anyone — a paired tablet included, since switching the module off is exactly how
  // an operator says they have stopped using it. These routes are public by design — a customer is at
  // the tablet, there is no user to authenticate — so the feature switch is the only thing that can say
  // the endpoint should not exist here at all. (Dispensary B1)
  if (companyId && !(await isFeatureEnabled(companyId, 'kiosk'))) {
    return c.json({ error: 'The kiosk is not enabled for this account.', code: 'FEATURE_NOT_ENABLED', feature: 'kiosk' }, 403)
  }
  if (device) { c.set('kioskDevice', device); return next() }
  const mode = companyId ? await kioskEnforcement(companyId) : 'warn'
  if (mode === 'enforce') {
    return c.json({ error: 'This kiosk is not paired. Pair it from Settings → Kiosks.', code: 'kiosk_not_paired' }, 401)
  }
  console.warn(`[kiosk] unpaired device used ${c.req.method} ${c.req.path}${token ? ' (token not recognised)' : ' (no token)'}`)
  return next()
}
app.use('/session/start', requireDevice)
app.use('/session/:token/add-item', requireDevice)
app.use('/session/:token/checkout', requireDevice)

// Raw-SQL rows come back snake_case, but the kiosk UI and the manager Sessions page read
// camelCase (sessionToken, ageVerified, locationName, strainType, thcPercent, imageUrl...).
// Convert row keys to camelCase before responding — same pattern as cash.ts.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

const rows = (result: any): any[] => ((result as any)?.rows || result) as any[]

// Public kiosk endpoints have no auth (a customer stands at the device), and this CRM is a
// single-tenant deployment. Resolve the owning company from the supplied location when we
// have one, otherwise fall back to the single company row. This is what lets a session
// start / the menu load with no kioskId and no locationId.
async function resolveCompanyId(locationId?: string | null): Promise<string | null> {
  if (locationId) {
    const r = await db.execute(sql`SELECT company_id FROM locations WHERE id = ${locationId} LIMIT 1`)
    const row = rows(r)?.[0]
    if (row?.company_id) return row.company_id
  }
  // A tenant DB should hold exactly ONE company, but an older seed run can leave a demo company (with
  // its own products) behind. `SELECT id FROM company LIMIT 1` then returned an ARBITRARY row — which
  // once served a stranger's menu on the kiosk and dropped every order into the wrong company. Resolve
  // the REAL tenant deterministically: the company that owns the owner/admin account. A seed-only demo
  // company has no users, so it can never win. Oldest owner first, so the result is stable.
  const owned = await db.execute(sql`
    SELECT c.id FROM company c
    JOIN "user" u ON u.company_id = c.id
    WHERE u.role IN ('owner', 'admin')
    ORDER BY u.created_at ASC
    LIMIT 1`)
  const ownedId = rows(owned)?.[0]?.id
  if (ownedId) return ownedId
  // Last resort (a DB with no owner/admin yet): the oldest company, deterministically.
  const r = await db.execute(sql`SELECT id FROM company ORDER BY created_at ASC LIMIT 1`)
  return rows(r)?.[0]?.id ?? null
}

const sessionItems = (session: any): any[] => {
  const raw = session?.items
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') { try { return JSON.parse(raw) || [] } catch { return [] } }
  return raw || []
}

// --- Helper: validate session token ---
async function getSession(token: string) {
  const result = await db.execute(sql`
    SELECT * FROM kiosk_sessions
    WHERE session_token = ${token}
      AND status NOT IN ('completed', 'abandoned')
  `)
  return rows(result)?.[0]
}

// ===== PAIRING =====
// The tablet is paired ONCE: a manager adds the kiosk in Settings, reads out the code, and the device
// exchanges it for a token it keeps. The code is spent on first use and expires on its own. (T21 B1)
app.post('/pair', createRateLimiter(KIOSK_WINDOW_MS, 20, isWrite), async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const result = await claimPairingCode(String(body?.code || ''))
  if ('error' in result) return c.json({ error: result.error }, 400)
  audit.log({ action: 'create', entity: 'kiosk_device', entityId: result.device.id, entityName: result.device.name, metadata: { paired: true }, req: { user: { companyId: result.device.companyId } } })
  return c.json({ token: result.token, device: { id: result.device.id, name: result.device.name, locationId: result.device.locationId } }, 201)
})

// Does this device still count as paired? The kiosk asks on load so it can show the pairing screen again
// after a manager revokes it, rather than failing at checkout with a cart already full.
app.get('/pair/status', async (c) => {
  const device = await deviceForToken(c.req.header('x-kiosk-token'))
  const companyId = device?.companyId || (await resolveCompanyId(null))
  return c.json({ paired: !!device, device: device ? { id: device.id, name: device.name } : null, enforcement: companyId ? await kioskEnforcement(companyId) : 'warn' })
})

// ===== DEVICE MANAGEMENT (manager) =====
app.get('/devices', authenticate, requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  // sessionCount comes back with each device so the Settings table can offer Delete only where it will
  // work. It used to offer it on every row, including the ones DELETE refuses 409 for, and the operator
  // found out by pressing it. Counted exactly the way DELETE /devices/:id counts — same table, same
  // company scope — so the button and the server cannot disagree about what "has taken a session" means.
  // (Dispensary T28 L-i)
  const r = await db.execute(sql`
    SELECT d.id, d.name, d.location_id, d.status, d.token_last4, d.pairing_code, d.pairing_expires_at,
           d.last_seen_at, d.paired_at, d.created_at,
           (SELECT COUNT(*)::int FROM kiosk_sessions s
             WHERE s.kiosk_device_id = d.id AND s.company_id = d.company_id) AS session_count
    FROM kiosk_devices d WHERE d.company_id = ${user.companyId} ORDER BY d.created_at DESC
  `)
  return c.json({ data: rows(r).map(camel), enforcement: await kioskEnforcement(user.companyId) })
})

app.post('/devices', authenticate, requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({} as any))
  const name = String(body?.name || '').trim()
  if (!name) return c.json({ error: 'Give the kiosk a name, so you can tell it from the others.' }, 400)
  const code = newPairingCode()
  const r = await db.execute(sql`
    INSERT INTO kiosk_devices(id, company_id, location_id, name, pairing_code, pairing_expires_at, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${user.companyId}, ${body?.locationId || null}, ${name}, ${code},
            NOW() + ${`${Math.round(PAIRING_TTL_MS / 1000)} seconds`}::interval, 'pending', NOW(), NOW())
    RETURNING *
  `)
  const row = rows(r)?.[0]
  audit.log({ action: 'create', entity: 'kiosk_device', entityId: row?.id, entityName: name, req: c })
  // The code is shown once, here. It is not retrievable later — generate a new one instead.
  return c.json({ ...camel(row), pairingCode: code }, 201)
})

app.post('/devices/:id/revoke', authenticate, requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const r = await db.execute(sql`
    UPDATE kiosk_devices SET status = 'revoked', token_hash = NULL, pairing_code = NULL, revoked_at = NOW(), updated_at = NOW()
    WHERE id = ${id} AND company_id = ${user.companyId} RETURNING *
  `)
  const row = rows(r)?.[0]
  if (!row) return c.json({ error: 'Kiosk not found' }, 404)
  audit.log({ action: 'delete', entity: 'kiosk_device', entityId: id, entityName: row.name, req: c })
  return c.json({ success: true, device: camel(row) })
})

/**
 * Remove a kiosk that never traded.
 *
 * Revoking is the right answer for a tablet that has been in service: kiosk_sessions.kiosk_device_id
 * is how a sale is traced back to the terminal that took it, and dropping the row would orphan that —
 * the same seed-to-sale traceability that makes a sale voidable rather than deletable.
 *
 * But a device added by mistake — a typo'd name, one added twice, one never paired — has no sessions
 * behind it and nothing to orphan, and leaving a manager no way to clear it means the list fills with
 * rubbish they can only "revoke". So: delete when there is no history, refuse with an explanation when
 * there is. (T27 H1)
 */
app.delete('/devices/:id', authenticate, requireRole('manager'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const [device] = rows(await db.execute(sql`
    SELECT id, name FROM kiosk_devices WHERE id = ${id} AND company_id = ${user.companyId}
  `))
  if (!device) return c.json({ error: 'Kiosk not found' }, 404)

  const [{ count } = { count: 0 }] = rows(await db.execute(sql`
    SELECT COUNT(*)::int as count FROM kiosk_sessions
    WHERE kiosk_device_id = ${id} AND company_id = ${user.companyId}
  `))
  if (Number(count) > 0) {
    return c.json({
      error: `"${device.name}" has taken ${count} kiosk session${Number(count) === 1 ? '' : 's'}, so it is part of the sales record and cannot be deleted. Revoke it instead — that ends its access and keeps the history.`,
      sessions: Number(count),
    }, 409)
  }

  await db.execute(sql`DELETE FROM kiosk_devices WHERE id = ${id} AND company_id = ${user.companyId}`)
  audit.log({ action: 'delete', entity: 'kiosk_device', entityId: id, entityName: device.name, metadata: { hardDelete: true, sessions: 0 }, req: c })
  return c.json({ success: true })
})

// ===== SESSION MANAGEMENT (no user auth — a customer is standing at the device) =====

// POST /session/start — Start a kiosk session.
// kioskId is optional: the customer-facing kiosk has no kiosk-provisioning concept, it only
// knows (at most) a location. locationId is optional too (single-location tenants). We store
// kiosk_id as a plain string (defaulting to the location or 'default') and always stamp the
// resolved company_id (NOT NULL) so the age gate can start with an empty body.
app.post('/session/start', async (c) => {
  const sessionSchema = z.object({
    kioskId: z.string().optional(),
    locationId: z.string().optional(),
  })
  const body = await c.req.json().catch(() => ({}))
  const data = sessionSchema.parse(body ?? {})

  // A paired device settles both the company and the location without the caller being asked. (T21 B1)
  const device = c.get('kioskDevice') as { id: string; companyId: string; locationId: string | null } | undefined
  const companyId = device?.companyId || (await resolveCompanyId(data.locationId))
  if (!companyId) return c.json({ error: 'No company configured' }, 400)

  const sessionToken = crypto.randomUUID()
  const locationId = data.locationId || device?.locationId || null
  const kioskId = data.kioskId || device?.id || locationId || 'default'

  const result = await db.execute(sql`
    INSERT INTO kiosk_sessions(id, company_id, session_token, kiosk_id, kiosk_device_id, location_id, status, age_verified, items, started_at, updated_at)
    VALUES (gen_random_uuid(), ${companyId}, ${sessionToken}, ${kioskId}, ${device?.id || null}, ${locationId}, 'started', false, '[]'::json, NOW(), NOW())
    RETURNING *
  `)

  return c.json(camel(rows(result)?.[0]), 201)
})

// GET /session/:token — Get session status
app.get('/session/:token', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  return c.json(camel(session))
})

// POST /session/:token/verify-age — Age verification step
app.post('/session/:token/verify-age', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)

  // The customer's own device does not get to certify the customer's age. `verified` used to BE the
  // gate: sending {verified:true} set age_verified, and the date of birth alongside it was written to
  // the row and never looked at — a DOB in 2012 passed. The date of birth is now required and the age
  // is computed here, by the same rule the register enforces. (Dispensary T20 B2)
  const ageSchema = z.object({
    verified: z.boolean().optional(),
    dobProvided: z.string().optional(), // YYYY-MM-DD
    dateOfBirth: z.string().optional(), // accepted alias
  })
  const data = ageSchema.parse(await c.req.json().catch(() => ({})))
  const dob = data.dobProvided || data.dateOfBirth || null

  const endSession = async () => {
    await db.execute(sql`
      UPDATE kiosk_sessions
      SET status = 'abandoned', age_verified = false, updated_at = NOW()
      WHERE session_token = ${token}
    `)
  }

  // Declining the prompt still ends the session, as before.
  if (data.verified === false) {
    await endSession()
    return c.json({ error: 'Age verification failed. Session ended.' }, 403)
  }

  const age = ageFromDob(dob)
  if (age == null) {
    return c.json({ error: 'Enter your date of birth to continue.', code: 'dob_required' }, 400)
  }
  if (age < ADULT_USE_MIN_AGE) {
    await endSession()
    // A refused sale is the kind of thing a regulator asks about, so it is recorded. The actor is the
    // kiosk itself — there is no signed-in user — so the company comes through the same `req.user` shape
    // every other caller uses; passing a bare companyId is ignored and the row fails its NOT NULL.
    audit.log({ action: 'kiosk_age_denied', entity: 'kiosk_session', entityId: String(session.id), metadata: { age, minAge: ADULT_USE_MIN_AGE, dobProvided: dob }, req: { user: { companyId: session.company_id } } })
    return c.json({ error: `Cannabis sales require ${ADULT_USE_MIN_AGE}+.`, code: 'underage', age, minAge: ADULT_USE_MIN_AGE }, 403)
  }

  // id_verified stays FALSE here: a kiosk cannot inspect a physical ID. The budtender ticks that at
  // the register, where checkAgeGate already refuses to settle a cannabis sale without it.
  const result = await db.execute(sql`
    UPDATE kiosk_sessions
    SET age_verified = true, dob_provided = ${dob}, status = 'browsing', updated_at = NOW()
    WHERE session_token = ${token}
    RETURNING *
  `)

  return c.json(camel(rows(result)?.[0]))
})

// GET /menu — Kiosk menu (no auth). locationId is optional; without it we return the
// company's active, in-stock products (the menu). Products are scoped by company, not
// location, so there is no location filter on the catalog.
app.get('/menu', async (c) => {
  const locationId = c.req.query('locationId')
  const companyId = await resolveCompanyId(locationId)

  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')
  const offset = (page - 1) * limit
  const category = c.req.query('category')
  const search = c.req.query('search')

  if (!companyId) {
    return c.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } })
  }

  let categoryFilter = sql``
  if (category) categoryFilter = sql`AND p.category = ${category}`

  let searchFilter = sql``
  if (search) searchFilter = sql`AND (p.name ILIKE ${'%' + search + '%'} OR p.strain_name ILIKE ${'%' + search + '%'})`

  const dataResult = await db.execute(sql`
    SELECT p.id, p.name, p.description, p.category, p.strain_name, p.strain_type,
           p.thc_percent, p.cbd_percent, p.weight, p.weight_unit, p.price, p.sale_price,
           p.image_url, p.in_stock
    FROM products p
    WHERE p.company_id = ${companyId}
      AND p.active = true
      AND COALESCE(p.in_stock, true) = true
      ${categoryFilter}
      ${searchFilter}
    ORDER BY p.category ASC, p.name ASC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM products p
    WHERE p.company_id = ${companyId}
      AND p.active = true
      AND COALESCE(p.in_stock, true) = true
      ${categoryFilter}
      ${searchFilter}
  `)

  const data = rows(dataResult).map(camel)
  const total = Number(rows(countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// POST /session/:token/add-item — Add item to kiosk order
app.post('/session/:token/add-item', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  if (!session.age_verified) return c.json({ error: 'Age verification required' }, 403)

  const itemSchema = z.object({
    productId: z.string(),
    quantity: z.number().int().min(1).max(100),
    notes: z.string().optional(),
  })
  const data = itemSchema.parse(await c.req.json())

  // Validate product exists and is in stock. Products are company-scoped, not location-scoped.
  // The weight/category columns come back too, because the purchase limit below has to weigh this line.
  const productResult = await db.execute(sql`
    SELECT id, name, price, sale_price, in_stock, category, tax_category, weight_grams, weight, weight_unit
    FROM products
    WHERE id = ${data.productId} AND company_id = ${session.company_id} AND active = true
  `)
  const product = rows(productResult)?.[0]
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (product.in_stock === false) return c.json({ error: 'Product is out of stock' }, 400)

  const items = sessionItems(session)
  const unitPrice = Number(product.sale_price || product.price)

  const newItem = {
    productId: data.productId,
    productName: product.name,
    quantity: data.quantity,
    unitPrice,
    total: unitPrice * data.quantity,
    notes: data.notes || null,
  }

  // The purchase limit belongs here, not only at checkout. Weighing the cart was something only checkout
  // did, so a customer could add 20 eighths, watch every one of them be accepted, and be refused the whole
  // basket at the end — "Purchase exceeds limit: 2.47oz exceeds the 1oz maximum" — with nothing to say
  // which item took them over. Same helpers, same limit, same message as checkout and the register; the
  // only difference is that it runs as each item is added, so the refusal names the item that caused it.
  // Session items carry no product (only checkout ever looked one up), so the prospective cart is
  // backfilled exactly the way checkout backfills it. (Dispensary T28 M-e)
  const prospective = [...items, newItem]
  const byId = new Map<string, any>([[String(product.id), camel(product)]])
  const needed = [...new Set(prospective.map((i: any) => String(i.productId)).filter((id) => id && id !== 'undefined' && !byId.has(id)))]
  if (needed.length) {
    const pr = await db.execute(sql`
      SELECT id, category, tax_category, weight_grams, weight, weight_unit
      FROM products WHERE company_id = ${session.company_id}
        AND id IN (${sql.join(needed.map((m) => sql`${m}`), sql`, `)})
    `)
    for (const p of rows(pr)) byId.set(String(p.id), camel(p))
  }
  const factors = await loadEquivalencyFactors(session.company_id)
  const totalGrams = cartCannabisGrams(
    prospective.map((i: any) => ({ product: byId.get(String(i.productId)) || {}, quantity: i.quantity })),
    factors,
  )
  const [companyRow] = rows(await db.execute(sql`SELECT purchase_limit_oz, state FROM company WHERE id = ${session.company_id} LIMIT 1`))
  const over = overPurchaseLimit(totalGrams, resolvePurchaseLimitOz(camel(companyRow) as any))
  if (over) {
    audit.log({ action: 'kiosk_limit_denied', entity: 'kiosk_session', entityId: String(session.id), metadata: { ...over, at: 'add_item', productId: data.productId, quantity: data.quantity }, req: { user: { companyId: session.company_id } } })
    return c.json(over, 400)
  }

  items.push(newItem)

  const result = await db.execute(sql`
    UPDATE kiosk_sessions
    SET items = ${JSON.stringify(items)}::json, status = 'browsing', updated_at = NOW()
    WHERE session_token = ${token}
    RETURNING *
  `)

  return c.json(camel(rows(result)?.[0]))
})

// POST /session/:token/checkout — Submit kiosk order
app.post('/session/:token/checkout', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)
  if (!session.age_verified) return c.json({ error: 'Age verification required' }, 403)

  const companyId = session.company_id
  const body = await c.req.json().catch(() => ({} as any))
  const customerName = typeof body?.customerName === 'string' && body.customerName.trim() ? body.customerName.trim() : null
  const customerPhone = typeof body?.customerPhone === 'string' && body.customerPhone.trim() ? body.customerPhone.trim() : null

  // Prefer the cart the customer is actually looking at (the frontend sends the authoritative
  // cart, reflecting any quantity edits / removals) and re-price it server-side. Fall back to
  // the running session cart accumulated via add-item. Never trust client prices.
  let items: any[] = []
  if (Array.isArray(body?.items) && body.items.length) {
    for (const bi of body.items) {
      if (!bi?.productId) continue
      const pr = await db.execute(sql`
        SELECT id, name, price, sale_price, category, tax_category, weight_grams, weight, weight_unit
        FROM products
        WHERE id = ${bi.productId} AND company_id = ${companyId} AND active = true
        LIMIT 1
      `)
      const p = rows(pr)?.[0]
      if (!p) continue
      const qty = Math.max(1, Number(bi.quantity) || 1)
      const unitPrice = Number(p.sale_price || p.price)
      // The weight has to be carried with the line, or the limit has nothing to count. (T20 B1)
      items.push({ productId: p.id, productName: p.name, quantity: qty, unitPrice, total: unitPrice * qty, product: camel(p) })
    }
  }
  if (!items.length) items = sessionItems(session)
  if (!items.length) return c.json({ error: 'No items in order' }, 400)

  const subtotal = items.reduce((sum: number, item: any) => sum + Number(item.total || 0), 0)

  // The cannabis purchase limit — the thing that makes this a legal till rather than a shopping cart. The
  // kiosk had none of it: no weight counted, no limit checked, and total_cannabis_weight_oz written as 0, so
  // 20 eighths (2.47 oz) were accepted and completed at a register that refuses 1.11 oz over the counter, and
  // the state-reportable weight on the order read zero. Same helpers, same limit, same message as the
  // register. Items that arrived through add-item carry no product, so look those up. (Dispensary T20 B1)
  const missing = items.filter((i: any) => !i.product && i.productId).map((i: any) => String(i.productId))
  if (missing.length) {
    const pr = await db.execute(sql`
      SELECT id, category, tax_category, weight_grams, weight, weight_unit
      FROM products WHERE company_id = ${companyId}
        AND id IN (${sql.join(missing.map((m) => sql`${m}`), sql`, `)})
    `)
    const byId = new Map(rows(pr).map((p: any) => [String(p.id), camel(p)]))
    for (const i of items as any[]) if (!i.product && i.productId) i.product = byId.get(String(i.productId)) || null
  }
  const factors = await loadEquivalencyFactors(companyId)
  const totalGrams = cartCannabisGrams(items.map((i: any) => ({ product: i.product || {}, quantity: i.quantity })), factors)
  const [companyRow] = rows(await db.execute(sql`SELECT purchase_limit_oz, state FROM company WHERE id = ${companyId} LIMIT 1`))
  const limitOz = resolvePurchaseLimitOz(camel(companyRow) as any)
  const over = overPurchaseLimit(totalGrams, limitOz)
  if (over) {
    audit.log({ action: 'kiosk_limit_denied', entity: 'kiosk_session', entityId: String(session.id), metadata: over, req: { user: { companyId } } })
    return c.json(over, 400)
  }
  const totalCannabisWeightOz = (totalGrams / GRAMS_PER_OZ).toFixed(2)

  // Sequential per-company order number for the Orders list (integer order_number); the
  // `number` text column holds the human-facing kiosk code shown on the thank-you screen.
  const maxResult = await db.execute(sql`
    SELECT COALESCE(MAX(order_number), 1000)::int as maxnum FROM orders WHERE company_id = ${companyId}
  `)
  const nextNumber = Number(rows(maxResult)?.[0]?.maxnum || 1000) + 1
  const orderCode = 'ORD-' + String(nextNumber)

  const noteParts = [customerName ? `Kiosk order for ${customerName}` : 'Kiosk order']
  if (customerPhone) noteParts.push(`Phone: ${customerPhone}`)

  // Create order (walk-in style; a budtender reviews and completes it at the register).
  const orderResult = await db.execute(sql`
    INSERT INTO orders(id, order_number, number, type, status, subtotal, total, total_cannabis_weight_oz, total_weight_grams, customer_dob, kiosk_session_id, location_id, company_id, customer_name, notes, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      ${nextNumber},
      ${orderCode},
      'kiosk',
      'pending',
      ${String(subtotal)},
      ${String(subtotal)},
      ${totalCannabisWeightOz},
      -- the register writes grams too, and EOD/Metrc read that column; a kiosk order left it at 0 (T21 M13)
      ${totalGrams.toFixed(2)},
      -- the date of birth the customer actually passed the gate with, so the budtender's own age check at the
      -- register has something to check against instead of starting blank (T21 M13)
      ${session.dob_provided || null},
      ${session.id},
      ${session.location_id || null},
      ${companyId},
      ${customerName},
      ${noteParts.join(' — ')},
      NOW(),
      NOW()
    )
    RETURNING *
  `)

  const order = rows(orderResult)?.[0]

  // Order line items live in order_items (the orders list / detail read from there).
  //
  // The line has to say WHAT it is, not just what it cost. This INSERT named nine columns and left
  // category, tax_category and the weights null on every kiosk line, and three things read them:
  //
  //   • checkAgeGate decides a sale is cannabis by reading the LINE (isCannabisLine → tax_category, else
  //     category). With all of them null a kiosk cannabis order looked like a sale of nothing in
  //     particular, the gate returned "no cannabis here" and never required the ID tick — so the order
  //     settled with id_verified false and landed on the diversion report as an unverified-ID sale. That
  //     is Dispensary T28 M-d, and it is the reason the flag was wrong: not that the kiosk should set it,
  //     but that the register was never made to ask for it. (T28 M-d)
  //   • a state report or an audit is rebuilt from LINES, which is why the register started writing
  //     weight_grams per line — the kiosk never did, so kiosk lines could not say what they weighed even
  //     though the order total could. (the same gap as T20 M11, on the other till)
  //   • analytics, tax filing and recommendations all group by oi.category, where kiosk sales were
  //     grouping under null.
  //
  // Same resolution the register uses, so one sale reads the same whichever till rang it.
  for (const item of items) {
    // A line whose product could not be resolved (deleted mid-session) records NULL rather than
    // asserting 'non_cannabis' — an unknown line should read as unknown, not as a cleared one.
    const prod = item.product || null
    const isCannabis = prod ? isCannabisLine(prod) : false
    const unitGrams = prod ? unitGramsOf(prod) : 0
    const lineGrams = unitGrams > 0 ? String(Math.round(unitGrams * Number(item.quantity || 0) * 100) / 100) : null
    await db.execute(sql`
      INSERT INTO order_items(id, order_id, product_id, product_name, quantity, unit_price, total_price, line_total, company_id, category, tax_category, weight_grams, weight, weight_unit)
      VALUES (
        gen_random_uuid(),
        ${order.id},
        ${item.productId},
        ${item.productName},
        ${item.quantity},
        ${String(item.unitPrice)},
        ${String(item.total)},
        ${String(item.total)},
        ${companyId},
        ${prod?.category ?? null},
        ${prod ? (isCannabis ? 'cannabis' : 'non_cannabis') : null},
        ${lineGrams},
        ${prod?.weight ?? null},
        ${prod?.weightUnit ?? null}
      )
    `)
  }

  // Update session to completed
  await db.execute(sql`
    UPDATE kiosk_sessions
    SET status = 'completed', order_id = ${order.id}, completed_at = NOW(), updated_at = NOW()
    WHERE session_token = ${token}
  `)

  return c.json({
    orderId: order.id,
    orderNumber: order.number,
    items,
    subtotal,
    total: subtotal,
    status: 'pending',
    message: 'Order submitted. A budtender will review your order shortly.',
  }, 201)
})

// POST /session/:token/abandon — Abandon kiosk session
app.post('/session/:token/abandon', async (c) => {
  const token = c.req.param('token')
  const session = await getSession(token)
  if (!session) return c.json({ error: 'Session not found or expired' }, 404)

  await db.execute(sql`
    UPDATE kiosk_sessions
    SET status = 'abandoned', updated_at = NOW()
    WHERE session_token = ${token}
  `)

  return c.json({ message: 'Session abandoned' })
})

// ===== ADMIN SESSION LIST (auth required) =====

// GET /sessions — List kiosk sessions (manager+)
app.get('/sessions', authenticate, requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit
  const status = c.req.query('status')
  const locationId = c.req.query('locationId')

  let statusFilter = sql``
  if (status) statusFilter = sql`AND ks.status = ${status}`

  let locationFilter = sql``
  if (locationId) locationFilter = sql`AND ks.location_id = ${locationId}`

  // Scope by ks.company_id (NOT NULL on every session) rather than the joined location's
  // company_id — a session can have a NULL location (single-location tenants), and the old
  // WHERE l.company_id filter dropped those rows. Order by started_at (there is no created_at
  // column on kiosk_sessions — the missing column is what 500'd this endpoint).
  const dataResult = await db.execute(sql`
    SELECT ks.*, l.name as location_name
    FROM kiosk_sessions ks
    LEFT JOIN locations l ON l.id = ks.location_id
    WHERE ks.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${locationFilter}
    ORDER BY ks.started_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total
    FROM kiosk_sessions ks
    WHERE ks.company_id = ${currentUser.companyId}
      ${statusFilter}
      ${locationFilter}
  `)

  const data = rows(dataResult).map(camel)
  const total = Number(rows(countResult)?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Manager stats tiles for today's kiosk activity.
app.get('/stats', authenticate, requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const cid = currentUser.companyId

  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE started_at::date = current_date)::int as total_today,
      COUNT(*) FILTER (WHERE started_at::date = current_date AND status = 'completed')::int as completed_today,
      COUNT(*) FILTER (WHERE started_at::date = current_date AND status = 'abandoned')::int as abandoned_today,
      AVG(EXTRACT(EPOCH FROM (completed_at - started_at)))
        FILTER (WHERE started_at::date = current_date AND status = 'completed' AND completed_at IS NOT NULL) as avg_secs
    FROM kiosk_sessions
    WHERE company_id = ${cid}
  `)
  const row = rows(result)?.[0] || {}
  const total = Number(row.total_today || 0)
  const completed = Number(row.completed_today || 0)
  const abandoned = Number(row.abandoned_today || 0)
  const avgSecs = row.avg_secs != null ? Number(row.avg_secs) : null

  let avgSessionTime: string | null = null
  if (avgSecs != null) {
    const m = Math.floor(avgSecs / 60)
    const s = Math.round(avgSecs % 60)
    avgSessionTime = m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  return c.json({
    totalSessionsToday: total,
    completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
    avgSessionTime,
    abandonedRate: total > 0 ? Math.round((abandoned / total) * 100) : 0,
  })
})

export default app
