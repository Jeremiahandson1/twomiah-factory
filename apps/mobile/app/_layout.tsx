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
import { WrongAppGate } from '../src/vertical/WrongAppGate'

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth()
  const { verticalMismatch } = useVertical()
  const segments = useSegments()
  const router = useRouter()
  const t = useTheme()

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
                  <StatusBar style="auto" />
                  <AuthGate />
                </OfflineProvider>
              </SocketProvider>
            </ToastProvider>
          </ThemeProvider>
        </VerticalProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  )
}
