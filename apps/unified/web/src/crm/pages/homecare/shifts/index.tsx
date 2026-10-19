// Home care, the shifts group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// Moved from templates/crm-homecare/frontend/src: components/admin/{LiveBoard, VisitGpsMap, EmergencyCoverage,
// NoShowAlerts, ShiftApprovals, RouteOptimizer, CompanyOptimizer, ClientWeekHours} and pages/{PtoPage, NoShowPage}
// (AdminDashboard.tsx renderPage: live-board, emergency-coverage, no-show-alerts, shift-approvals, route-optimizer,
// company-optimizer, client-week, pto, no-show). Not moved: components/admin/CaregiverAvailability and
// AbsenceManagement — nothing in the template imported either.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { Activity, AlertTriangle, BellRing, CalendarRange, CheckSquare, Map as MapIcon, Sparkles } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const LiveBoard = page(() => import('./LiveBoard'))
const EmergencyCoverage = page(() => import('./EmergencyCoverage'))
const NoShowAlerts = page(() => import('./NoShowAlerts'))
const ShiftApprovals = page(() => import('./ShiftApprovals'))
const RouteOptimizer = page(() => import('./RouteOptimizer'))
const CompanyOptimizer = page(() => import('./CompanyOptimizer'))
const ClientWeekHours = page(() => import('./ClientWeekHours'))
const PtoPage = page(() => import('./PtoPage'))
const NoShowPage = page(() => import('./NoShowPage'))

export const routes: ReactElement[] = [
  <Route key="hc-live-board" path="live-board" element={<LiveBoard />} />,
  <Route key="hc-emergency-coverage" path="emergency-coverage" element={<EmergencyCoverage />} />,
  <Route key="hc-no-show-alerts" path="no-show-alerts" element={<NoShowAlerts />} />,
  <Route key="hc-shift-approvals" path="shift-approvals" element={<ShiftApprovals />} />,
  <Route key="hc-route-optimizer" path="route-optimizer" element={<RouteOptimizer />} />,
  <Route key="hc-company-optimizer" path="company-optimizer" element={<CompanyOptimizer />} />,
  <Route key="hc-client-week" path="client-week" element={<ClientWeekHours />} />,
  <Route key="hc-pto" path="pto" element={<PtoPage />} />,
  <Route key="hc-no-show" path="no-show" element={<NoShowPage />} />,
]

/**
 * The permission each page's main API asks (server/crm/homecare/**). Where a caregiver also holds it, the office's verb
 * stands in so a caregiver's menu stays their own: the matching screen's reads ask care-schedule:read, its writes and
 * the optimizer care-schedule:update. PTO's list is care-payroll:read for the office (a caregiver reads their own through
 * my-pay:read). Shift approvals ask the office's EVV verb, evv:delete, which no caregiver holds.
 */
export const routePermissions: Record<string, string> = {
  '/crm/live-board': 'care-schedule:update',
  '/crm/emergency-coverage': 'care-schedule:update',
  '/crm/no-show-alerts': 'care-schedule:update',
  '/crm/shift-approvals': 'evv:delete',
  '/crm/route-optimizer': 'care-schedule:update',
  '/crm/company-optimizer': 'care-schedule:update',
  '/crm/client-week': 'care-billing:read',
  '/crm/pto': 'care-payroll:read',
  '/crm/no-show': 'care-schedule:update',
}

// The template's menu labels (AdminDashboard.tsx NAV_SECTIONS); pto and no-show had no menu item there.
export const nav: NavItem[] = [
  { to: '/crm/live-board', icon: Activity, label: 'Live Board', permission: routePermissions['/crm/live-board'] },
  { to: '/crm/emergency-coverage', icon: AlertTriangle, label: 'Emergency Coverage', permission: routePermissions['/crm/emergency-coverage'] },
  { to: '/crm/no-show-alerts', icon: BellRing, label: 'No-Show Alerts', permission: routePermissions['/crm/no-show-alerts'] },
  { to: '/crm/shift-approvals', icon: CheckSquare, label: 'Shift Approvals', permission: routePermissions['/crm/shift-approvals'] },
  { to: '/crm/route-optimizer', icon: MapIcon, label: 'Route Optimizer', permission: routePermissions['/crm/route-optimizer'] },
  { to: '/crm/company-optimizer', icon: Sparkles, label: 'Company Optimizer', permission: routePermissions['/crm/company-optimizer'] },
  { to: '/crm/client-week', icon: CalendarRange, label: 'Client Hours by Week', permission: routePermissions['/crm/client-week'] },
]
