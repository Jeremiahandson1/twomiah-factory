import React from 'react'
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native'
import { useDesign } from '../DesignContext'
import { radius, elevationStyle, motion, space, type ElevationLevel } from '../tokens'

/** A surface: rounded, hairline-bordered, lifted by a soft shadow on light and by a lighter surface on dark. Tappable when it has onPress. */
export function Card({ children, onPress, level = 1, padded = true, style, accessibilityLabel, accessibilityHint }: {
  children: React.ReactNode; onPress?: () => void; level?: ElevationLevel; padded?: boolean; style?: StyleProp<ViewStyle>
  accessibilityLabel?: string; accessibilityHint?: string
}) {
  const { c } = useDesign()
  const base: ViewStyle = { backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: padded ? space[4] : 0, overflow: 'hidden' }
  const lift = elevationStyle(level, c.dark)
  if (!onPress) return <View style={[base, lift, style]}>{children}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} onPress={onPress}
      style={({ pressed }) => [base, lift, pressed && { backgroundColor: c.surfaceAlt, transform: [{ scale: motion.pressScale }] }, style]}>
      {children}
    </Pressable>
  )
}
