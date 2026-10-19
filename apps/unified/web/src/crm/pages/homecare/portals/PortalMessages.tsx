// The client portal's Messages: the client's threads with the office (answered from the office's Family Portal screen,
// ./FamilyPortalAdmin.tsx). Moved from templates/crm-homecare/frontend/src/components/portal/PortalMessages.tsx.
//
// Server (server/crm/homecare/portals/clientPortal.ts): GET /api/portal/messages — a list of threads (id, subject,
// status, lastMessageAt, createdAt, lastMessage, messageCount, hasUnread); POST /api/portal/messages { subject, body } →
// { thread, message }; GET /api/portal/messages/:threadId → { thread, messages }; POST /api/portal/messages/:threadId
// { body } → the message; POST /api/portal/messages/:threadId/read → { success }.
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import { formatAgencyDate } from '../lib/agencyClock'
import { listRows, usePortal } from './portalHttp'

interface Message { id: string; senderType: string; senderName: string | null; body: string; createdAt: string }
interface Thread {
  id: string
  subject: string
  status: string
  lastMessageAt: string | null
  createdAt: string | null
  lastMessage: Message | null
  messageCount: number
  hasUnread: boolean
}

const formatRelativeTime = (iso: string | null | undefined) => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  // An instant's day on the agency's clock.
  return formatAgencyDate(iso, { month: 'short', day: 'numeric' })
}

const field: CSSProperties = { width: '100%', borderRadius: '8px', padding: '10px 14px', fontSize: '0.9rem', boxSizing: 'border-box', fontFamily: 'inherit' }
const navyBtn = (dim: boolean): CSSProperties => ({
  background: 'var(--hcp-navy-fill)', color: '#fff', border: 'none', padding: '8px 18px', borderRadius: '8px',
  cursor: dim ? 'not-allowed' : 'pointer', fontSize: '0.85rem', fontWeight: 600, opacity: dim ? 0.6 : 1,
})

export default function PortalMessages({ onRead }: { onRead?: () => void }) {
  const portal = usePortal()
  const [threads, setThreads] = useState<Thread[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedThread, setSelectedThread] = useState<Thread | null>(null)
  const [threadMessages, setThreadMessages] = useState<Message[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newBody, setNewBody] = useState('')
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const loadThreads = () => {
    setLoading(true)
    portal.get('/api/portal/messages')
      .then((reply) => { if (reply) setThreads(listRows<Thread>(reply)) })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadThreads() }, [portal]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [threadMessages])

  const openThread = async (thread: Thread) => {
    setSelectedThread(thread)
    setThreadLoading(true)
    try {
      const data = await portal.get<{ thread: Thread; messages: Message[] }>(`/api/portal/messages/${thread.id}`)
      if (data) {
        setThreadMessages(Array.isArray(data.messages) ? data.messages : [])
        if (thread.hasUnread) {
          await portal.send('POST', `/api/portal/messages/${thread.id}/read`)
          setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, hasUnread: false } : t)))
          onRead?.()
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setThreadLoading(false)
    }
  }

  const handleCompose = async (e: FormEvent) => {
    e.preventDefault()
    if (!newSubject.trim() || !newBody.trim()) return
    setSending(true)
    try {
      await portal.send('POST', '/api/portal/messages', { subject: newSubject, body: newBody })
      setNewSubject('')
      setNewBody('')
      setShowCompose(false)
      loadThreads()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const handleReply = async (e: FormEvent) => {
    e.preventDefault()
    if (!replyBody.trim() || !selectedThread) return
    setSending(true)
    try {
      const msg = await portal.send<Message>('POST', `/api/portal/messages/${selectedThread.id}`, { body: replyBody })
      if (msg) {
        setThreadMessages((prev) => [...prev, msg])
        setReplyBody('')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSending(false)
    }
  }

  const goBack = () => {
    setSelectedThread(null)
    setThreadMessages([])
    setReplyBody('')
    loadThreads()
  }

  if (loading && threads.length === 0) {
    return <div style={{ textAlign: 'center', padding: '40px', color: 'var(--hc-muted)' }}>Loading messages...</div>
  }

  // ── One thread ──
  if (selectedThread) {
    return (
      <div>
        <button
          onClick={goBack}
          style={{ background: 'none', border: 'none', color: 'var(--hc-blue-ink)', cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600, padding: '0', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '4px' }}
        >
          ← Back to Messages
        </button>

        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: 'var(--hcp-navy)' }}>{selectedThread.subject}</h3>
          <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)' }}>
            {selectedThread.status === 'closed' ? 'Closed' : 'Open'} &middot; {formatRelativeTime(selectedThread.createdAt)}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px', maxHeight: '400px', overflowY: 'auto', padding: '4px' }}>
          {threadLoading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--hc-muted)' }}>Loading...</div>
          ) : threadMessages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--hc-muted)' }}>No messages yet.</div>
          ) : (
            threadMessages.map((msg) => {
              const isClient = msg.senderType === 'client'
              return (
                <div key={msg.id} style={{ alignSelf: isClient ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                  <div style={{
                    background: isClient ? 'var(--hcp-navy-fill)' : 'var(--hc-subtle)',
                    color: isClient ? '#fff' : 'var(--hc-ink)',
                    borderRadius: isClient ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '12px 16px',
                  }}>
                    <div style={{ fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{msg.body}</div>
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--hc-muted)', marginTop: '4px', textAlign: isClient ? 'right' : 'left' }}>
                    {msg.senderName || (isClient ? 'You' : 'Agency')} &middot; {formatRelativeTime(msg.createdAt)}
                  </div>
                </div>
              )
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {selectedThread.status !== 'closed' && (
          <form onSubmit={handleReply} style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
            <textarea className="hcp-field" value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Type your reply..." rows={3} style={{ ...field, resize: 'vertical' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button type="submit" disabled={sending || !replyBody.trim()} style={{ ...navyBtn(sending || !replyBody.trim()), padding: '8px 20px', fontSize: '0.88rem' }}>
                {sending ? 'Sending...' : 'Send Reply'}
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  // ── The threads ──
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', color: 'var(--hcp-navy)' }}>💬 Messages</h2>
        <button onClick={() => setShowCompose(true)} style={navyBtn(false)}>+ New Message</button>
      </div>

      {error && (
        <div style={{ background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', fontSize: '0.88rem' }}>{error}</div>
      )}

      {showCompose && (
        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px', border: '2px solid var(--hcp-navy)' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem', color: 'var(--hcp-navy)' }}>New Message to Agency</h3>
          <form onSubmit={handleCompose}>
            <div style={{ marginBottom: '12px' }}>
              <input className="hcp-field" type="text" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="Subject" required style={field} />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <textarea className="hcp-field" value={newBody} onChange={(e) => setNewBody(e.target.value)} placeholder="Type your message..." rows={4} required style={{ ...field, resize: 'vertical' }} />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowCompose(false); setNewSubject(''); setNewBody('') }}
                style={{ background: 'transparent', color: 'var(--hc-ink-soft)', border: '1px solid var(--hc-line)', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
              <button type="submit" disabled={sending} style={navyBtn(sending)}>{sending ? 'Sending...' : 'Send Message'}</button>
            </div>
          </form>
        </div>
      )}

      {threads.length === 0 && !showCompose ? (
        <div style={{ background: 'var(--hc-surface)', borderRadius: '12px', padding: '48px', textAlign: 'center', color: 'var(--hc-muted)', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>💬</div>
          <div style={{ fontSize: '1rem', fontWeight: 500 }}>No messages yet</div>
          <div style={{ fontSize: '0.85rem', marginTop: '8px' }}>Start a conversation with your care team.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {threads.map((thread) => (
            <div
              key={thread.id}
              onClick={() => openThread(thread)}
              style={{
                background: thread.hasUnread ? 'var(--hcp-unread)' : 'var(--hc-surface)',
                borderRadius: '12px', padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', cursor: 'pointer',
                borderLeft: thread.hasUnread ? '4px solid var(--hcp-mark)' : '4px solid var(--hc-line)',
                display: 'flex', gap: '14px', alignItems: 'flex-start', transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: '2px' }}>{thread.hasUnread ? '💬' : '✉️'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{ fontWeight: thread.hasUnread ? 700 : 500, color: 'var(--hcp-navy)', fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.subject}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', flexShrink: 0 }}>{formatRelativeTime(thread.lastMessageAt)}</div>
                </div>
                {thread.lastMessage && (
                  <div style={{ fontSize: '0.83rem', color: 'var(--hc-ink-soft)', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {thread.lastMessage.senderType === 'client' ? 'You: ' : 'Agency: '}
                    {thread.lastMessage.body}
                  </div>
                )}
                <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', marginTop: '4px' }}>
                  {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''}
                  {thread.status === 'closed' && (
                    <span style={{ background: 'var(--hc-subtle)', color: 'var(--hc-muted)', padding: '1px 6px', borderRadius: '8px', fontSize: '0.7rem', marginLeft: '8px' }}>Closed</span>
                  )}
                </div>
              </div>
              {thread.hasUnread && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--hcp-mark)', flexShrink: 0, marginTop: '6px' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
