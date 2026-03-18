/**
 * Products — dispensary product catalog with category filters.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, Image,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { SearchBar } from '../../src/components/SearchBar'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { EmptyState } from '../../src/components/EmptyState'
import { useDebounce } from '../../src/hooks/useDebounce'

const CATEGORIES = [
  { key: 'all', label: 'All' },
  { key: 'flower', label: 'Flower' },
  { key: 'edible', label: 'Edibles' },
  { key: 'concentrate', label: 'Concentrates' },
  { key: 'vape', label: 'Vapes' },
  { key: 'preroll', label: 'Pre-Rolls' },
  { key: 'topical', label: 'Topicals' },
  { key: 'merch', label: 'Merch' },
]

const STRAIN_COLORS: Record<string, string> = {
  indica: '#8b5cf6',
  sativa: '#f59e0b',
  hybrid: '#22c55e',
  cbd: '#3b82f6',
}

export default function ProductsScreen() {
  const t = useTheme()
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [category, setCategory] = useState('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search)

  const loadProducts = useCallback(async () => {
    const params = new URLSearchParams({ limit: '100' })
    if (category !== 'all') params.set('category', category)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    const res = await get(`/api/products?${params}`)
    if (res.ok) setProducts(res.data.data || res.data || [])
    setLoading(false)
  }, [category, debouncedSearch])

  useEffect(() => { setLoading(true); loadProducts() }, [loadProducts])

  const onRefresh = async () => { setRefreshing(true); await loadProducts(); setRefreshing(false) }

  const getStockColor = (qty: number, threshold: number) => {
    if (qty <= 0) return '#ef4444'
    if (qty <= (threshold || 5)) return '#f59e0b'
    return '#22c55e'
  }

  const renderProduct = ({ item: product, index }: { item: any; index: number }) => (
    <AnimatedCard index={index}>
      <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
        <View style={styles.cardRow}>
          {product.imageUrl ? (
            <Image source={{ uri: product.imageUrl }} style={styles.productImg} />
          ) : (
            <View style={[styles.productImg, styles.imgPlaceholder, { backgroundColor: t.surfaceAlt }]}>
              <Ionicons name="leaf" size={20} color={t.textMuted} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.productName, { color: t.text }]} numberOfLines={1}>{product.name}</Text>
            <View style={styles.metaRow}>
              {product.strainType && (
                <View style={[styles.strainBadge, { backgroundColor: (STRAIN_COLORS[product.strainType] || '#64748b') + '20' }]}>
                  <Text style={[styles.strainText, { color: STRAIN_COLORS[product.strainType] || '#64748b' }]}>
                    {product.strainType}
                  </Text>
                </View>
              )}
              {product.thcPercent != null && (
                <Text style={[styles.thc, { color: t.textSecondary }]}>THC {product.thcPercent}%</Text>
              )}
              {product.brand && (
                <Text style={[styles.brand, { color: t.textMuted }]}>{product.brand}</Text>
              )}
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.price, { color: t.text }]}>${(product.price / 100).toFixed(2)}</Text>
            <View style={styles.stockRow}>
              <View style={[styles.stockDot, { backgroundColor: getStockColor(product.stockQuantity, product.lowStockThreshold) }]} />
              <Text style={[styles.stockText, { color: t.textMuted }]}>
                {product.stockQuantity ?? '—'}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </AnimatedCard>
  )

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search products..." />
      <FilterChips options={CATEGORIES} selected={category} onSelect={setCategory} />

      {loading ? (
        <SkeletonList count={6} />
      ) : (
        <FlatList
          data={products}
          keyExtractor={item => item.id}
          renderItem={renderProduct}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={<EmptyState icon="leaf-outline" title="No products" subtitle="Products will appear here" />}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 8 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  productImg: { width: 48, height: 48, borderRadius: 10 },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  productName: { fontSize: 15, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  strainBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  strainText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  thc: { fontSize: 11 },
  brand: { fontSize: 11 },
  price: { fontSize: 16, fontWeight: '700' },
  stockRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  stockDot: { width: 6, height: 6, borderRadius: 3 },
  stockText: { fontSize: 11 },
})
