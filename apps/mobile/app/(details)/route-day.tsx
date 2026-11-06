/**
 * The crew's day on one screen (landscaping parity rows 11 and 14; Jobber's map, Service Autopilot's map and "Finish Day"):
 *   · the day's stops on a map, numbered in route order — done green, could-not-do red, the NEXT stop orange — drawn by the server
 *     (GET /api/crew-day/day/map: Google's map with the server's key, which never reaches the phone);
 *   · the stops listed in the same order, the next one first to tap, each opening its visit;
 *   · the Finish Day recap: done, could not do, still to do, hours, the customer notes still to write (GET /api/crew-day/day).
 * Directions go to the crew's own maps app from each visit (row 11, ../../src/trades/DirectionsSheet.tsx): spoken turn-by-turn is the
 * maps apps' own. Feature crew_day_map (not ready).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Image, View } from 'react-native'
import { useRouter } from 'expo-router'
import { get, getApiUrl, getAccessToken } from '../../src/api/client'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useAuth } from '../../src/auth/AuthContext'
import { rowCache } from '../../src/trades/kit'
import { recapLines } from '../../src/trades/crewDay'
import { Screen, Card, Group, ListRow, DText, EmptyState, SkeletonRows, SectionHeader, space, radius } from '../../src/design'

export default function RouteDay() {
  const router = useRouter()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const [day, setDay] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [mapFailed, setMapFailed] = useState(false)
  const [stamp, setStamp] = useState(Date.now())
  const load = useCallback(async () => {
    const r = await get('/api/crew-day/day')
    if (!r.ok) { setError(r.error || 'Could not load your day'); return }
    setError(null); setDay((r.data as any)?.data ?? r.data); setMapFailed(false); setStamp(Date.now())
  }, [])
  useEffect(() => { load() }, [load])
  if (!hasFeature('crew_day_map') || !can('jobs:read')) return <Screen title="My day" onBack={() => router.back()}><EmptyState icon="lock-closed" title="Not available" body="Your business has not turned on the map of the day for your seat." /></Screen>
  const token = getAccessToken()
  const map = { uri: `${getApiUrl()}/api/crew-day/day/map?v=${stamp}`, ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) }
  // The visit opens from the route list's own copy when it has one (phone number and all); else from this day's.
  const open = (s: any) => { const k = `landscaping-route:${s.id}`; if (!rowCache.has(k)) rowCache.set(k, { ...s, contact: { name: s.name }, address: s.place }); router.push({ pathname: '/(details)/t/[spec]/[id]', params: { spec: 'landscaping-route', id: s.id } } as any) }
  return (
    <Screen title="My day" onBack={() => router.back()} refreshing={false} onRefresh={load}>
      {error ? <EmptyState icon="alert-circle" title="Could not load your day" body={error} action="Try again" onAction={load} />
        : !day ? <SkeletonRows count={5} /> : (
          <View style={{ gap: space[4] }}>
            {day.stops.length ? (
              <Card padded={false}>
                {day.mapReady && !mapFailed
                  ? <Image source={map} style={{ width: '100%', aspectRatio: 1, borderRadius: radius.md }} resizeMode="cover" onError={() => setMapFailed(true)} accessibilityLabel={`Map of today's ${day.stops.length} stops, numbered in order`} />
                  : <View style={{ padding: space[3] }}><DText variant="callout" tone="textSecondary">{day.mapReady ? 'The map could not be loaded. The stops are listed below.' : 'The map is not set up for your business yet. The stops are listed below.'}</DText></View>}
              </Card>
            ) : null}
            <View style={{ gap: space[2] }}>
              <SectionHeader title="Finish Day" />
              <Card><View style={{ gap: space[1] }}>{recapLines(day.recap).map((l) => <DText key={l} variant="body">{l}</DText>)}</View></Card>
              {day.recap.notesOutstanding.length ? <Group>{day.recap.notesOutstanding.map((n: any, i: number) => <ListRow key={n.id} title={`Write a note for ${n.name}`} icon="chatbox-ellipses" divider={i < day.recap.notesOutstanding.length - 1} onPress={() => open(day.stops.find((s: any) => s.id === n.id) || n)} />)}</Group> : null}
            </View>
            {day.stops.length ? (
              <View style={{ gap: space[2] }}>
                <SectionHeader title="Stops, in order" />
                <Group>{day.stops.map((s: any, i: number) => (
                  <ListRow key={s.id} title={`${s.n}. ${s.name}`} subtitle={s.place || undefined}
                    badge={s.skipped ? 'Could not do' : s.status === 'completed' ? 'Done' : s.id === day.nextId ? 'Next' : undefined}
                    badgeTone={s.skipped ? 'danger' : s.status === 'completed' ? 'success' : s.id === day.nextId ? 'warning' : 'neutral'}
                    divider={i < day.stops.length - 1} onPress={() => open(s)} />
                ))}</Group>
              </View>
            ) : <EmptyState icon="checkmark-circle" title="Nothing on your route today" body="Your visits for today show here, in the order to do them." />}
          </View>
        )}
    </Screen>
  )
}
