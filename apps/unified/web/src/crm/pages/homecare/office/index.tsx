// Home care, the office group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// Moved from templates/crm-homecare/frontend/src/components/admin/: DashboardOverview (OfficeHome), IncidentResponsesDue,
// ComplianceTracking, AuditLogs, LoginActivity, IncidentReporting, IncidentDetail, ReportsAnalytics, AgencyTimezone,
// CommunicationLog, SMSManagement, AlertsManagement, MessageBoard, NotificationCenter, IntegrationsHub, SandataPanel,
// UserManagement; components/ImpersonationModal. Not moved: components/admin/FeaturesPage (the shared feature switches
// at /crm/settings/features are the same page on the same PUT /api/company/features, from the registry's catalogue —
// /crm/agency-features goes there) and components/HelpPanel (the app's Help at /crm/help).
//
// Each permission is the one the page's main API asks on the server; where a caregiver also holds it, the office's verb
// (rule 7 of docs/UNIFIED_HOMECARE_SCREENS.md) so a caregiver's menu stays their own app.
import type { ReactElement } from 'react'
import { Navigate, Route } from 'react-router-dom'
import {
  AlertTriangle, BarChart3, Bell, BellRing, Calculator, ClipboardList, CreditCard, FileText, KeyRound, MessageSquare, Plug, ScrollText, ShieldCheck,
  Smartphone, ToggleLeft, TrendingUp, Upload, UserCog,
} from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const ComplianceTracking = page(() => import('./ComplianceTracking'))
const AuditLogs = page(() => import('./AuditLogs'))
const LoginActivity = page(() => import('./LoginActivity'))
const IncidentReporting = page(() => import('./IncidentReporting'))
const IncidentDetail = page(() => import('./IncidentDetail'))
const ReportsAnalytics = page(() => import('./ReportsAnalytics'))
const CommunicationLog = page(() => import('./CommunicationLog'))
const SMSManagement = page(() => import('./SMSManagement'))
const AlertsManagement = page(() => import('./AlertsManagement'))
const MessageBoard = page(() => import('./MessageBoard'))
const NotificationCenter = page(() => import('./NotificationCenter'))
const IntegrationsHub = page(() => import('./IntegrationsHub'))
const UserManagement = page(() => import('./UserManagement'))
const MarginReports = page(() => import('./MarginReports'))
const DataImport = page(() => import('./DataImport'))
const PayRules = page(() => import('./PayRules'))
const Autopay = page(() => import('./Autopay'))
const LtcBilling = page(() => import('./LtcBilling'))
const Home = page(() => import('./OfficeHome'))

/**
 * The permission each page's main API asks (server/crm/homecare/**):
 *   compliance          care-hr:read          hr/backgroundChecks.ts, hr/caregivers.ts (caregivers hold only care-schedule:read)
 *   audit-logs          care-compliance:read  office/auditLogs.ts
 *   login-activity      audit:read            office/compliance.ts (sign-ins and IP addresses: owner and admin only,
 *                                             owner's decision 2026-10-09 — a manager holds care-compliance, not this)
 *   incidents(/:id)     care-compliance:read  office/incidents.ts
 *   reports             care-billing:read     planning/reports.ts (the overview; other tabs ask more, the page says so)
 *   margin-reports      care-billing:read     planning/marginReports.ts: client margin asks billing AND payroll read, turnover asks
 *                                             care-hr:read; the page shows each tab only to whoever holds its permission
 *   pay-rules           care-payroll:read     payroll/payRulesRoutes.ts: reading asks :read, saving and the ADP / Paychex files ask :update (the page shows those only to whoever holds it)
 *   autopay             care-billing:read     billing/autopayRoutes.ts: reading asks :read; saving a card, removing it and "Try now" ask :update (the page shows those only to whoever holds it)
 *   ltc-billing         care-billing:read     billing/ltcRoutes.ts: reading and the claim packet ask :read; saving a policy asks :update (the page shows the form's Save only to whoever holds it)
 *   data-import         care-clients:create   office/csvImport.ts: each kind asks its own area's :create (clients care-clients, caregivers care-hr,
 *                                             recurring shifts care-schedule) and the page offers only the kinds the person holds
 *   communication-log   care-portal:update    portals/communication.ts (caregivers hold care-portal:read)
 *   sms                 care-portal:update    portals/sms.ts
 *   alerts              care-compliance:read  visits/alerts.ts
 *   messages            care-portal:update    portals/messages.ts asks care-portal:read, which caregivers hold
 *   notifications       care-portal:update    portals/notifications.ts asks care-portal:read, which caregivers hold
 *   integrations        evv:delete            visits/sandata.ts (OFFICE_EVV, visits/shared.ts): the hub opens on EVV; its
 *                                             other tabs ask care-billing:read, care-payroll:update, integrations:update
 *                                             and the page shows each only to whoever holds it
 *   users              care-hr:read          hr/caregivers.ts /admins and /caregivers (care-hr:read or care-schedule:read;
 *                                             the office's verb — each control on the page asks its own)
 */
const INTEGRATIONS = 'evv:delete'

const PERMISSION: Record<string, string> = {
  '/crm/compliance': 'care-hr:read',
  '/crm/audit-logs': 'care-compliance:read',
  '/crm/login-activity': 'audit:read',
  '/crm/incidents': 'care-compliance:read',
  '/crm/reports': 'care-billing:read',
  '/crm/margin-reports': 'care-billing:read',
  '/crm/data-import': 'care-clients:create',
  '/crm/pay-rules': 'care-payroll:read',
  '/crm/autopay': 'care-billing:read',
  '/crm/ltc-billing': 'care-billing:read',
  '/crm/communication-log': 'care-portal:update',
  '/crm/sms': 'care-portal:update',
  '/crm/alerts': 'care-compliance:read',
  '/crm/messages': 'care-portal:update',
  '/crm/notifications': 'care-portal:update',
  '/crm/integrations': INTEGRATIONS,
  '/crm/users': 'care-hr:read',
}

export const routes: ReactElement[] = [
  <Route key="hc-office-compliance" path="compliance" element={<ComplianceTracking />} />,
  <Route key="hc-office-audit-logs" path="audit-logs" element={<AuditLogs />} />,
  <Route key="hc-office-login-activity" path="login-activity" element={<LoginActivity />} />,
  <Route key="hc-office-incidents" path="incidents" element={<IncidentReporting />} />,
  <Route key="hc-office-incident" path="incidents/:id" element={<IncidentDetail />} />,
  <Route key="hc-office-reports" path="reports" element={<ReportsAnalytics />} />,
  <Route key="hc-office-margin-reports" path="margin-reports" element={<MarginReports />} />,
  <Route key="hc-office-data-import" path="data-import" element={<DataImport />} />,
  <Route key="hc-office-pay-rules" path="pay-rules" element={<PayRules />} />,
  <Route key="hc-office-autopay" path="autopay" element={<Autopay />} />,
  <Route key="hc-office-ltc-billing" path="ltc-billing" element={<LtcBilling />} />,
  <Route key="hc-office-communication-log" path="communication-log" element={<CommunicationLog />} />,
  <Route key="hc-office-sms" path="sms" element={<SMSManagement />} />,
  <Route key="hc-office-alerts" path="alerts" element={<AlertsManagement />} />,
  <Route key="hc-office-messages" path="messages" element={<MessageBoard />} />,
  <Route key="hc-office-notifications" path="notifications" element={<NotificationCenter />} />,
  <Route key="hc-office-integrations" path="integrations" element={<IntegrationsHub />} />,
  <Route key="hc-office-users" path="users" element={<UserManagement />} />,
  // The template's Features page is the shared feature switches (same PUT /api/company/features).
  <Route key="hc-office-agency-features" path="agency-features" element={<Navigate to="/crm/settings/features" replace />} />,
]

export const nav: NavItem[] = [
  { to: '/crm/compliance', icon: ShieldCheck, label: 'Compliance', permission: PERMISSION['/crm/compliance'] },
  { to: '/crm/audit-logs', icon: ScrollText, label: 'Audit Logs', permission: PERMISSION['/crm/audit-logs'] },
  { to: '/crm/login-activity', icon: KeyRound, label: 'Login Activity', permission: PERMISSION['/crm/login-activity'] },
  { to: '/crm/incidents', icon: AlertTriangle, label: 'Incidents', permission: PERMISSION['/crm/incidents'] },
  { to: '/crm/reports', icon: BarChart3, label: 'Reports & Analytics', permission: PERMISSION['/crm/reports'], features: ['reports'] },
  { to: '/crm/margin-reports', icon: TrendingUp, label: 'Margin & turnover', permission: PERMISSION['/crm/margin-reports'], features: ['care_margin_reports'] },
  { to: '/crm/data-import', icon: Upload, label: 'Import from a spreadsheet', permission: ['care-clients:create', 'care-hr:create', 'care-schedule:create'], features: ['care_import'] },
  { to: '/crm/pay-rules', icon: Calculator, label: 'Pay rules', permission: PERMISSION['/crm/pay-rules'], features: ['care_payroll_rules'] },
  { to: '/crm/autopay', icon: CreditCard, label: 'Automatic payments', permission: PERMISSION['/crm/autopay'], features: ['care_autopay'] },
  { to: '/crm/ltc-billing', icon: FileText, label: 'Long-term care insurance', permission: PERMISSION['/crm/ltc-billing'], features: ['care_ltc_billing'] },
  { to: '/crm/communication-log', icon: ClipboardList, label: 'Communication Log', permission: PERMISSION['/crm/communication-log'] },
  { to: '/crm/sms', icon: Smartphone, label: 'SMS', permission: PERMISSION['/crm/sms'], features: ['two_way_texting'] },
  { to: '/crm/alerts', icon: BellRing, label: 'Alerts', permission: PERMISSION['/crm/alerts'] },
  { to: '/crm/messages', icon: MessageSquare, label: 'Messages', permission: PERMISSION['/crm/messages'] },
  { to: '/crm/integrations', icon: Plug, label: 'Integrations Hub', permission: PERMISSION['/crm/integrations'] },
  // PUT /api/company/features is requireAdmin (a rank, not a permission) — the shell gates /crm/settings/features the same.
  { to: '/crm/agency-features', icon: ToggleLeft, label: 'Features', minRole: 'admin' },
  { to: '/crm/notifications', icon: Bell, label: 'Notifications', permission: PERMISSION['/crm/notifications'] },
  { to: '/crm/users', icon: UserCog, label: 'Users & Access', permission: PERMISSION['/crm/users'] },
]

export const routePermissions: Record<string, string> = PERMISSION

/** The office's overview at /crm/dashboard (templates/crm-homecare components/admin/DashboardOverview.tsx). */
export function OfficeHome() { return <Home /> }
