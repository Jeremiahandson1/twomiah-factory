/**
 * Subtle offline indicator — shows when network is unavailable.
 */

import React from 'react'
import { Text, StyleSheet } from 'react-native'
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

export function OfflineBanner() {
  const { isOffline } = useNetworkStatus()

  if (!isOffline) return null

  return (
    <Animated.View
      entering={FadeInDown.duration(200)}
      exiting={FadeOutUp.duration(200)}
      style={styles.banner}
    >
      <Ionicons name="cloud-offline" size={14} color="#991b1b" />
      <Text style={styles.text}>No internet connection</Text>
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
})
