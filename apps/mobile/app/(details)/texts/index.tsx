/**
 * Texts — the business's customer text conversations, as the desktop's Messages page (packages/tenant-ui marketing/
 * MessagesPage.tsx) lists them: GET /api/sms/conversations (rows are { conversation, contact }), newest first, with the
 * unread count; search by the contact's name or the number; "Unread" narrows it. A row opens the thread; "New text" writes
 * to a contact or a number. Needs sms:send and the business's Two-Way Texting (the menu row asks both).
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, ListRow, Group, ChipRow, Chip, SearchField, EmptyState, SkeletonRows, Button, space } from '../../../src/design'
import { useList } from '../../../src/home/useList'
import { useDebounce } from '../../../src/hooks/useDebounce'

/** +16085550188 → (608) 555-0188; anything else as stored (the desktop's fmtPhone). */
export const fmtPhone = (p: unknown): string => {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return String(p || '')
}
/** How long ago, short: now, 5m, 3h, 2d, then the date. */
export const ago = (v?: string | null): string => {
  if (!v) return ''
  const t = new Date(v).getTime()
  if (isNaN(t)) return ''
  const m = Math.floor((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  if (m < 1440) return `${Math.floor(m / 60)}h`
  if (m < 10080) return `${Math.floor(m / 1440)}d`
  return new Date(t).toLocaleDateString()
}

export default function TextsScreen() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [unread, setUnread] = useState(false)
  const q = useDebounce(search)
  const url = `/api/sms/conversations?${new URLSearchParams({ ...(q.trim() ? { search: q.trim() } : {}), ...(unread ? { unreadOnly: 'true' } : {}) })}`
  const { rows, total, loading, error, refresh, loadMore } = useList(url)
  const [refreshing, setRefreshing] = useState(false)

  return (
    <Screen title="Texts" onBack={() => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}
      actions={[{ icon: 'create', label: 'New text', onPress: () => router.push('/(details)/texts/new' as any) }]}>
      <View style={{ gap: space[3] }}>
        <SearchField value={search} onChangeText={setSearch} placeholder="Search by name or number" />
        <ChipRow>
          <Chip label="All" selected={!unread} onPress={() => setUnread(false)} />
          <Chip label="Unread" selected={unread} onPress={() => setUnread(true)} />
        </ChipRow>
        {loading ? <SkeletonRows count={6} /> : error ? <EmptyState icon="alert-circle" title="Could not load texts" body={error} action="Try again" onAction={refresh} /> : rows.length === 0 ? (
          <EmptyState icon="chatbubbles" title={unread ? 'Nothing unread' : 'No texts here'} body={q.trim() ? 'No conversation matches this search.' : 'Texts with customers show here.'}
            action="New text" onAction={() => router.push('/(details)/texts/new' as any)} />
        ) : (
          <Group>
            {rows.map((row, i) => {
              const conv = row?.conversation ? { ...row.conversation, contact: row.contact } : row
              const unreadCount = Number(conv.unreadCount) || 0
              const name = conv.contact?.name || fmtPhone(conv.phoneNumber)
              return (
                <ListRow key={conv.id} title={name} subtitle={conv.contact?.name ? fmtPhone(conv.phoneNumber) : undefined}
                  icon="chatbubble" meta={ago(conv.lastMessageAt)}
                  badge={unreadCount ? `${unreadCount} new` : undefined} badgeTone="info" divider={i < rows.length - 1}
                  onPress={() => router.push(`/(details)/texts/${conv.id}` as any)} />
              )
            })}
          </Group>
        )}
        {!loading && rows.length > 0 && rows.length < (total ?? 0) ? <Button label="Show more" variant="secondary" onPress={loadMore} /> : null}
      </View>
    </Screen>
  )
}
