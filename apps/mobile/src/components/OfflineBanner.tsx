/**
 * Subtle offline indicator — shows when network is unavailable.
 */

import React from 'react'
import { Text, StyleSheet } from 'react-native'
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
      <Ionicons name={isSyncing ? 'sync' : 'cloud-offline'} size={14} color={isSyncing ? '#92400e' : '#991b1b'} />
      <Text style={[styles.text, isSyncing && styles.syncingText]}>{label}</Text>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 6,
    backgroundColor: '#fee2e2',
  },
  text: { fontSize: 12, fontWeight: '600', color: '#991b1b' },
  syncingBanner: { backgroundColor: '#fef3c7' },
  syncingText: { color: '#92400e' },
})
