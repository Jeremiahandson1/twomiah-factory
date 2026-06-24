/**
 * Inventory (units) — searchable list of the dealership's units.
 * RV / powersports / marine vertical.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, StyleSheet, RefreshControl } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { SearchBar } from '../../src/components/SearchBar'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { EmptyState } from '../../src/components/EmptyState'
import { StatusBadge } from '../../src/components/StatusBadge'
import { useDebounce } from '../../src/hooks/useDebounce'

const money = (n: any) => (n ? '$' + Number(n).toLocaleString() : '—')

export default function UnitsScreen() {
  const t = useTheme()
  const [units, setUnits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const ds = useDebounce(search)

  const load = useCallback(async () => {
    const res = await get('/api/units?limit=100')
    if (res.ok) { const data = res.data?.data || res.data || []; setUnits(Array.isArray(data) ? data : []) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  const q = ds.trim().toLowerCase()
  const filtered = !q ? units : units.filter((u) => [u.year, u.make, u.modelName, u.model, u.stockNumber].filter(Boolean).join(' ').toLowerCase().includes(q))

  const render = ({ item: u, index }: { item: any; index: number }) => {
    const name = [u.year, u.make, u.modelName || u.model].filter(Boolean).join(' ')
    const price = u.internetPrice || u.price || u.salePrice
    return (
      <AnimatedCard index={index}>
        <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{name || 'Unit'}</Text>
              <Text style={[styles.sub, { color: t.textSecondary }]}>{[u.stockNumber ? 'Stock ' + u.stockNumber : '', u.category].filter(Boolean).join(' · ') || '—'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[styles.price, { color: t.primary }]}>{money(price)}</Text>
              {u.condition ? <StatusBadge status={u.condition} /> : null}
            </View>
          </View>
        </View>
      </AnimatedCard>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search inventory..." />
      {loading ? <SkeletonList count={6} /> : (
        <FlatList
          data={filtered}
          keyExtractor={(it, i) => it.id || String(i)}
          renderItem={render}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={<EmptyState icon="car-sport-outline" title="No units found" />}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2 },
  price: { fontSize: 15, fontWeight: '700' },
})
