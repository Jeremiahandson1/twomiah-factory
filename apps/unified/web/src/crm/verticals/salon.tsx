// Salon: the screens templates/crm-salon has and the base CRM doesn't (crm/pages/salon/), their routes under /crm and
// their menu items, each gated by the template's features so no other vertical sees them (docs/UNIFIED_MOVE_GUIDE.md).
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { BellRing, Calendar, ClipboardList, CreditCard, Gift, Scissors, Users } from 'lucide-react'
import type { NavItem } from '../../shared'
import { page } from '../lazy'

const ClientsPage = page(() => import('../pages/salon/ClientsPage'))
const ClientDetailPage = page(() => import('../pages/salon/ClientDetailPage'))
const AppointmentsPage = page(() => import('../pages/salon/AppointmentsPage'))
const RemindersPage = page(() => import('../pages/salon/RemindersPage'))
const ServiceMenuPage = page(() => import('../pages/salon/ServiceMenuPage'))
const MembershipsPage = page(() => import('../pages/salon/MembershipsPage'))
const LoyaltyPage = page(() => import('../pages/salon/LoyaltyPage'))
const BookSettingsPage = page(() => import('../pages/salon/BookSettingsPage'))
const CardOnFileSettingsPage = page(() => import('../pages/salon/CardOnFileSettingsPage'))
const IntakeFormsSettingsPage = page(() => import('../pages/salon/IntakeFormsSettingsPage'))

/**
 * The salon's own dashboard (the book today, the month by chair, who is due back), shown at /crm/dashboard in place of
 * the jobs dashboard when the vertical's screens say home: 'salon' (crm/screens.tsx Dashboard).
 */
export const dashboard = page(() => import('../pages/salon/DashboardPage'))

/** Routes inside /crm (behind the CRM's first-run gate), as <Route path="…" element={…} /> with a key. */
export const routes: ReactElement[] = [
  <Route key="salon-clients" path="clients" element={<ClientsPage />} />,
  <Route key="salon-client" path="clients/:id" element={<ClientDetailPage />} />,
  <Route key="salon-appointments" path="appointments" element={<AppointmentsPage />} />,
  <Route key="salon-reminders" path="reminders" element={<RemindersPage />} />,
  <Route key="salon-service-menu" path="service-menu" element={<ServiceMenuPage />} />,
  <Route key="salon-memberships" path="memberships" element={<MembershipsPage />} />,
  <Route key="salon-loyalty" path="loyalty" element={<LoyaltyPage />} />,
  <Route key="salon-book-settings" path="settings/book" element={<BookSettingsPage />} />,
  <Route key="salon-card-on-file-settings" path="settings/card-on-file" element={<CardOnFileSettingsPage />} />,
  <Route key="salon-intake-forms-settings" path="settings/intake-forms" element={<IntakeFormsSettingsPage />} />,
]

/**
 * The salon's own Settings card (screens.tsx extraSubPages): The Book's "Stylists see only their own appointments"
 * switch (owner's decision 2026-10-25) — for whoever may change the company (PUT /api/appointments/book-settings asks
 * company:update), where the business has The Book.
 */
export const SETTINGS_EXTRA = [
  { to: '/crm/settings/book', label: 'The Book', icon: Calendar, permission: 'company:update', feature: 'salon_booking' },
  // Card on file: the no-show / late-cancel fees (PUT /api/card-on-file/policy asks company:update, behind `card_on_file`).
  { to: '/crm/settings/card-on-file', label: 'Card on file', icon: CreditCard, permission: 'company:update', feature: 'card_on_file' },
  // Intake and consent forms (/api/intake-forms writes ask company:update, behind `intake_forms`).
  { to: '/crm/settings/intake-forms', label: 'Intake & consent forms', icon: ClipboardList, permission: 'company:update', feature: 'intake_forms' },
]

/**
 * Menu items, gated by features (and the permission each page's API asks): templates/crm-salon shellConfig.ts. The
 * clients, book, rebooking, menu and memberships lists all ask contacts:read on the server; loyalty asks loyalty:read.
 */
export const nav: NavItem[] = [
  { to: '/crm/clients', icon: Users, label: 'Clients', section: 'Salon', features: ['client_profiles'], permission: 'contacts:read' },
  { to: '/crm/appointments', icon: Calendar, label: 'The Book', features: ['salon_booking'], permission: 'contacts:read' },
  { to: '/crm/reminders', icon: BellRing, label: 'Rebooking', features: ['rebooking_reminders'], permission: 'contacts:read' },
  { to: '/crm/service-menu', icon: Scissors, label: 'Service Menu', features: ['service_menu'], permission: 'contacts:read' },
  { to: '/crm/memberships', icon: CreditCard, label: 'Memberships', features: ['salon_memberships'], permission: 'contacts:read' },
  { to: '/crm/loyalty', icon: Gift, label: 'Loyalty', features: ['loyalty_rewards'], permission: 'loyalty:read' },
]
