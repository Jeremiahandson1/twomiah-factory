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
export const RESTAURANT_TABS: TabDef[] = []
export const BAR_TABS: TabDef[] = []
export const STORE_TABS: TabDef[] = []
export const VET_TABS: TabDef[] = []
