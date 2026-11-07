/**
 * Clock — clock in, the open clock, clock out, for the trades (field service, basic). The home care Clock tab is
 * app/(tabs)/time-clock.tsx (visits, Sandata); this is the same idea for a tech who is paid by the hour.
 *
 * Routes: GET /api/time/active, POST /api/time/clock-in { jobId?, at, place?, source }, POST /api/time/clock-out { at, place? },
 * POST /api/time/break/start and /break/end { at } (time:create — a break's minutes come off the hours), the same
 * the desktop's Time page uses. Each tap goes through the offline queue under `clock:<userId>` with the moment it was TAPPED
 * (`at`), so a tap made with no signal and sent later records when the work started or stopped; until sent it shows "Waiting to
 * send". A refused tap ("Couldn't send — tap to fix") says why in the server's words.
 * The job-site switch (clock me in and out at job sites) is the location card the Alerts tab has, shown here too: the
 * geofence opens this same clock (server crm/field/geofencing.ts).
 */
import React, { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { get } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useToast } from '../../src/components/ToastProvider'
import { ConfirmSheet } from '../../src/components/ConfirmSheet'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useOfflineApi } from '../../src/offline/useOfflineApi'
import { useOfflineQueue } from '../../src/offline/OfflineContext'
import { LocationCard } from '../../src/location/LocationCard'
import { clockKey, clockView, tapBody } from '../../src/jobflow/clock'
import { useVertical } from '../../src/vertical/VerticalContext'
import { cashCents, declaredBody } from '../../src/trades/shiftRequests'
import { tapPlace } from '../../src/location/tapPlace'
import { Screen, Card, DText, Badge, Button, Chip, ChipRow, TextField, space } from '../../src/design'
import { clockInExtras } from '../../src/trades/contractor'

const two = (n: number) => String(n).padStart(2, '0')
const elapsed = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` }
const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export default function ClockScreen() {
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { user, can } = useAuth()
  const { hasFeature } = useVertical()
  const userId = String((user as { id?: string } | null)?.id ?? '')
  const mayClock = can('time:create')
  // Cash tips at clock-out (restaurant-bar parity #16): the same route and gates as the desktop's clock page (POST /api/tips/declared/mine).
  const declares = can('bar:register') && hasFeature('bar_tip_pooling') && hasFeature('bar_declared_tips')
  const { queue, retry, discard } = useOfflineQueue()
  const { post } = useOfflineApi()
  const [active, setActive] = useState<any>(null)
  const [jobs, setJobs] = useState<Array<{ id: string; title: string; number?: string }>>([])
  const [jobId, setJobId] = useState<string | null>(null)
  // The contractor's clock (row 11, contractor_phone): hours against a project and one of its cost codes.
  const byProject = hasFeature('contractor_phone') && hasFeature('projects')
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [codes, setCodes] = useState<string[]>([])
  const [costCode, setCostCode] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outOpen, setOutOpen] = useState(false)
  const [note, setNote] = useState('')
  const [cash, setCash] = useState('')
  const [problem, setProblem] = useState('')
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    const [a, j] = await Promise.all([get('/api/time/active'), get('/api/jobs/today')])
    if (a.ok) setActive(a.data || null)
    if (j.ok) { const rows = Array.isArray(j.data) ? j.data : j.data?.data; if (Array.isArray(rows)) setJobs(rows.map((r: any) => ({ id: r.id, title: r.title, number: r.number }))) }
    if (byProject) {
      const p = await get('/api/projects?status=active&limit=50')
      if (p.ok) { const rows = Array.isArray(p.data) ? p.data : p.data?.data; if (Array.isArray(rows)) setProjects(rows.map((r: any) => ({ id: r.id, name: r.name || r.number }))) }
    }
    setLoaded(true)
  }, [byProject])
  // A project chosen: its cost codes, by name (the server's /api/project-phone answers names only).
  useEffect(() => {
    setCostCode(null); setCodes([])
    if (!projectId) return
    void get(`/api/project-phone/${projectId}/cost-codes`).then((r) => { if (r.ok && Array.isArray(r.data?.codes)) setCodes(r.data.codes) })
  }, [projectId])
  useEffect(() => { void load() }, [load])
  // What is waiting changes (sent, refused): read the server's clock again.
  const sig = queue.filter((q) => q.recordKey === clockKey(userId)).map((q) => `${q.id}:${q.state}`).join(',')
  useEffect(() => { void load() }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const iv = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(iv) }, [])

  const view = clockView(active, queue, userId)
  const key = { recordKey: clockKey(userId) }

  const tap = async (which: 'in' | 'out') => {
    setBusy(true); setProblem('')
    const tapped = new Date()
    const where = await tapPlace() // never asks, never holds the tap up
    const cents = which === 'out' && declares ? cashCents(cash) : null
    if (cents !== null && !Number.isFinite(cents)) { setBusy(false); setProblem('Type the cash tips in dollars, like 12.50, or leave the box empty.'); return }
    const r = which === 'in'
      ? await post('/api/time/clock-in', tapBody(tapped, { ...where, source: 'phone', ...clockInExtras(jobId, byProject ? projectId : null, costCode) }), { ...key, label: 'Clock in' })
      : await post('/api/time/clock-out', tapBody(tapped, { ...where, ...(note.trim() ? { description: note.trim() } : {}) }), { ...key, label: 'Clock out' })
    // The cash tips ride the same record key, so they are sent after the clock-out and land on the night it was tapped.
    let tipSaved = false
    if (cents && cents > 0 && (r.ok || r.queued)) {
      const t = await post('/api/tips/declared/mine', declaredBody(cents, tapped), { ...key, label: 'Cash tips' })
      if (!t.ok && !t.queued) setProblem(`Clocked out, but the cash tips did not save: ${t.error || 'try again from the Tips page'}`)
      else tipSaved = true
    }
    setBusy(false); setOutOpen(false)
    if (r.queued) { setCash(''); haptics.success(); toast.success(tipSaved ? 'Saved on the phone, with your cash tips — waiting to send' : 'Saved on the phone — waiting to send'); return }
    if (!r.ok) { haptics.error(); setProblem(r.error || 'That did not go through'); return }
    haptics.success()
    toast.success(r.data?.discarded ? 'That was under a minute, so no time was recorded' : which === 'in' ? 'Clocked in' : 'Clocked out')
    setNote(''); setCash(''); void load()
  }

  const takeBreak = async (which: 'start' | 'end') => {
    setBusy(true); setProblem('')
    const r = await post(`/api/time/break/${which}`, tapBody(new Date()), { ...key, label: which === 'start' ? 'Start break' : 'End break' })
    setBusy(false)
    if (r.queued) { haptics.success(); toast.success('Saved on the phone — waiting to send'); return }
    if (!r.ok) { haptics.error(); setProblem(r.error || 'That did not go through'); return }
    haptics.success()
    toast.success(which === 'start' ? 'Break started' : 'Break ended')
    void load()
  }

  return (
    <Screen title="Clock" onBack={() => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }}
      actions={can('time:update') ? [{ icon: 'checkmark-done', label: 'Approve hours', onPress: () => router.push('/(details)/office-time' as any) }] : undefined}>
      <Card>
        <View style={{ gap: space[3] }}>
          {view.canClockOut && view.since ? (
            <>
              <DText variant="overline" tone="textSecondary">Clocked in{view.waiting ? ' · waiting to send' : ''}</DText>
              <DText variant="stat">{elapsed(now - new Date(view.since).getTime())}</DText>
              <DText variant="callout" tone="textSecondary">Since {clockTime(view.since)}{active?.job?.title ? ` · ${active.job.title}` : ''}</DText>
              {view.onBreak && view.breakSince ? <Badge label={`On a break since ${clockTime(view.breakSince)}`} tone="warning" icon="cafe" /> : null}
            </>
          ) : view.state === 'out_waiting' ? (
            <>
              <DText variant="headline">Clocked out</DText>
              <Badge label="Waiting to send" tone="warning" icon="time" />
            </>
          ) : (
            <DText variant="headline">{loaded ? 'You are not clocked in' : 'Checking the clock…'}</DText>
          )}
          {view.refused ? (
            <View style={{ gap: space[2] }}>
              <Badge label={"Couldn't send — tap to fix"} tone="danger" icon="alert-circle" />
              <DText variant="callout" tone="danger">{view.refused.message}</DText>
              <View style={{ flexDirection: 'row', gap: space[2] }}>
                <Button variant="secondary" label="Try again" onPress={() => { void retry(view.refused!.id) }} />
                <Button variant="ghost" label="Drop it" onPress={() => { void discard(view.refused!.id) }} />
              </View>
            </View>
          ) : null}
          {problem ? <DText variant="callout" tone="danger">{problem}</DText> : null}
          {!mayClock ? <DText variant="callout" tone="textSecondary">Your seat can look at hours but not clock in.</DText> : null}
          {mayClock && view.canClockIn ? (
            <>
              {jobs.length ? (
                <View style={{ gap: space[1] }}>
                  <DText variant="captionStrong" tone="textSecondary">Which job? (optional)</DText>
                  <ChipRow>
                    <Chip label="No job" selected={!jobId} onPress={() => setJobId(null)} />
                    {jobs.map((j) => <Chip key={j.id} label={j.title} selected={jobId === j.id} onPress={() => setJobId(j.id)} />)}
                  </ChipRow>
                </View>
              ) : null}
              {byProject && projects.length ? (
                <View style={{ gap: space[1] }}>
                  <DText variant="captionStrong" tone="textSecondary">Which project? (optional)</DText>
                  <ChipRow>
                    <Chip label="No project" selected={!projectId} onPress={() => setProjectId(null)} />
                    {projects.map((p) => <Chip key={p.id} label={p.name} selected={projectId === p.id} onPress={() => setProjectId(p.id)} />)}
                  </ChipRow>
                  {projectId && codes.length ? (
                    <>
                      <DText variant="captionStrong" tone="textSecondary">Cost code</DText>
                      <ChipRow>
                        <Chip label="None" selected={!costCode} onPress={() => setCostCode(null)} />
                        {codes.map((c) => <Chip key={c} label={c} selected={costCode === c} onPress={() => setCostCode(c)} />)}
                      </ChipRow>
                    </>
                  ) : null}
                </View>
              ) : null}
              <Button size="lg" fullWidth label="Clock in" icon="play" loading={busy} onPress={() => tap('in')} />
            </>
          ) : null}
          {mayClock && view.canStartBreak ? <Button size="lg" fullWidth variant="secondary" label="Start break" icon="cafe" loading={busy} onPress={() => takeBreak('start')} /> : null}
          {mayClock && view.canEndBreak ? <Button size="lg" fullWidth variant="secondary" label="End break" icon="cafe" loading={busy} onPress={() => takeBreak('end')} /> : null}
          {mayClock && view.canClockOut ? <Button size="lg" fullWidth variant="danger" label="Clock out" icon="stop-circle" onPress={() => setOutOpen(true)} /> : null}
        </View>
      </Card>
      <LocationCard />
      <ConfirmSheet visible={outOpen} onClose={() => setOutOpen(false)} onConfirm={() => tap('out')} title="Clock out?"
        description="Your time stops now. Add a note for the office if you like." confirmLabel="Clock out" destructive />
      {outOpen ? <TextField label="Note for the office (optional)" value={note} onChangeText={setNote} multiline /> : null}
      {outOpen && declares ? <TextField label="Cash tips you were handed tonight, in dollars (optional)" value={cash} onChangeText={setCash} keyboardType="decimal-pad" /> : null}
    </Screen>
  )
}
