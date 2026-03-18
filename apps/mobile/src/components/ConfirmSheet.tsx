/**
 * Confirmation bottom sheet — replaces Alert.alert for destructive/important actions.
 */

import React from 'react'
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { useHaptics } from '../hooks/useHaptics'

interface ConfirmSheetProps {
  title: string
  description?: string
  confirmLabel?: string
  confirmColor?: string
  onConfirm: () => void
  onCancel: () => void
  destructive?: boolean
}

export function ConfirmSheet({
  title,
  description,
  confirmLabel = 'Confirm',
  confirmColor,
  onConfirm,
  onCancel,
  destructive,
}: ConfirmSheetProps) {
  const t = useTheme()
  const haptics = useHaptics()
  const btnColor = confirmColor || (destructive ? '#ef4444' : t.primary)

  return (
    <View style={[styles.container, { backgroundColor: t.surface }]}>
      <View style={[styles.handle, { backgroundColor: t.border }]} />
      <Text style={[styles.title, { color: t.text }]}>{title}</Text>
      {description && (
        <Text style={[styles.desc, { color: t.textSecondary }]}>{description}</Text>
      )}
      <View style={styles.buttons}>
        <TouchableOpacity
          style={[styles.btn, styles.cancelBtn, { borderColor: t.border }]}
          onPress={() => { haptics.light(); onCancel() }}
        >
          <Text style={[styles.btnText, { color: t.textSecondary }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, { backgroundColor: btnColor }]}
          onPress={() => { haptics.medium(); onConfirm() }}
        >
          <Text style={[styles.btnText, { color: '#fff' }]}>{confirmLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 20, paddingTop: 12, borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  handle: {
    width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: 20 },
  buttons: { flexDirection: 'row', gap: 10 },
  btn: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
  },
  cancelBtn: { borderWidth: 1 },
  btnText: { fontSize: 15, fontWeight: '600' },
})
