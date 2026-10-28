/**
 * Stack for the caregiver screens pushed from the Twomiah Care tabs (home care vertical).
 */
import React from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../src/theme/ThemeContext'

const TITLES: Record<string, string> = {
  'client/[id]': 'Client',
  clients: 'My clients',
  'open-shifts': 'Open shifts',
  swaps: 'Shift swaps',
  requests: 'Requests',
  'shift-action': 'Visit',
  incident: 'Report an incident',
  documents: 'Documents to sign',
  mileage: 'Mileage',
  notifications: 'Notifications',
  history: 'Visit history',
  'thread/[id]': 'Message',
  compose: 'New message',
  payday: 'Confirm your hours',
  'sandata-help': 'Sandata help',
}

export default function CareLayout() {
  const t = useTheme()
  // Edge-to-edge (Android 16): a pushed screen has no tab bar, so its content would run under the system navigation
  // bar. One rule for every screen in this stack: keep the bottom inset clear (theme/insets.ts).
  const insets = useSafeAreaInsets()
  return (
    <Stack
      screenLayout={({ children }: { children: React.ReactNode }) => (
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>{children}</View>
      )}
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: t.background },
      }}
    >
      {Object.entries(TITLES).map(([name, title]) => (
        <Stack.Screen key={name} name={name} options={{ title }} />
      ))}
    </Stack>
  )
}
