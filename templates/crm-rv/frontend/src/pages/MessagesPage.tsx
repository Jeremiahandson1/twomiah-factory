import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Send, Loader2, AlertTriangle, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const PRIMARY = '{{PRIMARY_COLOR}}';
const POLL_MS = 15000;

interface LastMessage {
  body: string;
  direction: 'inbound' | 'outbound';
  createdAt: string;
  status: string;
}

interface Conversation {
  contactId: string | null;
  contactName: string | null;
  number: string;
  unread: number;
  lastMessage: LastMessage | null;
}

interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  status: string;
  createdAt: string;
  mediaUrls?: string[];
}

interface ThreadContact {
  id?: string;
  name?: string;
  phone?: string;
  mobile?: string;
}

const FAILED_STATUSES = ['failed', 'undelivered', 'error'];
const isFailed = (s?: string) => !!s && FAILED_STATUSES.includes(s.toLowerCase());

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return 'now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const convoKey = (c: Conversation) => c.contactId ?? `num:${c.number}`;

export default function MessagesPage() {
  const { token } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [contact, setContact] = useState<ThreadContact | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const selectedConvo = conversations.find(c => convoKey(c) === selectedKey) || null;

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch('/api/sms/conversations', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch (err) {
      console.error('Failed to load conversations:', err);
    } finally {
      setLoadingConvos(false);
    }
  }, [token]);

  // Initial load + 15s polling for new inbound
  useEffect(() => {
    loadConversations();
    const id = setInterval(loadConversations, POLL_MS);
    return () => clearInterval(id);
  }, [loadConversations]);

  // Open a thread (also marks read server-side); refresh convo list so badge clears
  const openThread = useCallback(async (contactId: string) => {
    setLoadingThread(true);
    setWarning(null);
    try {
      const res = await fetch(`/api/sms/conversations/${contactId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load thread');
      const data = await res.json();
      setContact(data.contact || null);
      setMessages(data.messages || []);
      // The GET marked the thread read — refresh list to clear the unread badge.
      loadConversations();
    } catch (err) {
      console.error('Failed to load thread:', err);
      setMessages([]);
    } finally {
      setLoadingThread(false);
    }
  }, [token, loadConversations]);

  const handleSelect = (c: Conversation) => {
    setSelectedKey(convoKey(c));
    setWarning(null);
    if (c.contactId) {
      openThread(c.contactId);
    } else {
      // Unmatched inbound number — no contact thread endpoint; composer disabled.
      setContact({ name: c.contactName || c.number, phone: c.number });
      setMessages([]);
    }
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadingThread]);

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || !selectedConvo?.contactId || sending) return;
    setSending(true);
    setWarning(null);
    try {
      const res = await fetch('/api/sms/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId: selectedConvo.contactId, body }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        if (data.message) setMessages(prev => [...prev, data.message]);
        setDraft('');
        loadConversations();
      } else if (res.status === 502) {
        // Message stored but not delivered (e.g. Twilio not configured).
        if (data.message) setMessages(prev => [...prev, data.message]);
        setWarning(data.warning || 'Message could not be delivered.');
        setDraft('');
        loadConversations();
      } else {
        setWarning(data.message || 'Failed to send message.');
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setWarning('Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const unmatched = !!selectedConvo && !selectedConvo.contactId;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Messages</h1>
        <p style={{ color: '#6b7280', margin: '4px 0 0' }}>Two-way texting with your contacts</p>
      </div>

      <div style={{ display: 'flex', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', background: '#fff', height: 'calc(100vh - 180px)', minHeight: 480 }}>
        {/* Conversation list */}
        <div style={{ width: 320, borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6', fontWeight: 600, fontSize: 14, color: '#374151' }}>
            Conversations
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingConvos ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
              </div>
            ) : conversations.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
                <MessageSquare size={32} style={{ marginBottom: 10, opacity: 0.4 }} />
                <p style={{ fontSize: 14, margin: 0 }}>No conversations yet</p>
              </div>
            ) : (
              conversations.map(c => {
                const key = convoKey(c);
                const active = key === selectedKey;
                const name = c.contactName || c.number;
                return (
                  <button
                    key={key}
                    onClick={() => handleSelect(c)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px',
                      border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer',
                      background: active ? '#f9fafb' : '#fff',
                      borderLeft: active ? `3px solid ${PRIMARY}` : '3px solid transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontSize: 14, fontWeight: c.unread > 0 ? 700 : 600, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
                      <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 0 }}>{relativeTime(c.lastMessage?.createdAt)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 4 }}>
                      <span style={{ fontSize: 13, color: c.unread > 0 ? '#374151' : '#9ca3af', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {c.lastMessage?.direction === 'outbound' ? 'You: ' : ''}{c.lastMessage?.body || 'No messages'}
                      </span>
                      {c.unread > 0 && (
                        <span style={{ flexShrink: 0, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: PRIMARY, color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Thread */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {!selectedConvo ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
              <MessageSquare size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p style={{ fontSize: 15, margin: 0 }}>Select a conversation</p>
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
                  <User size={18} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#111827' }}>{contact?.name || selectedConvo.contactName || selectedConvo.number}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 12, color: '#9ca3af' }}>{contact?.phone || contact?.mobile || selectedConvo.number}</p>
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: '#fafafa' }}>
                {loadingThread ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                    <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
                  </div>
                ) : unmatched ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 13 }}>
                    This number isn&apos;t linked to a contact yet.
                  </div>
                ) : messages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af', fontSize: 13 }}>
                    No messages in this thread yet.
                  </div>
                ) : (
                  messages.map(m => {
                    const outbound = m.direction === 'outbound';
                    const failed = isFailed(m.status);
                    return (
                      <div key={m.id} style={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                        <div style={{ maxWidth: '72%' }}>
                          <div style={{
                            padding: '9px 13px', borderRadius: 14, fontSize: 14, lineHeight: 1.4, wordBreak: 'break-word',
                            background: outbound ? PRIMARY : '#fff',
                            color: outbound ? '#fff' : '#111827',
                            border: outbound ? 'none' : '1px solid #e5e7eb',
                            borderBottomRightRadius: outbound ? 4 : 14,
                            borderBottomLeftRadius: outbound ? 14 : 4,
                          }}>
                            {m.body}
                            {m.mediaUrls && m.mediaUrls.length > 0 && (
                              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {m.mediaUrls.map((url, i) => (
                                  <img key={i} src={url} alt="attachment" style={{ maxWidth: '100%', borderRadius: 8 }} />
                                ))}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', justifyContent: outbound ? 'flex-end' : 'flex-start', gap: 6, marginTop: 3, fontSize: 11, color: failed ? '#dc2626' : '#9ca3af' }}>
                            <span>{relativeTime(m.createdAt)}</span>
                            {failed && <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontWeight: 600 }}><AlertTriangle size={11} /> {m.status}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {/* Composer */}
              <div style={{ borderTop: '1px solid #f3f4f6', padding: 14 }}>
                {warning && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '8px 12px', background: '#fef3c7', borderRadius: 8, color: '#92400e', fontSize: 13 }}>
                    <AlertTriangle size={15} /> {warning}
                  </div>
                )}
                {unmatched ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>
                    Link this number to a contact to reply.
                  </p>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                      placeholder="Type a message..."
                      rows={2}
                      style={{ flex: 1, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, resize: 'none', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                    <button
                      onClick={handleSend}
                      disabled={sending || !draft.trim()}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, cursor: sending || !draft.trim() ? 'default' : 'pointer', opacity: sending || !draft.trim() ? 0.6 : 1, fontWeight: 600, fontSize: 14, height: 42 }}
                    >
                      {sending ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />} Send
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
