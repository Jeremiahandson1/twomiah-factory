/**
 * The bottom bar of each trade the kit draws: five slots at most, More last, alerts in the header bell (design round, DESIGN.md).
 * The same bar for every seat of a trade; a slot the seat may not open is simply absent (verticals.ts visibleTabs), so the Stylist's
 * and the Front Desk's bars differ only by permission, and a field seat's "Book" is named "My day".
 * Tab names are files in app/(tabs): `<trade>-<screen>.tsx`, each a thin wrapper over a kit spec.
 */
import type { TabDef } from '../vertical/verticals'

const tab = (name: string, title: string, icon: string, extra: Partial<TabDef> = {}): TabDef => ({ name, title, icon: `${icon}-outline`, activeIcon: icon, ...extra })
const more = (): TabDef => tab('more', 'More', 'ellipsis-horizontal')

export const SALON_TABS: TabDef[] = [
  tab('dashboard', 'Home', 'home', { permission: 'dashboard:read' }),
  tab('salon-book', 'Book', 'calendar', { permission: 'schedule:read', feature: 'salon_booking', seat: 'office' }),
  tab('salon-myday', 'My day', 'calendar', { permission: 'schedule:read', feature: 'salon_booking', seat: 'field' }),
  tab('salon-clients', 'Clients', 'people', { permission: 'contacts:read', feature: 'client_profiles' }),
  tab('salon-rebook', 'Rebook', 'repeat', { permission: 'contacts:read', feature: 'rebooking_reminders' }),
  more(),
]

// (restaurant, bar, store and vet are added by their files below as they land)

/** Restaurant: the office reads events and what is overdue; the captain reads events and the live board (read-only on events). */
export const RESTAURANT_TABS: TabDef[] = [
  tab('dashboard', 'Home', 'home', { permission: 'dashboard:read' }),
  tab('trade-events', 'Events', 'calendar', { permission: 'contacts:read', feature: 'event_bookings' }),
  tab('trade-overdue', 'Overdue', 'alert-circle', { permission: 'invoices:read', feature: 'invoices', seat: 'office' }),
  tab('bar-tonight', 'Tonight', 'moon', { permission: 'bar:read', feature: 'bar_tonight' }),
  tab('bar-menu', '86 board', 'close-circle', { permission: 'bar:read', feature: 'bar_menu', seat: 'field' }),
  more(),
]
/** Bar: the live board first. The office sees the party book and the count; the bartender sees shifts and the count. */
export const BAR_TABS: TabDef[] = [
  tab('dashboard', 'Home', 'home', { permission: 'dashboard:read' }),
  tab('bar-tonight', 'Tonight', 'moon', { permission: 'bar:read', feature: 'bar_tonight' }),
  tab('trade-events', 'Parties', 'calendar', { permission: 'contacts:read', feature: 'event_bookings', seat: 'office' }),
  tab('bar-shifts', 'Shifts', 'time', { permission: 'bar:read', feature: 'bar_schedule', seat: 'field' }),
  tab('bar-count', 'Count', 'clipboard', { permission: 'bar:register', feature: 'bar_stock' }),
  more(),
]
export const STORE_TABS: TabDef[] = []
export const VET_TABS: TabDef[] = []
