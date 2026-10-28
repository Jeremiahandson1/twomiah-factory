/**
 * Where a signed-in person lands: their first tab BY NAME (verticals.ts firstTab). A bare '/(tabs)' names no screen — the
 * tabs have no index — and Expo shows "Unmatched Route" for it. Alerts is the fallback: its screen has no permission.
 */
import { useAuth } from '../auth/AuthContext'
import { useVertical } from './VerticalContext'
import { firstTab } from './verticals'

export function useHomeHref(): `/(tabs)/${string}` {
  const { can } = useAuth()
  const { tabs, initialTab, hasFeature } = useVertical()
  return `/(tabs)/${firstTab(tabs, initialTab, can, hasFeature) || 'notifications'}`
}
