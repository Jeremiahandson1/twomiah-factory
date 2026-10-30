/**
 * A new text — to a contact, or to a number typed in — by the contract the desktop's New message uses:
 *   POST /api/sms/send { toPhone, contactId?, message } → the message saved, with its conversationId (sms:send).
 * 400 when the contact opted out of texts or has no number; 402 when texting is paused on the account; 502 when the carrier
 * refused it — the server's own words are shown. On success the conversation opens.
 */
import React, { useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { post } from '../../../src/api/client'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { useList } from '../../../src/home/useList'
import { useDebounce } from '../../../src/hooks/useDebounce'
import { Screen, Group, ListRow, SearchField, TextField, Button, DText, SkeletonRows, space } from '../../../src/design'
import { fmtPhone } from './index'

export default function NewText() {
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const [search, setSearch] = useState('')
  const [to, setTo] = useState<{ contactId?: string; name?: string; phone: string } | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const q = useDebounce(search)
  // Contacts with a number, as the desktop's picker offers them.
  const { rows, loading } = useList(to || !q.trim() ? null : `/api/contacts?${new URLSearchParams({ search: q.trim() })}`, 15)
  const withNumber = rows.filter((r) => r.mobile || r.phone)
  const typedDigits = search.replace(/\D/g, '')

  const send = async () => {
    if (!to) { toast.error('Choose who the text is to'); return }
    if (!message.trim()) { toast.error('Write the text first'); return }
    setBusy(true)
    const res = await post('/api/sms/send', { toPhone: to.phone, ...(to.contactId ? { contactId: to.contactId } : {}), message: message.trim() })
    setBusy(false)
    if (!res.ok) { haptics.error(); toast.error(res.error || 'The text was not sent'); return }
    haptics.success()
    const conversationId = res.data?.conversationId
    if (conversationId) router.replace(`/(details)/texts/${conversationId}` as any)
    else { toast.success('Text sent'); router.back() }
  }

  return (
    <Screen title="New text" onBack={() => router.back()}
      footer={<Button label="Send text" icon="send" size="lg" fullWidth loading={busy} onPress={send} />}>
      <View style={{ gap: space[3] }}>
        {to ? (
          <Group>
            <ListRow title={to.name || fmtPhone(to.phone)} subtitle={to.name ? fmtPhone(to.phone) : undefined} icon="person" meta="Change" divider={false}
              onPress={() => { setTo(null); setSearch('') }} />
          </Group>
        ) : (
          <>
            <SearchField value={search} onChangeText={setSearch} placeholder="A contact's name, or a number" />
            {typedDigits.length >= 10 ? (
              <Group><ListRow title={`Text ${fmtPhone(search)}`} icon="keypad" divider={false} onPress={() => setTo({ phone: search.trim() })} /></Group>
            ) : null}
            {q.trim() && loading ? <SkeletonRows count={3} /> : withNumber.length ? (
              <Group>
                {withNumber.map((r, i) => (
                  <ListRow key={r.id} title={r.name || 'Contact'} subtitle={fmtPhone(r.mobile || r.phone)} icon="person" divider={i < withNumber.length - 1}
                    onPress={() => setTo({ contactId: r.id, name: r.name, phone: r.mobile || r.phone })} />
                ))}
              </Group>
            ) : q.trim() && typedDigits.length < 10 ? <DText tone="textSecondary">No contact with a number matches. Type the full number to text it.</DText> : null}
          </>
        )}
        <TextField label="Text" value={message} onChangeText={setMessage} multiline placeholder="Write the text" />
      </View>
    </Screen>
  )
}
