// Home care, the billing group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// Every page here is the office's: each one's main API asks care-billing (server/crm/homecare/billing/*.ts and
// scheduling/forecast.ts), which a caregiver does not hold. Labels are the template's (AdminDashboard.tsx NAV_SECTIONS).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { CalendarDays, ClipboardCheck, FileInput, FileText, Landmark, Receipt, TrendingUp, Zap } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const BillingDashboard = page(() => import('./BillingDashboard'))
const BillingImport = page(() => import('./BillingImport'))
const PortalClaimDays = page(() => import('./PortalClaimDays'))
const ClaimsManagement = page(() => import('./ClaimsManagement'))
const BillingEngine = page(() => import('./BillingEngine'))
const PayersServiceCodes = page(() => import('./PayersServiceCodes'))
const AuthorizationsManagement = page(() => import('./AuthorizationsManagement'))
const RevenueForecast = page(() => import('./RevenueForecast'))

/** The permission each page's main API asks (the list or action the page exists for). */
const PERM = {
  billing: 'care-billing:read', // GET /api/billing/invoices
  'billing-import': 'care-billing:create', // POST /api/billing/import-csv
  'portal-claim-days': 'care-billing:read', // GET /api/billing/claim-portals, /portal-claim-days
  claims: 'care-billing:read', // GET /api/claims
  'billing-engine': 'care-billing:read', // GET /api/claims, /api/payments
  // GET /api/payers also admits care-clients:read (a caregiver's client screens read it); the screen manages payers.
  'payers-service-codes': 'care-billing:read',
  authorizations: 'care-billing:read', // GET /api/authorizations
  'revenue-forecast': 'care-billing:read', // GET /api/forecast/revenue
} as const

export const routes: ReactElement[] = [
  <Route key="hc-billing" path="billing" element={<BillingDashboard />} />,
  <Route key="hc-billing-import" path="billing-import" element={<BillingImport />} />,
  <Route key="hc-portal-claim-days" path="portal-claim-days" element={<PortalClaimDays />} />,
  <Route key="hc-claims" path="claims" element={<ClaimsManagement />} />,
  <Route key="hc-billing-engine" path="billing-engine" element={<BillingEngine />} />,
  <Route key="hc-payers-service-codes" path="payers-service-codes" element={<PayersServiceCodes />} />,
  <Route key="hc-authorizations" path="authorizations" element={<AuthorizationsManagement />} />,
  <Route key="hc-revenue-forecast" path="revenue-forecast" element={<RevenueForecast />} />,
]

export const nav: NavItem[] = [
  { to: '/crm/billing', icon: Receipt, label: 'Billing', permission: PERM.billing },
  { to: '/crm/billing-import', icon: FileInput, label: 'Invoice Import', permission: PERM['billing-import'] },
  { to: '/crm/portal-claim-days', icon: CalendarDays, label: 'Portal Claim Days', permission: PERM['portal-claim-days'] },
  { to: '/crm/claims', icon: FileText, label: 'Claims', permission: PERM.claims },
  { to: '/crm/billing-engine', icon: Zap, label: 'Claims & EVV Engine', permission: PERM['billing-engine'] },
  { to: '/crm/payers-service-codes', icon: Landmark, label: 'Payers & Codes', permission: PERM['payers-service-codes'] },
  { to: '/crm/authorizations', icon: ClipboardCheck, label: 'Authorizations', permission: PERM.authorizations },
  { to: '/crm/revenue-forecast', icon: TrendingUp, label: 'Revenue Forecast', permission: PERM['revenue-forecast'] },
]

export const routePermissions: Record<string, string> = Object.fromEntries(
  Object.entries(PERM).map(([path, permission]) => [`/crm/${path}`, permission]),
)
