import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { contact, company } from '../../db/schema.ts'
import { loyaltyConfig } from '../utils/loyaltyConfig.ts'
import { recomputeTier } from '../utils/loyaltyTier.ts'
import { eq, and, ilike, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { zodRefusal } from '../utils/errors.ts'

const app = new Hono()
app.use('*', authenticate)

// Raw-SQL rows come back snake_case (company_id, points_balance); the client reads camelCase.
// Normalise so /members isn't the one module still on the old convention. (retest#9)
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}

// List loyalty members
app.get('/members', async (c) => {
  const currentUser = c.get('user') as any
  const search = c.req.query('search')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let searchClause = sql``
  if (search) {
    searchClause = sql`AND (c.name ILIKE ${'%' + search + '%'} OR c.phone ILIKE ${'%' + search + '%'} OR c.email ILIKE ${'%' + search + '%'})`
  }

  const dataResult = await db.execute(sql`
    SELECT lm.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.company_id = ${currentUser.companyId} ${searchClause}
    ORDER BY lm.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.company_id = ${currentUser.companyId} ${searchClause}
  `)

  const data = ((dataResult as any).rows || dataResult).map(camel)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Get member detail with transaction history
app.get('/members/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const memberResult = await db.execute(sql`
    SELECT lm.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.id = ${id} AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const member = ((memberResult as any).rows || memberResult)?.[0]
  if (!member) return c.json({ error: 'Member not found' }, 404)

  const transactionsResult = await db.execute(sql`
    SELECT * FROM loyalty_transactions
    WHERE member_id = ${id} AND company_id = ${currentUser.companyId}
    ORDER BY created_at DESC
    LIMIT 50
  `)
  const transactions = ((transactionsResult as any).rows || transactionsResult).map(camel)

  return c.json({ ...camel(member), transactions })
})

// Enroll customer as loyalty member
app.post('/members', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any

  const enrollSchema = z.object({
    contactId: z.string(),
    initialPoints: z.number().int().min(0).default(0),
    tier: z.enum(['bronze', 'silver', 'gold', 'platinum']).default('bronze'),
    notes: z.string().optional(),
    // Consent, taken at the counter where the customer is standing. It was silently dropped here
    // before, which is half of why SMS marketing could never reach anybody. (T47 P2)
    optedInSms: z.boolean().optional(),
    optedInEmail: z.boolean().optional(),
    consentSource: z.enum(['in_store', 'online', 'import', 'staff']).optional(),
  })
  const data = enrollSchema.parse(await c.req.json())

  // Verify contact exists
  const [foundContact] = await db.select().from(contact)
    .where(and(eq(contact.id, data.contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundContact) return c.json({ error: 'Contact not found' }, 404)

  // Check if already enrolled
  const existingResult = await db.execute(sql`
    SELECT id FROM loyalty_members
    WHERE contact_id = ${data.contactId} AND company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const existing = ((existingResult as any).rows || existingResult)?.[0]
  if (existing) return c.json({ error: 'Customer is already a loyalty member' }, 409)

  // Joining is joining however it happens: a customer signed up at the counter gets the same welcome
  // bonus Settings → Loyalty promises as one enrolled by their first purchase. (T21 M7)
  const [coRow] = await db.select({ settings: company.settings, loyaltyPointsPerDollar: company.loyaltyPointsPerDollar })
    .from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const cfg = loyaltyConfig(coRow)
  const welcomeBonus = cfg.enabled ? cfg.welcomePoints : 0
  const startingPoints = data.initialPoints + welcomeBonus

  const smsOk = data.optedInSms === true
  const emailOk = data.optedInEmail === true
  const source = data.consentSource || 'in_store'
  const result = await db.execute(sql`
    INSERT INTO loyalty_members(id, contact_id, tier, points_balance, total_points_earned, lifetime_points, total_visits, total_spent, notes, opted_in_sms, opted_in_email, opted_in_sms_at, opted_in_email_at, consent_source, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.contactId}, ${data.tier}, ${startingPoints}, ${startingPoints}, ${startingPoints}, 0, 0, ${data.notes || null},
            ${smsOk}, ${emailOk}, ${smsOk ? sql`NOW()` : sql`NULL`}, ${emailOk ? sql`NOW()` : sql`NULL`},
            ${smsOk || emailOk ? source : null}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING *
  `)
  const member = ((result as any).rows || result)?.[0]
  if (welcomeBonus > 0 && member?.id) {
    await db.execute(sql`
      INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, description, company_id, created_at)
      VALUES (gen_random_uuid(), ${member.id}, 'bonus', ${welcomeBonus}, ${startingPoints}, 'Welcome bonus', ${currentUser.companyId}, NOW())
    `)
  }

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'loyalty_member',
    entityId: member?.id,
    entityName: foundContact.name,
    metadata: { tier: data.tier, initialPoints: data.initialPoints },
    req: c,
  })

  // camel(), like every other row this file returns. Enrolment was the one raw row that went out as
  // it came back from Postgres — company_id, points_balance, total_points_earned — while the members
  // list beside it was camelCase, so the page that had just enrolled someone read undefined off its own
  // response and showed a blank balance until a reload. (Dispensary T31 L6)
  return c.json(camel(member), 201)
})

/**
 * Set a member's marketing consent.
 *
 * T47 P2: there was no way to opt anybody in to texts — anywhere. Not on the customer page, not on
 * the loyalty member, not through the API: create ignored the field and there was no update route
 * at all, so PUT answered 405. The SMS audience correctly counts opted-in members only, so it
 * counted zero, for ever, and SMS marketing could never reach one person. A consent gate with no
 * consent path is a feature that cannot be switched on.
 *
 * Consent carries its DATE and its SOURCE, because that is what the question "why did you text me"
 * is actually asking. Withdrawing is recorded the same way, and the unsubscribe link already goes
 * through the same columns.
 *
 * A budtender may take consent — they are the one at the counter when the customer says yes.
 */
app.put('/members/:id/consent', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const consentSchema = z.object({
    optedInSms: z.boolean().optional(),
    optedInEmail: z.boolean().optional(),
    source: z.enum(['in_store', 'online', 'import', 'staff']).default('in_store'),
  }).refine((d) => d.optedInSms !== undefined || d.optedInEmail !== undefined, {
    message: 'Say which consent is changing: optedInSms, optedInEmail, or both.',
  })
  const parsed = consentSchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json(zodRefusal(parsed.error), 400)
  const data = parsed.data

  const [member] = ((await db.execute(sql`
    SELECT m.*, ct.name AS contact_name, ct.phone AS contact_phone
    FROM loyalty_members m
    LEFT JOIN contact ct ON ct.id = m.contact_id
    WHERE m.id = ${id} AND m.company_id = ${currentUser.companyId} LIMIT 1
  `)) as any).rows || []
  if (!member) return c.json({ error: 'Loyalty member not found' }, 404)

  // Consent to be TEXTED needs somewhere to text. Accepting it against a customer with no phone
  // number records a permission that can never be used and looks like an audience that exists.
  if (data.optedInSms === true && !String(member.contact_phone || '').trim()) {
    return c.json({
      error: `${member.contact_name || 'This customer'} has no phone number on file, so there is nothing to text. Add a mobile number first.`,
      code: 'no_phone_to_consent_to',
    }, 400)
  }

  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.optedInSms !== undefined) {
    sets.push(sql`opted_in_sms = ${data.optedInSms}`)
    sets.push(data.optedInSms ? sql`opted_in_sms_at = NOW()` : sql`opted_in_sms_at = NULL`)
  }
  if (data.optedInEmail !== undefined) {
    sets.push(sql`opted_in_email = ${data.optedInEmail}`)
    sets.push(data.optedInEmail ? sql`opted_in_email_at = NOW()` : sql`opted_in_email_at = NULL`)
  }
  if (data.optedInSms === true || data.optedInEmail === true) sets.push(sql`consent_source = ${data.source}`)
  const setClause = sets.reduce((acc, s, i) => (i === 0 ? s : sql`${acc}, ${s}`))

  const [updated] = ((await db.execute(sql`
    UPDATE loyalty_members SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING *
  `)) as any).rows || []

  // A fresh opt-in at the counter OVERRIDES an old unsubscribe. (T49 H1)
  //
  // The unsubscribe writes contact.customFields.emailOptOut, which the email audience reads. Until
  // now nothing in the product could clear it — PUT /api/contacts answers 200 and silently ignores
  // customFields — so a customer who unsubscribed in March and asked to be put back on the list in
  // April showed a ticked Email box and received nothing, for ever. The newer decision is the
  // customer's current one, and the person standing in front of them is recording it.
  if (data.optedInEmail === true) {
    await db.execute(sql`
      UPDATE contact
      SET custom_fields = COALESCE(custom_fields, '{}'::jsonb)
            - 'emailOptOut' - 'emailOptOutDate'
          || jsonb_build_object('emailOptInAt', ${new Date().toISOString()}::text, 'emailOptInSource', ${data.source}::text),
          updated_at = NOW()
      WHERE id = ${member.contact_id} AND company_id = ${currentUser.companyId}
    `)
  }

  audit.log({
    action: audit.ACTIONS.UPDATE, entity: 'loyalty_member', entityId: id, entityName: member.contact_name,
    changes: {
      ...(data.optedInSms !== undefined ? { optedInSms: { old: member.opted_in_sms, new: data.optedInSms } } : {}),
      ...(data.optedInEmail !== undefined ? { optedInEmail: { old: member.opted_in_email, new: data.optedInEmail } } : {}),
    },
    metadata: { source: data.source },
    req: c,
  })

  return c.json(camel(updated))
})

// Adjust points manually (manager+)
app.post('/members/:id/adjust', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const adjustSchema = z.object({
    points: z.number().int(),
    reason: z.string().min(1),
  })
  const data = adjustSchema.parse(await c.req.json())

  // Verify member exists
  const memberResult = await db.execute(sql`
    SELECT lm.*, c.name as customer_name FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE lm.id = ${id} AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)
  const member = ((memberResult as any).rows || memberResult)?.[0]
  if (!member) return c.json({ error: 'Member not found' }, 404)

  const newBalance = Math.max(0, Number(member.points_balance) + data.points)
  // A deduction is clamped at zero, so the points actually applied can be fewer than the points
  // asked for. The tier driver, the ledger row and the response all have to use the applied figure:
  // a -999,999 adjustment that removed 245 points was being recorded as -999,999. (T42 M3)
  const appliedDelta = newBalance - Number(member.points_balance)

  // total_points_earned drives the tier, and lifetime_points is its outward alias (migrate.ts keeps
  // the two equal). A deduction claws both back exactly as a refund does (orders.ts) — before, only
  // the balance moved, so a mistaken grant promoted a member permanently with no way back.
  //
  // But only as far as the grants themselves go. Earned-to-date is the customer's record of what
  // their PURCHASES earned, and a -999,999 that floors the balance was taking it to zero as well,
  // erasing points from real sales and demoting a genuine gold member to bronze. A correction can
  // now take back at most what corrections previously put in. (The salon found the same code as
  // LY0928 L3.)
  let lifetimeDelta = appliedDelta
  if (appliedDelta < 0) {
    const standingRes = await db.execute(sql`
      SELECT COALESCE(SUM(points), 0) AS standing FROM loyalty_transactions
      WHERE member_id = ${id} AND type IN ('adjustment_add', 'adjustment_subtract')
    `)
    const reversible = Math.max(0, Number(((standingRes as any).rows || standingRes)?.[0]?.standing || 0))
    lifetimeDelta = -Math.min(-appliedDelta, reversible)
  }

  await db.execute(sql`
    UPDATE loyalty_members
    SET points_balance = ${newBalance},
        total_points_earned = GREATEST(0, COALESCE(total_points_earned::numeric, 0) + ${lifetimeDelta}),
        lifetime_points = GREATEST(0, COALESCE(lifetime_points, 0) + ${lifetimeDelta}),
        updated_at = NOW()
    WHERE id = ${id}
  `)

  // Log transaction. This has to happen BEFORE the tier is recomputed: the tier is summed from the
  // ledger over a rolling window, so an adjustment that has not been written yet does not exist as
  // far as the recompute is concerned and every tier would land one event behind.
  await db.execute(sql`
    INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, description, company_id, created_at)
    VALUES (gen_random_uuid(), ${id}, ${data.points > 0 ? 'adjustment_add' : 'adjustment_subtract'}, ${appliedDelta}, ${newBalance}, ${data.reason}, ${currentUser.companyId}, NOW())
  `)

  // Re-evaluate tier so a manual adjustment can move the customer up or down, same as
  // award/refund — every point-changing path recomputes tier consistently. (retest#13)
  await recomputeTier(db, currentUser.companyId, { memberId: id })

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'loyalty_member',
    entityId: id,
    entityName: member.customer_name,
    changes: { points_balance: { old: member.points_balance, new: newBalance } },
    metadata: { reason: data.reason, adjustment: appliedDelta, requested: data.points },
    req: c,
  })

  // A correction still works with the programme switched off, and deliberately so: a shop that
  // pauses loyalty must still be able to undo a mistake made while it was running. Redeeming is
  // refused when it is off (orders.ts), correcting is not — so the answer says which, and the screen
  // can tell the truth about what it just did. (LY0928 L2, decided the same way for both verticals.)
  const [co] = await db.select({ settings: company.settings, loyaltyPointsPerDollar: company.loyaltyPointsPerDollar })
    .from(company).where(eq(company.id, currentUser.companyId)).limit(1)

  return c.json({
    pointsBalance: newBalance,
    adjustment: appliedDelta,
    requested: data.points,
    programmeOff: !loyaltyConfig(co).enabled,
  })
})

// List rewards
// Return camelCase aliases matching the frontend (LoyaltyPage reads pointsCost,
// discountType, discountValue, isActive). Selecting the real columns
// (points_cost/discount_type/discount_value/active) fixes the $NaN display.
app.get('/rewards', async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, name, description,
           points_cost AS "pointsCost",
           points_required AS "pointsRequired",
           discount_type AS "discountType",
           discount_value AS "discountValue",
           applicable_categories AS "applicableCategories",
           product_id AS "productId",
           min_tier AS "minTier",
           usage_count AS "usageCount",
           active AS "isActive",
           active AS "active",
           created_at AS "createdAt",
           updated_at AS "updatedAt"
    FROM loyalty_rewards
    WHERE company_id = ${currentUser.companyId}
    ORDER BY points_cost ASC
  `)

  return c.json((result as any).rows || result)
})

// Create reward (manager+)
app.post('/rewards', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  // Accept the frontend's camelCase fields and write to the REAL columns
  // (points_cost is NOT NULL; discount_type/discount_value/active). The old
  // schema inserted into type/value/limit_per_customer/expires_at, which don't
  // exist on loyalty_rewards, and omitted points_cost → every create 500'd.
  const rewardSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    pointsCost: z.number().int().min(1),
    discountType: z.enum(['fixed', 'percent', 'free_item']),
    discountValue: z.number().min(0), // percent or dollar amount (stored as text)
    productId: z.string().optional(), // for free_item type
    isActive: z.boolean().default(true),
  })
  let data: z.infer<typeof rewardSchema>
  try {
    data = rewardSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) return c.json(zodRefusal(err), 400)
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // A reward that cannot be redeemed should not be creatable.
  //
  // T45 L4: "150% off" and "free item" with no product both saved happily, and redemption then
  // correctly refused them — so the refusal landed on a customer at the counter rather than on the
  // manager who typed it. The rules are the redemption rules, applied at the point where they can
  // still be fixed.
  const rewardProblem = await (async () => {
    if (data.discountType === 'percent') {
      if (data.discountValue <= 0 || data.discountValue > 100) {
        return `A percentage reward has to be between 1 and 100 — ${data.discountValue}% is not a discount anyone can give`
      }
    }
    if (data.discountType === 'fixed' && data.discountValue <= 0) {
      return 'A money-off reward has to be worth more than $0'
    }
    if (data.discountType === 'free_item') {
      if (!data.productId) return 'A free-item reward has to say which product is free'
      const found = await db.execute(sql`
        SELECT id FROM products WHERE id = ${data.productId} AND company_id = ${currentUser.companyId} LIMIT 1
      `)
      if (!((found as any).rows || found)?.[0]) return 'That product is not one of yours'
    }
    return null
  })()
  if (rewardProblem) return c.json({ error: rewardProblem, code: 'unusable_reward' }, 400)

  const result = await db.execute(sql`
    INSERT INTO loyalty_rewards(id, name, description, points_cost, discount_type, discount_value, product_id, active, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.name}, ${data.description || null}, ${data.pointsCost}, ${data.discountType}, ${String(data.discountValue)}, ${data.productId || null}, ${data.isActive}, ${currentUser.companyId}, NOW(), NOW())
    RETURNING id, name, description, points_cost AS "pointsCost", discount_type AS "discountType", discount_value AS "discountValue", product_id AS "productId", active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
  `)

  return c.json(((result as any).rows || result)?.[0], 201)
})

// Update reward (manager+)
app.put('/rewards/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const rewardSchema = z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    pointsCost: z.number().int().min(1).optional(),
    discountType: z.enum(['fixed', 'percent', 'free_item']).optional(),
    discountValue: z.number().min(0).optional(),
    productId: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  const data = rewardSchema.parse(await c.req.json())

  // Build SET clause dynamically — real columns only.
  const sets: any[] = [sql`updated_at = NOW()`]
  if (data.name !== undefined) sets.push(sql`name = ${data.name}`)
  if (data.description !== undefined) sets.push(sql`description = ${data.description}`)
  if (data.pointsCost !== undefined) sets.push(sql`points_cost = ${data.pointsCost}`)
  if (data.discountType !== undefined) sets.push(sql`discount_type = ${data.discountType}`)
  if (data.discountValue !== undefined) sets.push(sql`discount_value = ${String(data.discountValue)}`)
  if (data.productId !== undefined) sets.push(sql`product_id = ${data.productId}`)
  if (data.isActive !== undefined) sets.push(sql`active = ${data.isActive}`)

  const setClause = sets.reduce((acc, s, i) => i === 0 ? s : sql`${acc}, ${s}`)

  const result = await db.execute(sql`
    UPDATE loyalty_rewards SET ${setClause}
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, name, description, points_cost AS "pointsCost", discount_type AS "discountType", discount_value AS "discountValue", product_id AS "productId", active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"
  `)

  const updated = ((result as any).rows || result)?.[0]
  if (!updated) return c.json({ error: 'Reward not found' }, 404)

  return c.json(updated)
})

// Delete reward (manager+)
app.delete('/rewards/:id', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    DELETE FROM loyalty_rewards
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id
  `)
  const deleted = ((result as any).rows || result)?.[0]
  if (!deleted) return c.json({ error: 'Reward not found' }, 404)

  return c.json({ success: true })
})

// Check points by phone (for POS quick lookup)
app.get('/check', async (c) => {
  const currentUser = c.get('user') as any
  const phone = c.req.query('phone')
  if (!phone) return c.json({ error: 'Phone number required' }, 400)

  // Match on DIGITS, both sides. The old pattern was ILIKE '%' + the caller's digits, against the phone
  // exactly as stored — and a phone is stored the way a person typed it, "715-555-0121". That string does
  // not end with the contiguous digits 7155550121, so the lookup found nobody, ever: every member came back
  // found:false and no till could pull up a loyalty balance. (Dispensary T20)
  const digits = phone.replace(/\D/g, '').slice(-10)
  if (digits.length < 7) return c.json({ found: false })
  const result = await db.execute(sql`
    SELECT lm.id, lm.points_balance, lm.tier, lm.total_visits, lm.total_spent,
           c.name as customer_name, c.phone as customer_phone, c.id as contact_id
    FROM loyalty_members lm
    JOIN contact c ON c.id = lm.contact_id
    WHERE RIGHT(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), ${digits.length}) = ${digits}
      AND lm.company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const member = ((result as any).rows || result)?.[0]
  if (!member) return c.json({ found: false })

  return c.json({ found: true, ...member })
})

export default app
