// Shared app shell (sidebar + header + settings) — the contract between a template and the vendored shell.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type ShellApi = InvoicingApi & { request?: (path: string, init?: any) => Promise<any>; upload?: (path: string, formData: FormData) => Promise<any> }
export type ShellToast = InvoicingToast
export type IconComponent = React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>

export interface NavItem {
  to: string
  icon: IconComponent
  label: string
  /** NavLink `end` — only the dashboard uses it */
  exact?: boolean
  /** Shown when ANY listed feature is enabled; no list = core, always shown */
  features?: string[]
  /** Optional group header rendered above the first item of each section */
  section?: string
  /** Opens `<company.website>/admin` in a new tab instead of routing (landscaping Website CMS) */
  external?: boolean
  /**
   * Lowest role that may open this page, as a ROLE_RANK id. Absent = no role gate, which is what every
   * vertical had: a manager and a stylist were shown Email, Billing, Users and Settings › Company and
   * got the API's raw 403 text when they opened one. (Salon T28 M5)
   */
  minRole?: string
  /**
   * The permission needed to open this page — the same one its API asks for. Prefer this to `minRole`
   * wherever the server gates on a permission, because rank and permission are different orders: a
   * `viewer` outranks nobody and still holds invoices:read, so minRole: 'manager' on Invoices hides
   * the page from someone the API would serve. Use minRole only where the server itself gates on rank
   * (requireAdmin, requireRole).
   *
   * A field technician was shown Invoices, Quotes, Reports, Team and Marketing, which opened as empty
   * lists with "New Invoice" buttons on them — they read as "no data", not "no access". (T30 M-R1)
   *
   * A LIST means any one of them opens it: home care's Clients page is the office's (care-clients:update) and, read-only,
   * the read-only office seat's (care-office:read) — one page, two doors, and a caregiver holding neither is shown
   * neither. (Live role check, 2026-10-23)
   */
  permission?: string | string[]
  /** Optional stable id (external items have no unique route) */
  id?: string
}

/**
 * The role hierarchy, lowest first — the same order the server's ROLE_HIERARCHY uses, because a menu
 * that disagrees with the API is how you get a page that opens and then refuses.
 */
export const ROLE_RANK = ['viewer', 'field', 'manager', 'admin', 'owner']
/** `user` and `staff` are what some templates store for the field rung. */
const ROLE_ALIASES: Record<string, string> = { user: 'field', staff: 'field' }
export const meetsRole = (role: string | undefined, minRole: string | undefined): boolean => {
  if (!minRole) return true
  const id = ROLE_ALIASES[String(role || '')] || String(role || '')
  const have = ROLE_RANK.indexOf(id)
  const need = ROLE_RANK.indexOf(minRole)
  // an unknown role is not promoted; an unknown requirement is not enforced
  return need < 0 ? true : have >= need
}

/**
 * "May this person open this route at all?" — the ONE rule, so a link cannot disagree with the URL.
 *
 * AppShell already applies both halves of this when it decides whether to blank a page the person
 * typed their way into: the rank from `routeRoles` (or the nav item's `minRole`) and then the
 * permission from `routePermissions` (or the item's `permission`). Links drawn from `config.nav` get
 * it for free. Two places do not:
 *
 *   - the shell's own Settings links (sidebar foot and account menu), which are not nav items; and
 *   - the Account Settings tile on the portal home, in every vertical's CustomerPortal.
 *
 * T41, on the salon: "the portal home offers an 'Account Settings' tile whose APIs 403". Salon
 * declares `routeRoles['/crm/settings'] = 'admin'`, so a stylist was being handed a tile to a screen
 * the shell then blanked — an offer with a refusal behind it. Salon T29 L1 had already fixed the
 * sidebar half by hand; this is the same rule, named once, so the next surface that needs it asks
 * the question instead of re-deriving the answer.
 *
 * `can` is optional and OPEN when absent: two verticals mount no permissions provider at all, and a
 * link hidden from everybody — the owner included — is a worse bug than a link that 403s. A template
 * that declares no requirement for a route is likewise not second-guessed.
 */
/** Does this person hold the permission — or, for a list, any one of them? (NavItem.permission) */
export const allowsPermission = (can: (permission: string) => boolean, permission: string | string[] | undefined): boolean =>
  !permission || (Array.isArray(permission) ? permission.some((p) => can(p)) : can(permission))

export const maySeeRoute = (
  config: { routeRoles?: Record<string, string>; routePermissions?: Record<string, string | string[]>; nav?: NavItem[] },
  to: string,
  role: string | undefined,
  can?: (permission: string) => boolean,
): boolean => {
  const item = config.nav?.find((i) => i.to === to)
  if (!meetsRole(role, config.routeRoles?.[to] ?? item?.minRole)) return false
  const permission = config.routePermissions?.[to] ?? item?.permission
  return !permission || !can || allowsPermission(can, permission)
}

export interface ShellAuth {
  user: any
  company: any
  logout: () => void | Promise<void>
  hasFeature: (id: string) => boolean
  /**
   * May this person do that? Comes from AuthContext, which reads the list /api/auth/me answered —
   * the role's permissions plus any the owner granted this person by name. Optional so a template
   * that has not been rewired still renders its whole menu rather than silently losing it.
   */
  can?: (permission: string) => boolean
}

export interface ShellConfig {
  /** The sidebar, in order. Items without `features` are core. */
  nav: NavItem[]
  /**
   * Routes that exist in the app but have no sidebar entry, and the features that make them
   * relevant — gated by URL exactly like nav items (a salon must not render /crm/jobs).
   */
  routeGates?: Record<string, string[]>
  /**
   * Lowest role for routes that have no sidebar entry of their own, or whose entry is one of several.
   * Checked by URL exactly like `minRole` on a nav item. (Salon T28 M5)
   */
  routeRoles?: Record<string, string>
  /**
   * The permission needed for routes with no sidebar entry of their own, or whose entry is one of
   * several — checked by URL exactly like `permission` on a nav item. (T30 M-R1)
   */
  routePermissions?: Record<string, string | string[]>
  /**
   * Addresses this CRM does not have although the app mounts them — another business type's page that a shared
   * feature would otherwise reach (the bar's /crm/regulars on a salon). Typed in, each says "isn't part of this CRM",
   * as a page whose feature is not offered does. Hiding a page from the menu alone left it one URL away.
   */
  routeAbsent?: string[]
  brand?: {
    icon?: IconComponent
    /** Shown while the company has not loaded. Default "CRM". */
    fallbackName?: string
  }
  /** "Back to Portal" link at the top of the sidebar. Default true. */
  backToPortal?: boolean
  /** The header search box's placeholder in this vertical's words. Default "Search contacts, jobs, invoices...". */
  searchPlaceholder?: string
  /** The header search box (GET /api/search). Default shown; false for an app with no search endpoint to answer it. */
  search?: boolean
  /** A vertical's own control in the header, beside the theme switch (home care's View As). Renders nothing it needn't. */
  headerActions?: React.ComponentType
  /** A vertical's own strip under the header, on every page (home care's "Viewing as …" while a View As is open). */
  banner?: React.ComponentType
  /**
   * Menu headings become buttons that fold their items away, and the person's choice is remembered for them (per signed-in
   * user, in this browser). Default false — a template's menu is unchanged unless it opts in. A heading holding the page
   * that is open never folds shut on the person.
   */
  collapsibleSections?: boolean
}

export interface AppShellProps {
  api: ShellApi
  auth: ShellAuth
  /** realtime socket connected indicator; absent = an app with no socket, and no dot that would only ever say "Disconnected" */
  connected?: boolean
  config: ShellConfig
}

// ---------------------------------------------------------------- settings
// `viewer` was added to DEFAULT_ROLES below and never to this union, so the shared shell has not
// typechecked since — and no template runs tsc in CI, which is why it sat there.
export interface RoleOption { value: 'viewer' | 'field' | 'manager' | 'admin'; label: string; description: string }

export interface SettingsConfig {
  /** Wording of the Add User role picker (the values are what the backend accepts). */
  roles?: RoleOption[]
  /** Hide the license # field for verticals that are not licensed trades. Default shown. */
  licenseNumber?: boolean
  /** The settings sub-pages this app serves (their `/crm/settings/...` paths). Default all — a link to a page the app
   *  has no route for is a link to the 404. */
  subPages?: string[]
  /**
   * The vertical's own settings pages, after the shared ones (roofing's estimator widget): each shown to whoever holds
   * `permission` (when given) and has `feature` on (when given) — a permission, never a rank.
   */
  extraSubPages?: Array<{ to: string; label: string; icon: import('react').ComponentType<{ className?: string }>; permission?: string; feature?: string }>
  /**
   * Show the business's time zone on Settings › Company: the company row's `timezone`, which the app's PUT /api/company
   * must accept (the unified app's does, every vertical). Blank = the state's zone, shown from `effectiveTimezone`. Off by
   * default: a CRM template keeps its zone in settings and its PUT has no such field.
   */
  timeZone?: boolean
  /** Show "Work week starts on" (the pay week overtime is counted over). */
  workWeek?: boolean
  /**
   * What sits under the time zone box. Default: the trades' sentence (hours, reports, invoices, timesheets, online
   * bookings, the AI Receptionist). A shop that has none of those says what its clock really keeps (store, 2026-10-30).
   */
  timeZoneHint?: string
  /**
   * The app's own control on a row of Settings › Users, before the shared ones (the unified app's "View as <person>").
   * Not called for your own row. Absent: nothing extra, as before.
   */
  userActions?: (user: any) => import('react').ReactNode
}

export interface SettingsAuth {
  user: any
  company: any
  updateCompany: (updates: any) => void
  /** Optional so a template that has not been re-vendored yet still type-checks; the page falls back to a reload prompt. */
  updateUser?: (updates: any) => void
}

export interface SettingsPageProps { api: ShellApi; auth: SettingsAuth; toast: ShellToast; config?: SettingsConfig }

export interface FeaturesAuth {
  user: any
  company: any
  isAdmin?: boolean
  /** Re-fetches the session (company.enabledFeatures) so the sidebar updates without a reload. */
  checkAuth?: () => Promise<unknown> | unknown
}

export interface FeaturesSettingsPageProps { api: ShellApi; auth: FeaturesAuth; toast: ShellToast }

export const DEFAULT_ROLES: RoleOption[] = [
  // Lowest first. `viewer` has had a full read-only grant list in BASE_ROLE_PERMISSIONS all along
  // and no way to hand it to anyone, so the only way to give someone read access was `field` —
  // which can update jobs, log time and expenses, and create documents, daily logs and tasks.
  // Anyone who should only look was made able to write. (The dialog still defaults to Staff:
  // emptyUser() names the role explicitly rather than taking the first option.)
  { value: 'viewer', label: 'Viewer', description: 'read-only: can open any page but change nothing' },
  { value: 'field', label: 'Staff', description: 'day-to-day work: view jobs, log time, expenses and notes' },
  { value: 'manager', label: 'Manager', description: 'full access to work and invoicing, but not company settings' },
  { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
]

/** Same words everywhere the role is shown (the table used to say "User" for what the dialog calls Staff). */
export const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', field: 'Staff', user: 'Staff', viewer: 'Viewer' }
