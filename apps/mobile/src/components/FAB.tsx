/**
 * Floating Action Button — primary action per screen.
 */

import React from 'react'
import { TouchableOpacity, StyleSheet } from 'react-native'
import Animated, { FadeInUp } from 'react-native-reanimated'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeContext'
import { fabBottom } from '../theme/insets'
import { inkOn } from '../theme/contrast'
import { useHaptics } from '../hooks/useHaptics'

interface FABProps {
  icon?: string
  onPress: () => void
  /** True on a tab screen (the tab bar already clears the system buttons); false on a screen with no tab bar. */
  aboveTabBar?: boolean
}

export function FAB({ icon = 'add', onPress, aboveTabBar = true }: FABProps) {
  const t = useTheme()
  const insets = useSafeAreaInsets()
  const haptics = useHaptics()

  return (
    <Animated.View entering={FadeInUp.delay(300).duration(250)} style={[styles.wrapper, { bottom: fabBottom(insets.bottom, aboveTabBar) }]}>
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: t.primary }]}
        onPress={() => { haptics.medium(); onPress() }}
        activeOpacity={0.85}
      >
        <Ionicons name={icon as any} size={28} color={inkOn(t.primary)} />
      </TouchableOpacity>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute', right: 20, zIndex: 100,
  },
  fab: {
    width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2, shadowRadius: 8, elevation: 6,
  },
})
