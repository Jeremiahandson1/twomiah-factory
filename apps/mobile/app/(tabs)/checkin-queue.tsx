/**
 * Check-In Queue — door staff screen for managing customer waiting queue.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity,
  TextInput, Modal, Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get, post, put } from '../../src/api/client'
import { StatusBadge } from '../../src/components/StatusBadge'
import { FilterChips } from '../../src/components/FilterChips'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { AnimatedCard } from '../../src/components/AnimatedCard'
import { SwipeableRow } from '../../src/components/SwipeableRow'
import { FAB } from '../../src/components/FAB'
import { EmptyState } from '../../src/components/EmptyState'
import { useToast } from '../../src/components/ToastProvider'
import { useHaptics } from '../../src/hooks/useHaptics'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'called', label: 'Called' },
  { key: 'serving', label: 'Serving' },
  { key: 'completed', label: 'Done' },
]

const SOURCE_COLORS: Record<string, { bg: string; text: string }> = {
  walk_in: { bg: '#dbeafe', text: '#1d4ed8' },
  online: { bg: '#dcfce7', text: '#15803d' },
  delivery: { bg: '#fef3c7', text: '#b45309' },
  phone: { bg: '#f3e8ff', text: '#7c3aed' },
}

export default function CheckInQueueScreen() {
  const t = useTheme()
  const toast = useToast()
  const haptics = useHaptics()
  const [queue, setQueue] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [showAddModal, setShowAddModal] = useState(false)
  const [walkInName, setWalkInName] = useState('')
  const [walkInPhone, setWalkInPhone] = useState('')
  const [addingWalkIn, setAddingWalkIn] = useState(false)
  const [stats, setStats] = useState({ waiting: 0, avgWait: 0 })
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadQueue = useCallback(async () => {
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('status', filter)
    const res = await get(`/api/checkin/queue?${params}`)
    if (res.ok) {
      const data = res.data.data || res.data || []
      setQueue(data)
      // Compute stats from active entries
      const waiting = data.filter((e: any) => e.status === 'waiting')
      const avgWait = waiting.length > 0
        ? Math.round(waiting.reduce((sum: number, e: any) => {
            const checkedIn = new Date(e.checkedInAt || e.createdAt).getTime()
            return sum + (Date.now() - checkedIn) / 60000
          }, 0) / waiting.length)
        : 0
      setStats({ waiting: waiting.length, avgWait })
    }
    setLoading(false)
  }, [filter])

  useEffect(() => { setLoading(true); loadQueue() }, [loadQueue])

  // Auto-refresh every 10 seconds
  useEffect(() => {
    intervalRef.current = setInterval(() => { loadQueue() }, 10000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [loadQueue])

  const onRefresh = async () => { setRefreshing(true); await loadQueue(); setRefreshing(false) }

  const updateCheckin = async (entry: any, action: string) => {
    const res = await put(`/api/checkin/${entry.id}/${action}`, {})
    if (res.ok) {
      haptics.success()
      toast.success(`${entry.customerName || 'Customer'} — ${action}`)
      loadQueue()
    } else {
      haptics.error()
      toast.error(res.error || `Failed to ${action}`)
    }
  }

  const addWalkIn = async () => {
    if (!walkInName.trim()) { toast.warning('Name is required'); return }
    setAddingWalkIn(true)
    const res = await post('/api/checkin/queue', {
      customerName: walkInName.trim(),
      phone: walkInPhone.trim() || undefined,
      source: 'walk_in',
    })
    if (res.ok) {
      haptics.success()
      toast.success(`${walkInName.trim()} added to queue`)
      setWalkInName('')
      setWalkInPhone('')
      setShowAddModal(false)
      loadQueue()
    } else {
      haptics.error()
      toast.error(res.error || 'Failed to add')
    }
    setAddingWalkIn(false)
  }

  const formatWait = (entry: any) => {
    const checkedIn = new Date(entry.checkedInAt || entry.createdAt).getTime()
    const mins = Math.round((Date.now() - checkedIn) / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m`
    return `${Math.floor(mins / 60)}h ${mins % 60}m`
  }

  const renderEntry = ({ item: entry, index }: { item: any; index: number }) => {
    const swipeActions: any[] = []
    if (entry.status === 'waiting') {
      swipeActions.push({ icon: 'megaphone', label: 'Call', color: '#3b82f6', onPress: () => updateCheckin(entry, 'call') })
      swipeActions.push({ icon: 'close-circle', label: 'No-Show', color: '#ef4444', onPress: () => updateCheckin(entry, 'no-show') })
    }
    if (entry.status === 'called') {
      swipeActions.push({ icon: 'hand-left', label: 'Serve', color: '#f59e0b', onPress: () => updateCheckin(entry, 'serve') })
      swipeActions.push({ icon: 'close-circle', label: 'No-Show', color: '#ef4444', onPress: () => updateCheckin(entry, 'no-show') })
    }
    if (entry.status === 'serving') {
      swipeActions.push({ icon: 'checkmark-done', label: 'Complete', color: '#22c55e', onPress: () => updateCheckin(entry, 'complete') })
    }

    const source = entry.source || 'walk_in'
    const sourceStyle = SOURCE_COLORS[source] || SOURCE_COLORS.walk_in

    return (
      <AnimatedCard index={index}>
        <SwipeableRow rightActions={swipeActions}>
          <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={styles.cardRow}>
              <View style={[styles.positionBadge, { backgroundColor: t.primaryLight }]}>
                <Text style={[styles.positionText, { color: t.primary }]}>
                  #{entry.position || index + 1}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.customerName, { color: t.text }]}>
                  {entry.customerName || 'Unknown'}
                </Text>
                <View style={styles.metaRow}>
                  <View style={[styles.sourceBadge, { backgroundColor: sourceStyle.bg }]}>
                    <Text style={[styles.sourceText, { color: sourceStyle.text }]}>
                      {source.replace('_', '-')}
                    </Text>
                  </View>
                  {entry.phone && (
                    <Text style={[styles.phone, { color: t.textMuted }]}>{entry.phone}</Text>
                  )}
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[styles.waitTime, { color: t.textSecondary }]}>
                  {formatWait(entry)}
                </Text>
                <StatusBadge status={entry.status} />
              </View>
            </View>
            {entry.notes && (
              <Text style={[styles.notes, { color: t.textMuted }]} numberOfLines={1}>
                {entry.notes}
              </Text>
            )}
          </View>
        </SwipeableRow>
      </AnimatedCard>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Stats Header */}
      <View style={[styles.statsRow, { backgroundColor: t.surface, borderBottomColor: t.border }]}>
        <View style={styles.statItem}>
          <Ionicons name="people" size={18} color={t.primary} />
          <Text style={[styles.statValue, { color: t.text }]}>{stats.waiting}</Text>
          <Text style={[styles.statLabel, { color: t.textMuted }]}>Waiting</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: t.border }]} />
        <View style={styles.statItem}>
          <Ionicons name="time" size={18} color="#f59e0b" />
          <Text style={[styles.statValue, { color: t.text }]}>{stats.avgWait}m</Text>
          <Text style={[styles.statLabel, { color: t.textMuted }]}>Avg Wait</Text>
        </View>
        <View style={[styles.statDivider, { backgroundColor: t.border }]} />
        <View style={styles.statItem}>
          <Ionicons name="list" size={18} color="#8b5cf6" />
          <Text style={[styles.statValue, { color: t.text }]}>{queue.length}</Text>
          <Text style={[styles.statLabel, { color: t.textMuted }]}>Total</Text>
        </View>
      </View>

      <FilterChips options={FILTERS} selected={filter} onSelect={setFilter} />

      {loading ? (
        <SkeletonList count={5} />
      ) : (
        <FlatList
          data={queue}
          keyExtractor={item => item.id}
          renderItem={renderEntry}
          contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={<EmptyState icon="people-outline" title="Queue is empty" subtitle="No customers checked in" />}
        />
      )}

      <FAB icon="person-add" onPress={() => setShowAddModal(true)} />

      {/* Walk-in Add Modal */}
      <Modal visible={showAddModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: t.surface }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: t.text }]}>Add Walk-In</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={24} color={t.textMuted} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={[styles.modalInput, { color: t.text, borderColor: t.border, backgroundColor: t.background }]}
              value={walkInName}
              onChangeText={setWalkInName}
              placeholder="Customer name *"
              placeholderTextColor={t.textMuted}
              autoFocus
            />
            <TextInput
              style={[styles.modalInput, { color: t.text, borderColor: t.border, backgroundColor: t.background }]}
              value={walkInPhone}
              onChangeText={setWalkInPhone}
              placeholder="Phone number (optional)"
              placeholderTextColor={t.textMuted}
              keyboardType="phone-pad"
            />
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: t.primary, opacity: addingWalkIn ? 0.6 : 1 }]}
              onPress={addWalkIn}
              disabled={addingWalkIn}
            >
              <Ionicons name="person-add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>{addingWalkIn ? 'Adding...' : 'Add to Queue'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingVertical: 12, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statItem: { alignItems: 'center', gap: 2 },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 11 },
  statDivider: { width: 1, height: 32 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  positionBadge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, minWidth: 40, alignItems: 'center' },
  positionText: { fontSize: 14, fontWeight: '700' },
  customerName: { fontSize: 15, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sourceBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  sourceText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  phone: { fontSize: 12 },
  waitTime: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  notes: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalInput: {
    borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 15, marginBottom: 12,
  },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 10, marginTop: 4,
  },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
})
