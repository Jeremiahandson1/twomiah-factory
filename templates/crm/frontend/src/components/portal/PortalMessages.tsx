import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { MessageSquare, Send, ArrowLeft, Mail, MailOpen, Loader2, Plus } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

export default function PortalMessages() {
  const { token } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<any>(null);
  const [showCompose, setShowCompose] = useState(false);

  useEffect(() => {
    loadMessages();
  }, [portalFetch]);

  async function loadMessages() {
    try {
      const data = await portalFetch('/messages');
      setMessages(data);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoading(false);
    }
  }

  const unreadCount = messages.filter((m) => m.direction === 'inbound' && m.status !== 'read').length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (selectedMessage) {
    return (
      <MessageDetail
        message={selectedMessage}
        portalFetch={portalFetch}
        onBack={() => {
          setSelectedMessage(null);
          loadMessages();
        }}
        token={token}
      />
    );
  }

  if (showCompose) {
    return (
      <ComposeMessage
        portalFetch={portalFetch}
        onBack={() => setShowCompose(false)}
        onSent={() => {
          setShowCompose(false);
          loadMessages();
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
          <p className="text-gray-600">
            Communicate with your contractor.
            {unreadCount > 0 && (
              <span className="ml-2 text-orange-600 font-medium">{unreadCount} unread</span>
            )}
          </p>
        </div>
        <button
          onClick={() => setShowCompose(true)}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Message
        </button>
      </div>

      {messages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No messages yet.</p>
          <button
            onClick={() => setShowCompose(true)}
            className="mt-4 text-orange-600 hover:text-orange-700 text-sm font-medium"
          >
            Send your first message
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden divide-y">
          {messages.map((message) => {
            const isInbound = message.direction === 'inbound';
            const isUnread = isInbound && message.status !== 'read';

            return (
              <button
                key={message.id}
                onClick={() => setSelectedMessage(message)}
                className={`w-full text-left p-4 hover:bg-gray-50 transition-colors ${isUnread ? 'bg-orange-50' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg flex-shrink-0 ${isUnread ? 'bg-orange-100' : 'bg-gray-100'}`}>
                    {isUnread ? (
                      <Mail className="w-4 h-4 text-orange-600" />
                    ) : (
                      <MailOpen className="w-4 h-4 text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={`text-sm ${isUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                        {message.subject || '(No subject)'}
                      </p>
                      <span className="text-xs text-gray-400 flex-shrink-0 ml-2">
                        {new Date(message.createdAt || message.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 truncate mt-0.5">{message.body}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs ${isInbound ? 'text-blue-600' : 'text-gray-400'}`}>
                        {isInbound ? 'From contractor' : 'Sent by you'}
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageDetail({
  message,
  portalFetch,
  onBack,
  token,
}: {
  message: any;
  portalFetch: any;
  onBack: () => void;
  token: string | undefined;
}) {
  const [detail, setDetail] = useState<any>(message);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await portalFetch(`/messages/${message.id}`);
        setDetail(data);

        // Mark as read if inbound
        if (data.direction === 'inbound' && data.status !== 'read') {
          await portalFetch(`/messages/${message.id}/read`, { method: 'POST' });
        }
      } catch (error) {
        console.error('Failed to load message:', error);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [portalFetch, message.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div>
      <button onClick={onBack} className="text-orange-600 hover:underline text-sm mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" />
        Back to Messages
      </button>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-gray-900">{detail.subject || '(No subject)'}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
            <span>{detail.direction === 'inbound' ? 'From contractor' : 'Sent by you'}</span>
            <span>-</span>
            <span>{new Date(detail.createdAt || detail.created_at || detail.sent_at).toLocaleString()}</span>
          </div>
        </div>
        <div className="p-6">
          <p className="text-gray-700 whitespace-pre-wrap">{detail.body}</p>
        </div>
      </div>
    </div>
  );
}

function ComposeMessage({
  portalFetch,
  onBack,
  onSent,
}: {
  portalFetch: any;
  onBack: () => void;
  onSent: () => void;
}) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = async () => {
    if (!body.trim()) {
      alert('Please enter a message body.');
      return;
    }

    setSending(true);
    try {
      await portalFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({ subject: subject || undefined, body }),
      });
      onSent();
    } catch (error: any) {
      alert('Failed to send message: ' + error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <button onClick={onBack} className="text-orange-600 hover:underline text-sm mb-4 inline-flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" />
        Back to Messages
      </button>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold text-gray-900">New Message</h1>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What is this about?"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Type your message..."
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
            />
          </div>
        </div>
        <div className="p-6 bg-gray-50 border-t flex justify-end gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !body.trim()}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-600 rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
          >
            <Send className="w-4 h-4" />
            {sending ? 'Sending...' : 'Send Message'}
          </button>
        </div>
      </div>
    </div>
  );
}
