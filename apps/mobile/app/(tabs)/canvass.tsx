/**
 * Canvass — roofing door-to-door canvassing with GPS.
 *
 * The unified server's canvassing (server/crm/roof/field/canvassing.ts, feature canvassing_tool):
 *   · POST /api/canvassing/sessions { name, centerLat, centerLng } starts a session — the canvasser's own;
 *   · POST /api/canvassing/sessions/:id/stops { outcome, address, lat, lng, homeownerName, phone, email, notes } logs a
 *     door. outcome is one of no_answer, not_interested, interested, appointment_set, already_has_contractor, vacant
 *     (validation.ts CANVASSING_OUTCOMES). An interested door that left a phone or an email becomes a homeowner and a
 *     roofing job at `lead` on the server — the reply carries its jobId;
 *   · POST /api/canvassing/sessions/:id/end closes it with its counts; GET /sessions?mine=1 + GET /sessions/:id bring an
 *     open session back after the app was closed.
 * The field seat holds canvassing:create/update; the read-only viewer does not, and is not offered the buttons.
 * There was no /api/canvassing/knocks: every knock this screen "logged" was dropped, and the session lived only in memory.
 */

import React, { useState, useCallback, useEffect } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { post, get } from '../../src/api/client'
import { useAuth } from '../../src/auth/AuthContext'
import { useVertical } from '../../src/vertical/VerticalContext'
import { useLocation } from '../../src/hooks/useLocation'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useToast } from '../../src/components/ToastProvider'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { EmptyState } from '../../src/components/EmptyState'

type Outcome = 'interested' | 'appointment_set' | 'no_answer' | 'not_interested' | 'already_has_contractor' | 'vacant'

interface Stop {
  id: string
  address: string | null
  outcome: Outcome
  visitedAt: string
  jobId?: string | null
}

const OUTCOMES: { key: Outcome; label: string; icon: string; color: string }[] = [
  { key: 'interested', label: 'Interested', icon: 'checkmark-circle', color: '#22c55e' },
  { key: 'appointment_set', label: 'Appointment', icon: 'calendar', color: '#0ea5e9' },
  { key: 'no_answer', label: 'No Answer', icon: 'home', color: '#f59e0b' },
  { key: 'not_interested', label: 'No Thanks', icon: 'close-circle', color: '#ef4444' },
  { key: 'already_has_contractor', label: 'Has Roofer', icon: 'people', color: '#8b5cf6' },
  { key: 'vacant', label: 'Vacant', icon: 'remove-circle', color: '#94a3b8' },
]
const COLOR: Record<string, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.color]))
const LABEL: Record<string, string> = Object.fromEntries(OUTCOMES.map(o => [o.key, o.label]))
const wantsLead = (o: Outcome) => o === 'interested' || o === 'appointment_set'

export default function CanvassScreen() {
  const t = useTheme()
  const router = useRouter()
  const haptics = useHaptics()
  const toast = useToast()
  const { can } = useAuth()
  const { hasFeature } = useVertical()
  const enabled = hasFeature('canvassing_tool')
  const canLog = can('canvassing:create')
  const { requestLocation, loading: locLoading } = useLocation()
  const [session, setSession] = useState<any>(null)
  const [stops, setStops] = useState<Stop[]>([])
  const [restoring, setRestoring] = useState(true)
  const [busy, setBusy] = useState(false)
  const [address, setAddress] = useState('')
  const [homeowner, setHomeowner] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')

  // An open session the canvasser started earlier (the app was closed, the phone died) comes back with its doors.
  const restore = useCallback(async () => {
    if (!enabled) { setRestoring(false); return }
    const res = await get('/api/canvassing/sessions?mine=1')
    const open = res.ok && Array.isArray(res.data?.data) ? res.data.data.find((s: any) => s.status === 'active') : null
    if (open) {
      const one = await get(`/api/canvassing/sessions/${open.id}`)
      setSession(one.ok ? one.data : open)
      setStops(one.ok && Array.isArray(one.data?.stops) ? one.data.stops : [])
    }
    setRestoring(false)
  }, [enabled])

  useEffect(() => { restore() }, [restore])

  const startSession = async () => {
    const loc = await requestLocation()
    if (!loc) { toast.error('Location needed for canvassing'); return }
    setBusy(true)
    const res = await post('/api/canvassing/sessions', {
      name: `Canvass — ${new Date().toLocaleDateString()}`,
      centerLat: loc.latitude, centerLng: loc.longitude,
    })
    setBusy(false)
    if (!res.ok) { haptics.error(); toast.error(res.error || 'Could not start the session'); return }
    haptics.success()
    setSession(res.data)
    setStops([])
    toast.success('Canvassing session started')
  }

  const endSession = async () => {
    if (!session) return
    setBusy(true)
    const res = await post(`/api/canvassing/sessions/${session.id}/end`)
    setBusy(false)
    if (!res.ok) { haptics.error(); toast.error(res.error || 'Could not end the session'); return }
    haptics.medium()
    toast.info(`Session ended — ${res.data?.totalDoors ?? stops.length} doors, ${res.data?.leadsCreated ?? 0} leads`)
    setSession(null)
    setStops([])
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
    const res = await post(`/api/canvassing/sessions/${session.id}/stops`, {
      outcome,
      address: address.trim(),
      ...(loc ? { lat: loc.latitude, lng: loc.longitude } : {}),
      ...(homeowner.trim() ? { homeownerName: homeowner.trim() } : {}),
      ...(phone.trim() ? { phone: phone.trim() } : {}),
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    })
    setBusy(false)
    if (!res.ok) { haptics.error(); toast.error(res.error || 'That door was not saved'); return }
    setStops(prev => [res.data, ...prev])
    setAddress(''); setHomeowner(''); setPhone(''); setEmail(''); setNotes('')
    toast.success(res.data?.jobId ? `Lead created — ${res.data.address}` : `${LABEL[outcome]} — ${res.data?.address || ''}`)
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

  const answered = stops.filter(s => s.outcome !== 'no_answer').length
  const leads = stops.filter(s => s.jobId).length

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
              <Text style={[styles.statValue, { color: t.primaryText }]}>{stops.length}</Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Doors</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#f59e0b' }]}>{answered}</Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Answered</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#22c55e' }]}>{leads}</Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Leads</Text>
            </View>
            {canLog && (
              <TouchableOpacity onPress={endSession} style={styles.endBtn} disabled={busy}>
                <Ionicons name="stop-circle" size={28} color="#ef4444" />
              </TouchableOpacity>
            )}
          </View>

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

            {stops.map((stop, idx) => (
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
                      {LABEL[stop.outcome] || String(stop.outcome).replace(/_/g, ' ')}{stop.jobId ? ' • lead created' : ''}
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
})
