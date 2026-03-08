import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../theme/ThemeContext'

export function EmptyState({ icon, title, subtitle }: { icon: string; title: string; subtitle?: string }) {
  const t = useTheme()
  return (
    <View style={styles.container}>
      <Ionicons name={icon as any} size={48} color={t.textMuted} style={{ opacity: 0.5 }} />
      <Text style={[styles.title, { color: t.textSecondary }]}>{title}</Text>
      {subtitle && <Text style={[styles.subtitle, { color: t.textMuted }]}>{subtitle}</Text>}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  title: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
  subtitle: { fontSize: 14, textAlign: 'center' },
})
