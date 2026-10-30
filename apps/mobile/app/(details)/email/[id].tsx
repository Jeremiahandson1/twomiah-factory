/**
 * One email, and the reply to it.
 *   GET  /api/inbound-messages/:id         { message: { fromName, fromEmail, toLocalPart, subject, textBody, htmlBody,
 *                                           spfVerdict, dkimVerdict, receivedAt } }
 *   POST /api/inbound-messages/:id/reply   { text } — sent AS the address the customer wrote to; 501 when replying is
 *                                           not set up, 502 when the send failed (the server's words are shown).
 * The phone shows the email as text: its plain-text part, or the HTML part reduced to text. The desktop draws the HTML in
 * a locked frame; a phone would need a web view to do that safely, and reading and answering do not need it.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { KeyboardAvoidingView, Platform, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { get, post } from '../../../src/api/client'
import { useToast } from '../../../src/components/ToastProvider'
import { useHaptics } from '../../../src/hooks/useHaptics'
import { emailTo } from '../../../src/home/phoneActions'
import { Screen, Card, DText, TextField, Button, EmptyState, SkeletonRows, useDesign, space } from '../../../src/design'

/** An HTML email as readable text: no styles or scripts, a line per paragraph and break, the common entities decoded. */
export const htmlToText = (html: string): string =>
  html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

export default function EmailMessage() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const toast = useToast()
  const haptics = useHaptics()
  const { c } = useDesign()
  const [msg, setMsg] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const res = await get(`/api/inbound-messages/${id}`)
    if (res.ok) setMsg(res.data?.message ?? null)
    setLoading(false)
  }, [id])
  useEffect(() => { load() }, [load])

  const send = async () => {
    if (!reply.trim()) { toast.error('Write the reply first'); return }
    setBusy(true)
    const res = await post(`/api/inbound-messages/${id}/reply`, { text: reply.trim() })
    setBusy(false)
    if (res.ok) { haptics.success(); toast.success('Reply sent'); setReply('') }
    else { haptics.error(); toast.error(res.error || 'The reply was not sent') }
  }

  if (loading) return <Screen title="Email" onBack={() => router.back()}><SkeletonRows count={5} /></Screen>
  if (!msg) return <Screen title="Email" onBack={() => router.back()}><EmptyState icon="mail" title="Email not found" /></Screen>

  const body = msg.textBody?.trim() || (msg.htmlBody ? htmlToText(msg.htmlBody) : '') || '(no body)'
  const from = msg.fromName ? `${msg.fromName} <${msg.fromEmail}>` : msg.fromEmail
  const received = new Date(msg.receivedAt)
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen title={msg.subject || '(no subject)'} onBack={() => router.back()}
        actions={msg.fromEmail ? [{ icon: 'mail-open', label: `Email ${msg.fromEmail} from the phone's mail app`, onPress: () => emailTo(msg.fromEmail) }] : []}>
        <Card>
          <View style={{ gap: space[1] }}>
            <DText variant="bodyStrong">{from}</DText>
            <DText variant="callout" tone="textSecondary">To {msg.toLocalPart}@ · {isNaN(received.getTime()) ? '' : received.toLocaleString()}</DText>
          </View>
        </Card>
        <Card><DText selectable>{body}</DText></Card>
        <View style={{ gap: space[2] }}>
          <TextField label={`Reply as ${msg.toLocalPart}@ to ${msg.fromEmail}`} value={reply} onChangeText={setReply} multiline placeholder="Write a reply" />
          <Button label="Send reply" icon="send" size="lg" fullWidth loading={busy} onPress={send} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  )
}
