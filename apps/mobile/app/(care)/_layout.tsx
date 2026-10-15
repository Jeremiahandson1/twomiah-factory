/**
 * Stack for the caregiver screens pushed from the Twomiah Care tabs (home care vertical).
 */
import { Stack } from 'expo-router'
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
  return (
    <Stack
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
