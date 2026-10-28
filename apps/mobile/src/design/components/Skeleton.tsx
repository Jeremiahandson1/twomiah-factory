import React, { useEffect, useRef } from 'react'
import { Animated, View } from 'react-native'
import { useDesign, useReduceMotion } from '../DesignContext'
import { radius, space } from '../tokens'

/** A grey placeholder block that breathes (and stays still when the phone's animations are off). Hidden from screen readers, which hear "Loading". */
export function Skeleton({ width = '100%', height = 16, round = radius.sm }: { width?: number | string; height?: number; round?: number }) {
  const { c } = useDesign()
  const reduce = useReduceMotion()
  const o = useRef(new Animated.Value(1)).current
  useEffect(() => {
    if (reduce) { o.setValue(1); return }
    const loop = Animated.loop(Animated.sequence([Animated.timing(o, { toValue: 0.5, duration: 700, useNativeDriver: true }), Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true })]))
    loop.start()
    return () => loop.stop()
  }, [reduce, o])
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no" style={{ width: width as any, height, borderRadius: round, backgroundColor: c.surfaceAlt, opacity: o }} />
}
export function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <View accessible accessibilityLabel="Loading" style={{ gap: space[4], padding: space[4] }}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: space[3], alignItems: 'center' }}>
          <Skeleton width={36} height={36} round={radius.md} />
          <View style={{ flex: 1, gap: space[2] }}><Skeleton width="60%" /><Skeleton width="40%" height={12} /></View>
        </View>
      ))}
    </View>
  )
}
