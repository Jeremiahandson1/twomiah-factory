/**
 * Parts Catalog — search OEM parts at the counter / on the floor.
 * RV / powersports / marine vertical. Calls /api/oem-parts/search.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, StyleSheet } from 'react-native'
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
  // live is false while the dealer has imported no catalogue: the server then answers a stand-in demo list
  // (provider 'mock', apps/unified/server/crm/rv/parts.ts), whose prices are not the dealer's — said so, as the web does.
  const [live, setLive] = useState(true)
  const [search, setSearch] = useState('')
  const ds = useDebounce(search)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await get('/api/oem-parts/search?q=' + encodeURIComponent(ds.trim()))
    if (res.ok) { setParts(Array.isArray(res.data?.parts) ? res.data.parts : []); setLive(res.data?.live !== false) }
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
            <Text style={[styles.price, { color: t.primaryText }]}>{money(p.price)}</Text>
            <Text style={[styles.avail, { color: /in stock/i.test(p.availability || '') ? t.success : t.textMuted }]}>{p.availability}</Text>
          </View>
        </View>
      </View>
    </AnimatedCard>
  )

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search parts (part #, name, unit)..." />
      {!live ? (
        <View style={[styles.demo, { borderColor: t.warning, backgroundColor: t.warning + '1f' }]}>
          <Text style={[styles.demoText, { color: t.text }]}>Demo catalog — these are sample parts and prices, not yours. Import your parts on the web app to search your own.</Text>
        </View>
      ) : null}
      {loading ? <SkeletonList count={6} /> : (
        <FlatList
          data={parts}
          keyExtractor={(it, i) => (it.partNumber ? it.partNumber + '|' + it.oem : String(i))}
          renderItem={render}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          ListEmptyComponent={<EmptyState icon="construct-outline" title="No parts found" />}
        />
      )}
    </View>
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
  demo: { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  demoText: { fontSize: 12, lineHeight: 17 },
})
