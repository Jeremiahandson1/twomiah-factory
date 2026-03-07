// components/portal/PortalMessages.jsx
// Client messaging with the agency
import React, { useState, useEffect, useRef } from 'react';
import { apiCall } from '../../config';

const formatRelativeTime = (isoStr) => {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7)   return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const PortalMessages = ({ token, onRead }) => {
  const [threads, setThreads]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [selectedThread, setSelectedThread] = useState(null);
  const [threadMessages, setThreadMessages] = useState([]);
  const [threadLoading, setThreadLoading]   = useState(false);
  const [showCompose, setShowCompose]       = useState(false);
  const [newSubject, setNewSubject]         = useState('');
  const [newBody, setNewBody]               = useState('');
  const [replyBody, setReplyBody]           = useState('');
  const [sending, setSending]               = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    loadThreads();
  }, [token]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [threadMessages]);

  const loadThreads = () => {
    setLoading(true);
    apiCall('/api/portal/messages', { method: 'GET' }, token)
      .then(data => { if (data) setThreads(data); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  const openThread = async (thread) => {
    setSelectedThread(thread);
    setThreadLoading(true);
    try {
      const data = await apiCall(`/api/portal/messages/${thread.id}`, { method: 'GET' }, token);
      if (data) {
        setThreadMessages(data.messages || []);
        // Mark as read
        if (thread.hasUnread) {
          await apiCall(`/api/portal/messages/${thread.id}/read`, { method: 'POST' }, token);
          setThreads(prev => prev.map(t =>
            t.id === thread.id ? { ...t, hasUnread: false } : t
          ));
          if (onRead) onRead();
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setThreadLoading(false);
    }
  };

  const handleCompose = async (e) => {
    e.preventDefault();
    if (!newSubject.trim() || !newBody.trim()) return;

    setSending(true);
    try {
      await apiCall('/api/portal/messages', {
        method: 'POST',
        body: JSON.stringify({ subject: newSubject, body: newBody }),
      }, token);
      setNewSubject('');
      setNewBody('');
      setShowCompose(false);
      loadThreads();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleReply = async (e) => {
    e.preventDefault();
    if (!replyBody.trim() || !selectedThread) return;

    setSending(true);
    try {
      const msg = await apiCall(`/api/portal/messages/${selectedThread.id}`, {
        method: 'POST',
        body: JSON.stringify({ body: replyBody }),
      }, token);
      if (msg) {
        setThreadMessages(prev => [...prev, msg]);
        setReplyBody('');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const goBack = () => {
    setSelectedThread(null);
    setThreadMessages([]);
    setReplyBody('');
    loadThreads();
  };

  if (loading && threads.length === 0) {
    return <div style={{ textAlign: 'center', padding: '40px', color: '#888' }}>Loading messages...</div>;
  }

  // Thread detail view
  if (selectedThread) {
    return (
      <div>
        <button
          onClick={goBack}
          style={{
            background: 'none', border: 'none', color: '#2980b9',
            cursor: 'pointer', fontSize: '0.88rem', fontWeight: 600,
            padding: '0', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '4px',
          }}
        >
          ← Back to Messages
        </button>

        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
        }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '1.1rem', color: '#1a5276' }}>
            {selectedThread.subject}
          </h3>
          <div style={{ fontSize: '0.8rem', color: '#888' }}>
            {selectedThread.status === 'closed' ? 'Closed' : 'Open'} &middot; {formatRelativeTime(selectedThread.createdAt)}
          </div>
        </div>

        {/* Messages */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px',
          maxHeight: '400px', overflowY: 'auto', padding: '4px',
        }}>
          {threadLoading ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>Loading...</div>
          ) : threadMessages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>No messages yet.</div>
          ) : (
            threadMessages.map(msg => {
              const isClient = msg.senderType === 'client';
              return (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: isClient ? 'flex-end' : 'flex-start',
                    maxWidth: '80%',
                  }}
                >
                  <div style={{
                    background: isClient ? '#1a5276' : '#f0f2f5',
                    color: isClient ? '#fff' : '#333',
                    borderRadius: isClient ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                    padding: '12px 16px',
                  }}>
                    <div style={{ fontSize: '0.9rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                      {msg.body}
                    </div>
                  </div>
                  <div style={{
                    fontSize: '0.72rem', color: '#999', marginTop: '4px',
                    textAlign: isClient ? 'right' : 'left',
                  }}>
                    {msg.senderName || (isClient ? 'You' : 'Agency')} &middot; {formatRelativeTime(msg.createdAt)}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply box */}
        {selectedThread.status !== 'closed' && (
          <form onSubmit={handleReply} style={{
            background: '#fff', borderRadius: '12px', padding: '16px',
            boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}>
            <textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Type your reply..."
              rows={3}
              style={{
                width: '100%', border: '1px solid #ddd', borderRadius: '8px',
                padding: '10px 14px', fontSize: '0.9rem', resize: 'vertical',
                fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
              <button
                type="submit"
                disabled={sending || !replyBody.trim()}
                style={{
                  background: '#1a5276', color: '#fff',
                  border: 'none', padding: '8px 20px', borderRadius: '8px',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  fontSize: '0.88rem', fontWeight: 600,
                  opacity: (sending || !replyBody.trim()) ? 0.6 : 1,
                }}
              >
                {sending ? 'Sending...' : 'Send Reply'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  // Thread list view
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, fontSize: '1.3rem', color: '#1a5276' }}>
          💬 Messages
        </h2>
        <button
          onClick={() => setShowCompose(true)}
          style={{
            background: '#1a5276', color: '#fff',
            border: 'none', padding: '8px 18px', borderRadius: '8px',
            cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600,
          }}
        >
          + New Message
        </button>
      </div>

      {error && (
        <div style={{
          background: '#fdf2f2', color: '#c0392b', borderRadius: '8px',
          padding: '12px 16px', marginBottom: '16px', fontSize: '0.88rem',
        }}>
          {error}
        </div>
      )}

      {/* Compose modal */}
      {showCompose && (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '20px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)', marginBottom: '16px',
          border: '2px solid #1a5276',
        }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '1rem', color: '#1a5276' }}>
            New Message to Agency
          </h3>
          <form onSubmit={handleCompose}>
            <div style={{ marginBottom: '12px' }}>
              <input
                type="text"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder="Subject"
                required
                style={{
                  width: '100%', border: '1px solid #ddd', borderRadius: '8px',
                  padding: '10px 14px', fontSize: '0.9rem', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '12px' }}>
              <textarea
                value={newBody}
                onChange={(e) => setNewBody(e.target.value)}
                placeholder="Type your message..."
                rows={4}
                required
                style={{
                  width: '100%', border: '1px solid #ddd', borderRadius: '8px',
                  padding: '10px 14px', fontSize: '0.9rem', resize: 'vertical',
                  fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => { setShowCompose(false); setNewSubject(''); setNewBody(''); }}
                style={{
                  background: 'transparent', color: '#666',
                  border: '1px solid #ddd', padding: '8px 18px', borderRadius: '8px',
                  cursor: 'pointer', fontSize: '0.85rem',
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={sending}
                style={{
                  background: '#1a5276', color: '#fff',
                  border: 'none', padding: '8px 18px', borderRadius: '8px',
                  cursor: sending ? 'not-allowed' : 'pointer',
                  fontSize: '0.85rem', fontWeight: 600,
                  opacity: sending ? 0.6 : 1,
                }}
              >
                {sending ? 'Sending...' : 'Send Message'}
              </button>
            </div>
          </form>
        </div>
      )}

      {threads.length === 0 && !showCompose ? (
        <div style={{
          background: '#fff', borderRadius: '12px', padding: '48px',
          textAlign: 'center', color: '#888', boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '12px' }}>💬</div>
          <div style={{ fontSize: '1rem', fontWeight: 500 }}>No messages yet</div>
          <div style={{ fontSize: '0.85rem', marginTop: '8px' }}>
            Start a conversation with your care team.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {threads.map(thread => (
            <div
              key={thread.id}
              onClick={() => openThread(thread)}
              style={{
                background: thread.hasUnread ? '#f0f7ff' : '#fff',
                borderRadius: '12px', padding: '16px 18px',
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
                cursor: 'pointer',
                borderLeft: thread.hasUnread ? '4px solid #2980b9' : '4px solid #e0e0e0',
                display: 'flex', gap: '14px', alignItems: 'flex-start',
                transition: 'background 0.2s',
              }}
            >
              <span style={{ fontSize: '1.4rem', flexShrink: 0, marginTop: '2px' }}>
                {thread.hasUnread ? '💬' : '✉️'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <div style={{
                    fontWeight: thread.hasUnread ? 700 : 500, color: '#1a5276',
                    fontSize: '0.92rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {thread.subject}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#999', flexShrink: 0 }}>
                    {formatRelativeTime(thread.lastMessageAt)}
                  </div>
                </div>
                {thread.lastMessage && (
                  <div style={{
                    fontSize: '0.83rem', color: '#666', marginTop: '3px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {thread.lastMessage.senderType === 'client' ? 'You: ' : 'Agency: '}
                    {thread.lastMessage.body}
                  </div>
                )}
                <div style={{ fontSize: '0.75rem', color: '#aaa', marginTop: '4px' }}>
                  {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''}
                  {thread.status === 'closed' && (
                    <span style={{
                      background: '#f0f0f0', color: '#888',
                      padding: '1px 6px', borderRadius: '8px',
                      fontSize: '0.7rem', marginLeft: '8px',
                    }}>
                      Closed
                    </span>
                  )}
                </div>
              </div>
              {thread.hasUnread && (
                <div style={{
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: '#2980b9', flexShrink: 0, marginTop: '6px',
                }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PortalMessages;
