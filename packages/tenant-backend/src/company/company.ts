// Company settings, feature toggles and login-user management — one implementation for every CRM.
// The template injects its Drizzle db, `company` + `user` tables, auth middleware and template id.
//
// Provider secrets never leave the server: GET/PUT /api/company strip them from every response.
// Feature writes are validated against the registry (the one vocabulary the Factory, the sidebar and
// this route share). User writes are company-scoped and guard against locking the tenant out.
import { Hono } from 'hono'
import { z } from 'zod'
import { eq, and, inArray, sql } from 'drizzle-orm'
import { getFeaturesForTemplate, FEATURE_MAP, withinOffer } from '../featureRegistry'
import { seatRefusal } from './seats'
import { HAS_SCHEME, looksLikeWebAddress, healLogo, normalizeLogo } from './logoAddress'
import { checkBusinessHours } from './businessHours'
import { paymentTermsProblem } from '../invoicing/money'
import { zipField } from '../address'
import { COMPANY_COMMERCIAL, redactCompanyCommercial, withoutDisplayKeys } from '../auth/redactSettings'
export { healLogo, normalizeLogo, isLogoAddress, looksLikeWebAddress } from './logoAddress'

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
  /**
   * The template's audit service — `{ log, ACTIONS, ENTITIES }`. Optional: a template without one
   * keeps working rather than failing to start. (T41)
   *
   * "The audit log doesn't record money movements or settings changes: no refund, payment, credit,
   *  void, invoice-create, company-settings or 2FA entries across 1,889 rows." — salon
   *
   * A company's settings are its tax rate, its payment terms, its brand and its licence number.
   * Every one of them changes what goes on an invoice, and nothing recorded who changed them.
   */
  audit?: { log: (entry: any) => any; ACTIONS?: Record<string, string>; ENTITIES?: Record<string, string> }
  /** drops the cached extra-permission grants for a user after they change */
  invalidateExtraPermissions?: (userId: string) => void
  /** this template's id in the feature registry, e.g. 'crm-salon' */
  template: string
  options?: { roles?: string[] }
  /** Called (not awaited) after a successful feature save with the saved list — e.g. the Ads connector registers the tenant when paid_ads turns on. */
  onFeaturesChanged?: (features: string[]) => void
  /**
   * Email a new teammate a link to choose their own password — the template's teamInvite email, its link built on
   * the reset-password page from `resetToken`. Not wired → adding a user still needs a password set by the admin,
   * which is all there was until 10/14 (E2E run 1: "no invite email is sent").
   */
  sendInvite?: (to: string, data: { firstName: string; inviterName: string; companyName: string; role: string; resetToken: string }) => Promise<unknown>
  /**
   * A vertical's own company columns, which PUT / accepts beside the shared ones: each a zod schema, whose message is
   * the refusal (home care's time zone and mileage rate, its legal name, NPI and Medicaid id — apps/unified
   * server/crm/homecare/office/companyFields.ts). Not wired → only the shared columns, as before.
   */
  fields?: Record<string, z.ZodTypeAny>
  /** What GET / and PUT / add to the company they answer with, worked out from the row (home care's effectiveTimezone). */
  describe?: (row: any) => Record<string, unknown>
  /**
   * What a login still holds — the jobs assigned to it, its commissions, its shifts — as words ('1 job'), read on the
   * delete's own transaction `tx` with the user row locked. Anything held and DELETE /users/:id refuses (409) and says to
   * deactivate instead: a hard delete took JOB-00001's crew off it through ON DELETE SET NULL and left a commission
   * naming nobody (live re-test 2026-10-23). Not wired → the delete is as it was.
   */
  heldBy?: (tx: any, userId: string) => Promise<string[]>
}

/** How long an emailed invite link works. The teamInvite email says so: "This invitation expires in 7 days." */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

// callrailSigningKey: the CallRail webhook signing key (Call Tracking › Settings). Write-only — the screen is told "set" / "not set".
// sandataPasswordEncrypted: home care's EVV aggregator password, written only through its Sandata settings (encrypted).
export const COMPANY_SECRETS = ['twilioAuthToken', 'twilioAccountSid', 'stripeCustomerId', 'sendgridApiKey', 'smtpPassword', 'callrailSigningKey', 'sandataPasswordEncrypted'] as const
export function sanitizeCompany<T extends Record<string, any>>(row: T): T {
  if (!row) return row
  const clone: any = { ...row }
  for (const f of COMPANY_SECRETS) delete clone[f]
  /**
   * Healed on the way out, not only on the way in. Every tenant whose owner has ever pressed Save on
   * Settings is already holding "https:///logo.svg" (verified on basictest), and this is the one
   * function every company response passes through — so the sidebar, the customer portal and the
   * booking widget all start rendering the logo again without waiting for somebody to save again.
   */
  if (typeof clone.logo === 'string') clone.logo = healLogo(clone.logo)
  return clone
}

// COMPANY_COMMERCIAL and redactCompanyCommercial live in ../auth/redactSettings.ts (pure, no imports, so a
// test can run them) beside the settings rule they apply. Re-exported here for existing importers.
export { COMPANY_COMMERCIAL, redactCompanyCommercial }

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
 * The address rules live in ./logoAddress.ts — pure, no imports, so a guard can RUN them. They sat
 * here beside `z.object(...)`, which meant nothing could execute them without zod resolving, and a
 * rule that cannot be run is a rule that is only ever read. Both of these were read repeatedly and
 * both were wrong: "nope" saved as https://nope (T30), and the logo corrupted on save (T58j).
 */
const safeUrl = z.string().trim()
  .refine(looksLikeWebAddress, 'Enter a web address like https://example.com')
  .transform((v: string) => (!v ? '' : HAS_SCHEME.test(v) ? v : `https://${v}`))
/**
 * One rule, one implementation. The schema and the guard both go through `normalizeLogo`, so the
 * guard cannot pass while the route behaves differently — which is the failure mode a comment
 * claiming "same rule" beside a second copy of the logic produces.
 *
 * The value is healed BEFORE it is judged, so the first save after this ships REPAIRS a row already
 * holding the malformed string rather than carefully preserving it.
 */
const safeLogo = z.string()
  .refine((v: string) => normalizeLogo(v).ok, 'Enter an image address like https://example.com/logo.png, or a path like /logo.svg')
  .transform((v: string) => normalizeLogo(v).value)

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

/**
 * ONE SPELLING OF ONE ROLE. (T51 follow-up)
 *
 * Owner: "'field' and 'user' are both labelled 'Staff'."
 *
 * They are labelled the same because they ARE the same role: `user` carries an empty permission list
 * of its own (auth/permissions.ts:243) and the role mapping always folds `user → field` before any
 * permission is resolved. So the label is right and the DATA is what is wrong — a company ends up
 * holding two spellings of one role, and the Team page then shows two people as "Staff" whose stored
 * roles differ, which reads as a bug because it is one.
 *
 * It got that way because POST /users DEFAULTED to `'user'`: every account created without an
 * explicit role took the legacy spelling. `user` is still ACCEPTED — old clients and scripts send it
 * — but it is stored as `field` from here on, so the data converges on one value without a migration
 * and without anybody's access changing. Existing rows keep working: the label map and the role
 * mapping both still know the old word.
 */
const canonicalRole = (role?: string) => (role === 'user' ? 'field' : role)

/**
 * …AND ON THE WAY OUT, for the rows that were already there. (T58)
 *
 * Fixing the write path converges the data only as fast as somebody edits each person. Measured on
 * the live fleet, every one of the ten test tenants still holds `user` rows, and contractor holds
 * BOTH spellings at once — three `field` and one `user`. That is precisely what the owner is looking
 * at: four people on one Team page, all correctly labelled "Staff", whose stored roles disagree.
 *
 * So the API answers one word. `user` and `field` are not two roles that happen to share a label —
 * they are one role with two spellings, and the permission layer has always folded them together
 * before deciding anything (auth/permissions.ts). A list that reports them differently is reporting
 * a distinction the system does not make.
 *
 * This is deliberately a READ fix, not a migration: it needs no DDL, it is true the moment it
 * deploys on all eleven live tenants, and it cannot damage a row. `user` is still accepted on the
 * way in, and anything that stored it keeps working.
 */
const withCanonicalRole = <T extends { role?: unknown }>(row: T): T =>
  (row && row.role === 'user' ? { ...row, role: 'field' } : row)

/** The refusal for an address that already has a login here — who holds it, and what to do instead. */
const duplicateEmailMessage = (email: string, who: { firstName?: string | null; lastName?: string | null; isActive?: boolean | null }) => {
  const name = [who.firstName, who.lastName].filter(Boolean).join(' ')
  return `${email} already has a login here${name ? ` (${name})` : ''}.`
    + (who.isActive === false ? ' That login is switched off — reactivate it from the list instead of adding it again.' : ' Each person needs their own email address.')
}

/**
 * What PUT /users/:id may change. `.strict()`: a field it does not take is REFUSED, never answered 200 and dropped. A PUT
 * carrying `password` came back 200 and changed nothing, so an owner believed they had set a teammate's password
 * (coordinator, 10/23). A first password has its own door (POST /users/:id/password); email is the login and is not
 * edited here.
 */
const USER_EDIT_FIELDS = ['firstName', 'lastName', 'phone', 'role', 'extraPermissions', 'isActive'] as const
const nameField = (label: string) => z.string().trim().min(1, `${label} can't be blank.`).max(100, `${label} is too long (100 characters at most).`)
const unknownUserFieldMessage = (keys: string[]) => {
  if (keys.includes('password')) return 'A password is not changed here. For someone who has never signed in, use Set password; anyone else uses Forgot password on the sign-in page.'
  if (keys.includes('email')) return "A login's email address is not changed here — add a new login for the new address, then switch the old one off."
  return `These can't be changed here: ${keys.join(', ')}. You can change ${USER_EDIT_FIELDS.join(', ')}.`
}

export function createCompanyRoutes(deps: CompanyDeps) {
  const { db, tables: t, authenticate, requireAdmin, requirePermission, requireAnyPermission, canSee, invalidateExtraPermissions, template, roleLabel, sendInvite } = deps
  const roles = (deps.options?.roles && deps.options.roles.length ? deps.options.roles : DEFAULT_ROLES) as [string, ...string[]]
  const app = new Hono()
  app.use('*', authenticate)

  const readBody = async (c: any) => (await c.req.json().catch(() => null)) ?? ({} as any)

  /** A role in the vertical's own word, lower case for a sentence ('staff', 'manager'). */
  const roleWord = (role: unknown) => String(roleLabel ? roleLabel(String(role || '')) : role || '').toLowerCase()
  /**
   * A change to who gets in, on the record in words: a login added (and as what, and whether by invite), a role moved
   * (its own action, role_change, so the log can be filtered to it), access revoked or restored, an invite sent again.
   * Taken from templates/crm-store routes/users.ts (store T3, "check the audit log"): the write floor's row said only
   * "Updated — user", which cannot tell a promotion from a typo fixed in a name. Never throws.
   */
  const logSeat = (c: any, action: string, who: any, changes: Record<string, unknown> | null, description: string | null) => {
    if (!deps.audit?.log) return
    try {
      const name = [who?.firstName, who?.lastName].filter(Boolean).join(' ') || who?.email || null
      deps.audit.log({
        action, entity: deps.audit.ENTITIES?.USER ?? 'user', entityId: who?.id ?? null, entityName: name,
        changes, metadata: description ? { description } : null, req: c,
      })
    } catch { /* an audit row is never the reason a change fails */ }
  }

  /**
   * What of the company row this reader gets. (T41; Contractor admin pass, 10/12)
   *   · below company:update — no commercial terms at all (redactCompanyCommercial);
   *   · company:update without billing:manage (an admin) — the plan and licence, which the Billing page shows them
   *     anyway, but NOT the integrations bag: the Stripe account the shop's customers pay into, the QuickBooks
   *     realm, whatever the next connector adds. No screen reads any of it for any seat, and the accounts the
   *     business's money runs through are the owner's (billing:manage), as changing the plan is;
   *   · the owner — the row.
   * Every reply that carries the row goes through here — the GET and each save — so a save cannot hand back what
   * the read withholds. canSee not wired → not asked → unchanged.
   */
  // Every answer that hands the company back goes through here (the GET and every save), so what a vertical adds to it
  // (deps.describe: home care's effectiveTimezone) is redacted by the same rule as the rest.
  const forReader = async (c: any, row: any) => {
    const safe = deps.describe ? { ...row, ...deps.describe(row) } : row
    const u = c.get('user') as any
    if (!canSee) return safe
    if (!(await canSee(u?.role, 'company:update', u?.userId))) return redactCompanyCommercial(safe)
    if (!(await canSee(u?.role, 'billing:manage', u?.userId))) { const { integrations: _connected, ...rest } = safe; return rest }
    return safe
  }

  // ---------------------------------------------------------------- company
  app.get('/', async (c) => {
    const currentUser = c.get('user') as any
    const [row] = await db.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    if (!row) return c.json({ error: 'Company not found' }, 404)
    const safe = sanitizeCompany(row)
    /**
     * The commercial fields go only to whoever may change the company — the same rung that PUT /
     * below requires, and the rung /api/billing already answers to. (T41)
     *
     * Asked with `company:update`: not wired (canSee absent) → not asked → today's behaviour, so a
     * template nobody rewires is unchanged rather than silently narrowed.
     */
    return c.json(await forReader(c, safe))
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
      city: z.string().optional(), state: z.string().optional(), zip: zipField(),
      /**
       * The logo is rendered as <img src> on the portal and the website goes into an <a href> in the
       * sidebar. Both accepted anything, including "javascript:alert(1)" — and an href is the sink where
       * that actually runs, so a company admin could leave a trap that fires for every user who clicks
       * "Live Website". Only http(s) is allowed now, and only on write; existing values are untouched.
       *
       * null clears the field. It used to 400 with "Expected string, received null", so the Settings form
       * could set a logo and never remove one. (Field Service T28 M2 + L9)
       */
      logo: safeLogo.optional().nullable(),
      // The colour on every invoice, email and portal page. It accepted "banana", which then went into
      // a CSS value and silently did nothing. The booking colour grew this same check in T27 N11 and
      // this one — the one customers actually see — was missed. (Salon T28 L1)
      primaryColor: z.string().trim().optional().refine((v: string | undefined) => !v || /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v), 'Brand colour must be a hex value like #1d4ed8.'),
      website: safeUrl.optional().nullable(), licenseNumber: z.string().optional(), settings: z.record(z.any()).optional(),
      ...(deps.fields || {}),
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
      // Any key that names payment terms (paymentTermsDays, defaultPaymentTerms, a bare paymentTerms) is a number of days.
      for (const [k, v] of Object.entries(money)) if (/paymentterms/i.test(k)) { const bad = paymentTermsProblem(v); if (bad) return c.json({ error: bad, field: `settings.${k}` }, 400) }
      // Opening hours (Settings › Company), read by the website: a week of HH:MM pairs or closed days (./businessHours.ts).
      if ('businessHours' in money) { const bad = checkBusinessHours(money.businessHours); if (bad) return c.json({ error: bad, field: 'businessHours' }, 400) }

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
    // The WHOLE prior row, not just its settings: the audit entry below reports what actually
    // CHANGED, which needs something to compare against. One read on a settings save. (T58k)
    const [before] = await db.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    if (data.settings && typeof data.settings === 'object') {
      // What redaction added on the way out (accountLock, …Configured) is not saved back.
      data.settings = withoutDisplayKeys(data.settings)
      const merged: Record<string, unknown> = { ...((before?.settings as any) || {}), ...data.settings }
      /**
       * A UI ROUND-TRIP MUST NOT DELETE THE SHOP'S COMMERCIAL STATE. (T58k)
       *
       *   owner: "Saving Settings also drops null keys (billingType, nextBillingDate, trialEndsAt)."
       *
       * Null means "remove this key", added in T20 L1 because merging alone meant a key could only
       * ever be added. That is still right for a setting somebody is clearing. What it did not
       * account for is the Settings form posting the ENTIRE settings object back, nulls included,
       * for keys it does not even render — so pressing Save deleted the plan's billing type, the
       * next billing date and the trial end. Nobody asked for any of that to be removed, and the
       * trial end disappearing changes what the tenant is entitled to.
       *
       * So removal is refused for the keys the SERVER owns. They are not the owner's to clear from a
       * settings form; they are set by billing and onboarding. Any other key still clears on null,
       * which is what the mechanism was for.
       */
      const SERVER_OWNED = new Set([
        'plan', 'planId', 'billingType', 'billingStatus', 'nextBillingDate', 'trialEndsAt',
        'seatLimit', 'monthlyAmount', 'stripeCustomerId', 'stripeSubscriptionId', 'onboardingComplete',
      ])
      for (const [k, v] of Object.entries(data.settings as Record<string, unknown>)) {
        if (v !== null) continue
        if (SERVER_OWNED.has(k)) {
          // Put the stored value back: the request said null, and null is not the caller's to say here.
          if (before?.settings && k in (before.settings as any)) merged[k] = (before.settings as any)[k]
          else delete merged[k]
          continue
        }
        delete merged[k]
      }
      updates.settings = merged
    }
    const [row] = await db.update(t.company).set(updates).where(eq(t.company.id, currentUser.companyId)).returning()
    if (!row) return c.json({ error: 'Company not found' }, 404)
    /**
     * WHO CHANGED THE SHOP'S SETTINGS. (T41)
     *
     * WHAT changed matters as much as that something did, so the entry carries the KEYS the request
     * touched — `settings.defaultTaxRate`, `settings.paymentTermsDays`, `name`, `licenseNumber`
     * — rather than the whole blob. The blob holds plan state, onboarding flags and per-vertical
     * configuration across thirteen verticals; dumping it into every row would bury the one key
     * somebody is looking for and copy settings into the log for ever.
     *
     * Values are NOT recorded. A settings change is "the tax rate was touched, by this person, from
     * this address, at this time" — enough to find the change and ask; the value is on the record
     * itself. Never throws: a settings save must not fail because the log was unavailable.
     */
    try {
      if (deps.audit?.log) {
        /**
         * WHAT CHANGED, NOT WHAT THE FORM POSTED. (T58k)
         *
         *   owner: "Salon: Settings rows list all 50 fields the form sent, not the one that changed."
         *
         * This recorded `Object.keys(data)` — every field in the request. The Settings screen posts
         * the whole form on every save, so changing one tax rate wrote an audit row naming fifty
         * fields, and the one that actually moved was invisible among them. The row was technically
         * true and completely useless, which is the same outcome as the em-dash it replaced.
         *
         * Compared against the stored row now, by value. JSON.stringify because a setting can be a
         * number, a string, a boolean or an object, and `!==` on two equal objects is always true.
         */
        const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
        const touched = Object.keys(data).filter((k) => k !== 'settings' && !same((before as any)?.[k], (data as any)[k]))
        const beforeSettings = ((before?.settings as any) || {}) as Record<string, unknown>
        const settingKeys = data.settings && typeof data.settings === 'object'
          ? Object.keys(data.settings as Record<string, unknown>).filter((k) => !same(beforeSettings[k], (data.settings as any)[k]))
          : []
        // A save that changed nothing is not an event. Logging it is how a settings log fills with
        // rows nobody can act on, which is what buried the real ones.
        if (!touched.length && !settingKeys.length) return c.json(await forReader(c, sanitizeCompany(row)))
        deps.audit.log({
          action: deps.audit.ACTIONS?.UPDATE ?? 'update',
          entity: deps.audit.ENTITIES?.COMPANY ?? 'company',
          entityId: row.id, entityName: row.name,
          metadata: { fields: touched, settings: settingKeys },
          userId: currentUser?.userId, companyId: currentUser?.companyId, req: c,
        })
      }
    } catch { /* an unwritten log must not undo a saved setting */ }
    return c.json(await forReader(c, sanitizeCompany(row)))
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
    // Only ids this template offers may be switched on. Ids already on may be sent back (no 400 for them), and those
    // this template still lists stay — a not-ready one a platform admin switched on included; anything else is a 400.
    // Core features are always kept on.
    const [current] = await db.select({ enabledFeatures: t.company.enabledFeatures }).from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1)
    // Not-ready (hidden) features are not the owner's to switch on — the catalogue never shows them, and
    // the save does not accept them either. One already on (a platform admin's choice) survives a save.
    const offered = getFeaturesForTemplate(template).filter((f) => !f.hidden)
    const allowed = new Set<string>([...offered.map((f) => f.id), ...((current?.enabledFeatures || []) as string[])])
    const unknown = (features as string[]).filter((f) => !allowed.has(f))
    // A not-ready feature is named for what it is, by its real name — "Unknown feature ids … measurement_reports"
    // read like a typo for a switch the owner can see in the registry. (Owner, 2026-10-09)
    const notReady = unknown.filter((f) => FEATURE_MAP[f]?.hidden)
    if (notReady.length) {
      const names = notReady.map((f) => FEATURE_MAP[f].name).join(', ')
      return c.json({ error: `${names} ${notReady.length === 1 ? "isn't" : "aren't"} ready yet, so ${notReady.length === 1 ? 'it' : 'they'} can't be switched on.`, code: 'feature_not_ready', notReady }, 400)
    }
    if (unknown.length) return c.json({ error: `Unknown feature ids for this product: ${unknown.join(', ')}` }, 400)
    // An id already on may come back in the save (the page sends what it was given), but only what this product still
    // offers is kept (withinOffer): a feature taken off the industry goes at the owner's next save, never kept because
    // it happened to be on (home care's shared Invoices, live test 2026-10-22).
    const next = withinOffer(template, [...offered.filter((f) => f.core).map((f) => f.id), ...(features as string[])])
    const [row] = await db.update(t.company).set({ enabledFeatures: next, updatedAt: new Date() }).where(eq(t.company.id, currentUser.companyId)).returning()
    if (!row) return c.json({ error: 'Company not found' }, 404)
    try { deps.onFeaturesChanged?.(next) } catch (e: any) { console.warn('[Features] onFeaturesChanged failed:', e?.message || e) }
    // Switching a module on or off changes what the whole tenant can do, so it is a security event
    // as much as a settings one. Recorded as the DIFFERENCE, which is what anybody asking will want.
    try {
      if (deps.audit?.log) {
        const was = new Set(((current?.enabledFeatures || []) as string[]))
        const now = new Set(next)
        deps.audit.log({
          action: deps.audit.ACTIONS?.UPDATE ?? 'update',
          entity: deps.audit.ENTITIES?.COMPANY ?? 'company',
          entityId: row.id, entityName: row.name,
          metadata: {
            fields: ['enabledFeatures'],
            switchedOn: next.filter((f) => !was.has(f)),
            switchedOff: [...was].filter((f) => !now.has(f)),
          },
          userId: currentUser?.userId, companyId: currentUser?.companyId, req: c,
        })
      }
    } catch { /* as above */ }
    return c.json(await forReader(c, sanitizeCompany(row)))
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
      resetToken: t.user.resetToken, resetTokenExp: t.user.resetTokenExp,
    }).from(t.user).where(eq(t.user.companyId, currentUser.companyId))
    // An invited seat that has not yet chosen a password reads "Invite sent", not "Active" (invite re-test, 10/14).
    // Worked out here and the token itself dropped — it is the password link and never leaves the server.
    const now = Date.now()
    const shaped = rows.map(({ resetToken, resetTokenExp, ...r }: any) => ({
      ...r, invitePending: !r.lastLogin && !!resetToken && !!resetTokenExp && new Date(resetTokenExp).getTime() > now,
    }))
    // Send the word alongside the id. The Users table used to map the id itself, which is a second
    // definition of the vocabulary and drifts from this one the moment a vertical renames a rung.
    // One spelling out, whatever is stored — see withCanonicalRole. Applied BEFORE the label so a
    // vertical that renames the rung labels the canonical word, not the legacy one.
    const canonical = shaped.map((r: any) => withCanonicalRole(r))
    const labelled = roleLabel ? canonical.map((r: any) => ({ ...r, roleLabel: roleLabel(String(r.role || '')) })) : canonical

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
    /**
     * `isActive` IS ACCEPTED HERE. (T58d — Showcase, "isActive:false being ignored")
     *
     * It was not, and zod strips what it does not declare, so `POST /users { isActive: false }`
     * answered 201 with a fully ACTIVE seat. Nothing refused it and nothing reported it; the caller
     * asked for a suspended account and got a working one, which on a seat-limited plan is also a
     * seat they did not mean to spend.
     *
     * The edit route three handlers down has honoured `isActive` all along — it is how Revoke access
     * works — so this was the same field being real on one door and discarded on the other. Same
     * shape as the rule that says a check applied on create applies on edit, read the other way
     * round: a field honoured on edit is honoured on create.
     *
     * The seat cap below is deliberately NOT applied when the new seat is inactive: it counts active
     * users, because that is what a plan charges for, and refusing to create a suspended account on
     * a full plan would make the one safe thing an admin can do impossible.
     */
    // No password = an INVITE: the person is emailed a link to choose their own, which works once and for
    // INVITE_TTL_MS. A password the admin sets is still accepted, for a shop that hands logins over in person.
    const schema = z.object({ email: z.string().email(), password: z.string().min(8).optional(), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(roles).default('user'), isActive: z.boolean().optional() })
    const body = await readBody(c)
    if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
    if (body.password === '') delete body.password
    const parsed = schema.safeParse(body)
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid user details' }, 400)
    const { password, ...rest } = parsed.data
    const invite = !password
    if (invite && !sendInvite) return c.json({ error: 'Set a first password for them (at least 8 characters).' }, 400)
    if (invite && rest.isActive === false) return c.json({ error: 'An invite is for someone who can sign in — set a password to create a suspended account.' }, 400)
    // One spelling from here on — see canonicalRole. The schema still DEFAULTS to 'user' because
    // that default is also what older callers rely on; what changes is what gets stored. (T51)
    rest.role = canonicalRole(rest.role) as typeof rest.role
    // Hash before opening the transaction — bcrypt takes ~100ms and must not run under a row lock. An invited
    // person's stored password is random and never told to anyone; the link replaces it.
    const passwordHash = await Bun.password.hash(password || crypto.randomUUID() + crypto.randomUUID(), 'bcrypt')
    const inviteFields = invite ? { resetToken: crypto.randomUUID(), resetTokenExp: new Date(Date.now() + INVITE_TTL_MS) } : {}

    // Seat cap (seats.ts, the one rule): the count and the insert happen under a lock on the company row so two
    // concurrent adds cannot both pass the check.
    const outcome = await db.transaction(async (tx: any) => {
      const [companyRow] = await tx.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1).for('update')
      if (rest.isActive !== false) {
        const full = await seatRefusal(tx, t, companyRow)
        if (full) return { status: 403 as const, body: full }
      }
      // One login per address, whatever its case: an older row may hold "Sam@Shop.com", and "sam@shop.com" is the same
      // inbox. The refusal says who already has it, in words (live test 10/22: "Email already exists" read like a fault).
      const [existing] = await tx.select({ id: t.user.id, firstName: t.user.firstName, lastName: t.user.lastName, isActive: t.user.isActive }).from(t.user)
        .where(and(sql`lower(${t.user.email}) = ${rest.email}`, eq(t.user.companyId, currentUser.companyId))).limit(1)
      if (existing) return { status: 409 as const, body: { error: duplicateEmailMessage(rest.email, existing), code: 'email_taken' } }
      const [created] = await tx.insert(t.user).values({ ...rest, ...inviteFields, passwordHash, companyId: currentUser.companyId }).returning(USER_COLUMNS(t.user))
      return { status: 201 as const, body: created, companyName: companyRow?.name as string | undefined }
    })
    if (outcome.status === 201) {
      const made = outcome.body as any
      logSeat(c, deps.audit?.ACTIONS?.CREATE ?? 'create', made, null, `Login added — ${made.email}, as ${roleWord(made.role)}${invite ? ' (invited by email)' : ''}`)
    }
    if (outcome.status !== 201 || !invite) return c.json(outcome.body as any, outcome.status)
    // Sent after the row is committed. A failed send leaves the seat in place, says so, and Resend invite retries it.
    const inviteSent = await emailInvite(currentUser, { email: rest.email, firstName: rest.firstName, role: rest.role }, (inviteFields as any).resetToken, outcome.companyName)
    return c.json({ ...(outcome.body as any), invited: true, inviteSent }, 201)
  })

  /** The teamInvite email — true when the provider accepted it. Never throws: the seat already exists. */
  const emailInvite = async (currentUser: any, to: { email: string; firstName: string; role: string }, resetToken: string, companyName?: string): Promise<boolean> => {
    if (!sendInvite) return false
    try {
      const [inviter] = await db.select({ firstName: t.user.firstName, lastName: t.user.lastName }).from(t.user).where(eq(t.user.id, currentUser.userId)).limit(1)
      let name = companyName
      if (!name) { const [co] = await db.select({ name: t.company.name }).from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1); name = co?.name }
      const result: any = await sendInvite(to.email, {
        firstName: to.firstName,
        inviterName: [inviter?.firstName, inviter?.lastName].filter(Boolean).join(' ') || 'Your team',
        companyName: name || 'your company',
        role: roleLabel ? roleLabel(to.role) : to.role,
        resetToken,
      })
      // The template email services answer { success } rather than throwing on a refused send.
      return !(result && typeof result === 'object' && result.success === false)
    } catch { return false }
  }

  /**
   * Send the invite again — a fresh 7-day link, for someone who has never signed in (the first one expired, went
   * to spam, or was never sent). Anyone who has signed in uses Forgot password like everyone else.
   */
  app.post('/users/:id/invite', requireAdmin, async (c) => {
    const currentUser = c.get('user') as any
    if (!sendInvite) return c.json({ error: 'Invites are not available here — set their password instead.' }, 400)
    const [target] = await db.select().from(t.user).where(and(eq(t.user.id, c.req.param('id')), eq(t.user.companyId, currentUser.companyId))).limit(1)
    if (!target) return c.json({ error: 'User not found' }, 404)
    // The owner's account is the owner's: nobody else sends a set-your-password link for it, whether or not the owner
    // has signed in yet (templates/crm-store routes/users.ts refused it always; the engine refused only after a sign-in).
    if (target.role === 'owner') return c.json({ error: "The owner's account can't be sent an invite. The owner signs in with their own password, or uses Forgot password.", code: 'owner_account' }, 409)
    if (!target.isActive) return c.json({ error: 'Restore their access first — a suspended account cannot sign in.' }, 409)
    if (target.lastLogin) return c.json({ error: 'They have already signed in. If they have lost their password, Forgot password on the sign-in page sends them a new link.' }, 409)
    const resetToken = crypto.randomUUID()
    await db.update(t.user).set({ resetToken, resetTokenExp: new Date(Date.now() + INVITE_TTL_MS), updatedAt: new Date() }).where(eq(t.user.id, target.id))
    const inviteSent = await emailInvite(currentUser, { email: target.email, firstName: target.firstName, role: target.role }, resetToken)
    logSeat(c, deps.audit?.ACTIONS?.UPDATE ?? 'update', target, null, `Invite sent again — ${target.email}`)
    return c.json({ invited: true, inviteSent })
  })

  /**
   * SET A FIRST PASSWORD — for a login that has never been used. (Coordinator 10/23; live tests 10/22)
   *
   * Adding someone by invite left them at "Invite sent" until they opened the email, and the owner had no way to hand
   * over a password instead: PUT /users/:id dropped `password` and answered 200, so the testers' manager and staff
   * logins could only be made by deleting the invited seat and adding it again. The way the big CRMs do it (Jobber,
   * Housecall Pro): the admin may set the first password for someone who has not signed in yet.
   *
   * Only before the first sign-in. After that the password is the person's own, and Forgot password is how it is
   * replaced — an admin who could set anyone's password at any time could become anyone. The owner's account is never
   * set this way, a switched-off login is restored first, and the unused invite link stops working (one way in).
   * Recorded in the audit log, by whom and for whom; the password itself never is.
   */
  app.post('/users/:id/password', requireAdmin, async (c) => {
    const currentUser = (c as any).get('user')
    const parsed = z.object({ password: z.string().min(8, 'The password needs at least 8 characters.').max(200, 'That password is too long.') }).strict().safeParse(await readBody(c))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Enter a password of at least 8 characters.' }, 400)
    const target = await findTarget(c.req.param('id'), currentUser.companyId)
    if (!target) return c.json({ error: 'User not found' }, 404)
    if (target.role === 'owner') return c.json({ error: "The owner's password is the owner's own. They change it under Settings › Security, or use Forgot password.", code: 'owner_account' }, 409)
    if (target.id === currentUser.userId) return c.json({ error: 'Change your own password under Settings › Security.', code: 'own_account' }, 409)
    if (!target.isActive) return c.json({ error: 'Turn their login back on first — a switched-off login cannot sign in.', code: 'inactive' }, 409)
    if (target.lastLogin) return c.json({ error: 'They have already signed in, so the password is theirs now. If they have lost it, Forgot password on the sign-in page sends them a new link.', code: 'already_signed_in' }, 409)
    const passwordHash = await Bun.password.hash(parsed.data.password, 'bcrypt')
    await db.update(t.user).set({ passwordHash, resetToken: null, resetTokenExp: null, updatedAt: new Date() })
      .where(and(eq(t.user.id, target.id), eq(t.user.companyId, currentUser.companyId)))
    logSeat(c, deps.audit?.ACTIONS?.UPDATE ?? 'update', target, null, `First password set by an admin — ${target.email}`)
    return c.json({ success: true, id: target.id, invitePending: false })
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
    const schema = z.object({
      firstName: nameField('First name').optional(), lastName: nameField('Last name').optional(),
      // Blank clears it; anything else reads like a phone number (the company phone's rule).
      phone: z.union([z.string().trim(), z.null()]).optional()
        .refine((v) => !v || (v.replace(/\D/g, '').length >= 7 && v.replace(/\D/g, '').length <= 15), 'Enter a valid phone number (7–15 digits), or leave it blank.')
        .transform((v) => (v === '' ? null : v)),
      role: z.enum(roles).optional(), extraPermissions: z.array(z.enum(['users:read'])).optional(), isActive: z.boolean().optional(),
    }).strict()
    const parsed = schema.safeParse(await readBody(c))
    if (!parsed.success) {
      const unknown = parsed.error.issues.flatMap((i: any) => (i.code === 'unrecognized_keys' ? i.keys : []))
      if (unknown.length) return c.json({ error: unknownUserFieldMessage(unknown), code: 'field_not_editable', fields: unknown }, 400)
      return c.json({ error: parsed.error.issues[0]?.message || 'Invalid changes' }, 400)
    }
    const data = parsed.data
    // …and on the edit too, so saving an existing 'user' row converts it rather than keeping the
    // legacy spelling alive. The owner-demotion check below reads data.role, and `field` and `user`
    // are the same role to it either way. (T51)
    if (data.role !== undefined) data.role = canonicalRole(data.role) as typeof data.role
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
    /**
     * Turning a login back ON spends a seat, so it meets the plan's cap — the one rule (seats.ts) the add above meets, under
     * the same lock on the company row. It did not: switch someone off, add a person, switch them back on, and a 10-seat
     * plan had 11 active logins (found re-checking the seat rules for the live test, 10/23).
     */
    const reactivating = data.isActive === true && target.isActive === false
    const outcome = await db.transaction(async (tx: any) => {
      if (reactivating) {
        const [companyRow] = await tx.select().from(t.company).where(eq(t.company.id, currentUser.companyId)).limit(1).for('update')
        const full = companyRow ? await seatRefusal(tx, t, companyRow) : null
        if (full) return { full }
      }
      const [updated] = await tx.update(t.user).set({ ...data, updatedAt: new Date() }).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId))).returning(USER_COLUMNS(t.user))
      return { row: updated }
    })
    if ((outcome as any).full) return c.json({ ...(outcome as any).full, code: 'seat_limit' }, 403)
    const row = (outcome as any).row
    if (row) {
      const changes: Record<string, { old: unknown; new: unknown }> = {}
      for (const k of Object.keys(data)) {
        const was = k === 'role' ? canonicalRole(target.role) : target[k]
        if (JSON.stringify(was ?? null) !== JSON.stringify((data as any)[k] ?? null)) changes[k] = { old: was ?? null, new: (data as any)[k] ?? null }
      }
      const access = data.isActive !== undefined && data.isActive !== target.isActive
      logSeat(c, changes.role ? (deps.audit?.ACTIONS?.ROLE_CHANGE ?? 'role_change') : (deps.audit?.ACTIONS?.UPDATE ?? 'update'), { ...target, ...row },
        Object.keys(changes).length ? changes : null,
        access ? (data.isActive ? `Access restored — ${target.email}` : `Access revoked — ${target.email}`) : null)
    }
    // An edit that does not touch the role still returns the stored one, which may be the legacy word.
    return c.json(withCanonicalRole(row as any))
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
      return rows.map((r: any) => withCanonicalRole(r))
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
    if (deps.heldBy) {
      const heldBy = deps.heldBy
      const held = await db.transaction(async (tx: any) => {
        await tx.select({ id: t.user.id }).from(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId))).for('update')
        const what = await heldBy(tx, id)
        if (what.length) return what
        await tx.delete(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId)))
        return null
      })
      if (held) {
        const who = [target.firstName, target.lastName].filter(Boolean).join(' ') || target.email
        return c.json({
          error: `${who} still has ${held.join(', ')}. Deleting the login would take them off it. Deactivate them instead: they can't sign in, their seat is freed, and their work keeps their name.`,
          code: 'user_holds_records',
          held,
        }, 409)
      }
      return c.body(null, 204)
    }
    await db.delete(t.user).where(and(eq(t.user.id, id), eq(t.user.companyId, currentUser.companyId)))
    return c.body(null, 204)
  })

  return app
}
