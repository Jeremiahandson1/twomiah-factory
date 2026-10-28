/**
 * Animated card wrapper — staggered fade-in on mount.
 *
 * The wrapper is the flex item of whatever row or grid holds the card. Its child cannot size it: a percentage width on
 * the child resolves against a wrapper that has no width of its own, and the card collapses to the width of its
 * longest word (the dashboard's stat cards drew one letter per line on the phone). So any width, flex or margin the
 * card needs goes in `style` HERE, on the wrapper, and the child just fills it.
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
