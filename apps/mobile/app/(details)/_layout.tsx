/**
 * Stack layout for detail screens (push navigation from tabs).
 */

import { Stack } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'

export default function DetailsLayout() {
  const t = useTheme()

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        headerShadowVisible: false,
      }}
    />
  )
}
