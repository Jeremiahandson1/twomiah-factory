// Shared app shell (sidebar + header + settings) — the contract between a template and the vendored shell.
import type { InvoicingApi, InvoicingToast } from '../invoicing/types'

export type ShellApi = InvoicingApi & { request?: (path: string, init?: any) => Promise<any> }
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
   */
  permission?: string
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
  routePermissions?: Record<string, string>
  brand?: {
    icon?: IconComponent
    /** Shown while the company has not loaded. Default "CRM". */
    fallbackName?: string
  }
  /** "Back to Portal" link at the top of the sidebar. Default true. */
  backToPortal?: boolean
  /** The header search box's placeholder in this vertical's words. Default "Search contacts, jobs, invoices...". */
  searchPlaceholder?: string
}

export interface AppShellProps {
  api: ShellApi
  auth: ShellAuth
  /** realtime socket connected indicator */
  connected?: boolean
  config: ShellConfig
}

// ---------------------------------------------------------------- settings
export interface RoleOption { value: 'field' | 'manager' | 'admin'; label: string; description: string }

export interface SettingsConfig {
  /** Wording of the Add User role picker (the values are what the backend accepts). */
  roles?: RoleOption[]
  /** Hide the license # field for verticals that are not licensed trades. Default shown. */
  licenseNumber?: boolean
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
  { value: 'field', label: 'Staff', description: 'day-to-day work: view jobs, log time, expenses and notes' },
  { value: 'manager', label: 'Manager', description: 'full access to work and invoicing, but not company settings' },
  { value: 'admin', label: 'Admin', description: 'full access, including company settings and team' },
]

/** Same words everywhere the role is shown (the table used to say "User" for what the dialog calls Staff). */
export const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', manager: 'Manager', field: 'Staff', user: 'Staff', viewer: 'Viewer' }
