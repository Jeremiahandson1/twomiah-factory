// Company settings, feature toggles and login-user management — one implementation for every CRM.
// The template injects its Drizzle db, `company` + `user` tables, auth middleware and template id.
//
// Provider secrets never leave the server: GET/PUT /api/company strip them from every response.
// Feature writes are validated against the registry (the one vocabulary the Factory, the sidebar and
// this route share). User writes are company-scoped and guard against locking the tenant out.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray } from 'drizzle-orm'
import { getFeaturesForTemplate } from '../featureRegistry'

export interface CompanyDeps {
  db: any
  tables: { company: any; user: any }
  authenticate: any
  /** admin | owner */
  requireAdmin: any
  requirePermission: (permission: string) => any
  /**
   * Gate that passes if the caller holds ANY of the permissions. Used by GET /users so the roster
   * read can accept `team:read` as well as `users:read`. (T41)
   *
   * Optional, and falls back to requirePermission('users:read') — so a template that has not been
   * rewired keeps exactly the behaviour it has today rather than silently opening up.
   */
  requireAnyPermission?: (permissions: string[]) => any
  /**
   * May this caller see the FULL user record (email, last login, extra grants), as opposed to the
   * reduced roster? Asked with `users:read`. The same convention the pricebook, jobs and team
   * modules use for `canSee`: not wired → not asked → today's behaviour.
   */
  canSee?: (role: string, permission: string, userId?: string) => Promise<boolean> | boolean
  /** The vertical's word for a rung (from createPermissions). Optional so a template that has not wired
   *  it yet still builds; the row simply carries no label rather than the wrong one. */
  roleLabel?: (role: string) => string
  /** drops the cached extra-permission grants for a user after they change */
  invalidateExtraPermissions?: (userId: string) => void
  /** this template's id in the feature registry, e.g. 'crm-salon' */
  template: string
  options?: { roles?: string[] }
  /** Called (not awaited) after a successful feature save with the saved list — e.g. the Ads connector registers the tenant when paid_ads turns on. */
  onFeaturesChanged?: (features: string[]) => void
}

export const COMPANY_SECRETS = ['twilioAuthToken', 'twilioAccountSid', 'stripeCustomerId', 'sendgridApiKey', 'smtpPassword'] as const
export function sanitizeCompany<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_SECRETS) delete clone[f]
  return clone
}

/**
 * A URL this app is willing to put in an href or an img src.
 *
 * Empty clears the field. Anything else must parse AND be http(s): "javascript:alert(1)" saved happily
 * before, and company.website goes straight into the sidebar's "Live Website" anchor, where a javascript:
 * href runs on click for whoever clicks it. Scheme is the whole question here — data:, vbscript: and
 * file: are refused for the same reason.
 *
 * A bare "example.com" is accepted and stored as https://example.com, because refusing it would fail
 * people typing the ordinary thing; "not a url" is still refused. (Field Service T28 M2)
 */
/**
 * The RAW input is what gets judged, and only then normalised. Order matters here: a `.refine()` after a
 * `.transform()` sees the transformed value, so a rule about "did the user type a scheme" has to run
 * first or it is always answering yes.
 *
 * Accepting a bare "example.com" means prepending https:// — and `new URL('https://nope')` parses
 * perfectly happily, because "nope" is a valid hostname the way "localhost" is. So the convenience that
 * rescued people typing a bare domain also turned any single word into a website: T30 found "nope" saved
 * as https://nope. A bare host must therefore look like a domain — a dot with letters after it. An
 * explicit scheme is still trusted, since someone typing http://localhost means it.
 * (Field Service T30, my regression from T28 M2)
 */
const HAS_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const looksLikeWebAddress = (raw: string): boolean => {
  const v = raw.trim()
  if (!v) return true
  const typedScheme = HAS_SCHEME.test(v)
  let u: URL
  try { u = new URL(typedScheme ? v : `https://${v}`) } catch { return false }
  if (!['http:', 'https:'].includes(u.protocol)) return false
  if (!typedScheme && !/\.[a-zA-Z]{2,}$/.test(u.hostname)) return false
  return true
}
const safeUrl = z.string().trim()
  .refine(looksLikeWebAddress, 'Enter a web address like https://example.com')
  .transform((v: string) => (!v ? '' : HAS_SCHEME.test(v) ? v : `https://${v}`))

// 'viewer' is granted a full read-only list in BASE_ROLE_PERMISSIONS and was absent here, so no
// tenant could assign it: the lowest role anyone could actually be given was 'user', which maps to
// 'field' and carries jobs:update, time:create/update, expenses:create, documents:create and
// tasks:create/update. An accountant or a silent partner had to be made able to write.
// Additive — no existing role changes, and 'user'/'field' stay for rows already written.
/**
 * Assignable roles. `owner` is deliberately NOT here — see the guards on PUT /users/:id.
 *
 * T32 B6: an admin set the owner's role to 'admin' (which this enum allows), and then nobody could
 * set it back, because 'owner' is not an assignable value. The tenant was left with no owner at all
 * and no way, through any API, to make one. Recovering it needed the Factory's bootstrap endpoint.
 *
 * Two things were wrong and both are fixed below rather than here: the owner's record was editable by
 * an admin, and there was no transfer. The enum stays as it is so that `owner` can never be handed
 * out as an ordinary role — it is moved, not granted.
 */
const DEFAULT_ROLES = ['admin', 'manager', 'user', 'field', 'viewer']
const USER_COLUMNS = (user: any) => ({ id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, isActive: user.isActive })

export function createCompanyRoutes(deps: CompanyDeps) {
  const { db, tables: t, authenticate, requireAdmin, requirePermission, requireAnyPermission, canSee, invalidateExtraPermissions, template, roleLabel } = deps
  const roles = (deps.options?.roles && deps.options.roles.length ? deps.options.roles : DEFAULT_ROLES) as [string, ...string[]]
  const app = new Hono()
  app.use('*', authenticate)

  const readBody = async (c: any) => (await c.req.json().catch(() => null)) ?? ({} as any)

  // ---------------------------------------------------------------- company
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const [row] = await db.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    if (!row) return c.json({ error: 'Company not found' }, 404)
    return c.json(sanitizeCompany(row))
  })

  app.put('/', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const schema = z.object({
      name: z.string().trim().min(2, 'Company name must be at least 2 characters.').optional(),
      email: z.string().email().optional(),
      // A phone is optional, but if given it must read like one — 7–15 digits (formatting chars allowed).
      // "abcdefghij" and other junk used to save and then print on every invoice.
      phone: z.string().trim().optional().refine(v => !v || (v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15), 'Enter a valid phone number (7–15 digits).'),
      address: z.string().optional(),
      city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(),
      /**
       * The logo is rendered as <img src> on the portal and the website goes into an <a href> in the
       * sidebar. Both accepted anything, including "javascript:alert(1)" — and an href is the sink where
       * that actually runs, so a company admin could leave a trap that fires for every user who clicks
       * "Live Website". Only http(s) is allowed now, and only on write; existing values are untouched.
       *
       * null clears the field. It used to 400 with "Expected string, received null", so the Settings form
       * could set a logo and never remove one. (Field Service T28 M2 + L9)
       */
      logo: safeUrl.optional().nullable(),
      // The colour on every invoice, email and portal page. It accepted "banana", which then went into
      // a CSS value and silently did nothing. The booking colour grew this same check in T27 N11 and
      // this one — the one customers actually see — was missed. (Salon T28 L1)
      primaryColor: z.string().trim().optional().refine((v: string | undefined) => !v || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v), 'Brand colour must be a hex value like #1d4ed8.'),
      website: safeUrl.optional().nullable(), licenseNumber: z.string().optional(), settings: z.record(z.any()).optional(),
    })
    const body = await readBody(c)
    if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`.replace(/^: /, '')).join('; ') }, 400)
    const data = parsed.data
    // Settings that feed money math are bounded here, not only in the form (a 150% tax rate saved). (SALON-M3)
    const money: any = data.settings
    if (money && typeof money === 'object') {
      if (money.defaultTaxRate != null && money.defaultTaxRate !== '') { const r = Number(money.defaultTaxRate); if (!Number.isFinite(r) || r < 0 || r > 100) return c.json({ error: 'Default sales tax rate must be between 0 and 100.' }, 400) }
      for (const k of ['paymentTermsDays', 'defaultPaymentTerms']) if (money[k] != null && money[k] !== '') { const d = Number(money[k]); if (!Number.isFinite(d) || d < 0 || d > 365) return c.json({ error: 'Payment terms must be between 0 and 365 days.' }, 400) }

      // …and the same bounds apply to a key NOBODY declared.
      //
      // FULL0929 F5: `settings.taxRate` — one word away from the real `defaultTaxRate` — accepted
      // −5, 150 and "abc" with a 200 each time, while the real field refused all three. The typo
      // saves, does nothing, and looks saved.
      //
      // This is deliberately NOT an allow-list of known keys. This function serves thirteen
      // verticals and the blob holds plan flags, onboarding state and per-vertical settings that
      // no single list here could stay ahead of; a key missing from it would break a working screen
      // silently, which is worse than the bug. What is checked instead is that a value is possible
      // FOR THE NAME IT WAS GIVEN — anything called a rate or a percentage has to be a number
      // between 0 and 100, and anything counted in days a number of days. A typo is caught because
      // it is a typo OF something, and a genuinely new key is still free to be anything.
      // ── and "rate" does not mean "percentage" ─────────────────────────────────────────────────
      //
      // RR0929 N2. The first version of this read every key ending in `rate` as a percentage and
      // held it to 0–100. Four real settings are not percentages and were refused outright:
      // hourlyRate 150, laborRate 125, chairRentalRate 250 — money per hour, per job, per chair —
      // and workingDays "mon-fri", which is a list of days and not a count of them.
      //
      // I asked the tester to try to break this rule, and this is what breaking it looks like: a
      // salon cannot set a chair rent. Refusing a real setting is worse than accepting a typo,
      // because the typo does nothing while the refusal stops the shop working.
      //
      // So the default for a `rate` is MONEY — any non-negative number — and the 0–100 bound
      // applies only where the name says percentage. That leaves a residual gap: an undeclared
      // percentage key nobody thought of (`vatRate`) would be read as money and accept 150. Every
      // percentage the product actually declares is validated by name above; this heuristic only
      // ever sees keys nobody declared, and on those I would rather be too permissive than break a
      // working screen. A `days` key that is not a number is somebody's schedule, not a bad count.
      const READS_AS_A_PERCENTAGE = /tax|vat|gst|hst|pst|commission|tip|gratuity|discount|markup|margin|interest|apr|surcharge|utili[sz]ation|occupancy|conversion|retention|churn|growth/i
      for (const [k, v] of Object.entries(money as Record<string, unknown>)) {
        if (v == null || v === '' || typeof v === 'object') continue
        // `percentage` as well as `percent`. RR2 R2: the suffix list had "percent" and "pct" but not
        // "percentage", so tipPercent 150 was refused and tipPercentage 150 saved — the same setting
        // spelled the longer way. The word "percentage" is not a borderline case for this rule; it
        // IS the rule.
        // …and the word ANYWHERE in the name, not only at the end.
        //
        // RR3 observation: the test read the suffix, so `discountPct` 150 was refused and
        // `percentageOff` 150 saved — the word is right there at the front. The tester did not file
        // it because no such key exists in the product today, and noted it was worth one line if one
        // ever gets added. This is that line: a rule that depends on which end of the name the word
        // falls on is not a rule about the word.
        //
        // `rate` stays a SUFFIX test on purpose. A rate is money unless something else in the name
        // says otherwise (READS_AS_A_PERCENTAGE), and hourlyRate / chairRentalRate / boothRentRate
        // are real settings a salon sets to 150 and 250 — refusing those stopped the shop, which is
        // the finding this whole rule was corrected for once already. (RR0929 F5)
        if (/percent|percentage|pct/i.test(k) || (/rate$/i.test(k) && READS_AS_A_PERCENTAGE.test(k))) {
          const n = Number(v)
          if (!Number.isFinite(n) || n < 0 || n > 100) {
            return c.json({ error: `${k} reads as a percentage, so it has to be a number between 0 and 100 — got ${JSON.stringify(v)}.`, field: `settings.${k}` }, 400)
          }
        } else if (/rate$/i.test(k)) {
          // A money rate: a number, and not a negative one. No upper bound — a chair rents for
          // what it rents for.
          const n = Number(v)
          if (!Number.isFinite(n) || n < 0) {
            return c.json({ error: `${k} reads as an amount, so it has to be a number that is not negative — got ${JSON.stringify(v)}.`, field: `settings.${k}` }, 400)
          }
        } else if (/days$/i.test(k) && Number.isFinite(Number(v))) {
          // Only when it really is a number. "mon-fri" is a working week, and refusing it was the
          // other half of N2.
          const n = Number(v)
          if (n < 0 || n > 3650) {
            return c.json({ error: `${k} reads as a number of days, so it has to be between 0 and 3650 — got ${JSON.stringify(v)}.`, field: `settings.${k}` }, 400)
          }
        }
      }
    }
    // MERGE a partial settings object into the stored one — never replace it. A caller sending only
    // { settings: { defaultTaxRate } } used to overwrite the whole JSON blob, wiping plan, seat limit,
    // payment terms and onboarding flags. The UI sends the full object (safe either way); any partial
    // writer (or a future one) must not destroy the rest. (settings-blob wipe)
    // Merging alone means a key can only ever be ADDED: writing one back as null stored null rather
    // than removing it, so the blob grew in one direction and nothing could ever be taken out of it.
    // An explicit null is how a caller says "remove this" — it is the only way to say it, and storing
    // the null instead is the one reading that means nothing to anybody. (Salon T20 L1)
    const updates: any = { ...data, updatedAt: new Date() }
    if (data.settings && typeof data.settings === 'object') {
      const [cur] = await db.select({ settings: t.company.settings }).from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
      const merged: Record<string, unknown> = { ...((cur?.settings as any) || {}), ...data.settings }
      for (const [k, v] of Object.entries(data.settings as Record<string, unknown>)) if (v === null) delete merged[k]
      updates.settings = merged
    }
    const [row] = await db.update(t.company).set(updates).where(eq(t.company.id, currentUser.companyId)).returning()
    if (!row) return c.json({ error: 'Company not found' }, 404)
    return c.json(sanitizeCompany(row))
  })

  // ---------------------------------------------------------------- features
  // The Features page renders THIS — the registry entries offered to this template — never a local
  // catalog with its own ids. Any signed-in user may read it; only admins write.
  app.get('/features/catalog', async (c) => {
    const features = getFeaturesForTemplate(template).filter((f) => !f.hidden).map(({ id, name, description, category, core }) => ({ id, name, description, category, core }))
    return c.json({ template, features })
  })

  app.put('/features', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const { features } = (await readBody(c)) as { features?: unknown }
    if (!Array.isArray(features) || features.some((f: unknown) => typeof f !== 'string')) return c.json({ error: 'features must be an array of feature ids' }, 400)
    // Only ids this template offers may be switched on. Ids the Factory already enabled stay (it may
    // grant beyond the catalog); anything else is a 400. Core features are always kept on.
    const [current] = await db.select({ enabledFeatures: t.company.enabledFeatures }).from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    const offered = getFeaturesForTemplate(template)
    const allowed = new Set<string>([...offered.map((f) => f.id), ...((current?.enabledFeatures || []) as string[])])
    const unknown = (features as string[]).filter((f) => !allowed.has(f))
    if (unknown.length) return c.json({ error: `Unknown feature ids for this product: ${unknown.join(', ')}` }, 400)
    const next = [...new Set([...offered.filter((f) => f.core).map((f) => f.id), ...(features as string[])])]
    const [row] = await db.update(t.company).set({ enabledFeatures: next, updatedAt: new Date() }).where(eq(t.company.id, currentUser.companyId)).returning()
    if (!row) return c.json({ error: 'Company not found' }, 404)
    try { deps.onFeaturesChanged?.(next) } catch (e: any) { console.warn('[Features] onFeaturesChanged failed:', e?.message || e) }
    return c.json(sanitizeCompany(row))
  })

  // ---------------------------------------------------------------- users
  /**
   * TWO QUESTIONS, ONE ENDPOINT: "who manages the logins here" and "who works here". (T41)
   *
   * This was `users:read` only — the OWNER plus anyone granted it. But the roster is what every
   * assignment picker and rep filter is built from, and those screens belong to the manager:
   *
   *   · "The manager's Dispatch Board is always empty: /api/jobs returns 9 jobs, but
   *     /api/company/users 403s for the manager and the board shows '0 Total Jobs' with no assign
   *     list. The owner sees the jobs." — Landscaping, reported as a HIGH
   *   · "/api/users 403s in the background, so rep filters come up empty." — Roofing
   *   · Events, Showcase and RV all reported the same background 403 on Settings.
   *
   * So a manager could not assign work, and the refusal was the bug. The read now accepts
   * `team:read` as well — which is the permission for "see the roster", and which manager holds on
   * every vertical — while the WRITE routes below stay requireAdmin, unchanged.
   *
   * WHAT A team:read CALLER GETS IS NARROWER. The full row carries email, lastLogin and
   * extraPermissions: that is user ADMINISTRATION, not the roster, and opening it to everyone who
   * can see colleagues would have traded one leak for another. A team:read caller gets the fields a
   * picker needs — id, name, role, roleLabel, active — and nothing else.
   */
  const rosterGate = requireAnyPermission
    ? requireAnyPermission(['users:read', 'team:read'])
    : requirePermission('users:read')

  app.get('/users', rosterGate, async (c) => {
    const currentUser = c.get('user') as any
    const rows = await db.select({
      id: t.user.id, email: t.user.email, firstName: t.user.firstName, lastName: t.user.lastName, phone: t.user.phone, role: t.user.role,
      isActive: t.user.isActive, lastLogin: t.user.lastLogin, createdAt: t.user.createdAt, extraPermissions: t.user.extraPermissions,
    }).from(t.user).where(eq(t.user.companyId, currentUser.companyId))
    // Send the word alongside the id. The Users table used to map the id itself, which is a second
    // definition of the vocabulary and drifts from this one the moment a vertical renames a rung.
    const labelled = roleLabel ? rows.map((r: any) => ({ ...r, roleLabel: roleLabel(String(r.role || '')) })) : rows

    // Not wired → not asked → the full row, which is what the only callers who could get here used
    // to receive anyway.
    if (!canSee) return c.json(labelled)
    if (await canSee(currentUser.role, 'users:read', currentUser.userId)) return c.json(labelled)

    return c.json(labelled.map((r: any) => ({
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      role: r.role,
      ...(r.roleLabel !== undefined ? { roleLabel: r.roleLabel } : {}),
      isActive: r.isActive,
    })))
  })

  app.post('/users', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const schema = z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(roles).default('user') })
    const body = await readBody(c)
    if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
    const parsed = schema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
    const { password, ...rest } = parsed.data
    // Hash before opening the transaction — bcrypt takes ~100ms and must not run under a row lock.
    const passwordHash = await Bun.password.hash(password, 'bcrypt')

    // Seat cap: SEAT_LIMIT (env, written by the Factory) wins; settings.seatLimit lets staff change it
    // without a redeploy; neither set => no cap. The count and the insert happen under a lock on the
    // company row so two concurrent adds cannot both pass the check.
    const outcome = await db.transaction(async (tx: any) => {
      const [companyRow] = await tx.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1).for('update')
      const envSeats = Number.parseInt(process.env.SEAT_LIMIT || '', 10)
      const settingSeats = Number.parseInt(String((companyRow?.settings as any)?.seatLimit ?? ''), 10)
      const seatLimit = Number.isInteger(envSeats) && envSeats > 0 ? envSeats : (Number.isInteger(settingSeats) && settingSeats > 0 ? settingSeats : null)
      if (seatLimit) {
        const active = await tx.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.companyId, currentUser.companyId), eq(t.user.isActive, true)))
        if (active.length >= seatLimit) {
          return { status: 403 as const, body: { error: `Your plan includes ${seatLimit} user${seatLimit === 1 ? '' : 's'} and ${active.length} are already active. Deactivate someone or upgrade to add more.`, seatLimit, activeSeats: active.length } }
        }
      }
      const [existing] = await tx.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.email, rest.email), eq(t.user.companyId, currentUser.companyId))).limit(1)
      if (existing) return { status: 409 as const, body: { error: 'Email already exists' } }
      const [created] = await tx.insert(t.user).values({ ...rest, passwordHash, companyId: currentUser.companyId }).returning(USER_COLUMNS(t.user))
      return { status: 201 as const, body: created }
    })
    return c.json(outcome.body as any, outcome.status)
  })

  const findTarget = async (id: string, companyId: string) => {
    const [row] = await db.select().from(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, companyId))).limit(1)
    return row
  }
  /** Would removing `target` (as admin, or entirely) leave the company with no active admin/owner? */
  const isLastAdmin = async (target: any, companyId: string) => {
    if (target.role !== 'admin' && target.role !== 'owner') return false
    const active = await db.select({ id: t.user.id, role: t.user.role }).from(t.user).where(and(eq(t.user.companyId, companyId), eq(t.user.isActive, true)))
    return active.filter((u: any) => u.role === 'admin' || u.role === 'owner').length <= 1
  }

  app.put('/users/:id', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    const schema = z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), role: z.enum(roles).optional(), extraPermissions: z.array(z.enum(['users:read'])).optional(), isActive: z.boolean().optional() })
    const parsed = schema.safeParse(await readBody(c))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
    const data = parsed.data
    // Grants are the owner's alone to give — an admin cannot widen their own or anyone's access.
    if (data.extraPermissions !== undefined && currentUser.role !== 'owner') return c.json({ error: 'Only the owner can grant or revoke permissions.' }, 403)
    const target = await findTarget(id, currentUser.companyId)
    if (!target) return c.json({ error: 'User not found' }, 404)

    /**
     * The OWNER's record is the owner's alone. (T32 B6)
     *
     * An admin demoted the owner to 'admin' — allowed, because the enum accepts it and the
     * last-administrator check was satisfied by the admin who was doing the demoting. `owner` is not
     * an assignable role, so nothing could put it back: the tenant had no owner, and no API could make
     * one. Recovery took the Factory's bootstrap endpoint.
     *
     * So an admin may not touch the owner's row at all — not the role, not the access. Only the owner
     * may change the owner's record, and even then not into another role, because a company with no
     * owner is the state this whole guard exists to prevent. Ownership MOVES (below); it is never
     * dropped.
     */
    if (target.role === 'owner' && currentUser.role !== 'owner') {
      return c.json({ error: 'Only the owner can change the owner\'s account.' }, 403)
    }
    if (target.role === 'owner' && data.role !== undefined && data.role !== 'owner') {
      return c.json({
        error: 'The owner cannot be given a lesser role — a company with no owner cannot be recovered from inside the product. Transfer ownership to somebody else instead.',
        code: 'owner_cannot_be_demoted',
        transfer: 'POST /api/company/transfer-ownership { userId }',
      }, 400)
    }

    // Never lock the company out of its own CRM: losing the last administrator is unrecoverable from inside the product.
    const losingAccess = data.isActive === false
    const losingAdmin = losingAccess || (data.role !== undefined && data.role !== 'admin' && (target.role === 'admin' || target.role === 'owner'))
    if (losingAccess && id === currentUser.userId) return c.json({ error: "You can't remove your own access." }, 400)
    if (losingAdmin && (await isLastAdmin(target, currentUser.companyId))) return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    if (data.extraPermissions !== undefined) invalidateExtraPermissions?.(id)
    const [row] = await db.update(t.user).set({ ...data, updatedAt: new Date() }).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId))).returning(USER_COLUMNS(t.user))
    return c.json(row)
  })

  /**
   * Hand the company over. (T32 B6)
   *
   * Protecting the owner's record without this would make ownership permanent, which is its own trap:
   * a business that sells, or an owner who leaves, would have no way to move it and would be back to
   * needing a database fix.
   *
   * Ownership MOVES rather than being granted, so there is always exactly one owner: the named user
   * becomes owner and the current owner becomes admin, in ONE transaction. Only the owner can do it —
   * an admin cannot take the company, which is what B6 effectively allowed.
   */
  // `requireAdmin` as MIDDLEWARE, plus the owner check inside.
  //
  // check-write-routes-authorise.ts failed this route when I first wrote it with the role check only
  // in the handler, and the guard was right: an in-handler check is invisible to anything that reads
  // the route table, and it is the kind of line an edit loses. The middleware is the declared gate;
  // the owner check below narrows it further, because requireAdmin admits admins and this must not.
  app.post('/transfer-ownership', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    /**
     * …UNLESS THERE IS NO OWNER. (T32 B6, the aftermath)
     *
     * B6's guards stop a company LOSING its owner. They do nothing for a company that has already
     * lost one — and ctrtest had, during the round that found the bug: the report's closing note says
     * "twomiah14@gmail.com is currently role admin, not owner. It cannot be restored through the app;
     * it needs a direct database update."
     *
     * A product whose recovery path is "someone with database access fixes it by hand" has not
     * recovered from the fault, it has just moved it. So: when the company has NO owner, an admin may
     * claim it. There is no owner to protect, the only people who can reach this already hold
     * `requireAdmin`, and the alternative is a tenant that is permanently broken.
     *
     * The check is inside the transaction as well as here — two admins clicking at once must not both
     * become owner.
     */
    if (currentUser.role !== 'owner') {
      const [existingOwner] = await db.select({ id: t.user.id }).from(t.user)
        .where(and(eq(t.user.companyId, currentUser.companyId), eq(t.user.role, 'owner'))).limit(1)
      if (existingOwner) {
        return c.json({ error: 'Only the owner can transfer ownership.' }, 403)
      }
      // No owner: this admin may take it, for themselves or hand it to somebody else.
    }
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(await readBody(c))
    if (!parsed.success) return c.json({ error: 'Say which user should become the owner.', code: 'user_required' }, 400)
    const { userId } = parsed.data
    const claimingItself = userId === currentUser.userId
    // Only meaningful when there IS an owner — an admin recovering a company with none is very often
    // claiming it for themselves, which is the whole point of the carve-out above.
    if (claimingItself && currentUser.role === 'owner') return c.json({ error: 'You are already the owner.' }, 400)

    const target = await findTarget(userId, currentUser.companyId)
    if (!target) return c.json({ error: 'User not found' }, 404)
    if (target.isActive === false) {
      return c.json({ error: 'That account is deactivated — reactivate it before handing the company over.', code: 'target_inactive' }, 400)
    }

    const result = await db.transaction(async (tx: any) => {
      // Lock both rows first so two transfers cannot interleave and leave two owners or none.
      const ids = claimingItself ? [userId] : [userId, currentUser.userId]
      await tx.select({ id: t.user.id }).from(t.user)
        .where(and(eq(t.user.companyId, currentUser.companyId), inArray(t.user.id, ids)))
        .for('update')
      // Re-checked under the lock: two admins recovering an ownerless company at the same moment must
      // not both become owner.
      if (currentUser.role !== 'owner') {
        const [owner] = await tx.select({ id: t.user.id }).from(t.user)
          .where(and(eq(t.user.companyId, currentUser.companyId), eq(t.user.role, 'owner'))).limit(1)
        if (owner) return { conflict: true as const }
      }
      await tx.update(t.user).set({ role: 'owner', updatedAt: new Date() })
        .where(and(eq(t.user.id, userId), eq(t.user.companyId, currentUser.companyId)))
      // Step DOWN only if the caller was the owner. An admin handing the company to a colleague stays
      // an admin, and an admin claiming it for themselves must not be demoted a line after promotion.
      if (currentUser.role === 'owner' && !claimingItself) {
        await tx.update(t.user).set({ role: 'admin', updatedAt: new Date() })
          .where(and(eq(t.user.id, currentUser.userId), eq(t.user.companyId, currentUser.companyId)))
      }
      const rows = await tx.select(USER_COLUMNS(t.user)).from(t.user)
        .where(and(eq(t.user.companyId, currentUser.companyId), inArray(t.user.id, ids)))
      return rows
    })
    if ((result as any)?.conflict) {
      return c.json({ error: 'Somebody else has just taken ownership of this company. Reload and ask them to transfer it.', code: 'owner_already_set' }, 409)
    }
    invalidateExtraPermissions?.(userId)
    invalidateExtraPermissions?.(currentUser.userId)
    return c.json({ success: true, users: result })
  })

  // Hard delete. Company-scoped (the old route deleted by id alone, so an admin could reach another
  // tenant's row), 404 when the row isn't ours, and the same self / last-admin guards as revoke.
  app.delete('/users/:id', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    const id = c.req.param('id')
    if (id === currentUser.userId) return c.json({ error: 'Cannot delete yourself' }, 400)
    const target = await findTarget(id, currentUser.companyId)
    if (!target) return c.json({ error: 'User not found' }, 404)
    // The same hole as PUT, and worse: an admin could DELETE the owner's row outright, which leaves a
    // company with no owner and nothing to promote. Found while fixing T32 B6 — the report only
    // reached the demotion. (The self-delete guard above means the owner cannot delete themselves
    // either, so this closes the door from both sides.)
    if (target.role === 'owner') {
      return c.json({
        error: 'The owner\'s account cannot be deleted. Transfer ownership first, then remove the account.',
        code: 'owner_cannot_be_deleted',
        transfer: 'POST /api/company/transfer-ownership { userId }',
      }, 403)
    }
    if (target.isActive && (await isLastAdmin(target, currentUser.companyId))) return c.json({ error: 'This is the only administrator left — promote someone else first.' }, 400)
    await db.delete(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId)))
    return c.body(null, 204)
  })

  return app
}
