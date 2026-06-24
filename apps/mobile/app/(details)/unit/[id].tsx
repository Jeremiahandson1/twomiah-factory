/**
 * Unit Detail — a unit from inventory, with quick actions (appraise a trade,
 * start a deal). Fields are passed via params from the Inventory list.
 */

import React from 'react'
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter, Stack } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { AnimatedCard } from '../../../src/components/AnimatedCard'
import { StatusBadge } from '../../../src/components/StatusBadge'

const money = (n: any) => (n ? '$' + Number(n).toLocaleString() : '—')

export default function UnitDetailScreen() {
  const p = useLocalSearchParams<{ id: string; name: string; price: string; stock: string; condition: string; category: string }>()
  const router = useRouter()
  const t = useTheme()
  const name = p.name || 'Unit'

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <Stack.Screen options={{ title: name }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <AnimatedCard index={0}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.headerRow}>
              <View style={[styles.iconWrap, { backgroundColor: t.primary + '18' }]}><Ionicons name="car-sport" size={26} color={t.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: t.text }]}>{name}</Text>
                {p.stock ? <Text style={[styles.sub, { color: t.textSecondary }]}>Stock {p.stock}</Text> : null}
              </View>
              {p.condition ? <StatusBadge status={p.condition} /> : null}
            </View>
            <Text style={[styles.price, { color: t.primary }]}>{money(p.price)}</Text>
            {p.category ? <Text style={[styles.cat, { color: t.textMuted }]}>{p.category}</Text> : null}
          </View>
        </AnimatedCard>

        <AnimatedCard index={1}>
          <View style={styles.actionsCol}>
            <TouchableOpacity style={[styles.btn, { backgroundColor: '#0ea5e9' }]} onPress={() => router.push('/(tabs)/ai-trade')}>
              <Ionicons name="cash" size={18} color="#fff" /><Text style={styles.btnText}>Appraise a Trade</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, { backgroundColor: t.primary }]} onPress={() => router.push({ pathname: '/(details)/deal/worksheet', params: { price: p.price || '', unit: name } })}>
              <Ionicons name="clipboard" size={18} color="#fff" /><Text style={styles.btnText}>Start a Deal</Text>
            </TouchableOpacity>
          </View>
        </AnimatedCard>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconWrap: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 2 },
  price: { fontSize: 26, fontWeight: '800', marginTop: 14 },
  cat: { fontSize: 13, marginTop: 2, textTransform: 'capitalize' },
  actionsCol: { gap: 10 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 10 },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
})
