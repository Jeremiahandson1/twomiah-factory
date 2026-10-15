/**
 * Messages — the caregiver's inbox with the office (home care vertical).
 *   GET /api/messages/inbox → threads { id, subject, unread, latestMessage { body, senderName, createdAt } }
 * Opening a thread (/(care)/thread/[id]) marks it read; "New message" writes to the office.
 */
import React, { useCallback, useState } from 'react'
import { View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { careGet, asList } from '../../src/care/careApi'
import { useCare } from '../../src/care/CareContext'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { EmptyState } from '../../src/components/EmptyState'
import { Banner, Button } from '../../src/care/ui'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  if (isNaN(diff)) return ''
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function MessagesScreen() {
  const t = useTheme()
  const router = useRouter()
  const care = useCare()
  const [threads, setThreads] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    const r = await careGet('/api/messages/inbox')
    if (r.ok) { setThreads(asList(r.data)); setFailed(false) } else { setFailed(true); setThreads((p) => p || []) }
    care.refreshCounts()
  }, [care.refreshCounts])

  useFocusEffect(useCallback(() => { load() }, [load]))

  if (threads === null) return <View style={{ flex: 1, backgroundColor: t.background }}><SkeletonList count={5} /></View>

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <FlatList
        data={threads}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false) }} tintColor={t.primary} />}
        ListHeaderComponent={
          <View>
            {failed && <Banner tone="warning" icon="cloud-offline-outline" onPress={load}>Messages didn't load. Tap to try again.</Banner>}
            <Button label="New message to the office" icon="create-outline" onPress={() => router.push('/(care)/compose' as any)} style={{ marginBottom: 12 }} />
          </View>
        }
        ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No messages" subtitle="Messages from your office will appear here." />}
        renderItem={({ item }) => {
          const who = item.latestMessage?.senderName || item.subject || 'Message'
          return (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: t.surface, borderColor: item.unread ? t.primary : t.border }]}
              activeOpacity={0.75}
              onPress={() => router.push(`/(care)/thread/${item.id}` as any)}
              accessibilityRole="button"
            >
              <AvatarCircle name={who} size={44} />
              <View style={{ flex: 1 }}>
                <View style={styles.row}>
                  <Text style={[styles.subject, { color: t.text, fontWeight: item.unread ? '800' : '600' }]} numberOfLines={1}>{item.subject || who}</Text>
                  <Text style={[styles.time, { color: t.textSecondary }]}>{timeAgo(item.latestMessage?.createdAt || item.updatedAt)}</Text>
                </View>
                {item.latestMessage ? (
                  <Text style={[styles.preview, { color: item.unread ? t.text : t.textSecondary }]} numberOfLines={2}>
                    {item.latestMessage.senderName}: {item.latestMessage.body}
                  </Text>
                ) : null}
              </View>
              {item.unread ? <View style={[styles.dot, { backgroundColor: t.primary }]} /> : null}
            </TouchableOpacity>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  subject: { fontSize: 15, flex: 1 },
  time: { fontSize: 12 },
  preview: { fontSize: 14, marginTop: 3, lineHeight: 19 },
  dot: { width: 10, height: 10, borderRadius: 5 },
})
