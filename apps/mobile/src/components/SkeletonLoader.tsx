/**
 * Skeleton loading placeholders — animated shimmer effect.
 */

import React, { useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated'
import { useTheme } from '../theme/ThemeContext'

function ShimmerBase({ style }: { style?: any }) {
  const t = useTheme()
  const shimmer = useSharedValue(0)

  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true)
  }, [])

  const animStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 1], [0.3, 0.7]),
  }))

  return (
    <Animated.View
      style={[
        { backgroundColor: t.isDark ? '#2a2d3e' : '#e2e8f0', borderRadius: 8 },
        style,
        animStyle,
      ]}
    />
  )
}

export function SkeletonLine({ width = '100%', height = 14 }: { width?: string | number; height?: number }) {
  return <ShimmerBase style={{ width, height, marginBottom: 8 }} />
}

export function SkeletonCircle({ size = 40 }: { size?: number }) {
  return <ShimmerBase style={{ width: size, height: size, borderRadius: size / 2 }} />
}

export function SkeletonCard() {
  const t = useTheme()
  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.row}>
        <SkeletonCircle size={40} />
        <View style={{ flex: 1, gap: 6 }}>
          <SkeletonLine width="70%" height={14} />
          <SkeletonLine width="40%" height={12} />
        </View>
      </View>
      <SkeletonLine width="90%" height={12} />
      <SkeletonLine width="50%" height={12} />
    </View>
  )
}

export function SkeletonStatGrid() {
  return (
    <View style={styles.statGrid}>
      {[0, 1, 2, 3].map(i => (
        <ShimmerBase key={i} style={styles.statItem} />
      ))}
    </View>
  )
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View style={{ gap: 10, padding: 16 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12, borderWidth: 1, padding: 14, gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 16 },
  statItem: { width: '47%', flexGrow: 1, height: 80, borderRadius: 12 },
})
