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
  AlertTriangle, BarChart3, Bell, BellRing, ClipboardList, KeyRound, MessageSquare, Plug, ScrollText, ShieldCheck,
  Smartphone, ToggleLeft, UserCog,
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
const Home = page(() => import('./OfficeHome'))

/**
 * The permission each page's main API asks (server/crm/homecare/**):
 *   compliance          care-hr:read          hr/backgroundChecks.ts, hr/caregivers.ts (caregivers hold only care-schedule:read)
 *   audit-logs          care-compliance:read  office/auditLogs.ts
 *   login-activity      care-compliance:read  office/compliance.ts
 *   incidents(/:id)     care-compliance:read  office/incidents.ts
 *   reports             care-billing:read     planning/reports.ts (the overview; other tabs ask more, the page says so)
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
  '/crm/login-activity': 'care-compliance:read',
  '/crm/incidents': 'care-compliance:read',
  '/crm/reports': 'care-billing:read',
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
  { to: '/crm/reports', icon: BarChart3, label: 'Reports & Analytics', permission: PERMISSION['/crm/reports'] },
  { to: '/crm/communication-log', icon: ClipboardList, label: 'Communication Log', permission: PERMISSION['/crm/communication-log'] },
  { to: '/crm/sms', icon: Smartphone, label: 'SMS', permission: PERMISSION['/crm/sms'] },
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
