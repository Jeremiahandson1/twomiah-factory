/**
 * Subtle offline indicator — shows when network is unavailable.
 */

import React from 'react'
import { Text, StyleSheet } from 'react-native'
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { useOfflineQueue } from '../offline/OfflineContext'

export function OfflineBanner() {
  const { isOffline } = useNetworkStatus()
  const { pendingCount, isSyncing } = useOfflineQueue()

  if (!isOffline && !isSyncing && pendingCount === 0) return null

  const label = isSyncing
    ? `Syncing ${pendingCount} pending...`
    : isOffline && pendingCount > 0
      ? `No internet \u2014 ${pendingCount} pending`
      : isOffline
        ? 'No internet connection'
        : `Syncing ${pendingCount} pending...`

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOutUp.duration(200)}
      style={[styles.banner, isSyncing && styles.syncingBanner]}
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
