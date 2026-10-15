/**
 * One message thread.
 *   GET  /api/messages/thread/:id         { thread, messages: [{ id, senderId, senderName, body, createdAt }] } (marks it read)
 *   POST /api/messages/thread/:id/reply   { body }
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { View, Text, FlatList, TextInput, StyleSheet, KeyboardAvoidingView, Platform, TouchableOpacity, ActivityIndicator } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../../../src/theme/ThemeContext'
import { useToast } from '../../../src/components/ToastProvider'
import { useCare } from '../../../src/care/CareContext'
import { careGet, carePost } from '../../../src/care/careApi'
import { Banner } from '../../../src/care/ui'
import { formatClock, formatYmdShort, ymdOf } from '../../../src/care/time'

export default function ThreadScreen() {
  const t = useTheme()
  const toast = useToast()
  const care = useCare()
  const { id } = useLocalSearchParams<{ id: string }>()
  const [data, setData] = useState<{ thread: any; messages: any[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<FlatList>(null)

  const load = useCallback(async () => {
    const r = await careGet(`/api/messages/thread/${id}`)
    if (r.ok && r.data) { setData({ thread: r.data.thread, messages: Array.isArray(r.data.messages) ? r.data.messages.filter((m: any) => !m.isDeleted) : [] }); setFailed(false) }
    else setFailed(true)
    care.refreshCounts()
  }, [id, care.refreshCounts])
  useEffect(() => { load() }, [load])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setSending(true)
    const r = await carePost(`/api/messages/thread/${id}/reply`, { body })
    setSending(false)
    if (!r.ok) { toast.error(r.status === 0 ? 'No connection — your message was not sent.' : r.error || 'Not sent.'); return }
    setText('')
    load()
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <Stack.Screen options={{ title: data?.thread?.subject || 'Message' }} />
      {failed && <View style={{ padding: 16 }}><Banner tone="warning" icon="cloud-offline-outline" onPress={load}>This conversation didn't load. Tap to try again.</Banner></View>}
      {!data && !failed ? <ActivityIndicator style={{ marginTop: 40 }} color={t.primary} /> : (
        <FlatList
          ref={listRef}
          data={data?.messages || []}
          keyExtractor={(m) => String(m.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 24 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item }) => {
            const mine = item.senderId === care.userId
            const d = new Date(item.createdAt)
            return (
              <View style={[styles.bubble, mine ? { alignSelf: 'flex-end', backgroundColor: t.primary } : { alignSelf: 'flex-start', backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }]}>
                {!mine && <Text style={[styles.sender, { color: t.textSecondary }]}>{item.senderName}</Text>}
                <Text style={[styles.body, { color: mine ? '#ffffff' : t.text }]}>{item.body}</Text>
                <Text style={[styles.when, { color: mine ? '#ffffff' : t.textSecondary }]}>{isNaN(d.getTime()) ? '' : `${formatYmdShort(ymdOf(d))} ${formatClock(d)}`}</Text>
              </View>
            )
          }}
        />
      )}
      <View style={[styles.composer, { backgroundColor: t.surface, borderTopColor: t.border }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Write a reply"
          placeholderTextColor={t.textMuted}
          multiline
          style={[styles.input, { color: t.text, backgroundColor: t.background, borderColor: t.border }]}
        />
        <TouchableOpacity onPress={send} disabled={sending || !text.trim()} style={[styles.send, { backgroundColor: t.primary, opacity: sending || !text.trim() ? 0.5 : 1 }]} accessibilityLabel="Send">
          {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 10, marginBottom: 8 },
  sender: { fontSize: 12, fontWeight: '700', marginBottom: 2 },
  body: { fontSize: 15, lineHeight: 21 },
  when: { fontSize: 11, marginTop: 4, opacity: 0.9 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15, maxHeight: 120 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
})
