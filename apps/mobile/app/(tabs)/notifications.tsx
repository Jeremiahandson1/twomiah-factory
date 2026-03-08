/**
 * Notifications / Alerts — real-time via WebSocket, single fetch on connect.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useSocket, useRealTimeEvent, EVENTS } from '../../src/socket/SocketContext'
import { get } from '../../src/api/client'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  createdAt: string
  data?: any
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

const EVENT_ICONS: Record<string, { icon: string; color: string }> = {
  'job:created': { icon: 'hammer', color: '#3b82f6' },
  'job:updated': { icon: 'hammer', color: '#3b82f6' },
  'job:statusChanged': { icon: 'hammer', color: '#22c55e' },
  'quote:created': { icon: 'document-text', color: '#f59e0b' },
  'quote:approved': { icon: 'checkmark-circle', color: '#22c55e' },
  'quote:sent': { icon: 'send', color: '#3b82f6' },
  'invoice:paid': { icon: 'cash', color: '#22c55e' },
  'contact:created': { icon: 'person-add', color: '#8b5cf6' },
  'alert:created': { icon: 'warning', color: '#ef4444' },
  'notification': { icon: 'notifications', color: '#3b82f6' },
}

export default function NotificationsScreen() {
  const t = useTheme()
  const { connected } = useSocket()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  // Fetch existing notifications on mount
  const load = useCallback(async () => {
    // Try dedicated notifications endpoint; fall back to empty
    const res = await get('/api/push/history')
    if (res.ok && Array.isArray(res.data)) {
      setNotifications(res.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false) }

  // Real-time: prepend new events as they arrive
  const addNotification = useCallback((event: string, data: any) => {
    const entry: Notification = {
      id: `rt-${Date.now()}-${Math.random()}`,
      type: event,
      title: formatEventTitle(event, data),
      message: data?.message || data?.title || data?.name || JSON.stringify(data).slice(0, 80),
      read: false,
      createdAt: new Date().toISOString(),
      data,
    }
    setNotifications(prev => [entry, ...prev])
  }, [])

  // Subscribe to all relevant events
  useRealTimeEvent(EVENTS.JOB_CREATED, (d: any) => addNotification('job:created', d), [addNotification])
  useRealTimeEvent(EVENTS.JOB_STATUS_CHANGED, (d: any) => addNotification('job:statusChanged', d), [addNotification])
  useRealTimeEvent(EVENTS.QUOTE_APPROVED, (d: any) => addNotification('quote:approved', d), [addNotification])
  useRealTimeEvent(EVENTS.INVOICE_PAID, (d: any) => addNotification('invoice:paid', d), [addNotification])
  useRealTimeEvent(EVENTS.CONTACT_CREATED, (d: any) => addNotification('contact:created', d), [addNotification])
  useRealTimeEvent(EVENTS.ALERT_CREATED, (d: any) => addNotification('alert:created', d), [addNotification])
  useRealTimeEvent(EVENTS.NOTIFICATION, (d: any) => addNotification('notification', d), [addNotification])

  const renderItem = ({ item }: { item: Notification }) => {
    const eventStyle = EVENT_ICONS[item.type] || EVENT_ICONS['notification']
    return (
      <View style={[styles.card, { backgroundColor: item.read ? t.surfaceAlt : t.surface, borderColor: t.border }]}>
        <View style={[styles.iconWrap, { backgroundColor: eventStyle.color + '18' }]}>
          <Ionicons name={eventStyle.icon as any} size={18} color={eventStyle.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: t.text }]}>{item.title}</Text>
          <Text style={[styles.message, { color: t.textSecondary }]} numberOfLines={2}>{item.message}</Text>
          <Text style={[styles.time, { color: t.textMuted }]}>{timeAgo(item.createdAt)}</Text>
        </View>
      </View>
    )
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {/* Connection status */}
      <View style={[styles.statusBar, { backgroundColor: connected ? '#22c55e18' : '#ef444418' }]}>
        <View style={[styles.dot, { backgroundColor: connected ? '#22c55e' : '#ef4444' }]} />
        <Text style={{ color: connected ? '#22c55e' : '#ef4444', fontSize: 12, fontWeight: '600' }}>
          {connected ? 'Live — receiving real-time updates' : 'Disconnected — pull to refresh'}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={t.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 40, gap: 12 }}>
              <Ionicons name="notifications-outline" size={48} color={t.textMuted} style={{ opacity: 0.5 }} />
              <Text style={{ color: t.textSecondary, fontSize: 16, fontWeight: '600' }}>No notifications yet</Text>
              <Text style={{ color: t.textMuted, fontSize: 14, textAlign: 'center' }}>
                Updates will appear here in real time as jobs, quotes, and invoices change.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  )
}

function formatEventTitle(event: string, data: any): string {
  switch (event) {
    case 'job:created': return `New job: ${data?.title || data?.number || 'Job'}`
    case 'job:statusChanged': return `Job ${data?.number || ''} status changed`
    case 'quote:approved': return `Quote ${data?.number || ''} approved`
    case 'quote:sent': return `Quote ${data?.number || ''} sent`
    case 'invoice:paid': return `Invoice ${data?.number || ''} paid`
    case 'contact:created': return `New contact: ${data?.name || ''}`
    case 'alert:created': return data?.customerName ? `Alert: ${data.customerName}` : 'New alert'
    case 'notification': return data?.title || 'Notification'
    default: return event.replace(/:/g, ' ').replace(/^\w/, c => c.toUpperCase())
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600' },
  message: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  time: { fontSize: 11, marginTop: 4 },
})
