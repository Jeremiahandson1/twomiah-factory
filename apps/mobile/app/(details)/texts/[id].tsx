/**
 * One text conversation, as the desktop's Messages page shows it.
 *   GET  /api/sms/conversations/:id          { ...conversation, contact, messages: [{ id, body, direction, status, createdAt,
 *                                             media: [{ url }], sentBy }] } — reading it marks it read
 *   POST /api/sms/conversations/:id/reply    { message } — sms:send. 402 when texting is paused on the account (its words
 *                                             are shown), 502 when the carrier refused it (saved as a failed message).
 *   POST /api/sms/conversations/:id/archive  — contacts:read, as the desktop's Archive.
 * Pictures a customer sent show as "Picture" links that open in the phone's browser; sending pictures stays on the desktop.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, Pressable, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, post } from '../../../src/api/client'
import { useAuth } from '../../../src/auth/AuthContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { callPhone } from '../../../src/home/phoneActions'
import { Screen, DText, EmptyState, SkeletonRows, Icon, useDesign, radius, space, MIN_TARGET } from '../../../src/design'
import { fmtPhone } from './index'

const when = (v: string) => {
  const d = new Date(v)
  return isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function TextThread() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { c } = useDesign()
  const { can } = useAuth()
  const [conv, setConv] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const res = await get(`/api/sms/conversations/${id}`)
    if (res.ok) { setConv(res.data); setMissing('') } else setMissing(res.status === 403 ? 'Texting is not part of your role.' : res.error || 'This conversation was not found.')
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setSending(true)
    const res = await post(`/api/sms/conversations/${id}/reply`, { message: body })
    setSending(false)
    if (res.ok) { haptics.success(); setText(''); load() }
    else { haptics.error(); toast.error(res.error || 'The text was not sent'); if (res.status === 502) load() }
  }
  const archive = async () => {
    const res = await post(`/api/sms/conversations/${id}/archive`)
    if (res.ok) { toast.success('Conversation archived'); router.back() } else toast.error(res.error || 'Could not archive it')
  }

  const name = conv?.contact?.name || fmtPhone(conv?.phoneNumber)
  const actions = conv ? [
    ...(conv.phoneNumber ? [{ icon: 'call', label: `Call ${name}`, onPress: () => callPhone(conv.phoneNumber) }] : []),
    ...(can('contacts:read') ? [{ icon: 'archive', label: 'Archive this conversation', onPress: archive }] : []),
  ] : []
  const messages: any[] = Array.isArray(conv?.messages) ? conv.messages : []

  const composer = (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[2] }}>
      <TextInput value={text} onChangeText={setText} placeholder="Write a text" placeholderTextColor={c.textSubtle} multiline
        accessibilityLabel="Text message"
        style={{ flex: 1, minHeight: MIN_TARGET, maxHeight: 140, borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2], color: c.text, backgroundColor: c.background, fontSize: 16 }} />
      <Pressable onPress={send} disabled={sending || !text.trim()} accessibilityRole="button" accessibilityLabel="Send text"
        style={{ width: MIN_TARGET, height: MIN_TARGET, borderRadius: radius.pill, backgroundColor: c.accentFill, alignItems: 'center', justifyContent: 'center', opacity: sending || !text.trim() ? 0.5 : 1 }}>
        <Icon name="send" size={20} tone="onAccent" />
      </Pressable>
    </View>
  )

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen title={loading ? 'Text' : name || 'Text'} subtitle={conv?.contact?.name ? fmtPhone(conv.phoneNumber) : undefined} onBack={() => router.back()}
        actions={actions} footer={conv ? composer : undefined}>
        {loading ? <SkeletonRows count={5} /> : missing ? <EmptyState icon="chatbubbles" title="Not available" body={missing} /> : messages.length === 0 ? (
          <EmptyState icon="chatbubbles" title="No texts yet" body="Write the first one below." />
        ) : (
          <View style={{ gap: space[2] }}>
            {messages.map((m) => {
              const ours = m.direction === 'outbound'
              const failed = m.status === 'failed'
              const by = ours && m.sentBy?.firstName ? `${m.sentBy.firstName} · ` : ''
              return (
                <View key={m.id} style={{ alignSelf: ours ? 'flex-end' : 'flex-start', maxWidth: '85%', gap: 2 }}>
                  <View style={{ backgroundColor: ours ? c.accentFill : c.surfaceAlt, borderRadius: radius.lg, paddingHorizontal: space[3], paddingVertical: space[2] }}>
                    {m.body ? <DText tone={ours ? 'onAccent' : 'text'}>{m.body}</DText> : null}
                    {(Array.isArray(m.media) ? m.media : []).map((p: any, i: number) => (
                      <Pressable key={i} onPress={() => Linking.openURL(p.url)} accessibilityRole="link" accessibilityLabel="Open the picture">
                        <DText tone={ours ? 'onAccent' : 'accentText'} style={{ textDecorationLine: 'underline' }}>Picture {i + 1}</DText>
                      </Pressable>
                    ))}
                  </View>
                  <DText variant="caption" tone={failed ? 'danger' : 'textSubtle'} style={{ textAlign: ours ? 'right' : 'left' }}>
                    {failed ? `Not sent${m.errorMessage ? ` — ${m.errorMessage}` : ''}` : `${by}${when(m.createdAt)}`}
                  </DText>
                </View>
              )
            })}
          </View>
        )}
      </Screen>
    </KeyboardAvoidingView>
  )
}
