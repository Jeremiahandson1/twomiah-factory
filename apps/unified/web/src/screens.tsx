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
import { useLiveConnection, subscribeLive } from './live'
import { MessageSquare } from 'lucide-react'
/** Settings › Texting: the business's own registered number (crm/pages/TextingPage.tsx; server crm/comms/texting.ts). */
const TEXTING_SETTINGS = { to: '/crm/settings/texting', label: 'Texting', icon: MessageSquare, permission: 'company:read' }

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

export function Settings() {
  const auth = useAuth()
  // timeZone: every vertical's PUT /api/company takes company.timezone (server/modules/company.ts).
  return <SettingsPage api={api} auth={auth} toast={useToast()} config={{ ...verticalScreens().settings, subPages: SETTINGS_SUB_PAGES, extraSubPages: [TEXTING_SETTINGS, ...ROOF_SETTINGS_EXTRA, ...STORE_SETTINGS_EXTRA], timeZone: true }} />
}

export const FeaturesSettings = () => <FeaturesSettingsPage api={api} auth={useAuth()} toast={useToast()} />
export const MyAccount = () => <MyAccountPage api={api} toast={useToast()} />
export const Billing = () => <BillingPage />
export const EmailAliases = () => <EmailAliasesPage />
// The vertical's lead platforms and words (screens.leads), as the Lead Sources page has them.
// A new or changed lead shows at once (live.ts; the server announces lead:created / lead:updated).
// The dashboard's "New leads" tile's list: exactly the rows it counts (GET /api/dashboard/new-leads).
export const NewLeads = () => <NewLeadsPage api={api} />
export const LeadInbox = () => <LeadInboxPage api={api} toast={useToast()} config={verticalScreens().leads as any} subscribe={subscribeLive} />

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
