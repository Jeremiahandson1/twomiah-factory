/** The list a home tile opens when it has no screen of its own (home care, the dealership, projects): exactly the rows the tile counts. */
import React, { useState } from 'react'
import { useRouter } from 'expo-router'
import { Screen, Group, ListRow, EmptyState, SkeletonRows, Button } from '../../src/design'
import { View } from 'react-native'
import { useList } from '../../src/home/useList'
import { useTile } from '../../src/home/useTile'
import { FilterBanner } from '../../src/home/FilterBanner'
import { rowView } from '../../src/home/rows'
import { reqUrl } from '../../src/home/tiles'

export default function RowsScreen() {
  const router = useRouter()
  const { tile, clear } = useTile()
  const { rows, total, loading, error, refresh, loadMore } = useList(tile ? reqUrl(tile.list) : null)
  const [refreshing, setRefreshing] = useState(false)
  const items = tile ? rows.map((r, i) => rowView(tile.id, r, i)) : []
  const count = tile ? tile.total({ data: rows, pagination: { total }, items: rows }) : undefined
  return (
    <Screen title={tile?.label || 'List'} onBack={() => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}>
      <View style={{ gap: 12 }}>
        {tile ? <FilterBanner label={tile.banner} count={count ?? total} onClear={() => { clear(); router.back() }} /> : null}
        {loading ? <SkeletonRows count={5} /> : error ? <EmptyState icon="alert-circle" title="Could not load this list" body={error} action="Try again" onAction={refresh} />
          : items.length === 0 ? <EmptyState icon="checkmark-circle" title="Nothing here" body="There is nothing to show right now." />
          : <Group>{items.map((r, i) => <ListRow key={r.key} title={r.title} subtitle={r.subtitle} meta={r.meta} badge={r.badge} divider={i < items.length - 1} onPress={r.to ? () => router.push(r.to as any) : undefined} />)}</Group>}
        {!loading && total != null && rows.length < total ? <Button label="Show more" variant="secondary" onPress={loadMore} /> : null}
      </View>
    </Screen>
  )
}
