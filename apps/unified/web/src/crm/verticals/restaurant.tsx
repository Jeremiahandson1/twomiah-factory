// Restaurant and events: the screens templates/crm-restaurant has and the base CRM doesn't (crm/pages/restaurant/), their
// routes under /crm and their menu items, each gated by the template's features so no other vertical sees them
// (docs/UNIFIED_MOVE_GUIDE.md). templates/crm-bar has the same screens and features: these routes and items are the
// bar's too, by the same features — nothing here is declared a second time.
import type { ReactElement } from 'react'
import { Route } from 'react-router-dom'
import { CalendarCheck, CalendarDays, BarChart3, DoorOpen, UtensilsCrossed } from 'lucide-react'
import type { NavItem } from '../../shared'
import { page, named } from '../lazy'

const EventsPage = page(() => import('../pages/restaurant/EventsPage'))
const EventDetailPage = page(() => import('../pages/restaurant/EventDetailPage'))
const SpacesPage = page(() => import('../pages/restaurant/SpacesPage'))
const MenusPage = page(() => import('../pages/restaurant/MenusPage'))
// The depth screens (restaurant-bar-depth), each behind its own not-ready feature.
const EventCalendarPage = named(() => import('../eventDepth'), 'EventCalendarPage')
const EventInsightsPage = named(() => import('../eventDepth'), 'EventInsightsPage')

/**
 * The private-events dashboard (the book ahead, the pipeline, the rooms, the money owed), shown at /crm/dashboard in
 * place of the jobs dashboard when the vertical's screens say home: 'events' (crm/screens.tsx Dashboard), as its
 * /api/dashboard is the events one (CrmSettings.dashboard).
 */
export const dashboard = page(() => import('../pages/restaurant/DashboardPage'))

/** Routes inside /crm (behind the CRM's first-run gate), as <Route path="…" element={…} /> with a key. */
export const routes: ReactElement[] = [
  <Route key="restaurant-events" path="events" element={<EventsPage />} />,
  <Route key="restaurant-event" path="events/:id" element={<EventDetailPage />} />,
  <Route key="restaurant-spaces" path="spaces" element={<SpacesPage />} />,
  <Route key="restaurant-menus" path="menus" element={<MenusPage />} />,
  <Route key="restaurant-event-calendar" path="event-calendar" element={<EventCalendarPage />} />,
  <Route key="restaurant-event-insights" path="event-insights" element={<EventInsightsPage />} />,
]

/**
 * Menu items, gated by features (and the permission each page's API asks). templates/crm-restaurant shellConfig.ts gated
 * each by its feature; each page's list route asks contacts:read (server/crm/restaurant).
 */
export const nav: NavItem[] = [
  { to: '/crm/events', icon: CalendarCheck, label: 'Events', section: 'Events', features: ['event_bookings'], permission: 'contacts:read' },
  { to: '/crm/spaces', icon: DoorOpen, label: 'Spaces', features: ['event_spaces'], permission: 'contacts:read' },
  { to: '/crm/event-calendar', icon: CalendarDays, label: 'Room Calendar', features: ['event_calendar'], permission: 'contacts:read' },
  { to: '/crm/event-insights', icon: BarChart3, label: 'Event Sources', features: ['event_reports', 'event_form_campaigns'], permission: 'reports:read' },
  { to: '/crm/menus', icon: UtensilsCrossed, label: 'Catering Menus', features: ['catering_menus'], permission: 'contacts:read' },
]
