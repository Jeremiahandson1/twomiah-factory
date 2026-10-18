// The admin's menu and URL gates for the shared shell (packages/tenant-ui/src/shell). Items without `features` are
// core; with `features`, shown when any is on. A `permission` is the one the page's API asks for, so the menu never
// offers a page that would refuse. `routeRoles` is only for pages whose server gate is a rank (requireAdmin).
import { BarChart3, Briefcase, CalendarCheck, CalendarDays, FileText, Globe, Hourglass, Image, Inbox, Newspaper, ScrollText, Settings2, SlidersHorizontal } from 'lucide-react'
import type { NavItem, ShellConfig } from './shared'

const NAV: NavItem[] = [
  { to: '/crm/website', icon: Globe, label: 'Website', section: 'Website', permission: 'site:read', exact: true },
  { to: '/crm/website/pages', icon: FileText, label: 'Pages', permission: 'site:read' },
  { to: '/crm/website/photos', icon: Image, label: 'Photos', permission: 'site:read' },
  { to: '/crm/website/blog', icon: Newspaper, label: 'Blog', permission: 'site:read' },
  { to: '/crm/website/portfolio', icon: Briefcase, label: 'Portfolio', permission: 'site:read' },
  { to: '/crm/website/settings', icon: Settings2, label: 'Website settings', permission: 'site:settings' },
  // Bookings: the online_booking feature, behind the same permissions as /api/booking.
  { to: '/crm/bookings', icon: CalendarCheck, label: 'Bookings', section: 'Bookings', features: ['online_booking'], permission: 'bookings:read', exact: true },
  { to: '/crm/bookings/calendar', icon: CalendarDays, label: 'Calendar', features: ['online_booking'], permission: 'bookings:read' },
  { to: '/crm/bookings/waitlist', icon: Hourglass, label: 'Waitlist', features: ['online_booking'], permission: 'bookings:read' },
  { to: '/crm/bookings/insights', icon: BarChart3, label: 'Insights', features: ['online_booking'], permission: 'bookings:read' },
  { to: '/crm/bookings/settings', icon: SlidersHorizontal, label: 'Booking settings', features: ['online_booking'], permission: 'bookings:update' },
  { to: '/crm/leads', icon: Inbox, label: 'Lead Inbox', section: 'Business', features: ['lead_inbox'], permission: 'contacts:read' },
  // Who changed what — owners and admins (audit:read, the permission /api/audit asks for).
  { to: '/crm/audit', icon: ScrollText, label: 'Audit Log', permission: 'audit:read' },
]

export const SHELL: ShellConfig = {
  nav: NAV,
  // No search endpoint yet (it arrives with the CRM's records), and no live socket.
  search: false,
  // '/' is the public website, not a portal.
  backToPortal: false,
  brand: { fallbackName: 'Admin' },
  routeRoles: {
    // The company, billing, email addresses and the feature switches are requireAdmin on the server.
    '/crm/settings': 'admin',
    '/crm/settings/billing': 'admin',
    '/crm/settings/email': 'admin',
    '/crm/settings/features': 'admin',
  },
}

/** The settings sub-pages this app has routes for (the shared Settings page links only to these). */
export const SETTINGS_SUB_PAGES = ['/crm/settings/features', '/crm/settings/billing', '/crm/settings/email']
