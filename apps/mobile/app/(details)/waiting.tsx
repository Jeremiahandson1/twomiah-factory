/**
 * Waiting to send — everything saved on this phone that the server has not taken yet (../../src/offline/README.md).
 * A save that is only waiting for signal says "Waiting to send". A save the server REFUSED stays here until someone deals with
 * it: it says "Couldn't send — tap to fix" with the server's own words, and offers Open (the job it is about), Try again and
 * Discard. Nothing refused is ever dropped on its own.
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useOfflineQueue } from '../../src/offline/OfflineContext'
import { describeItem, orderForList } from '../../src/offline/describe'
import { ConfirmSheet } from '../../src/components/ConfirmSheet'
import { useToast } from '../../src/components/ToastProvider'
import { Screen, Card, DText, Badge, Button, EmptyState, space } from '../../src/design'

export default function WaitingScreen() {
  const router = useRouter()
  const toast = useToast()
  const { queue, retry, retryAll, discard, syncNow, isSyncing } = useOfflineQueue()
  const [dropping, setDropping] = useState<string | null>(null)
  const items = orderForList(queue)
  const failedCount = items.filter((i) => i.state === 'failed').length

  return (
    <Screen title="Waiting to send" subtitle={items.length ? `${items.length} saved on this phone` : undefined} onBack={() => router.back()}
      footer={items.length ? <Button fullWidth label="Try everything again" icon="refresh" loading={isSyncing} onPress={async () => { await retryAll(); await syncNow() }} /> : undefined}>
      {!items.length ? <EmptyState icon="checkmark-circle" title="Everything has been sent" body="Nothing is waiting on this phone." /> : null}
      {failedCount ? <DText variant="callout" tone="danger">{failedCount} could not be sent. The words below are the server{'’'}s. Fix it, try again, or drop it.</DText> : null}
      {items.map((item) => {
        const line = describeItem(item)
        return (
          <Card key={item.id}>
            <View style={{ gap: space[2] }}>
              <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
                <DText variant="bodyStrong" style={{ flex: 1 }}>{line.title}</DText>
                <Badge label={line.headline} tone={line.failed ? 'danger' : item.blocked ? 'neutral' : 'warning'} icon={line.failed ? 'alert-circle' : 'time'} />
              </View>
              {line.detail ? <DText variant="callout" tone={line.failed ? 'danger' : 'textSecondary'}>{line.detail}</DText> : null}
              <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap' }}>
                {line.open ? <Button variant="tonal" label="Open the job" onPress={() => router.push(line.open as any)} /> : null}
                {line.failed ? <Button variant="secondary" label="Try again" onPress={async () => { await retry(item.id); toast.success('Trying again') }} /> : null}
                {line.failed ? <Button variant="ghost" label="Drop it" onPress={() => setDropping(item.id)} /> : null}
              </View>
            </View>
          </Card>
        )
      })}
      <ConfirmSheet visible={!!dropping} onClose={() => setDropping(null)} title="Drop this save?"
        description="It will not be sent, and what was entered is lost. Only do this if it is no longer needed." confirmLabel="Drop it"
        onConfirm={async () => { if (dropping) await discard(dropping); setDropping(null) }} />
    </Screen>
  )
}
