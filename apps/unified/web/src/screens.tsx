// The shared screens (packages/tenant-ui), handed this app's client, toasts and session. Each CRM template kept a
// wrapper file per screen; one file here.
import { Navigate } from 'react-router-dom'
import {
  AppShell, AuditLogPage, BillingPage, EmailAliasesPage, FeaturesSettingsPage, ForgotPasswordPage, LeadInboxPage,
  LoginPage, MyAccountPage, PaywallScreen, ResetPasswordPage, SettingsPage, useAuth, usePermissions, useToast,
} from './shared'
import { api } from './api'
import { SHELL, SETTINGS_SUB_PAGES } from './shell'

/** Where the admin opens. */
export const HOME = '/crm'

/** The company's name for the sign-in page: the server writes it into the page (server/admin.ts). */
const companyName = () => document.querySelector('meta[name="company-name"]')?.getAttribute('content') || ''

export const Shell = () => <AppShell api={api} auth={useAuth()} config={SHELL} />

/** The admin's front page: the website for those who look after it; otherwise their account. */
export function Home() {
  const { known, can } = usePermissions()
  if (!known) return null
  return <Navigate to={can('site:read') ? '/crm/website' : '/crm/account'} replace />
}

export const Login = () => <LoginPage companyName={companyName()} home={HOME} />
export const ForgotPassword = () => <ForgotPasswordPage api={api} />
export const ResetPassword = () => <ResetPasswordPage api={api} />

export function Settings() {
  const auth = useAuth()
  return <SettingsPage api={api} auth={auth} toast={useToast()} config={{ subPages: SETTINGS_SUB_PAGES }} />
}

export const FeaturesSettings = () => <FeaturesSettingsPage api={api} auth={useAuth()} toast={useToast()} />
export const MyAccount = () => <MyAccountPage api={api} toast={useToast()} />
export const Billing = () => <BillingPage />
export const EmailAliases = () => <EmailAliasesPage />
export const LeadInbox = () => <LeadInboxPage api={api} toast={useToast()} />

export function AuditLog() {
  const { company, can } = useAuth()
  return <AuditLogPage api={api} toast={useToast()} timeZone={(company as { timeZone?: string } | null)?.timeZone} canReadUsers={!!can?.('users:read')} />
}

export function Paywall() {
  const { company, logout } = useAuth()
  return <PaywallScreen company={company as any} onSignOut={logout} request={(method, path) => api.request(path, { method })} homePath={HOME} />
}
