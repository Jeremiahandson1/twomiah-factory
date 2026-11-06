/**
 * New message to the office.
 *   GET  /api/messages/users     active users { id, firstName, lastName, role } — the office ones
 *                                (manager / admin / owner: isOfficeRole) are offered
 *   POST /api/messages/send      { subject, body, recipientIds } → { thread, message }
 * Row 16 (care_offline_saves): with no signal the message is kept on the phone and sent when there is signal (AxisCare: message
 * the office with no signal), and the office list comes from the copy kept on the phone.
 */
import React, { useEffect, useState } from 'react'
import { Text, StyleSheet, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '../../src/theme/ThemeContext'
import { useToast } from '../../src/components/ToastProvider'
import { isOfficeRole } from '../../src/auth/roles'
import { careGet, carePost, asList } from '../../src/care/careApi'
import { CareScreen } from '../../src/care/screen'
import { useCare } from '../../src/care/CareContext'
import { useOfflineApi } from '../../src/offline/useOfflineApi'
import { getSaved } from '../../src/offline/readThrough'
import { Banner, Button, Choice, Field, SectionTitle } from '../../src/care/ui'

export default function ComposeScreen() {
  const t = useTheme()
  const toast = useToast()
  const router = useRouter()
  const [office, setOffice] = useState<any[] | null>(null)
  const [to, setTo] = useState<Set<string>>(new Set())
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const care = useCare()
  const queue = useOfflineApi()

  useEffect(() => {
    (care.offlineSaves ? getSaved('/api/messages/users') : careGet('/api/messages/users')).then((r) => {
      const list = r.ok ? asList(r.data).filter((u: any) => isOfficeRole(u.role)) : []
      setOffice(list)
      setTo(new Set(list.map((u: any) => u.id))) // the whole office by default
    })
  }, [])

  const toggle = (id: string) => setTo((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const send = async () => {
    if (!to.size) return Alert.alert('Pick who to send it to')
    if (!subject.trim()) return Alert.alert('Add a subject')
    if (!body.trim()) return Alert.alert('Write your message')
    setSending(true)
    const msg = { subject: subject.trim(), body: body.trim(), recipientIds: Array.from(to) }
    const r: { ok: boolean; status: number; data?: any; error?: string; queued?: boolean } = care.offlineSaves
      ? await queue.post('/api/messages/send', msg, { recordKey: 'messages', label: `Message: ${msg.subject}` })
      : await carePost('/api/messages/send', msg)
    setSending(false)
    if (r.ok && r.queued) { toast.info('Saved on your phone. It will be sent to the office when you have signal.'); router.back(); return }
    if (!r.ok) { Alert.alert('Not sent', r.status === 0 ? 'No connection — try again when you have signal.' : r.error || 'Please try again.'); return }
    toast.success('Message sent')
    const id = r.data?.thread?.id
    if (id) router.replace(`/(care)/thread/${id}` as any)
    else router.back()
  }

  return (
    <CareScreen keyboard>
      <SectionTitle>To</SectionTitle>
      {office === null ? <Text style={[styles.meta, { color: t.textSecondary }]}>Loading…</Text>
        : office.length === 0 ? <Banner tone="warning" icon="people-outline">No office staff found to message. Call the office instead.</Banner>
          : office.map((u) => <Choice key={u.id} label={`${u.firstName || ''} ${u.lastName || ''}`.trim()} sub="Office" selected={to.has(u.id)} onPress={() => toggle(u.id)} />)}
      <Field label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Running late to my 2 PM visit" />
      <Field label="Message" value={body} onChangeText={setBody} multiline placeholder="Write your message" />
      <Button label="Send" icon="send" loading={sending} onPress={send} />
    </CareScreen>
  )
}

const styles = StyleSheet.create({ meta: { fontSize: 14, marginBottom: 10 } })
