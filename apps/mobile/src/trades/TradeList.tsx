/** A trade's list screen, drawn from its spec (kit.ts): chips, search, rows that open the detail, list-level actions. */
import React, { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, Group, ListRow, EmptyState, SkeletonRows, Button, ChipRow, Chip, SearchField, space } from '../design'
import { useList } from '../home/useList'
import { reqUrl, type Req } from '../home/tiles'
import { useAuth } from '../auth/AuthContext'
import { useVertical } from '../vertical/VerticalContext'
import { FilterBanner } from '../home/FilterBanner'
import { specFor } from './specs'
import { mayUse, rowCache, fillDates, type Action } from './kit'
import { ActionSheet } from './ActionSheet'

export function TradeList({ spec: id, tab, params, banner, from }: { spec: string; tab?: boolean; params?: Record<string, string>; banner?: { label: string; onClear: () => void }; /** the tile's list: the chip with this query starts selected */ from?: Req }) {
  const router = useRouter()
  const { can, user } = useAuth()
  const { hasFeature } = useVertical()
  const spec = specFor(id)
  const [chip, setChip] = useState(() => (from && spec?.chips?.find((c) => reqUrl({ path: spec.list.path, query: { ...(spec.list.query || {}), ...c.query } }) === reqUrl(from))?.id) || spec?.chips?.[0]?.id)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Action | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const url = useMemo(() => {
    if (!spec) return null
    const query = fillDates({ ...(spec.list.query || {}), ...(spec.chips?.find((c) => c.id === chip)?.query || {}), ...(params || {}) })
    if (spec.search && q.trim()) query[spec.search.param] = q.trim()
    return reqUrl({ path: spec.list.path, query })
  }, [spec, chip, q, params])
  const { rows, total, loading, error, refresh, loadMore } = useList(spec && mayUse(spec, can, hasFeature) ? url : null, 25, spec?.pick)
  if (!spec) return <Screen title="Not found"><EmptyState icon="alert-circle" title="This screen is not available" body="Open it again from the home screen." /></Screen>
  if (!mayUse(spec, can, hasFeature)) return <Screen title={spec.title} onBack={tab ? undefined : () => router.back()}><EmptyState icon="lock-closed" title="Not for this seat" body="Your role does not include this screen." /></Screen>
  // A long figure beside the title squeezes the title to a sliver: it goes to the second line instead (only a short one stays at the right).
  const items = rows.map((r) => {
    const v = spec.rows(r, { userId: user?.id }); rowCache.set(`${spec.id}:${v.id}`, r && typeof r === 'object' ? { ...r, _me: user?.id } : r)
    return v.meta && v.meta.length > 12 ? { ...v, subtitle: [v.subtitle, v.meta].filter(Boolean).join(' · '), meta: undefined } : v
  })
  return (
    <Screen title={spec.title} onBack={tab ? undefined : () => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}
      actions={spec.create && spec.create.any.some((p) => can(p)) ? [{ icon: 'add', label: spec.create.label, onPress: () => router.push(spec.create!.route as any) }] : undefined}>
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
        {(spec.links || []).filter((l) => l.any.some((p) => can(p)) && (!l.feature || hasFeature(l.feature))).map((l) => <Button key={l.route} label={l.label} icon={l.icon} variant="secondary" fullWidth onPress={() => router.push(l.route as any)} />)}
        {(spec.actions || []).filter((a) => a.any.some((p) => can(p))).map((a) => <Button key={a.id} label={a.label} icon={a.icon} variant="secondary" fullWidth onPress={() => setOpen(a)} />)}
        {!loading && total != null && rows.length < total ? <Button label="Show more" variant="secondary" onPress={loadMore} /> : null}
      </View>
      <ActionSheet action={open} row={{}} onClose={() => setOpen(null)} onDone={refresh} />
    </Screen>
  )
}
