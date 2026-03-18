/**
 * Swipeable list row — reveals action buttons on swipe.
 */

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { Swipeable } from 'react-native-gesture-handler'
import { Ionicons } from '@expo/vector-icons'
import { useHaptics } from '../hooks/useHaptics'

export interface SwipeAction {
  icon: string
  label: string
  color: string
  onPress: () => void
}

interface SwipeableRowProps {
  children: React.ReactNode
  rightActions?: SwipeAction[]
  leftAction?: SwipeAction
}

export function SwipeableRow({ children, rightActions = [], leftAction }: SwipeableRowProps) {
  const haptics = useHaptics()

  const renderRightActions = () => {
    if (rightActions.length === 0) return null
    return (
      <View style={styles.actionsRight}>
        {rightActions.map((action, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.actionBtn, { backgroundColor: action.color }]}
            onPress={() => { haptics.light(); action.onPress() }}
          >
            <Ionicons name={action.icon as any} size={20} color="#fff" />
            <Text style={styles.actionLabel}>{action.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    )
  }

  const renderLeftActions = () => {
    if (!leftAction) return null
    return (
      <View style={styles.actionsLeft}>
        <TouchableOpacity
          style={[styles.actionBtn, { backgroundColor: leftAction.color }]}
          onPress={() => { haptics.light(); leftAction.onPress() }}
        >
          <Ionicons name={leftAction.icon as any} size={20} color="#fff" />
          <Text style={styles.actionLabel}>{leftAction.label}</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <Swipeable
      renderRightActions={renderRightActions}
      renderLeftActions={renderLeftActions}
      overshootRight={false}
      overshootLeft={false}
      friction={2}
    >
      {children}
    </Swipeable>
  )
}

const styles = StyleSheet.create({
  actionsRight: { flexDirection: 'row', alignItems: 'stretch' },
  actionsLeft: { flexDirection: 'row', alignItems: 'stretch' },
  actionBtn: {
    width: 72, alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  actionLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },
})
