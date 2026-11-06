/**
 * Each crew member's own clock on a visit (landscaping parity row 15; LMN Crew): the crew lead starts and stops each person on the
 * visit — logins and roster members alike — at the moment tapped. With no signal each tap is kept on the phone and sent later in
 * order, shown as waiting. Their hours are the visit's man-hours, read against its time allowed for the Crew Score (the office's
 * Route Board). Feature crew_timers (not ready).
 *   GET /api/crew-day/visits/:jobId/crew, POST …/crew/:key/start|stop   (jobs:read / jobs:update, the seat's own visits)
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useToast } from '../../src/components/ToastProvider'
import { useOfflineApi } from '../../src/offline/useOfflineApi'
import { useOfflineQueue } from '../../src/offline/OfflineContext'
import { clocksWithWaiting, crewClockRequest, crewKey, hoursWords } from '../../src/trades/crewDay'
import { Screen, Card, Button, DText, EmptyState, SkeletonRows, space } from '../../src/design'

export default function VisitCrew() {
  const router = useRouter()
  const toast = useToast()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const { jobId } = useLocalSearchParams<{ jobId: string }>()
  const offline = useOfflineApi()
  const { queue } = useOfflineQueue()
  const [people, setPeople] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!jobId) return
    const r = await get(`/api/crew-day/visits/${jobId}/crew`)
    if (!r.ok) { setError(r.error || 'Could not load the crew'); return }
    setError(null); setPeople(Array.isArray((r.data as any)?.data) ? (r.data as any).data : [])
  }, [jobId])
  useEffect(() => { load() }, [load])
  if (!jobId || !hasFeature('crew_timers') || !can('jobs:read')) return <Screen title="Crew clocks" onBack={() => router.back()}><EmptyState icon="lock-closed" title="Not available" body="Your business has not turned on crew clocks for your seat." /></Screen>
  const tap = async (p: any, action: 'start' | 'stop') => {
    setBusy(p.key)
    const req = crewClockRequest(String(jobId), p.key, action)
    const r = await offline.post(req.path, req.body, { recordKey: crewKey(String(jobId)), label: `${p.name} · clock ${action === 'start' ? 'started' : 'stopped'}` })
    setBusy(null)
    if (r.queued) toast.show('Saved on your phone. It will be sent when you have signal.', 'info')
    else if (!r.ok) { toast.show(r.error || 'Not saved', 'error'); return }
    load()
  }
  const shown = people ? clocksWithWaiting(people, queue as any, String(jobId)) : null
  return (
    <Screen title="Crew clocks" onBack={() => router.back()}>
      {error ? <EmptyState icon="alert-circle" title="Could not load" body={error} action="Try again" onAction={load} />
        : !shown ? <SkeletonRows count={3} />
        : !shown.length ? <EmptyState icon="people" title="No one is on this visit" body="The office puts the crew on the visit; then each person's clock shows here." />
        : (
          <View style={{ gap: space[3] }}>
            {shown.map((p) => (
              <Card key={p.key}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <DText variant="bodyStrong">{p.name}</DText>
                    <DText variant="callout" tone={p.waiting ? 'warning' : 'textSecondary'}>{p.waiting ? 'Waiting to send' : p.running ? 'On the clock' : 'Off the clock'} · {hoursWords(p.hours)} so far</DText>
                  </View>
                  {can('jobs:update') ? <Button label={p.running ? 'Stop' : 'Start'} icon={p.running ? 'stop' : 'play'} variant={p.running ? 'secondary' : 'primary'} loading={busy === p.key} onPress={() => tap(p, p.running ? 'stop' : 'start')} /> : null}
                </View>
              </Card>
            ))}
            <DText variant="caption" tone="textSecondary">Each person's hours on this visit count toward the crew's score against the time allowed.</DText>
          </View>
        )}
    </Screen>
  )
}
