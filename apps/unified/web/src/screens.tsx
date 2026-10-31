// The shared screens (packages/tenant-ui), handed this app's client, toasts and session. Each CRM template kept a
// wrapper file per screen; one file here.
import { lazy, Suspense } from 'react'
import { Navigate } from 'react-router-dom'
import {
  AppShell, AuditLogPage, isAccountLocked, BillingPage, EmailAliasesPage, FeaturesSettingsPage, ForgotPasswordPage, LeadInboxPage, NewLeadsPage,
  LoginPage, MyAccountPage, PaywallScreen, ResetPasswordPage, SettingsPage, useAuth, usePermissions, useToast,
} from './shared'
import { api } from './api'
import { SHELL_HERE, SETTINGS_SUB_PAGES } from './shell'
import { verticalScreens } from './crm/vertical'
import { leadStarts } from './leadStarts'
import { SETTINGS_EXTRA as ROOF_SETTINGS_EXTRA } from './crm/verticals/roof'
import { SETTINGS_EXTRA as STORE_SETTINGS_EXTRA } from './crm/verticals/store'
import { SETTINGS_EXTRA as SALON_SETTINGS_EXTRA } from './crm/verticals/salon'
import { useLiveConnection, subscribeLive } from './live'
import { MessageSquare, BellRing, FileArchive, Clock } from 'lucide-react'
import { isHomecare } from './crm/verticals/homecare'
import { ViewAsUserButton, roleWord } from './crm/viewAs'
import { DEFAULT_ROLES } from '@twomiah/tenant-ui/src/shell/types'
/** Settings › Texting: the business's own registered number (crm/pages/TextingPage.tsx; server crm/comms/texting.ts). */
// Behind Two-Way Texting, as the server's texting routes are: a vertical that is not offered it (the store) has no card.
const TEXTING_SETTINGS = { to: '/crm/settings/texting', label: 'Texting', icon: MessageSquare, permission: 'company:read', feature: 'two_way_texting' }
/**
 * Settings › Invoice Reminders (crm/pages/InvoiceRemindersPage.tsx; server crm/billing): the owner and admins, where the
 * business invoices — the Invoices feature, or home care's own Billing.
 */
const INVOICE_REMINDER_SETTINGS = { to: '/crm/settings/invoice-reminders', label: 'Invoice Reminders', icon: BellRing, permission: 'company:update', ...(isHomecare ? {} : { feature: 'invoices' }) }

/** Settings › Job Reminders (crm/pages/JobRemindersPage.tsx; server crm/field/jobReminderRoutes.ts): the owner and admins, where the Job Reminders feature is on. */
const JOB_REMINDER_SETTINGS = { to: '/crm/settings/job-reminders', label: 'Job Reminders', icon: BellRing, permission: 'company:update', feature: 'job_reminders' }

/** Settings › Time Clock (crm/pages/TimeClockSettingsPage.tsx; server crm/field/clockExtras.ts): the owner and admins, where Time Tracking is on. */
const TIME_CLOCK_SETTINGS = { to: '/crm/settings/time-clock', label: 'Time Clock', icon: Clock, permission: 'company:update', feature: 'time_tracking' }

/** Settings › Your data (crm/pages/ExportEverythingPage.tsx): every list the business has, one ZIP — the owner's and the admins'. */
const EXPORT_SETTINGS = { to: '/crm/settings/export', label: 'Your Data', icon: FileArchive, permission: 'settings:update' }

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
  // workWeek: on for every vertical unless its settings say `workWeek: false` (the store runs no pay week). It used to be
  // passed as `true` after the vertical's own settings were spread, so no vertical could turn it off.
  const own = verticalScreens().settings as { workWeek?: boolean }
  return <SettingsPage api={api} auth={auth} toast={useToast()} config={{ ...verticalScreens().settings, roles: settingsRoles(), subPages: SETTINGS_SUB_PAGES, extraSubPages: [TEXTING_SETTINGS, INVOICE_REMINDER_SETTINGS, JOB_REMINDER_SETTINGS, TIME_CLOCK_SETTINGS, EXPORT_SETTINGS, ...ROOF_SETTINGS_EXTRA, ...STORE_SETTINGS_EXTRA, ...SALON_SETTINGS_EXTRA], timeZone: true, workWeek: own.workWeek !== false, userActions: (u: any) => <ViewAsUserButton person={u} /> }} />
}

export const FeaturesSettings = () => <FeaturesSettingsPage api={api} auth={useAuth()} toast={useToast()} />
export const MyAccount = () => <MyAccountPage api={api} toast={useToast()} />
// Settings › Billing, and under it the owner's "Buy it outright" (crm/pages/OwnItPanel.tsx — the owner only).
const OwnItPanel = lazy(() => import('./crm/pages/OwnItPanel'))
export const Billing = () => <><BillingPage /><Suspense fallback={null}><OwnItPanel /></Suspense></>
export const EmailAliases = () => <EmailAliasesPage />
// The vertical's lead platforms and words (screens.leads), as the Lead Sources page has them.
// A new or changed lead shows at once (live.ts; the server announces lead:created / lead:updated).
// The dashboard's "New leads" tile's list: exactly the rows it counts (GET /api/dashboard/new-leads).
export const NewLeads = () => <NewLeadsPage api={api} />
// ownPermission: the inbox asks leads:* on both sides (server modules/company.ts; live role check, 2026-10-23).
// phoneCalls: a call reaches the inbox only through call tracking (store final check, 2026-10-26).
export const LeadInbox = () => {
  const { hasFeature, can } = useAuth()
  const screens = verticalScreens() as any
  // Convert and start the work in one step: only what this trade has, the business has on, and this seat may create (leadStarts.ts).
  const startAfterConvert = leadStarts(screens, hasFeature, can)
  return <LeadInboxPage api={api} toast={useToast()} config={{ ...screens.leads, ownPermission: true, phoneCalls: hasFeature('call_tracking'), spam: true, startAfterConvert }} subscribe={subscribeLive} />
}

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
