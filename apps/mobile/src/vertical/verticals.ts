/**
 * Tab definitions per vertical — controls which tabs appear in the bottom bar.
 *
 * The verticals are the unified app's ids (apps/unified/verticals/*, sent as company.vertical by /api/auth/login and
 * /api/auth/me). `basic` (a general service business) uses the contractor's tabs. `unavailable` is a business whose
 * industry has no phone screens (bar, salon, vet, restaurant, store): it is told to use the web app rather than shown
 * another trade's screens. Dispensary is not in the unified app (owner, 2026-10-19), so the app has no dispensary tabs.
 */

export type Vertical = 'contractor' | 'basic' | 'fieldservice' | 'homecare' | 'roofing' | 'landscaping' | 'rv' | 'unavailable'

/** Every vertical the phone app has screens for. */
export const PHONE_VERTICALS: Vertical[] = ['contractor', 'basic', 'fieldservice', 'homecare', 'roofing', 'landscaping', 'rv']

export interface TabDef {
  name: string
  title: string
  icon: string
  activeIcon: string
  /** Shown only to a seat the server grants this (useAuth().can) — the route behind the tab checks the same one. */
  permission?: string
  /** Shown only while this switch (Settings › Features) is on — the API behind the tab is gated on the same one. */
  feature?: string
}

/**
 * The tabs a seat actually sees: a tab the seat may not use is not shown (a field tech has no quotes:read; the RV floor seat
 * cannot appraise), and a tab whose switch is off (TabDef.feature) is not shown either, as its screen and route are not on the
 * web. Order is the vertical's. The tab layout and the tests both ask this.
 */
export function visibleTabs(tabs: TabDef[], can: (permission: string) => boolean, hasFeature: (feature: string) => boolean): TabDef[] {
  return tabs.filter((tab) => (!tab.permission || can(tab.permission)) && (!tab.feature || hasFeature(tab.feature)))
}

/**
 * The tab the app opens on: the vertical's own first tab when this seat can see it, else the first it can see. One rule for
 * the tab bar's initialRouteName and every redirect into the tabs — a bare '/(tabs)' names no screen (there is no index), and
 * Expo answered it with "Unmatched Route" (owner's Android, 2026-10-28).
 */
export function firstTab(tabs: TabDef[], initialTab: string, can: (permission: string) => boolean, hasFeature: (feature: string) => boolean): string | undefined {
  const shown = visibleTabs(tabs, can, hasFeature)
  return shown.some((tab) => tab.name === initialTab) ? initialTab : shown[0]?.name
}

const CONTRACTOR_TABS: TabDef[] = [
  { name: 'dashboard', title: 'Dashboard', icon: 'grid-outline', activeIcon: 'grid', permission: 'dashboard:read' },
  { name: 'jobs', title: 'Jobs', icon: 'hammer-outline', activeIcon: 'hammer', permission: 'jobs:read' },
  { name: 'contacts', title: 'Contacts', icon: 'people-outline', activeIcon: 'people', permission: 'contacts:read' },
  { name: 'quotes', title: 'Quotes', icon: 'document-text-outline', activeIcon: 'document-text', permission: 'quotes:read' },
  { name: 'notifications', title: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
]

export const VERTICAL_TABS: Record<Vertical, TabDef[]> = {
  contractor: CONTRACTOR_TABS,
  basic: CONTRACTOR_TABS,
  fieldservice: [
    { name: 'dashboard', title: 'Dashboard', icon: 'grid-outline', activeIcon: 'grid', permission: 'dashboard:read' },
    { name: 'service-calls', title: 'Service Calls', icon: 'build-outline', activeIcon: 'build', permission: 'jobs:read' },
    { name: 'schedule', title: 'Schedule', icon: 'calendar-outline', activeIcon: 'calendar', permission: 'jobs:read' },
    { name: 'contacts', title: 'Contacts', icon: 'people-outline', activeIcon: 'people', permission: 'contacts:read' },
    { name: 'notifications', title: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
  ],
  // Twomiah Care — the caregiver's day: Today (next visit, alerts), Schedule (two weeks: swap, move,
  // client not available, miss), Clock (clock in, the open visit, clock out), Messages, More.
  // Clients, open shifts, documents, incidents, mileage and notifications live under More.
  homecare: [
    { name: 'shifts', title: 'Today', icon: 'home-outline', activeIcon: 'home' },
    { name: 'care-schedule', title: 'Schedule', icon: 'calendar-outline', activeIcon: 'calendar' },
    { name: 'time-clock', title: 'Clock', icon: 'finger-print-outline', activeIcon: 'finger-print' },
    { name: 'messages', title: 'Messages', icon: 'chatbubbles-outline', activeIcon: 'chatbubbles' },
    { name: 'more-homecare', title: 'More', icon: 'ellipsis-horizontal-outline', activeIcon: 'ellipsis-horizontal' },
  ],
  roofing: [
    { name: 'pipeline', title: 'Pipeline', icon: 'funnel-outline', activeIcon: 'funnel', permission: 'jobs:read' },
    { name: 'jobs', title: 'Jobs', icon: 'hammer-outline', activeIcon: 'hammer', permission: 'jobs:read' },
    { name: 'contacts', title: 'Contacts', icon: 'people-outline', activeIcon: 'people', permission: 'contacts:read' },
    { name: 'canvass', title: 'Canvass', icon: 'walk-outline', activeIcon: 'walk', permission: 'canvassing:create' },
    { name: 'notifications', title: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
  ],
  landscaping: [
    { name: 'dashboard', title: 'Dashboard', icon: 'grid-outline', activeIcon: 'grid', permission: 'dashboard:read' },
    { name: 'jobs', title: 'Jobs', icon: 'hammer-outline', activeIcon: 'hammer', permission: 'jobs:read' },
    { name: 'schedule', title: 'Schedule', icon: 'calendar-outline', activeIcon: 'calendar', permission: 'jobs:read' },
    { name: 'contacts', title: 'Contacts', icon: 'people-outline', activeIcon: 'people', permission: 'contacts:read' },
    { name: 'notifications', title: 'Alerts', icon: 'notifications-outline', activeIcon: 'notifications' },
  ],
  rv: [
    { name: 'dashboard', title: 'Dashboard', icon: 'grid-outline', activeIcon: 'grid', permission: 'dashboard:read' },
    { name: 'units', title: 'Inventory', icon: 'car-sport-outline', activeIcon: 'car-sport' },
    { name: 'parts', title: 'Parts', icon: 'construct-outline', activeIcon: 'construct' },
    { name: 'ai-trade', title: 'Trade', icon: 'cash-outline', activeIcon: 'cash', permission: 'contacts:update', feature: 'trade_in' },
    { name: 'contacts', title: 'Customers', icon: 'people-outline', activeIcon: 'people', permission: 'contacts:read' },
  ],
  unavailable: [],
}

/** The first tab name per vertical (initial route) */
export const VERTICAL_INITIAL_TAB: Record<Vertical, string> = {
  contractor: 'dashboard',
  basic: 'dashboard',
  fieldservice: 'dashboard',
  homecare: 'shifts',
  roofing: 'pipeline',
  landscaping: 'dashboard',
  rv: 'dashboard',
  unavailable: '',
}

/**
 * Where a business signs in on the web: its own address's /login (the CRM's sign-in page, apps/unified web). The address is the
 * one the person typed to sign in to the app, so the link needs nothing else. Shown to a business the app has no screens for.
 */
export const webSignInUrl = (apiUrl: string) => apiUrl.replace(/\/+$/, '') + '/login'
