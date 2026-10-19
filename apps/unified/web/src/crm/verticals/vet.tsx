// Veterinary: the screens templates/crm-vet has and the base CRM doesn't (crm/pages/vet/), their routes under /crm and
// their menu items, each gated by the template's features so no other vertical sees them (docs/UNIFIED_MOVE_GUIDE.md).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { BellRing, Calendar, HeartPulse, PawPrint } from 'lucide-react'
import type { NavItem } from '../../shared'
import { page } from '../lazy'
import { verticalScreens } from '../vertical'

const PatientsPage = page(() => import('../pages/vet/PatientsPage'))
const PatientDetailPage = page(() => import('../pages/vet/PatientDetailPage'))
const AppointmentsPage = page(() => import('../pages/vet/AppointmentsPage'))
const RemindersPage = page(() => import('../pages/vet/RemindersPage'))
const WellnessPlansPage = page(() => import('../pages/vet/WellnessPlansPage'))

/**
 * The practice's own dashboard (patients, the day's appointments, billed revenue, vaccinations due, wellness), shown
 * at /crm/dashboard in place of the jobs dashboard when the vertical's screens say home: 'practice'
 * (crm/screens.tsx Dashboard), as its /api/dashboard is the practice's (CrmSettings.dashboard).
 */
export const dashboard = page(() => import('../pages/vet/DashboardPage'))

/**
 * /crm/appointments and /crm/reminders are the salon's paths too. They are the practice's only where the vertical's
 * screens say book: 'practice' (VerticalScreens.book), as /api/appointments and /api/reminders are on the server
 * (CrmSettings.appointments); read once, from the settings the page was served with.
 */
const book = verticalScreens().book
const practiceBook = typeof book === 'string' && book === 'practice'

/** Routes inside /crm (behind the CRM's first-run gate), as <Route path="…" element={…} /> with a key. */
export const routes: ReactElement[] = [
  <Route key="vet-patients" path="patients" element={<PatientsPage />} />,
  <Route key="vet-patient" path="patients/:id" element={<PatientDetailPage />} />,
  <Route key="vet-wellness-plans" path="wellness-plans" element={<WellnessPlansPage />} />,
  ...(practiceBook ? [
    <Route key="vet-appointments" path="appointments" element={<AppointmentsPage />} />,
    <Route key="vet-reminders" path="reminders" element={<RemindersPage />} />,
  ] : []),
]

/**
 * Menu items, gated by features (templates/crm-vet shellConfig.ts) and the permission each page's list route asks
 * (contacts:read for all four: server/crm/vet).
 */
export const nav: NavItem[] = [
  { to: '/crm/patients', icon: PawPrint, label: 'Patients', section: 'Practice', features: ['patient_records'], permission: 'contacts:read' },
  { to: '/crm/appointments', icon: Calendar, label: 'Appointments', features: ['appointment_scheduling'], permission: 'contacts:read' },
  { to: '/crm/reminders', icon: BellRing, label: 'Reminders', features: ['reminders_recall'], permission: 'contacts:read' },
  { to: '/crm/wellness-plans', icon: HeartPulse, label: 'Wellness Plans', features: ['wellness_plans'], permission: 'contacts:read' },
]
