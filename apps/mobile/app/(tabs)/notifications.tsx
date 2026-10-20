/**
 * Notifications / Alerts — the live feed of what happens while the app is open.
 *
 * The events are the unified server's live updates (src/socket/SocketContext EVENTS — apps/unified/server/core/realtime.ts).
 * There is NO stored notification history for the trades: GET /api/push/history does not exist on the unified server
 * (its /api/push and /api/notifications are home care's alone, crm/homecare/portals/index.ts), and the server never
 * sends a 'notification' event — so this screen asks for neither, and says the feed starts when the app opens.
 * Quote and invoice events carry money and link to screens a field seat cannot open, so they are listed only for a
 * seat with quotes:read / invoices:read.
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
import { useAuth } from '../../src/auth/AuthContext'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { LocationCard } from '../../src/location/LocationCard'

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
  'lead:created': { icon: 'mail-unread', color: '#ec4899' },
  'payment:received': { icon: 'cash', color: '#22c55e' },
  'alert:created': { icon: 'warning', color: '#ef4444' },
}
const DEFAULT_ICON = { icon: 'notifications', color: '#3b82f6' }

export default function NotificationsScreen() {
  const t = useTheme()
  const { connected } = useSocket()
  const { can } = useAuth()
  const seesQuotes = can('quotes:read')
  const seesInvoices = can('invoices:read')
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [refreshing, setRefreshing] = useState(false)

  // Nothing to fetch: the feed is what arrives live. Pull-to-refresh clears what has been read.
  const onRefresh = () => { setRefreshing(true); setNotifications(prev => prev.map(n => ({ ...n, read: true }))); setRefreshing(false) }

  // Real-time: prepend new events as they arrive
  const addNotification = useCallback((event: string, data: any) => {
    const entry: Notification = {
      id: `rt-${Date.now()}-${Math.random()}`,
      type: event,
      title: formatEventTitle(event, data),
      message: data?.message || data?.title || data?.name || data?.number || '',
      read: false,
      createdAt: new Date().toISOString(),
      data,
    }
    setNotifications(prev => [entry, ...prev])
  }, [])

  // Subscribe to all relevant events
  useRealTimeEvent(EVENTS.JOB_CREATED, (d: any) => addNotification('job:created', d), [addNotification])
  useRealTimeEvent(EVENTS.JOB_STATUS_CHANGED, (d: any) => addNotification('job:statusChanged', d), [addNotification])
  useRealTimeEvent(EVENTS.QUOTE_APPROVED, (d: any) => { if (seesQuotes) addNotification('quote:approved', d) }, [addNotification, seesQuotes])
  useRealTimeEvent(EVENTS.INVOICE_PAID, (d: any) => { if (seesInvoices) addNotification('invoice:paid', d) }, [addNotification, seesInvoices])
  useRealTimeEvent(EVENTS.PAYMENT_RECEIVED, (d: any) => { if (seesInvoices) addNotification('payment:received', d) }, [addNotification, seesInvoices])
  useRealTimeEvent(EVENTS.CONTACT_CREATED, (d: any) => addNotification('contact:created', d), [addNotification])
  useRealTimeEvent(EVENTS.LEAD_CREATED, (d: any) => addNotification('lead:created', d), [addNotification])
  useRealTimeEvent(EVENTS.ALERT_CREATED, (d: any) => addNotification('alert:created', d), [addNotification])

  const renderItem = ({ item }: { item: Notification }) => {
    const eventStyle = EVENT_ICONS[item.type] || DEFAULT_ICON
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

      {(
        <FlatList
          data={notifications}
          keyExtractor={item => item.id}
          // The person's own location switches — shown only to a trade business with gps_tracking.
          ListHeaderComponent={<LocationCard />}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', padding: 40, gap: 12 }}>
              <Ionicons name="notifications-outline" size={48} color={t.textMuted} style={{ opacity: 0.5 }} />
              <Text style={{ color: t.textSecondary, fontSize: 16, fontWeight: '600' }}>No notifications yet</Text>
              <Text style={{ color: t.textMuted, fontSize: 14, textAlign: 'center' }}>
                While the app is open, new jobs, status changes and new contacts appear here as they happen.
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
    case 'payment:received': return `Payment on ${data?.invoiceNumber || 'an invoice'}`
    case 'lead:created': return `New lead${data?.name ? `: ${data.name}` : ''}`
    case 'contact:created': return `New contact: ${data?.name || ''}`
    case 'alert:created': return data?.customerName ? `Alert: ${data.customerName}` : 'New alert'
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
