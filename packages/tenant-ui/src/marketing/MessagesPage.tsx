// Two-way texting inbox — ONE page for every CRM (vendored into each template as ../shared). Talks to the shared
// /api/sms routes. Before: two copies (typed / untyped) with alert() for send failures and a Phone / ⋮ button pair
// that did nothing.
import React, { useState, useEffect, useRef, useCallback } from 'react'
import { MessageSquare, Send, Search, User, Clock, Check, CheckCheck, AlertCircle, Loader2, Plus, ArrowLeft, Archive } from 'lucide-react'
import { errMsg, inputCls } from '../invoicing/ui'
import type { MarketingApi, MarketingToast, MessagesConfig } from './types'

interface Conversation { id: string; phoneNumber?: string; unreadCount?: number; contact?: { id?: string; name?: string; email?: string } | null; lastMessage?: { body?: string; direction?: string; createdAt?: string } | null; archived?: boolean }
interface Msg { id: string; body: string; direction: 'inbound' | 'outbound' | string; status?: string; createdAt: string }

// +16085550188 → (608) 555-0188; anything else is shown as stored.
export function fmtPhone(p: unknown): string {
  const d = String(p || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return String(p || '')
}
function timeAgo(v?: string): string {
  if (!v) return ''
  const diff = Date.now() - new Date(v).getTime()
  const m = Math.floor(diff / 60000), h = Math.floor(diff / 3600000), d = Math.floor(diff / 86400000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  if (h < 24) return `${h}h`
  if (d < 7) return `${d}d`
  return new Date(v).toLocaleDateString()
}
/** Backend rows are { conversation, contact } — flatten so conv.id / phoneNumber / unreadCount resolve (CC-03/VET-05). */
const flatten = (rows: any[]): Conversation[] => (rows || []).map((row: any) => (row?.conversation ? { ...row.conversation, contact: row.contact } : row))

export function MessagesPage({ api, toast, config }: { api: MarketingApi; toast: MarketingToast; config?: MessagesConfig }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [search, setSearch] = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [error, setError] = useState('')

  const loadConversations = useCallback(async () => {
    try { const data = await api.get('/api/sms/conversations', { search: search || undefined, unreadOnly: unreadOnly || undefined }); setConversations(flatten(data?.data)); setError('') }
    catch (e) { setError(errMsg(e, 'Failed to load conversations')) }
    finally { setLoading(false) }
  }, [api, search, unreadOnly])
  useEffect(() => { loadConversations(); const t = setInterval(loadConversations, 10000); return () => clearInterval(t) }, [loadConversations])

  const select = async (conv: Conversation) => {
    setSelected(conv); setLoadingMessages(true)
    try {
      const data = await api.get(`/api/sms/conversations/${conv.id}`)
      setMessages(data?.messages || [])
      if ((conv.unreadCount || 0) > 0) loadConversations() // the backend marks the thread read when fetched
    } catch (e) { toast.error(errMsg(e, 'Failed to load messages')) }
    finally { setLoadingMessages(false) }
  }
  const archive = async (conv: Conversation) => {
    try { await api.post(`/api/sms/conversations/${conv.id}/archive`); toast.success('Conversation archived'); setSelected(null); loadConversations() }
    catch (e) { toast.error(errMsg(e, 'Failed to archive')) }
  }

  return (
    <div className="h-[calc(100vh-8rem)] flex" data-testid="messages-page-shared">
      <div className={`w-80 border-r bg-white dark:bg-slate-900 dark:border-slate-800 flex flex-col ${selected ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 border-b dark:border-slate-800">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900 dark:text-slate-100">Messages</h1>
            <button onClick={() => setShowNew(true)} aria-label="New message" className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg"><Plus className="w-5 h-5" /></button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations..." className={`${inputCls} pl-10 text-sm`} />
          </div>
          <div className="flex gap-2 mt-2">
            <button onClick={() => setUnreadOnly(false)} className={`flex-1 py-1.5 text-sm rounded-lg ${!unreadOnly ? 'bg-gray-100 text-gray-900 dark:bg-slate-800 dark:text-slate-100' : 'text-gray-500'}`}>All</button>
            <button onClick={() => setUnreadOnly(true)} className={`flex-1 py-1.5 text-sm rounded-lg ${unreadOnly ? 'bg-orange-100 text-orange-700' : 'text-gray-500'}`}>Unread</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {error && <div role="alert" className="m-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
          {loading ? <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
            : conversations.length === 0 ? (
              <div className="text-center py-12 text-gray-500 dark:text-slate-400"><MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" /><p>No conversations yet</p><p className="text-xs mt-1">{config?.subtitle || 'Texts you send and receive show up here.'}</p></div>
            ) : conversations.map((conv) => (
              <button key={conv.id} onClick={() => select(conv)} className={`w-full p-4 text-left border-b dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors ${selected?.id === conv.id ? 'bg-orange-50 dark:bg-orange-950/30' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center dark:bg-slate-800"><User className="w-5 h-5 text-gray-500 dark:text-slate-400" /></div>
                    {(conv.unreadCount || 0) > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center">{conv.unreadCount}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`font-medium truncate ${(conv.unreadCount || 0) > 0 ? 'text-gray-900 dark:text-slate-100' : 'text-gray-700 dark:text-slate-300'}`}>{conv.contact?.name || fmtPhone(conv.phoneNumber)}</p>
                      <span className="text-xs text-gray-500 dark:text-slate-400">{timeAgo(conv.lastMessage?.createdAt)}</span>
                    </div>
                    {conv.lastMessage && <p className={`text-sm truncate ${(conv.unreadCount || 0) > 0 ? 'text-gray-900 font-medium dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}>{conv.lastMessage.direction === 'outbound' && '↑ '}{conv.lastMessage.body}</p>}
                  </div>
                </div>
              </button>
            ))}
        </div>
      </div>

      <div className={`flex-1 flex flex-col bg-gray-50 dark:bg-slate-950 ${!selected ? 'hidden md:flex' : 'flex'}`}>
        {selected ? (
          <>
            <div className="p-4 bg-white border-b flex items-center gap-3 dark:bg-slate-900 dark:border-slate-800">
              <button onClick={() => setSelected(null)} className="md:hidden p-2 hover:bg-gray-100 rounded-lg" aria-label="Back"><ArrowLeft className="w-5 h-5" /></button>
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center"><User className="w-5 h-5 text-orange-600" /></div>
              <div className="flex-1">
                <p className="font-medium text-gray-900 dark:text-slate-100">{selected.contact?.name || fmtPhone(selected.phoneNumber)}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">{fmtPhone(selected.phoneNumber)}</p>
              </div>
              {selected.phoneNumber && <a href={`tel:${String(selected.phoneNumber).replace(/[^\d+]/g, '')}`} className="px-3 py-1.5 text-sm border rounded-lg hover:bg-gray-50 dark:border-slate-700 dark:hover:bg-slate-800">Call</a>}
              <button onClick={() => archive(selected)} title="Archive conversation" className="p-2 hover:bg-gray-100 rounded-lg dark:hover:bg-slate-800"><Archive className="w-5 h-5 text-gray-500 dark:text-slate-400" /></button>
            </div>
            <Thread api={api} toast={toast} messages={messages} loading={loadingMessages} conversationId={selected.id} onSent={() => { select(selected); loadConversations() }} />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 dark:text-slate-400"><div className="text-center"><MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" /><p>Select a conversation to view messages</p></div></div>
        )}
      </div>

      {showNew && <NewMessageModal api={api} toast={toast} contactsPath={config?.contactsPath || '/api/contacts'} onClose={() => setShowNew(false)} onSent={(conv) => { setShowNew(false); loadConversations(); if (conv?.id) select(conv) }} />}
    </div>
  )
}

function Thread({ api, toast, messages, loading, conversationId, onSent }: { api: MarketingApi; toast: MarketingToast; messages: Msg[]; loading: boolean; conversationId: string; onSent: () => void }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  const send = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!text.trim() || sending) return
    setSending(true)
    try { await api.post(`/api/sms/conversations/${conversationId}/reply`, { message: text.trim() }); setText(''); onSent() }
    catch (err) { toast.error(errMsg(err, 'Failed to send message')) }
    finally { setSending(false) }
  }
  const icon = (status?: string) => status === 'delivered' ? <CheckCheck className="w-4 h-4 text-blue-500" /> : status === 'sent' ? <Check className="w-4 h-4 text-gray-400" /> : status === 'failed' ? <AlertCircle className="w-4 h-4 text-red-500" /> : <Clock className="w-4 h-4 text-gray-300" />
  if (loading) return <div className="flex-1 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => {
          const out = msg.direction === 'outbound'
          return (
            <div key={msg.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[70%]">
                <div className={`px-4 py-2 rounded-2xl ${out ? 'bg-orange-500 text-white rounded-br-md' : 'bg-white border rounded-bl-md dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100'}`}><p className="text-sm whitespace-pre-wrap">{msg.body}</p></div>
                <div className={`flex items-center gap-1 mt-1 ${out ? 'justify-end' : ''}`}><span className="text-xs text-gray-400">{new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{out && icon(msg.status)}</div>
              </div>
            </div>
          )
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="p-4 bg-white border-t dark:bg-slate-900 dark:border-slate-800">
        <div className="flex gap-2">
          <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message..." className={inputCls} maxLength={1600} />
          <button type="submit" disabled={!text.trim() || sending} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed">{sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}</button>
        </div>
      </form>
    </>
  )
}

function NewMessageModal({ api, toast, contactsPath, onClose, onSent }: { api: MarketingApi; toast: MarketingToast; contactsPath: string; onClose: () => void; onSent: (conv: any) => void }) {
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; phone?: string | null; mobile?: string | null }>>([])
  const [matches, setMatches] = useState<typeof contacts>([])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api.get(contactsPath, { limit: 100 }).then((d: any) => setContacts(d?.data || [])).catch(() => setContacts([])) }, [api, contactsPath])
  const onType = (v: string) => { setTo(v); setMatches(v.length >= 2 ? contacts.filter((c) => (c.name || '').toLowerCase().includes(v.toLowerCase()) || (c.phone || '').includes(v) || (c.mobile || '').includes(v)).slice(0, 5) : []) }
  const send = async () => {
    const digits = to.replace(/\D/g, '')
    if (digits.length < 10) { setError('Enter a 10-digit phone number or pick a contact'); return }
    if (!body.trim()) { setError('Type a message'); return }
    setSending(true); setError('')
    try { const r = await api.post('/api/sms/send', { to, body: body.trim() }); toast.success('Message sent'); onSent(r?.conversation) }
    catch (e) { setError(errMsg(e, 'Failed to send message')) }
    finally { setSending(false) }
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div role="dialog" aria-label="New Message" className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6 dark:bg-slate-900">
          <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-slate-100">New Message</h2>
          <div className="space-y-4">
            {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">To</label>
              <input type="text" value={to} onChange={(e) => onType(e.target.value)} placeholder="Phone number or contact name" className={inputCls} />
              {matches.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg dark:bg-slate-900 dark:border-slate-700">
                  {matches.map((c) => <button key={c.id} type="button" onClick={() => { setTo(c.mobile || c.phone || ''); setMatches([]) }} className="w-full px-4 py-2 text-left hover:bg-gray-50 dark:hover:bg-slate-800"><p className="font-medium text-gray-900 dark:text-slate-100">{c.name}</p><p className="text-sm text-gray-500 dark:text-slate-400">{fmtPhone(c.mobile || c.phone)}</p></button>)}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Message</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} className={inputCls} rows={4} placeholder="Type your message..." maxLength={1600} />
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg dark:border-slate-700 dark:text-slate-200">Cancel</button>
              <button type="button" onClick={send} disabled={sending} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50">{sending ? 'Sending...' : 'Send'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
