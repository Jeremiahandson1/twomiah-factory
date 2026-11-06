/**
 * Where a signed-in person lands: their first tab BY NAME (verticals.ts firstTab). A bare '/(tabs)' names no screen — the
 * tabs have no index — and Expo shows "Unmatched Route" for it. Alerts is the fallback: its screen has no permission. The seat kind
 * is passed as the tab bar passes it (app/(tabs)/_layout.tsx), so a field-only tab (landscaping's Today) never becomes an office home.
 */
import { useAuth } from '../auth/AuthContext'
import { useVertical } from './VerticalContext'
import { firstTab } from './verticals'
import { isFieldRole } from '../auth/roles'

export function useHomeHref(): `/(tabs)/${string}` {
  const { can, user } = useAuth()
  const { tabs, initialTab, hasFeature } = useVertical()
  return `/(tabs)/${firstTab(tabs, initialTab, can, hasFeature, isFieldRole(user?.role)) || 'notifications'}`
}
