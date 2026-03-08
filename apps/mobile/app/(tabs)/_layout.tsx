/**
 * Bottom tab navigator — the main app chrome after login.
 */

import React from 'react'
import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useSocket } from '../../src/socket/SocketContext'
import { View, Text, StyleSheet } from 'react-native'

export default function TabLayout() {
  const t = useTheme()

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
      <Tabs.Screen
        name="index"
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Jobs',
          tabBarIcon: ({ color, size }) => <Ionicons name="hammer" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="contacts"
        options={{
          title: 'Contacts',
          tabBarIcon: ({ color, size }) => <Ionicons name="people" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="quotes"
        options={{
          title: 'Quotes',
          tabBarIcon: ({ color, size }) => <Ionicons name="document-text" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Alerts',
          tabBarIcon: ({ color, size }) => <NotificationIcon color={color} size={size} />,
        }}
      />
    </Tabs>
  )
}

function NotificationIcon({ color, size }: { color: string; size: number }) {
  const { connected } = useSocket()
  return (
    <View>
      <Ionicons name="notifications" size={size} color={color} />
      {connected && (
        <View style={styles.connectedDot} />
      )}
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
