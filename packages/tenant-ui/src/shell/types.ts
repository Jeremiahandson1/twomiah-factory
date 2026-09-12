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
  /** Optional stable id (external items have no unique route) */
  id?: string
}

export interface ShellAuth {
  user: any
  company: any
  logout: () => void | Promise<void>
  hasFeature: (id: string) => boolean
}

export interface ShellConfig {
  /** The sidebar, in order. Items without `features` are core. */
  nav: NavItem[]
  /**
   * Routes that exist in the app but have no sidebar entry, and the features that make them
   * relevant — gated by URL exactly like nav items (a salon must not render /crm/jobs).
   */
  routeGates?: Record<string, string[]>
  brand?: {
    icon?: IconComponent
    /** Shown while the company has not loaded. Default "CRM". */
    fallbackName?: string
  }
  /** "Back to Portal" link at the top of the sidebar. Default true. */
  backToPortal?: boolean
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
