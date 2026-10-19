// Moved from templates/crm-homecare/frontend/src/components/admin/MessageBoard.tsx.
// The company message board: send individual, group or broadcast messages (/api/messages, server/crm/homecare/portals/messages.ts).
//
// Changes from the template:
//   · the inbox reads the unified reply ({ data } rows, camelCase): `unread` is a yes/no (the template counted
//     `unread_count`), the last line is `latestMessage.body`, its time `latestMessage.createdAt` (else `updatedAt`).
//     The inbox carries no participants (the template's `other_participants`), so a thread is labelled by its
//     subject and the last sender; the thread's own participants (GET /thread/:id) name who it is with once open;
//   · "Send to Everyone" sends every active person's id with isBroadcast: true — the server takes a list of ids and
//     refused the template's recipientIds: 'all';
//   · the sent toast counts the recipients picked (the reply is { thread, message }, no recipientCount);
//   · "is this mine" compares senderId with the signed-in user's id (the template decoded its token);
//   · the inbox polls through usePolling (paused while the tab is hidden); the template's setInterval kept going;
//   · both themes: every colour is a frame token or a light/dark pair; the unread count is white on red-700 (4.5:1+).
import { useState, useEffect, useRef, useCallback } from 'react';
import { api, rows, errorMessage } from '../lib/http';
import { useAuth, useToast } from '../../../../shared';
import { usePolling } from '../lib/usePolling';
import { formatAgencyDate, formatAgencyDateTime } from '../lib/agencyClock';

/** A row of GET /api/messages/inbox. */
interface Thread {
  id: string;
  subject: string;
  threadType?: string | null;
  isBroadcast: boolean;
  createdById?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  lastReadAt?: string | null;
  unread?: boolean | null;
  latestMessage?: { body: string; senderName: string; createdAt: string } | null;
}

/** A message of GET /api/messages/thread/:id (senderName) or the reply of POST /thread/:id/reply (no senderName). */
interface Message {
  id: string;
  threadId: string;
  senderId: string;
  body: string;
  createdAt: string;
  senderName?: string;
}

interface Participant { userId: string; firstName: string | null; lastName: string | null }

/** GET /api/messages/thread/:id. */
interface ThreadReply { thread: Thread; messages: Message[]; participants: Participant[] }

/** A row of GET /api/messages/users. */
interface StaffUser { id: string; firstName: string | null; lastName: string | null; role: string }

type View = 'inbox' | 'thread' | 'compose';

const BRAND_FILL = 'var(--hc-brand-deep)';
const BRAND_INK = 'var(--color-teal-dark)';
const BRAND_TINT = 'var(--color-teal-light)';
const UNREAD_RED = '#b91c1c';

const fullName = (p: { firstName?: string | null; lastName?: string | null }) => `${p.firstName || ''} ${p.lastName || ''}`.trim();

const MessageBoard = () => {
  const { user } = useAuth();
  const toast = useToast();
  const myId = user?.id;
  const [view, setView] = useState<View>('inbox');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [compose, setCompose] = useState<{ subject: string; body: string; recipientIds: string[] }>({ subject: '', body: '', recipientIds: [] });
  const [broadcastMode, setBroadcastMode] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadInbox = useCallback(async () => {
    try {
      setThreads(rows<Thread>(await api.get('/api/messages/inbox')));
    } catch { /* silent, as the template */ }
    finally { setLoading(false); }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setUsers(rows<StaffUser>(await api.get('/api/messages/users')));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  usePolling(loadInbox, 15000);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openThread = async (thread: Thread) => {
    setActiveThread(thread);
    setParticipants([]);
    setMessages([]);
    setView('thread');
    try {
      const data: ThreadReply = await api.get(`/api/messages/thread/${thread.id}`);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setParticipants(Array.isArray(data?.participants) ? data.participants : []);
      setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unread: false } : t)));
    } catch (e) { toast.error(errorMessage(e, 'Could not load messages')); }
  };

  const sendReply = async () => {
    if (!replyBody.trim() || !activeThread) return;
    setSending(true);
    try {
      const msg: Message = await api.post(`/api/messages/thread/${activeThread.id}/reply`, { body: replyBody });
      setMessages((prev) => [...prev, msg]);
      setReplyBody('');
    } catch (e) { toast.error(errorMessage(e, 'Failed to send')); }
    finally { setSending(false); }
  };

  const sendNew = async () => {
    if (!compose.body.trim()) { toast.error('Message body is required'); return; }
    const recipientIds = broadcastMode ? users.map((u) => u.id) : compose.recipientIds;
    if (recipientIds.length === 0) { toast.error(broadcastMode ? 'There is no active staff to send to' : 'Select at least one recipient'); return; }
    // The sender is a participant of every thread; the count is everyone else it reaches.
    const count = recipientIds.filter((id) => id !== myId).length || recipientIds.length;
    setSending(true);
    try {
      await api.post('/api/messages/send', {
        subject: compose.subject.trim() || 'New Message',
        body: compose.body,
        recipientIds,
        isBroadcast: broadcastMode,
      });
      toast.success(`Sent to ${count} recipient${count !== 1 ? 's' : ''}`);
      setCompose({ subject: '', body: '', recipientIds: [] });
      setBroadcastMode(false);
      await loadInbox();
      setView('inbox');
    } catch (e) { toast.error(errorMessage(e, 'Failed to send message')); }
    finally { setSending(false); }
  };

  const toggleRecipient = (userId: string) => {
    setCompose((prev) => ({
      ...prev,
      recipientIds: prev.recipientIds.includes(userId)
        ? prev.recipientIds.filter((id) => id !== userId)
        : [...prev.recipientIds, userId],
    }));
  };

  const formatTime = (ts?: string | null) => {
    if (!ts) return '';
    const d = new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return formatAgencyDateTime(d, { hour: '2-digit', minute: '2-digit' });
    return formatAgencyDate(d, { month: 'short', day: 'numeric' });
  };

  const totalUnread = threads.filter((t) => t.unread).length;
  const q = userSearch.toLowerCase();
  const filteredUsers = users.filter((u) =>
    !userSearch || fullName(u).toLowerCase().includes(q) || String(u.role || '').toLowerCase().includes(q),
  );

  const isOffice = (role: string) => role === 'admin' || role === 'owner';
  const roleChip = (role: string) => (isOffice(role)
    ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'
    : '');
  const roleLabel = (role: string) => (role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Caregiver');

  const inputStyle = { border: '1px solid var(--hc-line)', background: 'var(--hc-surface)', color: 'var(--hc-ink)' } as const;
  const backLink = { background: 'none', border: 'none', cursor: 'pointer', color: BRAND_INK, fontWeight: 700, fontSize: '1rem', padding: 0 } as const;

  // ─── INBOX ────────────────────────────────────────────────────────────────
  if (view === 'inbox') return (
    <div style={{ maxWidth: '800px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--hc-ink)' }}>
            💬 Messages {totalUnread > 0 && <span style={{ background: UNREAD_RED, color: '#fff', borderRadius: '99px', fontSize: '0.7rem', padding: '2px 8px', marginLeft: '0.4rem', verticalAlign: 'middle' }}>{totalUnread}</span>}
          </h2>
          <p style={{ margin: '0.1rem 0 0', fontSize: '0.82rem', color: 'var(--hc-muted)' }}>Company message board</p>
        </div>
        <button onClick={() => setView('compose')}
          style={{ padding: '0.6rem 1.25rem', background: BRAND_FILL, color: '#fff', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 700, fontSize: '0.9rem' }}>
          ✏️ New Message
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--hc-muted)' }}>Loading...</div>
      ) : threads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--hc-muted)' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>💬</div>
          <p style={{ fontWeight: 700, margin: '0 0 0.5rem', color: 'var(--hc-ink)' }}>No messages yet</p>
          <p style={{ margin: 0, fontSize: '0.875rem' }}>Click "New Message" to send one to the team.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {threads.map((thread) => {
            const unread = !!thread.unread;
            const latest = thread.latestMessage;
            const label = thread.isBroadcast ? '📢 All Staff' : thread.subject;
            return (
              <div key={thread.id} onClick={() => openThread(thread)}
                style={{ padding: '1rem 1.25rem', background: unread ? BRAND_TINT : 'var(--hc-surface)', border: `1px solid ${unread ? 'var(--color-teal)' : 'var(--hc-line)'}`, borderRadius: '12px', cursor: 'pointer', transition: 'all 0.15s', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <div style={{ width: '42px', height: '42px', borderRadius: '50%', background: unread ? BRAND_FILL : 'var(--hc-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', flexShrink: 0 }}>
                  {thread.isBroadcast ? '📢' : '💬'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.2rem' }}>
                    <span style={{ fontWeight: unread ? 800 : 600, fontSize: '0.9rem', color: 'var(--hc-ink)' }}>{label}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', flexShrink: 0, marginLeft: '0.5rem' }}>{formatTime(latest?.createdAt || thread.updatedAt)}</span>
                  </div>
                  {thread.isBroadcast && <div style={{ fontSize: '0.82rem', color: 'var(--hc-ink-soft)', fontWeight: unread ? 600 : 400 }}>{thread.subject}</div>}
                  <div style={{ fontSize: '0.8rem', color: 'var(--hc-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {latest ? `${latest.senderName}: ${latest.body}` : 'No messages yet'}
                  </div>
                </div>
                {unread && (
                  <div style={{ background: UNREAD_RED, color: '#fff', borderRadius: '99px', fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', flexShrink: 0 }}>New</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ─── THREAD VIEW ──────────────────────────────────────────────────────────
  if (view === 'thread') {
    const others = participants.filter((p) => p.userId !== myId);
    return (
      <div style={{ maxWidth: '800px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 200px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1rem' }}>
          <button onClick={() => { setView('inbox'); loadInbox(); }} style={backLink}>← Inbox</button>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--hc-ink)' }}>{activeThread?.subject}</h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--hc-muted)' }}>
              {activeThread?.isBroadcast ? 'Sent to all staff' : others.map(fullName).join(', ')}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.5rem 0', marginBottom: '1rem' }}>
          {messages.map((msg) => {
            const isMe = !!myId && msg.senderId === myId;
            return (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--hc-muted)', marginBottom: '0.2rem', paddingLeft: isMe ? 0 : '0.5rem', paddingRight: isMe ? '0.5rem' : 0 }}>
                  {isMe ? 'You' : msg.senderName || ''} · {formatTime(msg.createdAt)}
                </div>
                <div style={{ maxWidth: '75%', padding: '0.75rem 1rem', borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', background: isMe ? BRAND_FILL : 'var(--hc-subtle)', color: isMe ? '#fff' : 'var(--hc-ink)', fontSize: '0.9rem', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {msg.body}
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply */}
        <div style={{ display: 'flex', gap: '0.5rem', borderTop: '1px solid var(--hc-line)', paddingTop: '1rem' }}>
          <textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
            placeholder="Type a reply... (Enter to send, Shift+Enter for new line)"
            rows={2}
            style={{ ...inputStyle, flex: 1, padding: '0.75rem', borderRadius: '10px', resize: 'none', fontSize: '0.9rem', outline: 'none', fontFamily: 'inherit' }}
          />
          <button onClick={sendReply} disabled={sending || !replyBody.trim()} aria-label="Send reply"
            style={{ padding: '0.75rem 1.25rem', background: replyBody.trim() ? BRAND_FILL : 'var(--hc-subtle)', color: replyBody.trim() ? '#fff' : 'var(--hc-muted)', border: 'none', borderRadius: '10px', cursor: replyBody.trim() ? 'pointer' : 'default', fontWeight: 700, alignSelf: 'flex-end' }}>
            {sending ? '...' : '→'}
          </button>
        </div>
      </div>
    );
  }

  // ─── COMPOSE ──────────────────────────────────────────────────────────────
  const modeButton = (active: boolean) => ({
    padding: '0.5rem 1rem', borderRadius: '8px', border: `2px solid ${active ? 'var(--color-teal)' : 'var(--hc-line)'}`,
    background: active ? BRAND_TINT : 'var(--hc-surface)', color: active ? BRAND_INK : 'var(--hc-ink)', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem',
  });
  const labelStyle = { display: 'block', fontWeight: 700, fontSize: '0.875rem', marginBottom: '0.4rem', color: 'var(--hc-ink)' } as const;
  return (
    <div style={{ maxWidth: '700px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1.5rem' }}>
        <button onClick={() => setView('inbox')} style={backLink}>← Inbox</button>
        <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: 'var(--hc-ink)' }}>✏️ New Message</h2>
      </div>

      {/* Broadcast toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <button onClick={() => setBroadcastMode(false)} style={modeButton(!broadcastMode)}>👤 Individual / Group</button>
        <button onClick={() => setBroadcastMode(true)} style={modeButton(broadcastMode)}>📢 Send to Everyone</button>
      </div>

      {broadcastMode && (
        <div style={{ background: 'var(--hc-warning-bg)', border: '1px solid var(--hc-warning-line)', borderRadius: '10px', padding: '0.875rem 1rem', marginBottom: '1.25rem' }}>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--hc-warning-ink)', fontWeight: 600 }}>📢 Broadcast to all {users.length} active staff members. Everyone will receive this message and a push notification.</p>
        </div>
      )}

      {/* Recipient picker */}
      {!broadcastMode && (
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ ...labelStyle, marginBottom: '0.5rem' }}>
            Recipients {compose.recipientIds.length > 0 && <span style={{ background: BRAND_FILL, color: '#fff', borderRadius: '99px', padding: '1px 8px', fontSize: '0.75rem', marginLeft: '0.4rem' }}>{compose.recipientIds.length}</span>}
          </label>
          <input
            placeholder="Search by name or role..."
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            style={{ ...inputStyle, width: '100%', padding: '0.6rem 0.875rem', borderRadius: '8px', marginBottom: '0.5rem', fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none' }}
          />
          <div style={{ border: '1px solid var(--hc-line)', borderRadius: '10px', maxHeight: '200px', overflowY: 'auto' }}>
            {filteredUsers.map((u, i) => {
              const selected = compose.recipientIds.includes(u.id);
              return (
                <div key={u.id} onClick={() => toggleRecipient(u.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.625rem 1rem', cursor: 'pointer', background: selected ? BRAND_TINT : i % 2 === 0 ? 'var(--hc-surface)' : 'var(--hc-subtle)', borderBottom: i < filteredUsers.length - 1 ? '1px solid var(--hc-line)' : 'none' }}>
                  <div style={{ width: '20px', height: '20px', borderRadius: '4px', border: `2px solid ${selected ? 'var(--color-teal)' : 'var(--hc-line)'}`, background: selected ? BRAND_FILL : 'var(--hc-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {selected && <span style={{ color: '#fff', fontSize: '0.75rem', fontWeight: 800 }}>✓</span>}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--hc-ink)' }}>{fullName(u)}</span>
                    <span className={roleChip(u.role)}
                      style={{ marginLeft: '0.5rem', fontSize: '0.75rem', borderRadius: '4px', padding: '1px 6px', fontWeight: 600, ...(isOffice(u.role) ? {} : { background: BRAND_TINT, color: BRAND_INK }) }}>
                      {roleLabel(u.role)}
                    </span>
                  </div>
                </div>
              );
            })}
            {filteredUsers.length === 0 && <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--hc-muted)', fontSize: '0.875rem' }}>No staff found</div>}
          </div>
          {compose.recipientIds.length > 0 && (
            <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {compose.recipientIds.map((id) => {
                const u = users.find((x) => x.id === id);
                return u ? (
                  <span key={id} style={{ background: BRAND_FILL, color: '#fff', borderRadius: '99px', padding: '3px 10px', fontSize: '0.78rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    {fullName(u)}
                    <button onClick={() => toggleRecipient(id)} aria-label={`Remove ${fullName(u)}`} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, fontSize: '0.9rem', lineHeight: 1 }}>×</button>
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      {/* Subject */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={labelStyle}>Subject</label>
        <input
          placeholder="e.g. Schedule change this week, Team reminder..."
          value={compose.subject}
          onChange={(e) => setCompose((p) => ({ ...p, subject: e.target.value }))}
          style={{ ...inputStyle, width: '100%', padding: '0.6rem 0.875rem', borderRadius: '8px', fontSize: '0.875rem', boxSizing: 'border-box', outline: 'none' }}
        />
      </div>

      {/* Body */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label style={labelStyle}>Message *</label>
        <textarea
          placeholder="Type your message here..."
          value={compose.body}
          onChange={(e) => setCompose((p) => ({ ...p, body: e.target.value }))}
          rows={6}
          style={{ ...inputStyle, width: '100%', padding: '0.75rem', borderRadius: '8px', fontSize: '0.9rem', resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={() => setView('inbox')}
          style={{ padding: '0.75rem 1.5rem', border: '1px solid var(--hc-line)', borderRadius: '10px', background: 'var(--hc-surface)', cursor: 'pointer', fontWeight: 600, color: 'var(--hc-ink)' }}>
          Cancel
        </button>
        <button onClick={sendNew} disabled={sending}
          style={{ padding: '0.75rem 2rem', background: BRAND_FILL, color: '#fff', border: 'none', borderRadius: '10px', cursor: sending ? 'default' : 'pointer', fontWeight: 700, fontSize: '0.9rem' }}>
          {sending ? 'Sending...' : `📤 Send${broadcastMode ? ' to Everyone' : compose.recipientIds.length > 0 ? ` (${compose.recipientIds.length})` : ''}`}
        </button>
      </div>
    </div>
  );
};

export default MessageBoard;
