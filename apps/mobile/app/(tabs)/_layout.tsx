/**
 * Dynamic bottom tab navigator — shows different tabs per vertical.
 * All tab screen files exist at build time; inactive ones are hidden via href: null.
 */

import React from 'react'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { View, StyleSheet } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../src/theme/ThemeContext'
import { tabBarMetrics } from '../../src/theme/insets'
import { useSocket } from '../../src/socket/SocketContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useCareOptional } from '../../src/care/CareContext'
import { useAuth } from '../../src/auth/AuthContext'
import { usePushNotifications } from '../../src/hooks/usePushNotifications'
import { visibleTabs, firstTab } from '../../src/vertical/verticals'
import { isFieldRole } from '../../src/auth/roles'
import { HeaderBell } from '../../src/more/HeaderBell'

/** All possible tab screen names (must match filenames in this directory) */
const ALL_TABS = [
  'dashboard', 'jobs', 'contacts', 'quotes', 'notifications', 'more',
  'service-calls', 'schedule',
  'shifts', 'care-schedule', 'time-clock', 'messages', 'more-homecare',
  'pipeline', 'canvass',
  'units', 'parts', 'ai-trade',
  'salon-book', 'salon-myday', 'salon-clients', 'salon-rebook',
]

export default function TabLayout() {
  const t = useTheme()
  // On Android 16 (API 36) the app is drawn edge-to-edge, behind the system navigation bar. The tab bar grows by that
  // bar's height so its icons and labels sit above the system buttons (theme/insets.ts — never a fixed height).
  const insets = useSafeAreaInsets()
  const bar = tabBarMetrics(insets.bottom)
  const { tabs, vertical, hasFeature, initialTab } = useVertical()
  // This phone's push token, for every vertical (POST /api/push/expo-token — apps/unified/server/core/phonePush.ts): a
  // tech is told of a job assigned or rescheduled, the office of a new lead, a caregiver of a visit. Registered here,
  // where every signed-in person passes, not on one vertical's first tab (roofing opens on the pipeline).
  usePushNotifications({ registerWithServer: true, fallbackRoute: vertical === 'homecare' ? '/(care)/notifications' : '/(tabs)/notifications' })
  // Twomiah Care: unread messages and a visit in progress show on their tabs.
  const care = useCareOptional()
  const careBadge = (name: string): number | string | undefined => {
    if (!care?.enabled) return undefined
    if (name === 'messages' && care.unreadMessages > 0) return care.unreadMessages > 99 ? '99+' : care.unreadMessages
    if (name === 'time-clock' && care.active) return 'On'
    if (name === 'more-homecare') {
      const n = care.unsignedDocs.length + care.unreadNotifications
      return n > 0 ? (n > 99 ? '99+' : n) : undefined
    }
    return undefined
  }

  // Only the tabs this seat may use, and whose switch is on (verticals.ts visibleTabs).
  const { can, user } = useAuth()
  const field = isFieldRole(user?.role)
  const shown = visibleTabs(tabs, can, hasFeature, field)
  const activeNames = new Set(shown.map(tab => tab.name))
  // The tab the app opens on (verticals.ts firstTab — the same rule the redirects use). Without it Expo opens the FIRST
  // screen file in this folder ('dashboard'), which is hidden for roofing, home care and a seat without dashboard access.
  const openOn = firstTab(tabs, initialTab, can, hasFeature, field)
  const tabMap = new Map(tabs.map(tab => [tab.name, tab]))

  return (
    <Tabs
      initialRouteName={openOn}
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerShadowVisible: false,
        // Alerts are the bell in the header (the last bar slot is More).
        headerRight: () => <HeaderBell />,
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingBottom: bar.paddingBottom,
          height: bar.height,
        },
        tabBarActiveTintColor: t.primaryText,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {/* The bar follows the vertical's own order (verticals.ts); hidden screens come after. */}
      {[...shown.map(tab => tab.name), ...ALL_TABS.filter(n => !activeNames.has(n))].map(name => {
        const def = tabMap.get(name)
        const isActive = activeNames.has(name)

        if (!isActive) {
          return (
            <Tabs.Screen
              key={name}
              name={name}
              options={{ href: null }}
            />
          )
        }

        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: def!.title,
              tabBarBadge: careBadge(name),
              tabBarIcon: ({ color, size, focused }) => {
                const iconName = focused ? def!.activeIcon : def!.icon
                if (name === 'notifications') {
                  return <NotificationIcon iconName={iconName} color={color} size={size} />
                }
                return <Ionicons name={iconName as any} size={size} color={color} />
              },
            }}
          />
        )
      })}
    </Tabs>
  )
}

function NotificationIcon({ iconName, color, size }: { iconName: string; color: string; size: number }) {
  const { connected } = useSocket()
  return (
    <View>
      <Ionicons name={iconName as any} size={size} color={color} />
      {connected && <View style={styles.connectedDot} />}
    </View>
  )
}

const styles = StyleSheet.create({
  connectedDot: {
    position: 'absolute', top: -1, right: -1,
    width: 7, height: 7, borderRadius: 4,
    backgroundColor: '#22c55e', borderWidth: 1, borderColor: '#fff',
  },
})
