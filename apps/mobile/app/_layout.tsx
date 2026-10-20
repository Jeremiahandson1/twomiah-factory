/**
 * Root layout — wraps app in providers, handles auth gate.
 */

import React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider, useAuth } from '../src/auth/AuthContext'
import { VerticalProvider, useVertical } from '../src/vertical/VerticalContext'
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext'
import { ToastProvider } from '../src/components/ToastProvider'
import { SocketProvider } from '../src/socket/SocketContext'
import { OfflineProvider } from '../src/offline/OfflineContext'
import { OfflineBanner } from '../src/components/OfflineBanner'
import { WrongAppGate, NoPhoneAppGate } from '../src/vertical/WrongAppGate'
import { useLocationReporter } from '../src/hooks/useLocationReporter'
import { CareProvider } from '../src/care/CareContext'

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth()
  const { verticalMismatch, vertical } = useVertical()
  const segments = useSegments()
  const router = useRouter()
  const t = useTheme()

  // While signed in, report this technician's location to the CRM (foreground). Not for home care:
  // that backend has no /api/geofencing route — a caregiver's location is recorded on the visit
  // itself (clock-in / clock-out fixes and breadcrumbs, src/care/CareContext.tsx).
  useLocationReporter(vertical !== 'homecare')

  React.useEffect(() => {
    if (isLoading) return
    const inAuth = segments[0] === '(auth)'
    if (!isAuthenticated && !inAuth) {
      router.replace('/(auth)/login')
    } else if (isAuthenticated && inAuth) {
      router.replace('/(tabs)')
    }
  }, [isAuthenticated, isLoading, segments])

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
        <ActivityIndicator size="large" color={t.primary} />
      </View>
    )
  }

  if (isAuthenticated && verticalMismatch) {
    return <WrongAppGate />
  }
  if (isAuthenticated && vertical === 'unavailable') {
    return <NoPhoneAppGate />
  }

  return (
    <>
      <OfflineBanner />
      <Slot />
    </>
  )
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <VerticalProvider>
          <ThemeProvider>
            <ToastProvider>
              <SocketProvider>
                <OfflineProvider>
                  <CareProvider>
                    <StatusBar style="auto" />
                    <AuthGate />
                  </CareProvider>
                </OfflineProvider>
              </SocketProvider>
            </ToastProvider>
          </ThemeProvider>
        </VerticalProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  )
}
