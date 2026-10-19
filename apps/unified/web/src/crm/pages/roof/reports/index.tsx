// Roofing's reports screens (docs/UNIFIED_ROOF_SCREENS.md): their routes under /crm, their menu items and the permission each
// page's main API asks. Moved from templates/crm-roof/frontend/src: pages/roofing/MeasurementsPage, pages/roofReports/*,
// pages/{EstimatorPage, EstimatorTrialPage}, pages/settings/EstimatorSettingsPage.
//
// Gates, as the template's (App.tsx routes, components/layout/AppLayout.tsx menu): the menu items below carry the
// features, and the shell blocks a URL under a menu item whose features are all off (packages/tenant-ui shell
// routeGate.ts) — so /crm/roof-reports and /crm/roof-reports/:id are behind measurement_reports (the template's
// FeatureRoute) and /crm/estimator behind instant_estimator (the template's page said "not enabled on your plan").
// Measurements is behind measurement_reports too (the template showed it ungated; its API is gated the same way now).
// The estimator's Settings page and the trial offer were ungated in the template and are here.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { Calculator, FileBarChart, Ruler } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const MeasurementsPage = page(() => import('./MeasurementsPage'))
const RoofReportsPage = page(() => import('./RoofReportsPage'))
const RoofReportDetail = page(() => import('./RoofReportDetail'))
const EstimatorPage = page(() => import('./EstimatorPage'))
const EstimatorTrialPage = page(() => import('./EstimatorTrialPage'))
const EstimatorSettingsPage = page(() => import('./EstimatorSettingsPage'))

/** Routes inside /crm, each <Route key path element />. */
export const routes: ReactElement[] = [
  <Route key="roof-measurements" path="measurements" element={<MeasurementsPage />} />,
  <Route key="roof-reports" path="roof-reports" element={<RoofReportsPage />} />,
  <Route key="roof-report" path="roof-reports/:id" element={<RoofReportDetail />} />,
  <Route key="roof-estimator" path="estimator" element={<EstimatorPage />} />,
  <Route key="roof-estimator-trial" path="estimator-trial" element={<EstimatorTrialPage />} />,
  <Route key="roof-estimator-settings" path="settings/estimator" element={<EstimatorSettingsPage />} />,
]

/**
 * Menu items, each gated by the feature and permission the template's menu used (AppLayout.tsx: Measurements in the
 * main list with no feature; Roof Estimator and Roof Reports at the end of the field list). No permission: none of the
 * three pages' main reads asks one (GET /api/measurements and GET /api/roof-reports are sign-in only — the latter behind
 * its feature; the estimator page reads GET /api/company).
 */
export const nav: NavItem[] = [
  { to: '/crm/measurements', icon: Ruler, label: 'Measurements', features: ['measurement_reports'] },
  { to: '/crm/estimator', icon: Calculator, label: 'Roof Estimator', features: ['instant_estimator'] },
  { to: '/crm/roof-reports', icon: FileBarChart, label: 'Roof Reports', features: ['measurement_reports'] },
]

/**
 * '/crm/<path>' → the permission its page's main API asks, for every route (menu or not). None of this group's six
 * asks one: GET /api/measurements, GET /api/roof-reports(/:id) and GET /api/company are sign-in only, and the trial
 * offer posts to /api/platform-support, open to every seat. The writes on each page are offered by their own
 * permission (measurements:create/update/purchase, roof-reports:create/purchase/delete, company:update). The estimator's
 * Settings page sits under /crm/settings, which the shell's routeRoles already hold to admin.
 */
export const routePermissions: Record<string, string> = {}
