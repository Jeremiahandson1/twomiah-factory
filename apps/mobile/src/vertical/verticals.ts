/**
 * Tab definitions per vertical — controls which tabs appear in the bottom bar.
 */

export type Vertical = 'contractor' | 'fieldservice' | 'homecare' | 'roofing' | 'dispensary'

export interface TabDef {
  name: string
  title: string
  icon: string
  activeIcon: string
}

export const VERTICAL_TABS: Record<Vertical, TabDef[]> = {
  contractor: [
    { name: 'dashboard', title: 'Dashboard', icon: 'grid-outline', activeIcon: 'grid' },
    { name: 'jobs', title: 'Jobs', icon: 'hammer-outline', activeIcon: 'hammer' },
    { name: 'contacts', title: 'Contacts', icon: 'people-outline', activeIcon: 'people' },
    { name: 'quotes', title: 'Quotes', icon: 'document-text-outline', activeIcon: 'document-text' },
    { name: 'notifications', title: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
  ],
  fieldservice: [
    { name: 'dashboard', title: 'Dashboard', icon: 'grid-outline', activeIcon: 'grid' },
    { name: 'service-calls', title: 'Service Calls', icon: 'build-outline', activeIcon: 'build' },
    { name: 'schedule', title: 'Schedule', icon: 'calendar-outline', activeIcon: 'calendar' },
    { name: 'contacts', title: 'Contacts', icon: 'people-outline', activeIcon: 'people' },
    { name: 'notifications', title: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
  ],
  homecare: [
    { name: 'shifts', title: 'My Shifts', icon: 'time-outline', activeIcon: 'time' },
    { name: 'contacts', title: 'Clients', icon: 'heart-outline', activeIcon: 'heart' },
    { name: 'time-clock', title: 'Clock In', icon: 'finger-print-outline', activeIcon: 'finger-print' },
    { name: 'messages', title: 'Messages', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
    { name: 'more-homecare', title: 'More', icon: 'ellipsis-horizontal-outline', activeIcon: 'ellipsis-horizontal' },
  ],
  roofing: [
    { name: 'pipeline', title: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel' },
    { name: 'jobs', title: 'Jobs', icon: 'hammer-outline', activeIcon: 'hammer' },
    { name: 'contacts', title: 'Contacts', icon: 'people-outline', activeIcon: 'people' },
    { name: 'canvass', title: 'Canvass', icon: 'walk-outline', activeIcon: 'walk' },
    { name: 'notifications', title: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
  ],
  dispensary: [
    { name: 'orders', title: 'Orders', icon: 'receipt-outline', activeIcon: 'receipt' },
    { name: 'pos-mobile', title: 'POS', icon: 'card-outline', activeIcon: 'card' },
    { name: 'ai-chat', title: 'AI Chat', icon: 'sparkles-outline', activeIcon: 'sparkles' },
    { name: 'checkin-queue', title: 'Check-In', icon: 'people-outline', activeIcon: 'people' },
    { name: 'more-dispensary', title: 'More', icon: 'ellipsis-horizontal-outline', activeIcon: 'ellipsis-horizontal' },
  ],
}

/** The first tab name per vertical (initial route) */
export const VERTICAL_INITIAL_TAB: Record<Vertical, string> = {
  contractor: 'dashboard',
  fieldservice: 'dashboard',
  homecare: 'shifts',
  roofing: 'pipeline',
  dispensary: 'orders',
}
