/**
 * Root layout — wraps app in providers, handles auth gate.
 */

import React from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Slot, useRouter, useSegments } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { AuthProvider, useAuth } from '../src/auth/AuthContext'
import { VerticalProvider } from '../src/vertical/VerticalContext'
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext'
import { ToastProvider } from '../src/components/ToastProvider'
import { SocketProvider } from '../src/socket/SocketContext'
import { OfflineBanner } from '../src/components/OfflineBanner'

function AuthGate() {
  const { isAuthenticated, isLoading } = useAuth()
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
                <StatusBar style="auto" />
                <AuthGate />
              </SocketProvider>
            </ToastProvider>
          </ThemeProvider>
        </VerticalProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  )
}
