// Home care, the schedule group's screens: their routes inside /crm (each element a page() import, so this index stays
// light), their menu items (paths and order: crm/verticals/homecare.tsx MENU), and the permission each page's API asks.
//
// /crm/scheduling is the Schedule Hub (templates/crm-homecare AdminDashboard section 'scheduling'). Its main API is
// care-schedule (the week view and schedule lists are :read, every tool, board and write :update or above); a caregiver
// holds care-schedule:read for their own app, so the page asks the office's verb, care-schedule:update (rule 7).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { CalendarDays } from 'lucide-react'
import type { NavItem } from '../../../../shared'
import { page } from '../../../lazy'

const SchedulingHub = page(() => import('./SchedulingHub'))

export const routes: ReactElement[] = [
  <Route key="homecare-scheduling" path="scheduling" element={<SchedulingHub />} />,
]

export const nav: NavItem[] = [
  { to: '/crm/scheduling', icon: CalendarDays, label: 'Schedule Hub', permission: 'care-schedule:update' },
]

export const routePermissions: Record<string, string> = {
  '/crm/scheduling': 'care-schedule:update',
}
