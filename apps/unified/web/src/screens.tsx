// The shared screens (packages/tenant-ui), handed this app's client, toasts and session. Each CRM template kept a
// wrapper file per screen; one file here.
import { Navigate } from 'react-router-dom'
import {
  AppShell, AuditLogPage, isAccountLocked, BillingPage, EmailAliasesPage, FeaturesSettingsPage, ForgotPasswordPage, LeadInboxPage, NewLeadsPage,
  LoginPage, MyAccountPage, PaywallScreen, ResetPasswordPage, SettingsPage, useAuth, usePermissions, useToast,
} from './shared'
import { api } from './api'
import { SHELL_HERE, SETTINGS_SUB_PAGES } from './shell'
import { verticalScreens } from './crm/vertical'
import { SETTINGS_EXTRA as ROOF_SETTINGS_EXTRA } from './crm/verticals/roof'
import { SETTINGS_EXTRA as STORE_SETTINGS_EXTRA } from './crm/verticals/store'
import { SETTINGS_EXTRA as SALON_SETTINGS_EXTRA } from './crm/verticals/salon'
import { useLiveConnection, subscribeLive } from './live'
import { MessageSquare, BellRing } from 'lucide-react'
import { isHomecare } from './crm/verticals/homecare'
import { ViewAsUserButton, roleWord } from './crm/viewAs'
import { DEFAULT_ROLES } from '@twomiah/tenant-ui/src/shell/types'
/** Settings › Texting: the business's own registered number (crm/pages/TextingPage.tsx; server crm/comms/texting.ts). */
const TEXTING_SETTINGS = { to: '/crm/settings/texting', label: 'Texting', icon: MessageSquare, permission: 'company:read' }
/**
 * Settings › Invoice Reminders (crm/pages/InvoiceRemindersPage.tsx; server crm/billing): the owner and admins, where the
 * business invoices — the Invoices feature, or home care's own Billing.
 */
const INVOICE_REMINDER_SETTINGS = { to: '/crm/settings/invoice-reminders', label: 'Invoice Reminders', icon: BellRing, permission: 'company:update', ...(isHomecare ? {} : { feature: 'invoices' }) }

/** Where the admin opens. */
export const HOME = '/crm'

/** The company's name for the sign-in page: the server writes it into the page (server/admin.ts). */
const companyName = () => document.querySelector('meta[name="company-name"]')?.getAttribute('content') || ''

/** The shell, with the tab's live-updates connection (live.ts) open while someone is signed in — its dot shows it. */
export const Shell = () => {
  const auth = useAuth()
  const connected = useLiveConnection(!!auth.user)
  return <AppShell api={api} auth={auth} connected={connected} config={SHELL_HERE} />
}

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

/**
 * The role picker and the Users list in this vertical's words — the server's (VerticalSettings.roleLabels, served as
 * screens.roleLabels), so the list, the picker, the server's refusals and the View As banner say one word per rung (roofing
 * live re-test 3: "Staff" in Users, "Field" in the brief). A vertical's own picker keeps its descriptions.
 */
const settingsRoles = () => {
  const own = (verticalScreens().settings as { roles?: typeof DEFAULT_ROLES }).roles
  // A vertical that runs no jobs (reporting.jobs false) and has no list of its own does not describe Staff by jobs.
  const noJobs = (verticalScreens().reporting as { jobs?: boolean }).jobs === false
  const shared = noJobs
    ? DEFAULT_ROLES.map((r) => (r.value === 'field' ? { ...r, description: 'day-to-day work on the everyday pages; not settings, the team or billing' } : r))
    : DEFAULT_ROLES
  return (own && own.length ? own : shared).map((r) => ({ ...r, label: roleWord(r.value) || r.label }))
}
export function Settings() {
  const auth = useAuth()
  // timeZone: every vertical's PUT /api/company takes company.timezone (server/modules/company.ts).
  // userActions: "View as <person>" on each row (crm/viewAs.tsx), every vertical.
  return <SettingsPage api={api} auth={auth} toast={useToast()} config={{ ...verticalScreens().settings, roles: settingsRoles(), subPages: SETTINGS_SUB_PAGES, extraSubPages: [TEXTING_SETTINGS, INVOICE_REMINDER_SETTINGS, ...ROOF_SETTINGS_EXTRA, ...STORE_SETTINGS_EXTRA, ...SALON_SETTINGS_EXTRA], timeZone: true, userActions: (u: any) => <ViewAsUserButton person={u} /> }} />
}

export const FeaturesSettings = () => <FeaturesSettingsPage api={api} auth={useAuth()} toast={useToast()} />
export const MyAccount = () => <MyAccountPage api={api} toast={useToast()} />
export const Billing = () => <BillingPage />
export const EmailAliases = () => <EmailAliasesPage />
// The vertical's lead platforms and words (screens.leads), as the Lead Sources page has them.
// A new or changed lead shows at once (live.ts; the server announces lead:created / lead:updated).
// The dashboard's "New leads" tile's list: exactly the rows it counts (GET /api/dashboard/new-leads).
export const NewLeads = () => <NewLeadsPage api={api} />
// ownPermission: the inbox asks leads:* on both sides (server modules/company.ts; live role check, 2026-10-23).
export const LeadInbox = () => <LeadInboxPage api={api} toast={useToast()} config={{ ...(verticalScreens().leads as any), ownPermission: true }} subscribe={subscribeLive} />

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
