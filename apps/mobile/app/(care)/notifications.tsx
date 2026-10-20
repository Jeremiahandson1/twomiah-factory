/**
 * Notifications from the agency (shift reminders, open shifts, swap and reschedule answers…).
 *   GET  /api/notifications            my latest 100
 *   POST /api/push/mark-read           { ids: [id] | 'all' } — clears the badge the same way the web bell does
 */
import React, { useCallback, useState } from 'react'
import { Text, StyleSheet, View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { useCare } from '../../src/care/CareContext'
import { careGet, carePost, asList } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { Banner, Button, Card } from '../../src/care/ui'
import { EmptyState } from '../../src/components/EmptyState'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { formatClock, formatYmdShort, ymdOf } from '../../src/care/time'

// GET /api/notifications rows: { id, title, message, isRead, status: new | handled | archived, createdAt }
const isNew = (n: any) => n.status === 'new' || (n.status == null && !n.isRead)

export default function NotificationsScreen() {
  const t = useTheme()
  const care = useCare()
  const [list, setList] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    const r = await careGet('/api/notifications')
    if (r.ok) { setList(asList(r.data)); setFailed(false) } else { setFailed(true); setList((p) => p || []) }
  }, [])
  useFocusEffect(useCallback(() => { load() }, [load]))

  const markRead = async (ids: string[] | 'all') => {
    const r = await carePost('/api/push/mark-read', { ids })
    if (r.ok) {
      setList((l) => (l || []).map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, isRead: true, status: 'handled' } : n)))
      care.refreshCounts()
    }
  }

  if (list === null) return <View style={{ flex: 1, backgroundColor: t.background }}><SkeletonList count={5} /></View>
  const unread = list.filter(isNew)
  return (
    <CareScreen onRefresh={load}>
      {failed && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Notifications didn't load. Tap to try again.</Banner>}
      {unread.length > 0 && <Button small variant="ghost" label={`Mark all ${unread.length} as read`} onPress={() => markRead('all')} style={{ alignSelf: 'flex-end' }} />}
      {list.length === 0 && !failed && <EmptyState icon="notifications-outline" title="No notifications" subtitle="Shift reminders and updates from your agency appear here." />}
      {list.map((n) => {
        const when = n.createdAt
        const d = when ? new Date(when) : null
        const fresh = isNew(n)
        return (
          <Card key={n.id} style={fresh ? { borderColor: t.primary } : undefined} onPress={fresh ? () => markRead([n.id]) : undefined}>
            <View style={styles.row}>
              <Ionicons name={fresh ? 'notifications' : 'notifications-outline'} size={20} color={fresh ? t.primary : t.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: t.text, fontWeight: fresh ? '800' : '600' }]}>{n.title || 'Notification'}</Text>
                {n.message ? <Text style={[styles.msg, { color: t.text }]}>{n.message}</Text> : null}
                {d && !isNaN(d.getTime()) ? <Text style={[styles.when, { color: t.textSecondary }]}>{formatYmdShort(ymdOf(d))} · {formatClock(d)}</Text> : null}
              </View>
            </View>
          </Card>
        )
      })}
    </CareScreen>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  title: { fontSize: 15 },
  msg: { fontSize: 14, marginTop: 3, lineHeight: 19 },
  when: { fontSize: 12, marginTop: 6 },
})
