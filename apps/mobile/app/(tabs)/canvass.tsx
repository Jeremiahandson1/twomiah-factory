/**
 * Canvass — roofing door-to-door canvassing mode with GPS.
 */

import React, { useState, useCallback } from 'react'
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView, RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { post, get } from '../../src/api/client'
import { useLocation } from '../../src/hooks/useLocation'
import { useHaptics } from '../../src/hooks/useHaptics'
import { useToast } from '../../src/components/ToastProvider'
import { AnimatedCard } from '../../src/components/AnimatedCard'

interface Knock {
  id: string
  address: string
  result: 'interested' | 'not_home' | 'not_interested' | 'follow_up'
  time: string
}

export default function CanvassScreen() {
  const t = useTheme()
  const haptics = useHaptics()
  const toast = useToast()
  const { requestLocation, loading: locLoading } = useLocation()
  const [active, setActive] = useState(false)
  const [knocks, setKnocks] = useState<Knock[]>([])
  const [address, setAddress] = useState('')

  const startSession = async () => {
    const loc = await requestLocation()
    if (!loc) { toast.error('Location needed for canvassing'); return }
    haptics.success()
    setActive(true)
    toast.success('Canvassing session started')
  }

  const endSession = () => {
    haptics.medium()
    setActive(false)
    toast.info(`Session ended — ${knocks.length} doors knocked`)
    setKnocks([])
  }

  const logKnock = (result: Knock['result']) => {
    if (!address.trim()) { toast.warning('Enter an address first'); return }
    haptics.light()
    const knock: Knock = {
      id: `${Date.now()}`,
      address: address.trim(),
      result,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }
    setKnocks(prev => [knock, ...prev])
    setAddress('')

    // Try to log to backend
    post('/api/canvassing/knocks', {
      address: knock.address,
      result: knock.result,
    }).catch(() => {})

    const labels = { interested: 'Interested!', not_home: 'Not home', not_interested: 'Not interested', follow_up: 'Follow up' }
    toast.success(`${labels[result]} — ${knock.address}`)
  }

  const resultColors: Record<string, string> = {
    interested: '#22c55e', not_home: '#f59e0b', not_interested: '#ef4444', follow_up: '#3b82f6',
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {!active ? (
        // Start session screen
        <View style={styles.startContainer}>
          <View style={[styles.startCircle, { backgroundColor: t.primaryLight }]}>
            <Ionicons name="walk" size={64} color={t.primary} />
          </View>
          <Text style={[styles.startTitle, { color: t.text }]}>Door-to-Door Canvassing</Text>
          <Text style={[styles.startSub, { color: t.textSecondary }]}>
            Track your knocks, log results, and capture leads while canvassing neighborhoods.
          </Text>
          <TouchableOpacity
            style={[styles.startBtn, { backgroundColor: t.primary }]}
            onPress={startSession}
            disabled={locLoading}
            activeOpacity={0.85}
          >
            <Ionicons name="play" size={22} color="#fff" />
            <Text style={styles.startBtnText}>
              {locLoading ? 'Getting location...' : 'Start Canvassing'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Active canvassing
        <View style={{ flex: 1 }}>
          {/* Stats bar */}
          <View style={[styles.statsBar, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: t.primary }]}>{knocks.length}</Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Knocks</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#22c55e' }]}>
                {knocks.filter(k => k.result === 'interested').length}
              </Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Interested</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.statValue, { color: '#3b82f6' }]}>
                {knocks.filter(k => k.result === 'follow_up').length}
              </Text>
              <Text style={[styles.statLabel, { color: t.textMuted }]}>Follow Up</Text>
            </View>
            <TouchableOpacity onPress={endSession} style={styles.endBtn}>
              <Ionicons name="stop-circle" size={28} color="#ef4444" />
            </TouchableOpacity>
          </View>

          {/* Address input + quick result buttons */}
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <TextInput
              style={[styles.addressInput, { backgroundColor: t.surface, borderColor: t.border, color: t.text }]}
              value={address}
              onChangeText={setAddress}
              placeholder="Enter address..."
              placeholderTextColor={t.textMuted}
            />
            <View style={styles.resultBtns}>
              {([
                { key: 'interested', label: 'Interested', icon: 'checkmark-circle' },
                { key: 'not_home', label: 'Not Home', icon: 'home' },
                { key: 'not_interested', label: 'No Thanks', icon: 'close-circle' },
                { key: 'follow_up', label: 'Follow Up', icon: 'time' },
              ] as const).map(btn => (
                <TouchableOpacity
                  key={btn.key}
                  style={[styles.resultBtn, { borderColor: resultColors[btn.key] }]}
                  onPress={() => logKnock(btn.key)}
                >
                  <Ionicons name={btn.icon} size={16} color={resultColors[btn.key]} />
                  <Text style={[styles.resultLabel, { color: resultColors[btn.key] }]}>{btn.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Knock history */}
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {knocks.map((knock, idx) => (
              <AnimatedCard key={knock.id} index={idx}>
                <View style={[styles.knockCard, { backgroundColor: t.surface, borderColor: t.border }]}>
                  <View style={[styles.knockDot, { backgroundColor: resultColors[knock.result] }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.knockAddr, { color: t.text }]}>{knock.address}</Text>
                    <Text style={[styles.knockResult, { color: resultColors[knock.result] }]}>
                      {knock.result.replace('_', ' ')}
                    </Text>
                  </View>
                  <Text style={[styles.knockTime, { color: t.textMuted }]}>{knock.time}</Text>
                </View>
              </AnimatedCard>
            ))}
          </ScrollView>
        </View>
      )}
    </SafeAreaView>
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
  startBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  statsBar: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11, marginTop: 2 },
  endBtn: { padding: 8 },
  addressInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, marginBottom: 10,
  },
  resultBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
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
  knockResult: { fontSize: 12, textTransform: 'capitalize', marginTop: 1 },
  knockTime: { fontSize: 12 },
})
