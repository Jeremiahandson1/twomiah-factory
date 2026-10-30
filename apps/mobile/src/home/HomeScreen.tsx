/**
 * The home: tiles for THIS seat in THIS business (src/home/tiles.ts — the desktop's rules), each opening exactly what it counts.
 * Owner, admin and manager share one home; a field seat (staff) gets quick actions and "Your day"; a viewer sees the tiles only.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { useAuth } from '../auth/AuthContext'
import { isFieldRole } from '../auth/roles'
import { useVertical } from '../vertical/VerticalContext'
import { useTheme } from '../theme/ThemeContext'
import { get } from '../api/client'
import { useRealTimeEvent, EVENTS } from '../socket/SocketContext'
import { statCardWidth } from '../theme/insets'
import { Screen, StatTile, SectionHeader, Group, ListRow, EmptyState, SkeletonRows, Button, layout, space, DText } from '../design'
import { sourcesFor, resolveTiles, roofStages, type Shown } from './tiles'
import { tileRoute } from './useTile'
import { useStageName } from '../pipeline/useStageName'

const QUICK: { label: string; icon: string; any: string[]; to: string; verticals?: string[] }[] = [
  { label: 'New job', icon: 'add-circle', any: ['jobs:create'], to: '/(tabs)/jobs', verticals: ['contractor', 'basic', 'landscaping', 'roofing'] },
  { label: 'New quote', icon: 'document-text', any: ['quotes:create'], to: '/(tabs)/quotes', verticals: ['contractor', 'basic', 'landscaping', 'roofing', 'fieldservice', 'rv', 'homecare'] },
  { label: 'Contacts', icon: 'people', any: ['contacts:read'], to: '/(tabs)/contacts', verticals: ['contractor', 'basic', 'landscaping', 'roofing', 'fieldservice', 'rv', 'homecare'] },
]

export default function HomeScreen() {
  const router = useRouter()
  const t = useTheme()
  const { user, can } = useAuth()
  const { vertical, hasFeature } = useVertical()
  const { stageName } = useStageName()
  const { width } = useWindowDimensions()
  const [answers, setAnswers] = useState<Record<string, any>>({})
  const [today, setToday] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const field = isFieldRole(user?.role)
  const ctx = useMemo(() => ({ can, hasFeature }), [can, hasFeature])

  const load = useCallback(async () => {
    const sources = sourcesFor(vertical, ctx)
    const got = await Promise.all(sources.map((s) => get(s)))
    const next: Record<string, any> = {}
    sources.forEach((s, i) => { if (got[i].ok) next[s] = got[i].data })
    // The tile endpoints are one request per tile: asked for their own count.
    setAnswers(next)
    // "Your day": today's jobs for the shared jobs module (roofing, RV and home care have their own screens for it).
    if (field && (vertical === 'contractor' || vertical === 'basic' || vertical === 'fieldservice' || vertical === 'landscaping') && can('jobs:read')) {
      const j = await get('/api/jobs/today')
      if (j.ok && Array.isArray(j.data)) setToday(j.data)
    }
    setLoading(false)
  }, [vertical, ctx, field, can])
  useEffect(() => { load() }, [load])
  useRealTimeEvent(EVENTS.JOB_UPDATED, load)
  useRealTimeEvent(EVENTS.JOB_CREATED, load)

  const shown: Shown[] = useMemo(() => resolveTiles(vertical, ctx, answers), [vertical, ctx, answers])
  const stages = useMemo(() => (vertical === 'roofing' && can('jobs:read') ? roofStages(answers['/api/dashboard/stats'], hasFeature, (s) => stageName(s)) : []), [vertical, answers, can, hasFeature, stageName])
  const w = statCardWidth(width)
  const quick = QUICK.filter((q) => q.any.some((p) => can(p)) && (!q.verticals || q.verticals.includes(vertical)))

  return (
    <Screen title={`Hi, ${user?.firstName || 'there'}`} subtitle={t.companyName} refreshing={refreshing}
      onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }}>
      {loading ? <SkeletonRows count={4} /> : (
        <View style={{ gap: layout.sectionGap }}>
          {shown.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: layout.tileGap }}>
              {shown.map((s) => (
                <StatTile key={s.def.id} width={w} label={s.def.label} value={s.text} icon={s.def.icon} tone={s.def.tone} opens={s.def.opens}
                  onPress={() => router.push(tileRoute(s.def, vertical) as any)} />
              ))}
            </View>
          ) : <EmptyState icon="grid" title="Nothing to show yet" body="Your numbers appear here as soon as there is work to count." />}

          {stages.length > 0 ? (
            <View>
              <SectionHeader title="Pipeline" />
              <Group>
                {stages.map((s, i) => (
                  <ListRow key={s.id} title={s.label} meta={String(s.count)} divider={i < stages.length - 1}
                    onPress={() => router.push({ pathname: '/(tabs)/jobs', params: { status: s.id } } as any)} />
                ))}
              </Group>
            </View>
          ) : null}

          {field && quick.length > 0 ? (
            <View style={{ gap: space[2] }}>
              <SectionHeader title="Quick actions" />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                {quick.map((q) => <Button key={q.label} label={q.label} icon={q.icon} variant="tonal" onPress={() => router.push(q.to as any)} />)}
              </View>
            </View>
          ) : null}

          {field && today.length > 0 ? (
            <View>
              <SectionHeader title="Your day" />
              <Group>
                {today.slice(0, 5).map((j, i, a) => (
                  <ListRow key={j.id} title={j.title} subtitle={[j.number, j.scheduledTime].filter(Boolean).join(' · ')} meta={j.city || undefined}
                    divider={i < a.length - 1} onPress={() => router.push(`/(details)/job/${j.id}` as any)} />
                ))}
              </Group>
            </View>
          ) : field && !['homecare', 'salon', 'restaurant', 'bar', 'store', 'vet'].includes(vertical) ? <DText variant="callout" tone="textSecondary">Nothing scheduled for you today.</DText> : null}
        </View>
      )}
    </Screen>
  )
}
