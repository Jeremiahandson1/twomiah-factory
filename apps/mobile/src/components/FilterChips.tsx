/**
 * Horizontal scrollable filter chips — reusable across all list screens.
 */

import React from 'react'
import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { useHaptics } from '../hooks/useHaptics'

interface FilterChipsProps {
  options: { key: string; label: string }[]
  selected: string
  onSelect: (key: string) => void
}

export function FilterChips({ options, selected, onSelect }: FilterChipsProps) {
  const t = useTheme()
  const haptics = useHaptics()

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {options.map(opt => {
        const active = selected === opt.key
        return (
          <TouchableOpacity
            key={opt.key}
            style={[styles.chip, active && { backgroundColor: t.primary }]}
            onPress={() => { haptics.selection(); onSelect(opt.key) }}
            activeOpacity={0.7}
          >
            <Text style={[
              styles.label,
              { color: active ? '#fff' : t.textSecondary },
            ]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
  label: { fontSize: 13, fontWeight: '600' },
})
