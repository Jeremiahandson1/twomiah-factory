/**
 * Subtle offline indicator — shows when network is unavailable.
 */

import React from 'react'
import { Text, StyleSheet, Pressable } from 'react-native'
import { useRouter } from 'expo-router'
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { useOfflineQueue } from '../offline/OfflineContext'

export function OfflineBanner() {
  const { isOffline } = useNetworkStatus()
  const { pendingCount, failedCount, isSyncing } = useOfflineQueue()
  // Edge-to-edge: the banner is the top-most thing on screen, so it starts below the status bar, not under its clock.
  const insets = useSafeAreaInsets()
  const router = useRouter()

  if (!isOffline && !isSyncing && pendingCount === 0 && failedCount === 0) return null

  const failedNote = failedCount > 0 ? `${failedCount} couldn't send` : ''
  const base = (isSyncing
    ? `Syncing ${pendingCount} pending...`
    : isOffline && pendingCount > 0
      ? `No internet \u2014 ${pendingCount} pending`
      : isOffline
        ? 'No internet connection'
        : pendingCount > 0 ? `Syncing ${pendingCount} pending...` : '')
  const label = [base, failedNote].filter(Boolean).join(' \u00b7 ')

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOutUp.duration(200)}
      style={[styles.banner, isSyncing && styles.syncingBanner, { paddingTop: 6 + insets.top }]}
    >
      {/* Tapping it opens the list of what is waiting, and of what the server refused ("Couldn't send — tap to fix"). */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. Open the list of what is waiting to send`}
        disabled={pendingCount === 0 && failedCount === 0}
        onPress={() => router.push('/(details)/waiting' as any)}
        style={styles.tap}
      >
        <Ionicons name={isSyncing ? 'sync' : failedCount > 0 ? 'alert-circle' : 'cloud-offline'} size={14} color={isSyncing ? '#92400e' : '#991b1b'} />
        <Text style={[styles.text, isSyncing && styles.syncingText]}>{label}{failedCount > 0 ? ' \u2014 tap to fix' : pendingCount > 0 ? ' \u2014 tap to see' : ''}</Text>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 6,
    backgroundColor: '#fee2e2',
  },
  tap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 32, paddingHorizontal: 12 },
  text: { fontSize: 12, fontWeight: '600', color: '#991b1b' },
  syncingBanner: { backgroundColor: '#fef3c7' },
  syncingText: { color: '#92400e' },
})
