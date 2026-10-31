/**
 * Canvass — roofing door-to-door canvassing with GPS, with or without signal.
 *
 * The unified server's canvassing (server/crm/roof/field/canvassing.ts, feature canvassing_tool):
 *   · POST /api/canvassing/sessions { id, name, centerLat, centerLng, startedAt } starts a session — the canvasser's own. The
 *     phone makes the id, so the doors logged before the server has heard of the session already name it;
 *   · POST /api/canvassing/sessions/:id/stops { outcome, address, lat, lng, homeownerName, phone, email, notes, photos,
 *     visitedAt } logs a door. outcome is one of no_answer, not_interested, interested, appointment_set,
 *     already_has_contractor, vacant (validation.ts CANVASSING_OUTCOMES). An interested door that left a phone or an email
 *     becomes a homeowner and a roofing job at `lead` on the server — the reply carries its jobId. Its photos are uploaded
 *     first (POST /sessions/:id/photos), from the camera's files, just before the door is sent (src/offline/localPhotos.ts);
 *   · POST /api/canvassing/sessions/:id/end { endedAt } closes it with its counts; GET /sessions?mine=1 + GET /sessions/:id
 *     bring an open session back after the app was closed.
 * Every write goes through the offline queue (src/offline), all under one record per session (`canvass:<id>`), so the
 * session goes before its doors and the end after them, and nothing is lost without signal; a refused one is kept and
 * shown in the queue's list. The open session and its doors are also kept on the phone, so a restart with no signal
 * carries on. The field seat holds canvassing:create/update; the read-only viewer does not, and is not offered the buttons.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Image,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useTheme } from '../../src/theme/ThemeContext'
import { ACTION } from '../../src/theme/actions'
import { get } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useLocation } from '../../src/hooks/useLocation'
import { useCamera } from '../../src/hooks/useCamera'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useToast } from '../../src/components/ToastProvider'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { EmptyState } from '../../src/components/EmptyState'
import { useOfflineApi } from '../../src/offline/useOfflineApi'
import { useOfflineQueue } from '../../src/offline/OfflineContext'
import {
  canvassKey, doorRequest, endRequest, newSessionId, openCanvassStoreKey, startRequest, wantsLead, MAX_DOOR_PHOTOS,
  type LocalDoor, type OpenCanvass, type Outcome,
} from '../../src/canvass/offlineCanvass'

const OUTCOMES: { key: Outcome; label: string; icon: string; color: string }[] = [
  { key: 'interested', label: 'Interested', icon: 'checkmark-circle', color: ACTION.green },
  { key: 'appointment_set', label: 'Appointment', icon: 'calendar', color: ACTION.sky },
  { key: 'no_answer', label: 'No Answer', icon: 'home', color: '#b45309' },
  { key: 'not_interested', label: 'No Thanks', icon: 'close-circle', color: ACTION.red },
  { key: 'already_has_contractor', label: 'Has Roofer', icon: 'people', color: ACTION.slate },
  { key: 'vacant', label: 'Vacant', icon: 'remove-circle', color: '#94a3b8' },
]
const COLOR: Record<string, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.color]))
const LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label]))
const serverDoor = (s: any): LocalDoor => ({ id: s.id, address: s.address ?? null, outcome: s.outcome, visitedAt: s.visitedAt, jobId: s.jobId ?? null })

export default function CanvassScreen() {
  const t = useTheme()
  const router = useRouter()
  const haptics = useHaptics()
  const toast = useToast()
  const { can, user } = useAuth()
  const userId = (user as { id?: string } | null)?.id ?? null
  const { hasFeature } = useVertical()
  const enabled = hasFeature('canvassing_tool')
  const canLog = can('canvassing:create')
  const { requestLocation, loading: locLoading } = useLocation()
  const { takePhoto, loading: camLoading } = useCamera()
  const offline = useOfflineApi()
  const { queue, syncNow, isSyncing } = useOfflineQueue()
  const [session, setSession] = useState<OpenCanvass['session'] | null>(null)
  const [doors, setDoors] = useState<LocalDoor[]>([])
  const [restoring, setRestoring] = useState(true)
  const [busy, setBusy] = useState(false)
  const [address, setAddress] = useState('')
  const [homeowner, setHomeowner] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<string[]>([])
  const restored = useRef(false)

  const mine = session ? queue.filter((q) => q.recordKey === canvassKey(session.id)) : []
  const waiting = mine.filter((q) => q.state !== 'failed').length
  const refused = mine.filter((q) => q.state === 'failed').length

  /** The session as the server has it, once nothing of it waits on the phone: real ids, real leads. */
  const refresh = useCallback(async (id: string) => {
    const one = await get(`/api/canvassing/sessions/${encodeURIComponent(id)}`)
    if (!one.ok) return
    if (one.data?.status && one.data.status !== 'active') { setSession(null); setDoors([]); return }
    setSession((s) => (s && s.id === id ? { ...s, name: one.data?.name || s.name } : s))
    setDoors(Array.isArray(one.data?.stops) ? one.data.stops.map(serverDoor) : [])
  }, [])

  // An open session comes back after the app was closed — first as the phone kept it (it may never have reached the
  // server), else the one the server has open for this canvasser.
  const restore = useCallback(async () => {
    if (!enabled || !userId) { setRestoring(false); return }
    let kept: OpenCanvass | null = null
    try { const raw = await AsyncStorage.getItem(openCanvassStoreKey(userId)); kept = raw ? JSON.parse(raw) : null } catch { kept = null }
    if (kept?.session?.id) {
      setSession(kept.session); setDoors(Array.isArray(kept.doors) ? kept.doors : [])
    } else {
      const res = await get('/api/canvassing/sessions?mine=1')
      const open = res.ok && Array.isArray(res.data?.data) ? res.data.data.find((s: any) => s.status === 'active') : null
      if (open) { setSession({ id: open.id, name: open.name, startedAt: open.startedAt }); await refresh(open.id) }
    }
    restored.current = true
    setRestoring(false)
  }, [enabled, userId, refresh])

  useEffect(() => { restore() }, [restore])

  // Kept on the phone as it changes, so a restart with no signal carries on where it was.
  useEffect(() => {
    if (!restored.current || !userId) return
    const key = openCanvassStoreKey(userId)
    if (session) AsyncStorage.setItem(key, JSON.stringify({ session, doors } satisfies OpenCanvass)).catch(() => {})
    else AsyncStorage.removeItem(key).catch(() => {})
  }, [session, doors, userId])

  // When the last of the session's saves has been sent, the screen takes the server's version.
  const signature = mine.map((q) => `${q.id}:${q.state}`).join(',')
  useEffect(() => {
    if (!session || !restored.current) return
    setDoors((list) => list.map((d) => (d.waiting && d.queueId && !mine.some((q) => q.id === d.queueId) ? { ...d, waiting: false } : d)))
    if (!mine.length) void refresh(session.id)
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const startSession = async () => {
    const loc = await requestLocation()
    if (!loc) { toast.error('Location needed for canvassing'); return }
    setBusy(true)
    const id = newSessionId()
    const name = `Canvass — ${new Date().toLocaleDateString()}`
    const startedAt = new Date()
    const req = startRequest(id, name, startedAt, loc)
    const res = await offline.post(req.path, req.body, { recordKey: req.recordKey, label: req.label })
    setBusy(false)
    if (!res.ok) { haptics.error(); toast.error(res.error || 'Could not start the session'); return }
    haptics.success()
    setSession({ id, name, startedAt: startedAt.toISOString() })
    setDoors([])
    toast.success(res.queued ? 'Session started on this phone — it is sent when there is signal' : 'Canvassing session started')
  }

  const endSession = async () => {
    if (!session) return
    setBusy(true)
    const req = endRequest(session.id, session.name, new Date())
    const res = await offline.post(req.path, req.body, { recordKey: req.recordKey, label: req.label })
    setBusy(false)
    if (!res.ok) { haptics.error(); toast.error(res.error || 'Could not end the session'); return }
    haptics.medium()
    if (res.queued) toast.info(`Session ended on this phone — ${doors.length} doors, sent when there is signal`)
    else toast.info(`Session ended — ${res.data?.totalDoors ?? doors.length} doors, ${res.data?.leadsCreated ?? 0} leads`)
    setSession(null)
    setDoors([])
    setPhotos([])
  }

  const addPhoto = async () => {
    if (photos.length >= MAX_DOOR_PHOTOS) { toast.warning(`A door keeps at most ${MAX_DOOR_PHOTOS} photos`); return }
    const shot = await takePhoto()
    if (shot?.uri) setPhotos((p) => (p.length < MAX_DOOR_PHOTOS ? [...p, shot.uri] : p))
  }

  const logStop = async (outcome: Outcome) => {
    if (!session) return
    if (!address.trim()) { toast.warning('Enter an address first'); return }
    if (wantsLead(outcome) && !phone.trim() && !email.trim()) {
      toast.warning('Add a phone or email so this door becomes a lead')
      return
    }
    haptics.light()
    setBusy(true)
    const loc = await requestLocation()
    const visitedAt = new Date()
    const req = doorRequest(session.id, {
      outcome, address, homeownerName: homeowner, phone, email, notes, photoUris: photos,
      ...(loc ? { lat: loc.latitude, lng: loc.longitude } : {}),
    }, visitedAt)
    const res = await offline.post(req.path, req.body, { recordKey: req.recordKey, label: req.label })
    setBusy(false)
    if (!res.ok) { haptics.error(); toast.error(res.error || 'That door was not saved'); return }
    if (res.queued) {
      setDoors(prev => [{ id: res.queueId || `local-${visitedAt.getTime()}`, address: address.trim(), outcome, visitedAt: visitedAt.toISOString(), waiting: true, queueId: res.queueId }, ...prev])
      toast.success(`Saved on this phone — ${address.trim()}`)
    } else {
      setDoors(prev => [serverDoor(res.data), ...prev])
      toast.success(res.data?.jobId ? `Lead created — ${res.data.address}` : `${LABEL[outcome]} — ${res.data?.address || ''}`)
    }
    setAddress(''); setHomeowner(''); setPhone(''); setEmail(''); setNotes(''); setPhotos([])
  }

  if (!enabled) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <EmptyState icon="walk-outline" title="Canvassing is not switched on" subtitle="The owner can turn on the canvassing tool in the web app." />
      </View>
    )
  }

  if (restoring) {
    return (
      <View style={[styles.safe, { backgroundColor: t.background }]}>
        <View style={styles.startContainer}><ActivityIndicator color={t.primary} /></View>
      </View>
    )
  }

  const answered = doors.filter(s => s.outcome !== 'no_answer').length
  const leads = doors.filter(s => s.jobId).length

  return (
    <View style={[styles.safe, { backgroundColor: t.background }]}>
      {!session ? (
        <View style={styles.startContainer}>
          <View style={[styles.startCircle, { backgroundColor: t.primaryLight }]}>
            <Ionicons name="walk" size={64} color={t.primary} />
          </View>
          <Text style={[styles.startTitle, { color: t.text }]}>Door-to-Door Canvassing</Text>
          <Text style={[styles.startSub, { color: t.textSecondary }]}>
            Log every door, and an interested homeowner becomes a lead on the pipeline.
          </Text>
          {canLog ? (
            <TouchableOpacity
              style={[styles.startBtn, { backgroundColor: t.primary }]}
              onPress={startSession}
              disabled={locLoading || busy}
              activeOpacity={0.85}
            >
              <Ionicons name="play" size={22} color={t.onPrimary} />
              <Text style={[styles.startBtnText, { color: t.onPrimary }]}>{locLoading ? 'Getting location...' : 'Start Canvassing'}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.startSub, { color: t.textMuted }]}>Your role can view canvassing but not log doors.</Text>
          )}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          {/* Stats bar */}
          <View style={[styles.statsBar, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: t.primaryText }]}>{doors.length}</Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Doors</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: t.primaryText }]}>{answered}</Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Answered</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: t.primaryText }]}>{leads}</Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Leads</Text>
            </View>
            {canLog && (
              <TouchableOpacity onPress={endSession} style={styles.endBtn} disabled={busy}>
                <Ionicons name="stop-circle" size={28} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>

          {(waiting > 0 || refused > 0) && (
            <View style={[styles.queueStrip, { backgroundColor: t.surface, borderColor: t.border }]} accessibilityLiveRegion="polite">
              <Ionicons name={refused ? 'alert-circle' : 'cloud-upload-outline'} size={18} color={refused ? '#ef4444' : t.textSecondary} />
              <Text style={[styles.queueText, { color: t.text }]}>
                {waiting > 0 ? `${waiting} waiting to send` : ''}{waiting > 0 && refused > 0 ? ' \u00b7 ' : ''}{refused > 0 ? `${refused} could not be sent \u2014 see the waiting list` : ''}
              </Text>
              {waiting > 0 && (
                <TouchableOpacity onPress={() => { void syncNow() }} disabled={isSyncing} accessibilityRole="button" style={[styles.sendNow, { borderColor: t.primary }]}>
                  <Text style={{ color: t.primaryText, fontWeight: '600', fontSize: 13 }}>{isSyncing ? 'Sending\u2026' : 'Send now'}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {canLog && (
              <>
                <TextInput
                  style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
                  value={address} onChangeText={setAddress}
                  placeholder="Address *" placeholderTextColor={t.textMuted}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    style={[styles.input, { flex: 1, backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
                    value={homeowner} onChangeText={setHomeowner}
                    placeholder="Homeowner" placeholderTextColor={t.textMuted}
                  />
                  <TextInput
                    style={[styles.input, { flex: 1, backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
                    value={phone} onChangeText={setPhone} keyboardType="phone-pad"
                    placeholder="Phone" placeholderTextColor={t.textMuted}
                  />
                </View>
                <TextInput
                  style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
                  value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
                  placeholder="Email" placeholderTextColor={t.textMuted}
                />
                <TextInput
                  style={[styles.input, { backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
                  value={notes} onChangeText={setNotes}
                  placeholder="Notes" placeholderTextColor={t.textMuted}
                />
                <View style={styles.photoRow}>
                  {photos.map((uri, i) => (
                    <TouchableOpacity key={uri} onPress={() => setPhotos((p) => p.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`}>
                      <Image source={{ uri }} style={styles.photoThumb} />
                    </TouchableOpacity>
                  ))}
                  {photos.length < MAX_DOOR_PHOTOS && (
                    <TouchableOpacity onPress={addPhoto} disabled={camLoading} accessibilityRole="button" accessibilityLabel="Add a photo of the damage"
                      style={[styles.photoAdd, { borderColor: t.border, backgroundColor: t.surface }]}>
                      <Ionicons name="camera-outline" size={22} color={t.textSecondary} />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.resultBtns}>
                  {OUTCOMES.map(btn => (
                    <TouchableOpacity
                      key={btn.key}
                      style={[styles.resultBtn, { borderColor: btn.color, opacity: busy ? 0.5 : 1 }]}
                      onPress={() => logStop(btn.key)}
                      disabled={busy}
                    >
                      <Ionicons name={btn.icon as any} size={16} color={btn.color} />
                      <Text style={[styles.resultLabel, { color: btn.color }]}>{btn.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {doors.map((stop, idx) => (
              <AnimatedCard key={stop.id} index={idx}>
                <TouchableOpacity
                  disabled={!stop.jobId}
                  onPress={() => stop.jobId && router.push(`/(details)/job/${stop.jobId}`)}
                  style={[styles.knockCard, { backgroundColor: t.surface, borderColor: t.border }]}
                >
                  <View style={[styles.knockDot, { backgroundColor: COLOR[stop.outcome] || t.textMuted }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.knockAddr, { color: t.text }]}>{stop.address || 'No address'}</Text>
                    <Text style={[styles.knockResult, { color: COLOR[stop.outcome] || t.textMuted }]}>
                      {LABEL[stop.outcome] || String(stop.outcome).replace(/_/g, ' ')}{stop.jobId ? ' • lead created' : ''}{stop.waiting ? ' • waiting to send' : ''}
                    </Text>
                  </View>
                  <Text style={[styles.knockTime, { color: t.textMuted }]}>
                    {new Date(stop.visitedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </TouchableOpacity>
              </AnimatedCard>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  startContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  startCircle: { width: 120, height: 120, borderRadius: 60, alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  startTitle: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  startSub: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 32, maxWidth: 280 },
  startBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 32, paddingVertical: 16, borderRadius: 14,
  },
  startBtnText: { fontSize: 17, fontWeight: '700' },
  statsBar: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 2 },
  endBtn: { padding: 8 },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, marginBottom: 8,
  },
  resultBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  resultBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1,
    flexGrow: 1,
  },
  resultLabel: { fontSize: 12, fontWeight: '600' },
  knockCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 6,
  },
  knockDot: { width: 8, height: 8, borderRadius: 4 },
  knockAddr: { fontSize: 14, fontWeight: '500' },
  knockResult: { fontSize: 12, marginTop: 1 },
  knockTime: { fontSize: 12 },
  queueStrip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1 },
  queueText: { flex: 1, fontSize: 13 },
  sendNow: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  photoThumb: { width: 56, height: 56, borderRadius: 8 },
  photoAdd: { width: 56, height: 56, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
