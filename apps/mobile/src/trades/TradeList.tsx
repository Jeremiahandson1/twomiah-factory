/** A trade's list screen, drawn from its spec (kit.ts): chips, search, rows that open the detail, list-level actions. */
import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, Group, ListRow, EmptyState, SkeletonRows, Button, ChipRow, Chip, SearchField, space } from '../design'
import { useList } from '../home/useList'
import { reqUrl } from '../home/tiles'
import { useAuth } from '../auth/AuthContext'
import { useVertical } from '../vertical/VerticalContext'
import { FilterBanner } from '../home/FilterBanner'
import { specFor } from './specs'
import { mayUse, rowCache } from './kit'

export function TradeList({ spec: id, tab, params, banner }: { spec: string; tab?: boolean; params?: Record<string, string>; banner?: { label: string; onClear: () => void } }) {
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const spec = specFor(id)
  const [chip, setChip] = useState(spec?.chips?.[0]?.id)
  const [q, setQ] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const url = useMemo(() => {
    if (!spec) return null
    const query = { ...(spec.list.query || {}), ...(spec.chips?.find((c) => c.id === chip)?.query || {}), ...(params || {}) }
    if (spec.search && q.trim()) query[spec.search.param] = q.trim()
    return reqUrl({ path: spec.list.path, query })
  }, [spec, chip, q, params])
  const { rows, total, loading, error, refresh, loadMore } = useList(spec && mayUse(spec, can, hasFeature) ? url : null)
  if (!spec) return <Screen title="Not found"><EmptyState icon="alert-circle" title="This screen is not available" body="Open it again from the home screen." /></Screen>
  if (!mayUse(spec, can, hasFeature)) return <Screen title={spec.title} onBack={tab ? undefined : () => router.back()}><EmptyState icon="lock-closed" title="Not for this seat" body="Your role does not include this screen." /></Screen>
  const items = rows.map((r) => { const v = spec.rows(r); rowCache.set(`${spec.id}:${v.id}`, r); return v })
  return (
    <Screen title={spec.title} onBack={tab ? undefined : () => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}>
      <View style={{ gap: space[3] }}>
        {banner ? <FilterBanner label={banner.label} count={total ?? (loading ? undefined : rows.length)} onClear={banner.onClear} /> : null}
        {spec.search ? <SearchField value={q} onChangeText={setQ} placeholder={spec.search.placeholder} /> : null}
        {spec.chips ? <ChipRow>{spec.chips.map((c) => <Chip key={c.id} label={c.label} selected={chip === c.id} onPress={() => setChip(c.id)} />)}</ChipRow> : null}
        {loading ? <SkeletonRows count={5} /> : error ? <EmptyState icon="alert-circle" title="Could not load this list" body={error} action="Try again" onAction={refresh} />
          : items.length === 0 ? <EmptyState icon="checkmark-circle" title={spec.empty.title} body={spec.empty.body} />
          : <Group>{items.map((r, i) => (
              <ListRow key={r.key} title={r.title} subtitle={r.subtitle} meta={r.meta} badge={r.badge} badgeTone={r.tone}
                divider={i < items.length - 1}
                onPress={r.open || spec.detail ? () => router.push({ pathname: '/(details)/t/[spec]/[id]', params: r.open ? { spec: r.open.spec, id: r.open.id } : { spec: spec.id, id: r.id } } as any) : undefined} />
            ))}</Group>}
        {!loading && total != null && rows.length < total ? <Button label="Show more" variant="secondary" onPress={loadMore} /> : null}
      </View>
    </Screen>
  )
}
