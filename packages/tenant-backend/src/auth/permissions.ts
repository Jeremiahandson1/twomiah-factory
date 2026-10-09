// Role → permission matrix + the guards built on it — one implementation for every CRM.
// A template can widen a role (`extraRolePermissions`) or map its own role names onto the standard
// ones (`roleMapping`, e.g. vet's `staff` → `field`); the matrix itself is shared.
import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'

export const ROLE_HIERARCHY = ['viewer', 'field', 'manager', 'admin', 'owner']

export const BASE_ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: ['*'],
  admin: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:*', 'time:*',
    'expenses:*', 'documents:*', 'rfis:*', 'change-orders:*', 'punch-lists:*',
    'daily-logs:*', 'inspections:*', 'bids:*', 'team:*', 'company:read',
    // The rest of the construction document set, same standing as change-orders above. These four
    // shipped with no resource in this matrix at all, which is why their routes carried no gate: adding
    // one without this line would have refused everyone but the owner (check-permission-vocabulary.ts
    // fails the build on exactly that). Reads in those routes stay open, so field/viewer need no grant.
    'submittals:*', 'aia-forms:*', 'draw-schedules:*', 'lien-waivers:*',
    'company:update', 'dashboard:*', 'schedule:*', 'pricebook:*', 'marketing:*',
    /**
     * The audit log is the owner's and the admins'. (Owner's decision, 2026-10-09)
     *
     * It was on reports:read, which a manager holds — and the log carries everybody's sign-ins, IP
     * addresses and two-factor changes, not just the business's records. Its own permission, granted
     * here and nowhere else (owner holds '*'), so a manager can still have reports without it.
     */
    'audit:read',
    'tasks:*',
    /**
     * Seeing the login list, because an admin can already CHANGE it. (T32 B6)
     *
     * `requireAdmin` guards POST, PUT and DELETE on /api/company/users, so an admin could create,
     * re-role and delete logins — while GET was gated on `users:read`, which no role held and only the
     * owner could grant. An admin was therefore managing accounts it could not see, and the Settings
     * Users tab answered 403 for it.
     *
     * A judgement call, and the direction matters: the alternative reading is that logins are the
     * owner's domain and the WRITES should be owner-only. That would be the tighter fix, and it would
     * also stop an admin adding a member of staff — a workflow people rely on. So visibility is
     * aligned with the authority that already exists rather than authority being taken away. It is a
     * small widening (emails and roles; the team roster an admin already reads carries hourly rates),
     * and it is easy to reverse if the intent was the other way.
     */
    'users:read',
    /**
     * Operational modules. Writes are gated in their routes; reads are open, because a technician
     * needs the parts list, the customer's equipment and the service agreement to do the work, and
     * refusing those costs more than it protects.
     *
     * SELECTIONS AND TAKEOFFS ARE NO LONGER IN THAT GROUP. (T32 H1)
     * Both are money documents in a construction CRM — a selection is an option priced against the
     * client's allowance, a takeoff is quantities and what the material costs — and `field` has no
     * quotes and no invoices, so there is no job it does and no screen it opens that needs either.
     * Their reads are gated on the mount in templates/crm/backend/src/routes.
     *
     * THE PRICEBOOK IS THE EXCEPTION, and this comment used to claim otherwise. (T37, asked by the
     * tester after seeing a field technician's nav)
     *
     * `pricebook:read` is NOT in field's list below — and `GET /pricebook/items` and
     * `GET /pricebook/search` carry no permission gate at all, deliberately, with COST and the margin
     * computed from it stripped for any caller who may not see them. So a technician asked "what does
     * another outlet come to?" has the price list and not the markup, which is the useful half. The
     * gate is on the DATA, not the endpoint — `GET /pricebook/export`, which hands over the whole
     * list as a file, does require `pricebook:read`.
     */
    'equipment:*', 'fleet:*', 'warranties:*', 'inventory:*', 'agreements:*',
    'selections:*', 'takeoffs:*', 'calltracking:*', 'reports:*',
    // company config (geofencing, Stripe onboarding) + refunds — admin-tier, like company:update
    'settings:*', 'payments:*',
    // Commission approval moves money OUT to a person, so it sits with payments/refunds rather than
    // with the operational modules above. Locations are multi-location company configuration, which
    // is settings. Both shipped with no resource at all, which is why their routes carried no gate.
    'commissions:*', 'locations:*',
    /**
     * WHAT THE BUSINESS PAID, and therefore its margin. (T42)
     *
     *   "Viewer sees what staff can't: /api/units cost on 16 of 25 units; /api/fi/products cost; the
     *    full Accounting ledger (64 entries, $29,065); rental revenue; team list; syndication
     *    token."                                                               — RV, HIGH
     *
     *   "Decide whether viewers should see money, then apply the staff stripping to viewer or
     *    document it as intended."                                      — T42, fleet-wide
     *
     * That is two questions, not one, and the answer differs.
     *
     * REVENUE IS A READ-ONLY OFFICE SEAT'S BUSINESS. `viewer` is the bookkeeper, the accountant, the
     * silent partner — on salon it is literally labelled Front Desk. Invoices, quotes, totals, the
     * ledger of what customers owe, the rental income, the team roster: that is `invoices:read`,
     * which viewer holds deliberately, and it stays. Applying the staff stripping to viewer would
     * empty the one seat whose whole purpose is reading the books.
     *
     * COST AND MARGIN ARE NOT. What the dealership paid for a unit, what an F&I product costs the
     * store, what a roof's materials came to — that is the figure an owner keeps to themselves, and
     * anyone holding it can price every deal in the building. It is also the half the sales floor
     * negotiates against, which is why `field` never had it either.
     *
     * ONE PERMISSION, because the fleet had THREE answers to this one question and nothing said so:
     * the pricebook asked `pricebook:read`, the shared inventory module asked `inventory:read`, and
     * crm-rv's unit and F&I cost asked `invoices:read` — which is exactly how the viewer came to
     * hold them. All three ask this now. The swap takes nothing from anybody on the first two: the
     * roles that hold `pricebook:*` and `inventory:*` are precisely the roles listed here, and no
     * template grants either to a lower rung (checked across all 13).
     */
    'margin:read',
    // The roofing set. crm-roof carried a FORKED permission matrix that predated most of this file, so
    // none of its own modules had a resource here — and a gate on a resource the matrix does not carry
    // refuses everyone but the owner, which is exactly why roof's writes were left ungated instead.
    // Listed here rather than in a template's extraRolePermissions because check-permission-vocabulary
    // reads BASE_ROLE_PERMISSIONS and nothing else. Additive for every other vertical: no other
    // template gates on these, so nobody's access changes.
    'storms:*', 'insurance:*', 'canvassing:*', 'measurements:*', 'estimator:*', 'leads:*', 'crews:*',
    // Two carry a money decision, given its own verb so the day-to-day work can sit with a manager
    // while the spend does not: roof-reports:purchase buys a third-party report, financing:approve
    // settles a consumer finance application (approve / decline / mark-funded).
    'roof-reports:*', 'financing:*',
    // Connection + receptionist configuration — admin, the same line settings:* already draws.
    'integrations:*', 'ai-receptionist:*',
    // Support-desk configuration, NOT the desk work. Raising a ticket, replying, rating one and
    // asking the AI assistant stay open to everyone who can sign in — those are how a user gets
    // help. What is gated is publishing the knowledge base (HelpPage.tsx already shows that view
    // only to the admin role; the server never enforced it) and the SLA policy that sets the
    // response and resolve deadline on every ticket. Deliberately not manager: the matrix draws
    // the same admin line for ai-receptionist and integrations.
    'support-kb:*', 'support-sla:*',
    /**
     * …and the THIRD thing, which the two above were read as covering and do not. (T42)
     *
     * The note above draws the line between desk CONFIGURATION (gated) and getting help (open).
     * There is a third category it never named — desk WORK: changing a ticket's status, priority or
     * category, reassigning it, and writing an INTERNAL note that the person who raised it cannot
     * see. PATCH /support/tickets/:id carried `authenticate` and nothing else, so a read-only viewer
     * could close, reprioritise or reassign anybody's ticket in all nine templates that mount it:
     *
     *   "a viewer can change booking status and edit support tickets through the API" — T42, Showcase
     *
     * Raising, replying and rating stay open exactly as documented above; a raiser can also still
     * close their OWN ticket (the route allows createdById), which is the same latitude the matrix
     * already gives a person over their own timesheet line and their own expense claim. Reassigning
     * is triage and needs this permission, creator or not.
     */
    'support:update',
    // Accounts payable (crm only). Purchase orders are a document lifecycle a construction manager
    // runs; vendor bills carry two money operations, so paying and voiding get their own verb —
    // `bills:pay` — and stay with payments:* rather than with the document work.
    'purchase-orders:*', 'bills:*',
    /**
     * The pay run — what every person is owed. (T32 H1)
     *
     * GET /api/payroll/summary returns every employee's hours and pay, including the owner's, and it
     * had NO resource in this matrix at all, so its route carried `authenticate` and nothing else: a
     * field technician and a read-only viewer both read the whole company's payroll.
     *
     * Its own resource rather than borrowing `team:read` — which `viewer` holds — because the roster
     * and the pay run are different questions. It is granted to manager below as well as admin,
     * because the Pay run panel on the Time screen is already shown to manager and up and running a
     * pay period is that role's job. If the intent is that only an admin sees what people earn,
     * deleting the manager line is the whole change.
     */
    'payroll:*',
    // sms:send (text a customer) / sms:* (the canned messages and auto-responders live on
    // marketing:update). Its own resource rather than borrowing contacts:update, which would hand a
    // technician the right to EDIT customer records along with the right to text them. (T30 L-RB)
    'sms:*',
    // ads:read / ads:update (pause, dismiss, A/B tests) / ads:settings (profile, mode, platforms) / ads:spend (launch, resume, apply, AI preview)
    'ads:*',
    // The loyalty programme, split by what each act costs the business:
    //   loyalty:read       see a balance, a card, the ledger, the reward list
    //   loyalty:enroll     put a client on the programme
    //   loyalty:redeem     spend what they earned, against a real visit or order
    //   loyalty:adjust     hand-edit a balance — points out of nothing, so manager and up
    //   loyalty:configure  the rate, the card, and the reward list itself — admin and up
    // Run LY0928 H3 found salon gating reward create/edit on contacts:update, which every stylist
    // holds: any staff member could make a reward nearly free and then redeem it. M4 found the same
    // door open on adjust. Rewards are the price list of the programme; they sit where pricebook and
    // settings already sit.
    'loyalty:*',
    /**
     * A client's portal LINK is a credential, and handing one out is its own permission. (T62; owner's
     * decision 2026-10-09: owners, admins and managers.)
     *
     *   "The stylist holds contacts:create and contacts:update. That lets them fetch any client's working
     *    portal link, which is the credential behind the original T42 high."
     *
     * Switching a client's portal on, reissuing the link, reading it out and emailing it all asked
     * contacts:update — which salon stylists and vet staff hold so they can keep a client's card up to
     * date. Editing an address is not the right to open the customer's portal as them (or, with an
     * edited email, to mail their link to yourself). Split off the same way loyalty:adjust and sms:send
     * were: everyone keeps add/edit; the key sits with the desk.
     */
    'portal:share',
    /**
     * What the business has TAKEN, as one figure: the invoice totals and the dashboard's revenue line.
     * (T62; owner's decision 2026-10-09: vet staff do not see practice revenue.)
     *
     * It rode on invoices:read, and the vet grants its staff invoices:read so they can bill a visit — so
     * the person at the desk read the practice's month. Billing one owner is not the practice's books.
     * Granted here, to manager and to viewer (who sees revenue, not cost — owner's decision), so every
     * vertical reads exactly what it read before; the vet's staff are the only seat with invoices:read
     * and without this.
     */
    'revenue:read',
  ],
  manager: [
    'contacts:*', 'projects:*', 'jobs:*', 'quotes:*', 'invoices:read',
    'invoices:create', 'invoices:update', 'time:*', 'expenses:*', 'documents:*',
    'rfis:*', 'change-orders:*', 'punch-lists:*', 'daily-logs:*', 'inspections:*',
    'submittals:*', 'aia-forms:*', 'draw-schedules:*', 'lien-waivers:*',
    'bids:read', 'team:read', 'company:read', 'dashboard:*', 'schedule:*', 'pricebook:*',
    'marketing:read', 'marketing:create', 'marketing:update',
    'ads:read', 'ads:update',
    'tasks:*',
    // operational modules (writes gated in their routes; reads are open) + read-only reports
    'equipment:*', 'fleet:*', 'warranties:*', 'inventory:*', 'agreements:*',
    'selections:*', 'takeoffs:*', 'calltracking:*', 'reports:read',
    // Desk WORK on a support ticket — triage, not configuration. See the note beside support-kb on
    // the admin row for why this is a third category and not covered by either of the other two.
    // A manager runs the desk; publishing the knowledge base and setting the SLA stay admin. (T42)
    'support:update',
    // A manager sees the commission ledger and the location list but does not approve payouts or
    // reconfigure branches — the same line payments/settings already draw for this role.
    'commissions:read', 'locations:read',
    // What the shop paid, and the margin over it — a manager prices the work and buys the materials.
    // The long note is on the admin row above. (T42)
    'margin:read',
    // The roofing set. A roofing manager runs the day-to-day: storm events, insurance claims, the
    // canvassing board, measurements, estimates, leads and crews — the same standing the construction
    // document set above already gives this role, approvals included.
    'storms:*', 'insurance:*', 'canvassing:*', 'estimator:*', 'leads:*', 'crews:*',
    // …but not the money decisions. Everything except the spend verb, so a manager can run a report,
    // take a measurement or file a finance application and still not buy or settle one.
    'roof-reports:read', 'roof-reports:create', 'roof-reports:update', 'roof-reports:delete',
    'financing:read', 'financing:create', 'financing:update', 'financing:delete',
    'measurements:read', 'measurements:create', 'measurements:update', 'measurements:delete',
    // Connections and the receptionist are configuration: visible, not editable.
    'integrations:read', 'ai-receptionist:read',
    // A construction manager runs purchase orders end to end — raise, send, receive, cancel, reopen.
    // Vendor bills they enter and correct, but paying, voiding and deleting one is admin: `bills:pay`
    // and `bills:delete` are withheld here on purpose, the same line payments:* already draws.
    'purchase-orders:*',
    'bills:read', 'bills:create', 'bills:update',
    // Runs the pay period — the Pay run panel on the Time screen is already shown to this rung. Reads
    // the figures; does not get the rest of payroll:* (processing and export, where those exist).
    'payroll:read',
    'sms:*',
    // Runs the programme day to day, including the correction a desk sometimes has to make — but
    // does not set the rate or write the reward list. Same line settings:* and payments:* draw.
    'loyalty:read', 'loyalty:enroll', 'loyalty:redeem', 'loyalty:adjust',
    // Hands a client their portal link — switch it on, reissue it, read it out, email it. (T62; note on admin)
    'portal:share',
    // The business's takings as one figure. (T62; note on admin)
    'revenue:read',
  ],
  field: [
    'contacts:read', 'projects:read', 'jobs:read', 'jobs:update', 'time:read',
    // expenses mirrors time. The pair above already lets someone correct their own timesheet line;
    // expenses had create and read only, so a stylist who typed $95 for $9.50 was offered Edit on
    // their own row and got a 403, with no way to fix it. Both update and delete are narrowed in
    // the route to YOUR OWN claim, and only until somebody approves it — the same rule the
    // timesheet follows. (Salon RR6 E7)
    'time:create', 'time:update', 'expenses:read', 'expenses:create', 'expenses:update',
    'expenses:delete', 'documents:read',
    'documents:create', 'rfis:read', 'rfis:create', 'punch-lists:read',
    'punch-lists:update', 'daily-logs:read', 'daily-logs:create', 'inspections:read',
    'company:read', 'dashboard:read', 'schedule:read',
    // create + read any; update/delete gated to own tasks (assignee or creator) in the routes
    'tasks:read', 'tasks:create', 'tasks:update',
    // Sees a balance and a card. Spending and correcting are widened per-vertical, because who works
    // the till differs: a salon stylist checks their own client out, a site crew never does.
    'loyalty:read',
  ],
  viewer: [
    'contacts:read', 'projects:read', 'jobs:read', 'quotes:read', 'invoices:read',
    'time:read', 'expenses:read', 'documents:read', 'rfis:read', 'change-orders:read',
    'punch-lists:read', 'daily-logs:read', 'inspections:read', 'bids:read',
    'team:read', 'company:read', 'dashboard:read', 'schedule:read',
    'tasks:read',
    'loyalty:read',
    // Sees revenue, not cost (owner's decision) — what it read before revenue:read existed. (T62; note on admin)
    'revenue:read',
  ],
  user: [],
}

export interface PermissionsDeps {
  db: any
  tables: { user: any }
  /** Permissions appended to a role's base list, e.g. `{ field: ['contacts:create'] }`. */
  extraRolePermissions?: Record<string, string[]>
  /** Template role names mapped onto the standard hierarchy. `user → field` is always included. */
  roleMapping?: Record<string, string>
  /**
   * What this vertical CALLS each rung, for anything a person reads. The hierarchy is named for the
   * trades it was built for, so a salon stylist was told "yourRole: field" when refused. The names are
   * presentation only — every gate still works on the hierarchy id. (Salon T28 M3)
   */
  roleLabels?: Record<string, string>
}

/**
 * What the fleet calls each rung when nothing overrides it. Kept identical to ROLE_LABELS in
 * packages/tenant-ui/src/shell/types.ts so the server and the screen say the same word — before this,
 * an unconfigured vertical answered the raw id ("field") while its own Users table showed "Staff".
 */
const DEFAULT_ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', field: 'Staff', user: 'Staff', viewer: 'Viewer' }

export function createPermissions(deps: PermissionsDeps) {
  const { db, tables: { user } } = deps
  const ROLE_PERMISSIONS: Record<string, string[]> = {}
  for (const [role, list] of Object.entries(BASE_ROLE_PERMISSIONS)) {
    const extra = deps.extraRolePermissions?.[role] || []
    ROLE_PERMISSIONS[role] = Array.from(new Set([...list, ...extra]))
  }
  for (const [role, extra] of Object.entries(deps.extraRolePermissions || {})) {
    if (!ROLE_PERMISSIONS[role]) ROLE_PERMISSIONS[role] = Array.from(new Set(extra))
  }
  const ROLE_MAPPING: Record<string, string> = { user: 'field', ...(deps.roleMapping || {}) }

  function normalizeRole(role: string): string {
    return ROLE_MAPPING[role] || role || 'viewer'
  }

  /** The hierarchy id in this vertical's own words — for messages people read, never for a decision. */
  function roleLabel(role: string): string {
    const id = normalizeRole(role)
    return deps.roleLabels?.[id] || DEFAULT_ROLE_LABELS[id] || (id ? id[0].toUpperCase() + id.slice(1) : id)
  }

  // Per-user grants the OWNER hands out on top of the role (Settings › Users), e.g. users:read.
  // Read from the user row and cached 15s per user so every guarded request does not pay a query.
  const GRANT_CACHE = new Map<string, { at: number; list: string[] }>()
  async function getExtraPermissions(userId: string | undefined): Promise<string[]> {
    if (!userId) return []
    const hit = GRANT_CACHE.get(userId)
    if (hit && Date.now() - hit.at < 15_000) return hit.list
    let list: string[] = []
    try {
      const [row] = await db.select({ extra: user.extraPermissions }).from(user).where(eq(user.id, userId)).limit(1)
      list = Array.isArray(row?.extra) ? (row!.extra as string[]).filter((x) => typeof x === 'string') : []
    } catch { list = [] }
    GRANT_CACHE.set(userId, { at: Date.now(), list })
    return list
  }
  function invalidateExtraPermissions(userId: string) { GRANT_CACHE.delete(userId) }

  function hasPermission(role: string, permission: string, extra: string[] = []): boolean {
    // Per-user grants (extra_permissions) sit on top of the role.
    if (extra.includes('*') || extra.includes(permission)) return true
    const normalizedRole = normalizeRole(role)
    const permissions = ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer
    if (permissions.includes('*')) return true
    if (permissions.includes(permission)) return true
    const [resource] = permission.split(':')
    if (permissions.includes(`${resource}:*`)) return true
    return false
  }

  function getPermissions(role: string): string[] {
    const normalizedRole = normalizeRole(role)
    return ROLE_PERMISSIONS[normalizedRole] || ROLE_PERMISSIONS.viewer
  }

  function requirePermission(permission: string) {
    return async (c: Context, next: Next) => {
      const userRole = (c.get('user') as any)?.role
      if (!userRole) return c.json({ error: 'Authentication required' }, 401)
      const extra = await getExtraPermissions((c.get('user') as any)?.userId)
      if (!hasPermission(userRole, permission, extra)) {
        return c.json({ error: 'Permission denied', required: permission, yourRole: roleLabel(userRole) }, 403)
      }
      await next()
    }
  }

  function requireAnyPermission(permissions: string[]) {
    return async (c: Context, next: Next) => {
      const userRole = (c.get('user') as any)?.role
      if (!userRole) return c.json({ error: 'Authentication required' }, 401)
      const extra = await getExtraPermissions((c.get('user') as any)?.userId)
      if (!permissions.some(p => hasPermission(userRole, p, extra))) {
        return c.json({ error: 'Permission denied', requiredAny: permissions, yourRole: roleLabel(userRole) }, 403)
      }
      await next()
    }
  }

  /** Hierarchy gate: the user's role must be at least `minRole` (viewer < field < manager < admin < owner). */
  function requireRole(minRole: string) {
    return async (c: Context, next: Next) => {
      const userRole = normalizeRole((c.get('user') as any)?.role)
      if (!userRole) return c.json({ error: 'Authentication required' }, 401)
      const userLevel = ROLE_HIERARCHY.indexOf(userRole)
      const requiredLevel = ROLE_HIERARCHY.indexOf(minRole)
      if (userLevel < requiredLevel) {
        // the label, not the id — requirePermission's two refusals above already answer in the vertical's
        // own words, and this one sat three lines away still saying "field". (Salon T31)
        return c.json({ error: 'Insufficient role', required: minRole, yourRole: roleLabel(userRole) }, 403)
      }
      await next()
    }
  }

  function requireOwnership(getOwnerId: (c: Context) => Promise<string>) {
    return async (c: Context, next: Next) => {
      const userRole = normalizeRole((c.get('user') as any)?.role)
      if (ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf('manager')) {
        return next()
      }
      const ownerId = await getOwnerId(c)
      if (ownerId !== (c.get('user') as any).userId) {
        return c.json({ error: 'You can only modify your own entries' }, 403)
      }
      await next()
    }
  }

  return {
    ROLE_HIERARCHY, ROLE_PERMISSIONS, normalizeRole, roleLabel,
    getExtraPermissions, invalidateExtraPermissions,
    hasPermission, getPermissions,
    requirePermission, requireAnyPermission, requireRole, requireOwnership,
  }
}

export type Permissions = ReturnType<typeof createPermissions>
