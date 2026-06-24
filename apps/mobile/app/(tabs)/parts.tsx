/**
 * Parts Catalog — search OEM parts at the counter / on the floor.
 * RV / powersports / marine vertical. Calls /api/oem-parts/search.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, StyleSheet } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { SearchBar } from '../../src/components/SearchBar'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { EmptyState } from '../../src/components/EmptyState'
import { useDebounce } from '../../src/hooks/useDebounce'

const money = (n: any) => (n ? '$' + Number(n).toFixed(2) : '')

export default function PartsScreen() {
  const t = useTheme()
  const [parts, setParts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const ds = useDebounce(search)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await get('/api/oem-parts/search?q=' + encodeURIComponent(ds.trim()))
    if (res.ok) setParts(res.data?.parts || [])
    setLoading(false)
  }, [ds])
  useEffect(() => { load() }, [load])

  const render = ({ item: p, index }: { item: any; index: number }) => (
    <AnimatedCard index={index}>
      <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.name, { color: t.text }]}>{p.name}</Text>
            <Text style={[styles.sub, { color: t.textSecondary }]}>{p.partNumber} · {p.oem}</Text>
            {p.fitment ? <Text style={[styles.fit, { color: t.textMuted }]} numberOfLines={1}>{p.fitment}</Text> : null}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 3 }}>
            <Text style={[styles.price, { color: t.primary }]}>{money(p.price)}</Text>
            <Text style={[styles.avail, { color: /in stock/i.test(p.availability || '') ? '#22c55e' : t.textMuted }]}>{p.availability}</Text>
          </View>
        </View>
      </View>
    </AnimatedCard>
  )

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search parts (part #, name, unit)..." />
      {loading ? <SkeletonList count={6} /> : (
        <FlatList
          data={parts}
          keyExtractor={(it, i) => it.partNumber || String(i)}
          renderItem={render}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon="construct-outline" title="No parts found" />}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  name: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  fit: { fontSize: 11, marginTop: 2 },
  price: { fontSize: 15, fontWeight: '700' },
  avail: { fontSize: 11 },
})
