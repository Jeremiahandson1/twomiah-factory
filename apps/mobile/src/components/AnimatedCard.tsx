/**
 * Animated card wrapper — staggered fade-in on mount.
 */

import React from 'react'
import { ViewStyle } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'

interface AnimatedCardProps {
  children: React.ReactNode
  index?: number
  style?: ViewStyle | ViewStyle[]
}

export function AnimatedCard({ children, index = 0, style }: AnimatedCardProps) {
  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).duration(300).springify()}
      style={style}
    >
      {children}
    </Animated.View>
  )
}
