// The shared screens (packages/tenant-ui), handed this app's client, toasts and session. Each CRM template kept a
// wrapper file per screen; one file here.
import { Navigate } from 'react-router-dom'
import {
  AppShell, AuditLogPage, isAccountLocked, BillingPage, EmailAliasesPage, FeaturesSettingsPage, ForgotPasswordPage, LeadInboxPage,
  LoginPage, MyAccountPage, PaywallScreen, ResetPasswordPage, SettingsPage, useAuth, usePermissions, useToast,
} from './shared'
import { api } from './api'
import { SHELL, SETTINGS_SUB_PAGES } from './shell'
import { verticalScreens } from './crm/vertical'
import { SETTINGS_EXTRA as ROOF_SETTINGS_EXTRA } from './crm/verticals/roof'
import { SETTINGS_EXTRA as STORE_SETTINGS_EXTRA } from './crm/verticals/store'
import type { ShellConfig } from './shared'

/** Where the admin opens. */
export const HOME = '/crm'

/** The company's name for the sign-in page: the server writes it into the page (server/admin.ts). */
const companyName = () => document.querySelector('meta[name="company-name"]')?.getAttribute('content') || ''

/**
 * The shell, in this vertical's words: a menu item's label renamed where the vertical says (VerticalSettings.screens.nav,
 * keyed by the page's address — 'Service Calls' for /crm/jobs in field service), a menu heading renamed the same way
 * (screens.navSections, keyed by the heading: landscaping's 'Operations' for field service's 'Field Service'), and its
 * search box prompt. A vertical can also leave a shared item out (screens.navHidden, by address: RV has no use for field
 * service's Parts Inventory page) and widen the features that show one (screens.navFeatures, by address: RV's Parts &
 * Inventory is the shared Inventory page on parts_tracking, as its server mount is), so its menu stays its own.
 */
const verticalShell = (): ShellConfig => {
  const sc = verticalScreens() as unknown as { nav?: Record<string, string>; navSections?: Record<string, string>; searchPlaceholder?: string; navHidden?: string[]; navFeatures?: Record<string, string[]> }
  const names = sc.nav || {}
  const sections = sc.navSections || {}
  const hidden = new Set(Array.isArray(sc.navHidden) ? sc.navHidden : [])
  const widened = sc.navFeatures || {}
  return {
    ...SHELL,
    nav: SHELL.nav.filter((item) => !hidden.has(item.to)).map((item) => {
      const gated = widened[item.to] ? { ...item, features: widened[item.to] } : item
      const renamed = names[item.to] ? { ...gated, label: names[item.to] } : gated
      return item.section && sections[item.section] ? { ...renamed, section: sections[item.section] } : renamed
    }),
    ...(sc.searchPlaceholder ? { searchPlaceholder: sc.searchPlaceholder } : {}),
  }
}
const SHELL_HERE = verticalShell()
export const Shell = () => <AppShell api={api} auth={useAuth()} config={SHELL_HERE} />

/** The admin's front page: the CRM's dashboard where the business has one; else the website for those who look after it; else their account. */
export function Home() {
  const { known, can } = usePermissions()
  const { hasFeature } = useAuth()
  if (!known) return null
  return <Navigate to={hasFeature('dashboard') ? '/crm/dashboard' : can('site:read') ? '/crm/website' : '/crm/account'} replace />
}

export const Login = () => <LoginPage companyName={companyName()} home={HOME} />
export const ForgotPassword = () => <ForgotPasswordPage api={api} />
export const ResetPassword = () => <ResetPasswordPage api={api} />

export function Settings() {
  const auth = useAuth()
  return <SettingsPage api={api} auth={auth} toast={useToast()} config={{ ...verticalScreens().settings, subPages: SETTINGS_SUB_PAGES, extraSubPages: [...ROOF_SETTINGS_EXTRA, ...STORE_SETTINGS_EXTRA] }} />
}

export const FeaturesSettings = () => <FeaturesSettingsPage api={api} auth={useAuth()} toast={useToast()} />
export const MyAccount = () => <MyAccountPage api={api} toast={useToast()} />
export const Billing = () => <BillingPage />
export const EmailAliases = () => <EmailAliasesPage />
// The vertical's lead platforms and words (screens.leads), as the Lead Sources page has them.
export const LeadInbox = () => <LeadInboxPage api={api} toast={useToast()} config={verticalScreens().leads as any} />

export function AuditLog() {
  const { company, can } = useAuth()
  return <AuditLogPage api={api} toast={useToast()} timeZone={(company as { timeZone?: string } | null)?.timeZone} canReadUsers={!!can?.('users:read')} />
}

export function Paywall() {
  const { company, logout } = useAuth()
  // A company that is not locked has nothing to do here: back into the app (home care's lock page did this; the
  // shared screen only goes home after a restart's polling).
  if (company && !isAccountLocked(company as any)) return <Navigate to={HOME} replace />
  return <PaywallScreen company={company as any} onSignOut={logout} request={(method, path) => api.request(path, { method })} homePath={HOME} />
}
