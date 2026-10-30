/**
 * Email — the mail that reached the business's own addresses (support@, a person's own…) when an address routes into
 * the CRM, as the desktop's Email Inbox (packages/tenant-ui settings/InboundMessagesPage.tsx) lists it:
 * GET /api/inbound-messages?limit=100 → { messages }, newest first. A row opens the message, where it can be answered
 * as the address it was written to. The owner's and admins' (the menu row asks admin, and Branded Email).
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Screen, ListRow, Group, EmptyState, SkeletonRows, space } from '../../../src/design'
import { useList } from '../../../src/home/useList'
import { ago } from '../texts/index'

export default function EmailInbox() {
  const router = useRouter()
  const { rows, loading, error, refresh } = useList('/api/inbound-messages?limit=100', 100, (body) => (Array.isArray(body?.messages) ? body.messages : []))
  const [refreshing, setRefreshing] = useState(false)
  return (
    <Screen title="Email" onBack={() => router.back()} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refresh(); setRefreshing(false) }}>
      <View style={{ gap: space[3] }}>
        {loading ? <SkeletonRows count={6} /> : error ? <EmptyState icon="alert-circle" title="Could not load email" body={error} action="Try again" onAction={refresh} /> : rows.length === 0 ? (
          <EmptyState icon="mail" title="No email yet" body="Mail sent to an address that routes into the CRM shows here." />
        ) : (
          <Group>
            {rows.map((m, i) => (
              <ListRow key={m.id} title={m.fromName || m.fromEmail || 'Unknown sender'} subtitle={`${m.subject || '(no subject)'} · to ${m.toLocalPart}@`}
                icon="mail" meta={ago(m.receivedAt)} divider={i < rows.length - 1}
                onPress={() => router.push(`/(details)/email/${m.id}` as any)} />
            ))}
          </Group>
        )}
      </View>
    </Screen>
  )
}
