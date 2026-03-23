/**
 * Dynamic bottom tab navigator — shows different tabs per vertical.
 * All tab screen files exist at build time; inactive ones are hidden via href: null.
 */

import React from 'react'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { View, StyleSheet } from 'react-native'
import { useTheme } from '../../src/theme/ThemeContext'
import { useSocket } from '../../src/socket/SocketContext'
import { useVertical } from '../../src/vertical/VerticalContext'

/** All possible tab screen names (must match filenames in this directory) */
const ALL_TABS = [
  'dashboard', 'jobs', 'contacts', 'quotes', 'notifications',
  'service-calls', 'schedule',
  'shifts', 'time-clock', 'messages', 'more-homecare',
  'pipeline', 'canvass',
  'orders', 'products', 'customers', 'loyalty', 'more-dispensary',
  'checkin-queue', 'driver', 'ai-chat', 'pos-mobile',
]

export default function TabLayout() {
  const t = useTheme()
  const { tabs } = useVertical()

  const activeNames = new Set(tabs.map(tab => tab.name))
  const tabMap = new Map(tabs.map(tab => [tab.name, tab]))

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerShadowVisible: false,
        tabBarStyle: {
          backgroundColor: t.surface,
          borderTopColor: t.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          paddingBottom: 4,
          height: 56,
        },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      {ALL_TABS.map(name => {
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
