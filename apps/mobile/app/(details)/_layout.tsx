/**
 * Stack layout for detail screens (push navigation from tabs).
 */

import React from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../src/theme/ThemeContext'

export default function DetailsLayout() {
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
      }}
    >
      {/* Screens built with the design system's <Screen> draw their own header and back button; the stack's would show the file name. */}
      {['waiting', 'clock', 'job/checklist', 'leads/index', 'leads/[id]', 'invoices', 'invoice/[id]', 'rows', 'web', 't/[spec]/index', 't/[spec]/[id]', 'texts/index', 'texts/[id]', 'texts/new', 'email/index', 'email/[id]',
        'office-time', 'office-bookings', 'office-waitlist', 'office-google-reviews', 'office-review-requests', 'reports-summary', 'expenses/index', 'expenses/new', 'visit-photo', 'intake-form'].map((name) => (
        <Stack.Screen key={name} name={name} options={{ headerShown: false }} />
      ))}
    </Stack>
  )
}
