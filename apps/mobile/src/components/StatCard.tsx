/**
 * Reusable stat card — extracted from dashboard for consistency.
 */

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../theme/ThemeContext'

interface StatCardProps {
  label: string
  value: string | number
  icon: string
  color: string
}

export function StatCard({ label, value, icon, color }: StatCardProps) {
  const t = useTheme()

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={[styles.iconBg, { backgroundColor: color + '18' }]}>
        <Ionicons name={icon as any} size={18} color={color} />
      </View>
      <Text style={[styles.value, { color: t.text }]}>{value}</Text>
      <Text style={[styles.label, { color: t.textSecondary }]}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    width: '47%', flexGrow: 1, borderRadius: 12, padding: 14,
    borderWidth: 1, gap: 6,
  },
  iconBg: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  value: { fontSize: 22, fontWeight: '700' },
  label: { fontSize: 12 },
})
