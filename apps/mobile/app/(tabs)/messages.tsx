/**
 * Messages — homecare team messaging.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, StyleSheet, RefreshControl, TouchableOpacity,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../src/theme/ThemeContext'
import { get } from '../../src/api/client'
import { AvatarCircle } from '../../src/components/AvatarCircle'
import { SkeletonList } from '../../src/components/SkeletonLoader'
import { EmptyState } from '../../src/components/EmptyState'
import { AnimatedCard } from '../../src/components/AnimatedCard'

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export default function MessagesScreen() {
  const t = useTheme()
  const [threads, setThreads] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const loadMessages = useCallback(async () => {
    const res = await get('/api/messages')
    if (res.ok) setThreads(res.data.data || res.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadMessages() }, [loadMessages])

  const onRefresh = async () => { setRefreshing(true); await loadMessages(); setRefreshing(false) }

  const renderThread = ({ item: thread, index }: { item: any; index: number }) => (
    <AnimatedCard index={index}>
      <TouchableOpacity style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]} activeOpacity={0.7}>
        <AvatarCircle name={thread.name || thread.from} size={44} />
        <View style={{ flex: 1 }}>
          <View style={styles.row}>
            <Text style={[styles.name, { color: t.text }]} numberOfLines={1}>{thread.name || thread.from}</Text>
            <Text style={[styles.time, { color: t.textMuted }]}>
              {thread.lastMessageAt ? timeAgo(thread.lastMessageAt) : ''}
            </Text>
          </View>
          <Text style={[styles.preview, { color: thread.unread ? t.text : t.textMuted }]} numberOfLines={1}>
            {thread.lastMessage || thread.preview || 'No messages yet'}
          </Text>
        </View>
        {thread.unread && <View style={[styles.unreadDot, { backgroundColor: t.primary }]} />}
      </TouchableOpacity>
    </AnimatedCard>
  )

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: t.background }]} edges={['top']}>
      {loading ? (
        <SkeletonList count={6} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={item => item.id}
          renderItem={renderThread}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
          ListEmptyComponent={<EmptyState icon="chatbubbles-outline" title="No messages" subtitle="Messages from your care team will appear here" />}
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 15, fontWeight: '600', flex: 1 },
  time: { fontSize: 12 },
  preview: { fontSize: 13, marginTop: 2 },
  unreadDot: { width: 10, height: 10, borderRadius: 5 },
})
