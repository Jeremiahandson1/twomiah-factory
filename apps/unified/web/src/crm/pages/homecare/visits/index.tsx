// Home care, the visits group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// Both office screens' APIs (/api/evv, /api/visit-docs: server/crm/homecare/visits/evv.ts, visitDocumentation.ts) ask
// the office's evv permission (visits/shared.ts OFFICE_EVV = 'evv:delete'), which a caregiver does not hold — so that
// is the permission here: the item shows for exactly who the API admits.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { FileText, MapPin } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'
import { OfficeOr, EvvStatus } from '../office/OfficeReadOnly'

const EVVDashboard = page(() => import('./EVVDashboard'))
const VisitDocumentation = page(() => import('./VisitDocumentation'))
const CaregiverDashboard = page(() => import('./CaregiverDashboard'))

/** The office's evv permission (server/crm/homecare/visits/shared.ts OFFICE_EVV). */
const OFFICE_EVV = 'evv:delete'
// …and the read-only office seat's (care-office:read), which opens a read-only screen at the same address
// (office/OfficeReadOnly.tsx; live role check, 2026-10-23).
const EVV: string[] = [OFFICE_EVV, 'care-office:read']
const EvvPage = () => <OfficeOr office={OFFICE_EVV} Full={EVVDashboard} View={EvvStatus} />

export const routes: ReactElement[] = [
  <Route key="homecare-evv" path="evv" element={<EvvPage />} />,
  <Route key="homecare-visit-docs" path="visit-docs" element={<VisitDocumentation />} />,
]

export const nav: NavItem[] = [
  { to: '/crm/visit-docs', icon: FileText, label: 'Visit Documentation', permission: OFFICE_EVV },
  { to: '/crm/evv', icon: MapPin, label: 'EVV Dashboard', permission: EVV },
]

export const routePermissions: Record<string, string | string[]> = {
  '/crm/evv': EVV,
  '/crm/visit-docs': OFFICE_EVV,
}

/** A caregiver's day at /crm/dashboard (templates/crm-homecare components/CaregiverDashboard.tsx). */
export function CaregiverHome() { return <CaregiverDashboard /> }
