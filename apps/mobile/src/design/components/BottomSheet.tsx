import React, { useEffect, useRef } from 'react'
import { Animated, Modal, Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDesign, useReduceMotion } from '../DesignContext'
import { DText } from './Text'
import { Icon } from './Icon'
import { MIN_TARGET, motion, radius, space } from '../tokens'

/**
 * A sheet from the bottom: for choices that belong to the screen behind (change status, pick a payment method). It traps focus for
 * screen readers (accessibilityViewIsModal), closes on the scrim, the close button or the system Back, slides in 200 ms (not at all
 * when animations are off) and clears the system buttons by the bottom inset.
 */
export function BottomSheet({ visible, title, onClose, children, inline }: { visible: boolean; title: string; onClose: () => void; children: React.ReactNode; inline?: boolean }) {
  const { c } = useDesign()
  const insets = useSafeAreaInsets()
  const reduce = useReduceMotion()
  const y = useRef(new Animated.Value(reduce ? 0 : 40)).current
  useEffect(() => { if (visible) { if (reduce) y.setValue(0); else { y.setValue(40); Animated.timing(y, { toValue: 0, duration: motion.base, useNativeDriver: true }).start() } } }, [visible, reduce, y])
  const sheet = (
    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]} />
      <Animated.View accessibilityViewIsModal style={{ transform: [{ translateY: y }], backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingBottom: insets.bottom + space[4], paddingHorizontal: space[4], paddingTop: space[2], gap: space[3] }}>
        <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <DText variant="headline" accessibilityRole="header" style={{ flex: 1 }}>{title}</DText>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={24} tone="text" /></Pressable>
        </View>
        {children}
      </Animated.View>
    </View>
  )
  // `inline` draws the sheet in place (the dev preview shows it open on a screenshot without a native Modal layer).
  if (inline) return visible ? <View style={StyleSheet.absoluteFill}>{sheet}</View> : null
  return <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>{sheet}</Modal>
}
