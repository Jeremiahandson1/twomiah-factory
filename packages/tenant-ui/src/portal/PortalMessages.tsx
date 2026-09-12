// Portal messages: inbox list, detail (marks inbound read), compose.
import React, { useState, useEffect, useCallback } from 'react'
import { MessageSquare, Send, ArrowLeft, Mail, MailOpen, Plus } from 'lucide-react'
import { usePortal } from './PortalContext'
import { Spinner, PageTitle, Empty, card, btnPrimary, btnSecondary, inputCls, labelCls, formatDate } from './common'

interface PortalMessage { id: string; subject?: string | null; body: string; direction: 'inbound' | 'outbound' | string; status?: string | null; createdAt?: string; sentAt?: string | null }

export function PortalMessages() {
  const { fetch: portalFetch, config } = usePortal()
  const [messages, setMessages] = useState<PortalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<PortalMessage | null>(null)
  const [composing, setComposing] = useState(false)

  const load = useCallback(() => portalFetch('/messages').then((d) => setMessages(Array.isArray(d) ? d : [])).catch((e) => setError((e as Error).message)), [portalFetch])
  useEffect(() => { load().finally(() => setLoading(false)) }, [load])

  if (loading) return <Spinner />
  // From the customer's side, "inbound" rows are the ones the customer wrote; the company's replies are outbound.
  const fromCompany = (m: PortalMessage) => m.direction === 'outbound'
  const unread = messages.filter((m) => fromCompany(m) && m.status !== 'read').length
  if (selected) return <MessageDetail message={selected} onBack={() => { setSelected(null); load() }} />
  if (composing) return <ComposeMessage onBack={() => setComposing(false)} onSent={() => { setComposing(false); load() }} />

  return (
    <div>
      <PageTitle title="Messages" subtitle={<>Communicate with your {config.providerNoun}.{unread > 0 && <span className="ml-2 text-orange-600 font-medium">{unread} unread</span>}</>} action={<button onClick={() => setComposing(true)} className={btnPrimary}><Plus className="w-4 h-4" /> New Message</button>} />
      {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}</p>}
      {messages.length === 0 ? (
        <Empty icon={MessageSquare} text="No messages yet."><button onClick={() => setComposing(true)} className="mt-4 text-orange-600 hover:text-orange-700 text-sm font-medium">Send your first message</button></Empty>
      ) : (
        <div className={`${card} overflow-hidden divide-y dark:divide-slate-800`}>
          {messages.map((m) => {
            const isUnread = fromCompany(m) && m.status !== 'read'
            return (
              <button key={m.id} onClick={() => setSelected(m)} className={`w-full text-left p-4 hover:bg-gray-50 transition-colors dark:hover:bg-slate-800 ${isUnread ? 'bg-orange-50 dark:bg-orange-950/20' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg shrink-0 ${isUnread ? 'bg-orange-100' : 'bg-gray-100 dark:bg-slate-800'}`}>{isUnread ? <Mail className="w-4 h-4 text-orange-600" /> : <MailOpen className="w-4 h-4 text-gray-400" />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-sm truncate ${isUnread ? 'font-bold text-gray-900 dark:text-slate-100' : 'font-medium text-gray-700 dark:text-slate-200'}`}>{m.subject || '(No subject)'}</p>
                      <span className="text-xs text-gray-400 shrink-0">{formatDate(m.createdAt || m.sentAt)}</span>
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-0.5 dark:text-slate-400">{m.body}</p>
                    <span className={`text-xs ${fromCompany(m) ? 'text-blue-600' : 'text-gray-400'}`}>{fromCompany(m) ? `From your ${config.providerNoun}` : 'Sent by you'}</span>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MessageDetail({ message, onBack }: { message: PortalMessage; onBack: () => void }) {
  const { fetch: portalFetch, config } = usePortal()
  const [detail, setDetail] = useState<PortalMessage>(message)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    (async () => {
      try {
        const data = await portalFetch(`/messages/${message.id}`)
        setDetail(data)
        if (data.direction === 'outbound' && data.status !== 'read') await portalFetch(`/messages/${message.id}/read`, { method: 'POST', body: '{}' })
      } catch { /* keep the list copy */ } finally { setLoading(false) }
    })()
  }, [portalFetch, message.id])
  if (loading) return <Spinner />
  return (
    <div>
      <button onClick={onBack} className="text-orange-600 hover:underline text-sm mb-4 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to Messages</button>
      <div className={`${card} overflow-hidden`}>
        <div className="p-6 border-b dark:border-slate-700">
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">{detail.subject || '(No subject)'}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500 dark:text-slate-400"><span>{detail.direction === 'outbound' ? `From your ${config.providerNoun}` : 'Sent by you'}</span><span>-</span><span>{new Date(detail.createdAt || detail.sentAt || Date.now()).toLocaleString()}</span></div>
        </div>
        <div className="p-6"><p className="text-gray-700 whitespace-pre-wrap dark:text-slate-200">{detail.body}</p></div>
      </div>
    </div>
  )
}

function ComposeMessage({ onBack, onSent }: { onBack: () => void; onSent: () => void }) {
  const { fetch: portalFetch } = usePortal()
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const send = async () => {
    if (!body.trim()) { setError('Please enter a message.'); return }
    setSending(true); setError('')
    try { await portalFetch('/messages', { method: 'POST', body: JSON.stringify({ subject: subject || undefined, body }) }); onSent() }
    catch (e) { setError('Failed to send message: ' + (e as Error).message) } finally { setSending(false) }
  }
  return (
    <div>
      <button onClick={onBack} className="text-orange-600 hover:underline text-sm mb-4 inline-flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to Messages</button>
      <div className={`${card} overflow-hidden`}>
        <div className="p-6 border-b dark:border-slate-700"><h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">New Message</h1></div>
        <div className="p-6 space-y-4">
          <div><label htmlFor="msg-subject" className={labelCls}>Subject</label><input id="msg-subject" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is this about?" className={inputCls} /></div>
          <div><label htmlFor="msg-body" className={labelCls}>Message</label><textarea id="msg-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} placeholder="Type your message..." className={`${inputCls} resize-none`} /></div>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="p-6 bg-gray-50 border-t flex justify-end gap-3 dark:bg-slate-800/60 dark:border-slate-700">
          <button onClick={onBack} className={btnSecondary}>Cancel</button>
          <button onClick={send} disabled={sending || !body.trim()} className={btnPrimary}><Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send Message'}</button>
        </div>
      </div>
    </div>
  )
}
