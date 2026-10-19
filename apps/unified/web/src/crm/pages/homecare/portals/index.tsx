// Home care, the portals group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// The office's one page here is the Family Portal (the template's AdminDashboard 'family-portal' section,
// components/admin/FamilyPortalAdmin.tsx). Its API is /api/family-portal/admin/* at care-portal:update (the office's
// verb: a caregiver holds care-portal:read only), so a caregiver's menu stays their own app, as in the template.
// The public pages (the client and family portals, paying an invoice) are ./public.tsx, rendered by ../publicApp.tsx.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { Home } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const FamilyPortalAdmin = page(() => import('./FamilyPortalAdmin'))

export const routes: ReactElement[] = [
  <Route key="homecare-family-portal" path="family-portal" element={<FamilyPortalAdmin />} />,
]

export const nav: NavItem[] = [
  { to: '/crm/family-portal', icon: Home, label: 'Family Portal', permission: 'care-portal:update' },
]

export const routePermissions: Record<string, string> = {
  '/crm/family-portal': 'care-portal:update',
}
