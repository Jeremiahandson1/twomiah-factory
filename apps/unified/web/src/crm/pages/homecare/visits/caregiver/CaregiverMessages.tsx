// Moved from templates/crm-homecare/frontend/src/components/caregiver/CaregiverMessages.tsx — the caregiver's message
// inbox (mobile first, full screen).
//
// Server: GET /api/messages/inbox, GET /api/messages/thread/:id, POST /api/messages/thread/:id/reply
// (server/crm/homecare/portals/messages.ts). Changes from the template:
//   · no token: the app's client; "is this mine" compares senderId with the signed-in user's id (the template decoded
//     its token);
//   · the inbox reads the unified reply ({ data } rows, camelCase): `unread` is a yes/no (the template counted
//     `unread_count`), the last line is `latestMessage.body`, its time `latestMessage.createdAt` (else `updatedAt`). The
//     inbox carries no participants (the template's `other_participants`, `sender_first`), so a thread is labelled by
//     its last sender (or "Admin Broadcast"); the open thread's participants (GET /thread/:id) name who it is with;
//   · a message names its sender in `senderName` (the template's first_name / last_name);
//   · the inbox polls through usePolling (paused while the tab is hidden); the template's setInterval kept going;
//   · both themes: every colour is a frame token, the brand fill the frame's deep brand (white on it in both themes),
//     the unread badge white on red-700.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, rows } from '../../lib/http'
import { useAuth, useToast } from '../../../../../shared'
import { usePolling } from '../../lib/usePolling'
import { formatAgencyDate, formatAgencyDateTime } from '../../lib/agencyClock'

/** A row of GET /api/messages/inbox. */
interface Thread {
  id: string
  subject: string
  isBroadcast: boolean
  updatedAt?: string | null
  unread?: boolean | null
  latestMessage?: { body: string; senderName: string; createdAt: string } | null
}

/** A message of GET /api/messages/thread/:id (senderName) or the reply of POST /thread/:id/reply (no senderName). */
interface Message { id: string; senderId: string; body: string; createdAt: string; senderName?: string }
interface Participant { userId: string; firstName: string | null; lastName: string | null }
interface ThreadReply { messages: Message[]; participants: Participant[] }

const BRAND_FILL = 'var(--hc-brand-deep)'
const BRAND_INK = 'var(--color-teal-dark)'
const BRAND_TINT = 'var(--color-teal-light)'
const UNREAD_RED = '#b91c1c'

const CaregiverMessages = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuth()
  const toast = useToast()
  const myId = user?.id
  const [view, setView] = useState<'inbox' | 'thread'>('inbox')
  const [threads, setThreads] = useState<Thread[]>([])
  const [activeThread, setActiveThread] = useState<Thread | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [replyBody, setReplyBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const loadInbox = useCallback(async () => {
    try {
      setThreads(rows<Thread>(await api.get('/api/messages/inbox')))
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  usePolling(loadInbox, 20000)

  useEffect(() => {
    if (view === 'thread') messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, view])

  const openThread = async (thread: Thread) => {
    setActiveThread(thread)
    setParticipants([])
    setMessages([])
    setView('thread')
    try {
      const data: ThreadReply = await api.get(`/api/messages/thread/${thread.id}`)
      setMessages(Array.isArray(data?.messages) ? data.messages : [])
      setParticipants(Array.isArray(data?.participants) ? data.participants : [])
      setThreads((prev) => prev.map((t) => t.id === thread.id ? { ...t, unread: false } : t))
    } catch { toast.error('Could not load messages') }
  }

  const sendReply = async () => {
    if (!replyBody.trim() || sending || !activeThread) return
    setSending(true)
    try {
      const msg: Message = await api.post(`/api/messages/thread/${activeThread.id}/reply`, { body: replyBody })
      setMessages((prev) => [...prev, msg])
      setReplyBody('')
    } catch { toast.error('Failed to send') }
    finally { setSending(false) }
  }

  const formatTime = (ts: string | null | undefined) => {
    if (!ts) return ''
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    const diff = Date.now() - d.getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
    if (diff < 86400000) return formatAgencyDateTime(d, { hour: '2-digit', minute: '2-digit' })
    if (diff < 604800000) return formatAgencyDate(d, { weekday: 'short' })
    return formatAgencyDate(d, { month: 'short', day: 'numeric' })
  }

  const totalUnread = threads.filter((t) => t.unread).length
  const shell = { position: 'fixed', inset: 0, background: 'var(--hc-surface)', color: 'var(--hc-ink)', zIndex: 9999, display: 'flex', flexDirection: 'column' } as const

  // ─── INBOX ───────────────────────────────────────────────────────────────
  if (view === 'inbox') return (
    <div style={shell}>
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--hc-line)', display: 'flex', alignItems: 'center', gap: '0.875rem', flexShrink: 0 }}>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--hc-muted)', fontSize: '1.25rem', padding: 0 }}>✕</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: 'var(--hc-ink)' }}>
            💬 Messages
            {totalUnread > 0 && <span style={{ background: UNREAD_RED, color: '#fff', borderRadius: '99px', fontSize: '0.65rem', padding: '2px 7px', marginLeft: '0.4rem', verticalAlign: 'middle' }}>{totalUnread}</span>}
          </h2>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--hc-muted)' }}>From your team</p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)' }}>Loading...</div>
        ) : threads.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--hc-muted)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📭</div>
            <p style={{ fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--hc-ink)' }}>No messages yet</p>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>Your supervisor will send messages here.</p>
          </div>
        ) : threads.map((thread) => {
          const unread = !!thread.unread
          const sender = thread.isBroadcast ? 'Admin Broadcast' : (thread.latestMessage?.senderName || thread.subject)
          return (
            <div key={thread.id} onClick={() => openThread(thread)}
              style={{ display: 'flex', gap: '0.875rem', padding: '0.875rem', background: unread ? BRAND_TINT : 'var(--hc-surface)', border: `1px solid ${unread ? 'var(--color-teal)' : 'var(--hc-line)'}`, borderRadius: '12px', marginBottom: '0.5rem', cursor: 'pointer', alignItems: 'center' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: unread ? BRAND_FILL : 'var(--hc-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', flexShrink: 0 }}>
                {thread.isBroadcast ? '📢' : '💬'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.2rem', gap: '0.5rem' }}>
                  <span style={{ fontWeight: unread ? 800 : 600, fontSize: '0.9rem', color: 'var(--hc-ink)' }}>{sender}</span>
                  <span style={{ fontSize: '0.72rem', color: 'var(--hc-muted)', whiteSpace: 'nowrap' }}>{formatTime(thread.latestMessage?.createdAt || thread.updatedAt)}</span>
                </div>
                <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', fontWeight: unread ? 700 : 500, marginBottom: '0.1rem' }}>{thread.subject}</div>
                <div style={{ fontSize: '0.78rem', color: 'var(--hc-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {thread.latestMessage?.body || 'No messages yet'}
                </div>
              </div>
              {unread && <div style={{ background: UNREAD_RED, color: '#fff', borderRadius: '99px', fontSize: '0.65rem', fontWeight: 700, padding: '2px 7px', flexShrink: 0 }}>New</div>}
            </div>
          )
        })}
      </div>
    </div>
  )

  // ─── THREAD / CHAT VIEW ──────────────────────────────────────────────────
  const others = participants.filter((p) => p.userId !== myId)
  return (
    <div style={shell}>
      <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--hc-line)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
        <button onClick={() => { setView('inbox'); loadInbox() }} aria-label="Back to inbox" style={{ background: 'none', border: 'none', cursor: 'pointer', color: BRAND_INK, fontWeight: 700, fontSize: '1rem', padding: 0 }}>←</button>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800, color: 'var(--hc-ink)' }}>{activeThread?.subject}</h3>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--hc-muted)' }}>
            {activeThread?.isBroadcast ? '📢 Sent to all staff' : others.map((p) => `${p.firstName || ''} ${p.lastName || ''}`.trim()).join(', ')}
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {messages.map((msg) => {
          const isMe = msg.senderId === myId
          return (
            <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)', marginBottom: '0.2rem', paddingLeft: isMe ? 0 : '0.25rem', paddingRight: isMe ? '0.25rem' : 0 }}>
                {isMe ? 'You' : (msg.senderName || '')} · {formatTime(msg.createdAt)}
              </div>
              <div style={{ maxWidth: '80%', padding: '0.75rem 1rem', borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isMe ? BRAND_FILL : 'var(--hc-subtle)', color: isMe ? '#fff' : 'var(--hc-ink)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {msg.body}
              </div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--hc-line)', display: 'flex', gap: '0.5rem', background: 'var(--hc-surface)', flexShrink: 0 }}>
        <textarea
          value={replyBody}
          onChange={(e) => setReplyBody(e.target.value)}
          placeholder="Reply..."
          rows={1}
          style={{ flex: 1, padding: '0.75rem 1rem', border: '1px solid var(--hc-line)', borderRadius: '24px', resize: 'none', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, background: 'var(--hc-surface)', color: 'var(--hc-ink)' }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
        />
        <button onClick={sendReply} disabled={sending || !replyBody.trim()} aria-label="Send"
          style={{ width: '44px', height: '44px', borderRadius: '50%', background: replyBody.trim() ? BRAND_FILL : 'var(--hc-subtle)', color: replyBody.trim() ? '#fff' : 'var(--hc-muted)', border: 'none', cursor: replyBody.trim() ? 'pointer' : 'default', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {sending ? '⋯' : '↑'}
        </button>
      </div>
    </div>
  )
}

export default CaregiverMessages
