/** Today's route: the storm stops that are waiting (Log snow visit) above today's visits in route order — both drawn from the specs in landscaping.ts. */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, Group, ListRow, EmptyState, SkeletonRows, SectionHeader, space } from '../design'
import { useList } from '../home/useList'
import { useAuth } from '../auth/AuthContext'
import { useVertical } from '../vertical/VerticalContext'
import { specFor } from './specs'
import { mayUse, rowCache, isWaiting, asWaiting } from './kit'
import { useOfflineQueue } from '../offline/OfflineContext'

export function LandscapingDay({ tab }: { tab?: boolean }) {
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const { queue } = useOfflineQueue()
  const route = specFor('landscaping-route')!
  const snow = specFor('landscaping-snow')!
  const showRoute = mayUse(route, can, hasFeature)
  const showSnow = mayUse(snow, can, hasFeature)
  const visits = useList(showRoute ? route.list.path : null, 100, route.pick)
  const stops = useList(showSnow ? snow.list.path : null, 100, snow.pick)
  const [refreshing, setRefreshing] = useState(false)
  const open = (spec: string, id: string) => router.push({ pathname: '/(details)/t/[spec]/[id]', params: { spec, id } } as any)
  const waiting = stops.rows.filter((s) => s.status === 'open' || s.status === 'working')
  const loading = (showRoute && visits.loading) || (showSnow && stops.loading)
  const error = visits.error || stops.error
  const refresh = async () => { setRefreshing(true); await Promise.all([visits.refresh(), stops.refresh()]); setRefreshing(false) }
  if (!showRoute && !showSnow) return <Screen title="Today's route" onBack={tab ? undefined : () => router.back()}><EmptyState icon="lock-closed" title="Not for this seat" body="Your role does not include this screen." /></Screen>
  return (
    <Screen title="Today's route" onBack={tab ? undefined : () => router.back()} refreshing={refreshing} onRefresh={refresh}>
      <View style={{ gap: space[4] }}>
        {loading ? <SkeletonRows count={5} />
          : error ? <EmptyState icon="alert-circle" title="Could not load your route" body={error} action="Try again" onAction={refresh} />
          : !waiting.length && !visits.rows.length ? <EmptyState icon="checkmark-circle" title="Nothing on your route today" body="Your visits for today show here, in the order to do them." />
          : (
            <>
              {waiting.length ? (
                <View style={{ gap: space[2] }}>
                  <SectionHeader title="Snow stops — log each one when it is done" />
                  <Group>{waiting.map((s, i) => { const r = asWaiting(snow.rows(s, {}), isWaiting(queue, snow.waitingKey?.(s))); rowCache.set(`${snow.id}:${r.id}`, s)
                    return <ListRow key={r.key} title={r.title} subtitle={r.subtitle} badge={r.badge} badgeTone={r.tone} divider={i < waiting.length - 1} onPress={() => open(snow.id, r.id)} /> })}</Group>
                </View>
              ) : null}
              {/* The day on a map, numbered, and the Finish Day recap (parity rows 11 and 14; crew_day_map, not ready). */}
              {showRoute && hasFeature('crew_day_map') ? (
                <Group><ListRow title="Map of my day and Finish Day" subtitle="Your stops on a map, in order, and how the day went" icon="map" divider={false} onPress={() => router.push('/(details)/route-day' as any)} /></Group>
              ) : null}
              {visits.rows.length ? (
                <View style={{ gap: space[2] }}>
                  <SectionHeader title="Today's visits, in order" />
                  <Group>{visits.rows.map((j, i) => { const r = asWaiting(route.rows(j, {}), isWaiting(queue, route.waitingKey?.(j))); rowCache.set(`${route.id}:${r.id}`, j)
                    return <ListRow key={r.key} title={`${i + 1}. ${r.title}`} subtitle={r.subtitle} meta={r.meta} badge={r.badge} badgeTone={r.tone} divider={i < visits.rows.length - 1} onPress={() => open(route.id, r.id)} /> })}</Group>
                </View>
              ) : null}
            </>
          )}
      </View>
    </Screen>
  )
}
