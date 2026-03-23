import { useState, useEffect, useRef } from 'react';
import {
  MessageSquare, Send, Search, Phone, User, Clock,
  Check, CheckCheck, AlertCircle, Loader2, Plus,
  Archive, Star, MoreVertical, ArrowLeft
} from 'lucide-react';
import api from '../../services/api';

/**
 * Two-Way SMS Messaging Page
 */
export default function MessagesPage() {
  const [conversations, setConversations] = useState<Record<string, unknown>[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
  const [search, setSearch] = useState<string>('');
  const [showNewMessage, setShowNewMessage] = useState<boolean>(false);
  const [unreadFilter, setUnreadFilter] = useState<boolean>(false);

  useEffect(() => {
    loadConversations();
    // Poll for new messages every 10 seconds
    const interval = setInterval(loadConversations, 10000);
    return () => clearInterval(interval);
  }, [search, unreadFilter]);

  const loadConversations = async () => {
    try {
      const data = await api.get(`/api/sms/conversations?search=${search}&unreadOnly=${unreadFilter}`);
      setConversations(data.data || []);
      setLoading(false);
    } catch (error: unknown) {
      console.error('Failed to load conversations:', error);
      setLoading(false);
    }
  };

  const selectConversation = async (conv: Record<string, unknown>) => {
    setSelectedConversation(conv);
    setLoadingMessages(true);
    try {
      const data = await api.get(`/api/sms/conversations/${conv.id}/messages`);
      setMessages(data || []);
      // Mark as read
      if ((conv.unreadCount as number) > 0) {
        await api.post(`/api/sms/conversations/${conv.id}/read`);
        loadConversations();
      }
    } catch (error: unknown) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex">
      {/* Conversations List */}
      <div className={`w-80 border-r bg-white flex flex-col ${selectedConversation ? 'hidden md:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-gray-900">Messages</h1>
            <button
              onClick={() => setShowNewMessage(true)}
              className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"
            />
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setUnreadFilter(false)}
              className={`flex-1 py-1.5 text-sm rounded-lg ${
                !unreadFilter ? 'bg-gray-100 text-gray-900' : 'text-gray-500'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setUnreadFilter(true)}
              className={`flex-1 py-1.5 text-sm rounded-lg ${
                unreadFilter ? 'bg-orange-100 text-orange-700' : 'text-gray-500'
              }`}
            >
              Unread
            </button>
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No conversations yet</p>
            </div>
          ) : (
            conversations.map((conv: Record<string, unknown>) => (
              <ConversationItem
                key={conv.id as string}
                conversation={conv}
                selected={selectedConversation?.id === conv.id}
                onClick={() => selectConversation(conv)}
              />
            ))
          )}
        </div>
      </div>

      {/* Message Thread */}
      <div className={`flex-1 flex flex-col bg-gray-50 ${!selectedConversation ? 'hidden md:flex' : 'flex'}`}>
        {selectedConversation ? (
          <>
            {/* Thread Header */}
            <div className="p-4 bg-white border-b flex items-center gap-3">
              <button
                onClick={() => setSelectedConversation(null)}
                className="md:hidden p-2 hover:bg-gray-100 rounded-lg"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center">
                <User className="w-5 h-5 text-orange-600" />
              </div>
              <div className="flex-1">
                <p className="font-medium text-gray-900">
                  {(selectedConversation.contact as Record<string, unknown>)?.name as string || selectedConversation.phoneNumber as string}
                </p>
                <p className="text-sm text-gray-500">{selectedConversation.phoneNumber as string}</p>
              </div>
              <button className="p-2 hover:bg-gray-100 rounded-lg">
                <Phone className="w-5 h-5 text-gray-500" />
              </button>
              <button className="p-2 hover:bg-gray-100 rounded-lg">
                <MoreVertical className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Messages */}
            <MessageThread
              messages={messages}
              loading={loadingMessages}
              conversationId={selectedConversation.id as string}
              onMessageSent={() => {
                selectConversation(selectedConversation);
                loadConversations();
              }}
            />
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <MessageSquare className="w-16 h-16 mx-auto mb-4 opacity-50" />
              <p>Select a conversation to view messages</p>
            </div>
          </div>
        )}
      </div>

      {/* New Message Modal */}
      {showNewMessage && (
        <NewMessageModal
          onSend={(conv: Record<string, unknown>) => {
            setShowNewMessage(false);
            loadConversations();
            if (conv) selectConversation(conv);
          }}
          onClose={() => setShowNewMessage(false)}
        />
      )}
    </div>
  );
}

interface ConversationItemProps {
  conversation: Record<string, unknown>;
  selected: boolean;
  onClick: () => void;
}

function ConversationItem({ conversation, selected, onClick }: ConversationItemProps) {
  const lastMessage = conversation.lastMessage as Record<string, unknown> | undefined;
  const timeAgo = lastMessage ? formatTimeAgo(lastMessage.createdAt as string) : '';

  return (
    <button
      onClick={onClick}
      className={`w-full p-4 text-left border-b hover:bg-gray-50 transition-colors ${
        selected ? 'bg-orange-50' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center">
            <User className="w-5 h-5 text-gray-500" />
          </div>
          {(conversation.unreadCount as number) > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center">
              {conversation.unreadCount as number}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className={`font-medium truncate ${(conversation.unreadCount as number) > 0 ? 'text-gray-900' : 'text-gray-700'}`}>
              {(conversation.contact as Record<string, unknown>)?.name as string || conversation.phoneNumber as string}
            </p>
            <span className="text-xs text-gray-500">{timeAgo}</span>
          </div>
          {lastMessage && (
            <p className={`text-sm truncate ${(conversation.unreadCount as number) > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
              {lastMessage.direction === 'outbound' && '↑ '}
              {lastMessage.body as string}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

interface MessageThreadProps {
  messages: Record<string, unknown>[];
  loading: boolean;
  conversationId: string;
  onMessageSent: () => void;
}

function MessageThread({ messages, loading, conversationId, onMessageSent }: MessageThreadProps) {
  const [newMessage, setNewMessage] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    try {
      await api.post(`/api/sms/conversations/${conversationId}/messages`, {
        body: newMessage,
      });
      setNewMessage('');
      onMessageSent();
    } catch (error: unknown) {
      alert('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg: Record<string, unknown>) => (
          <MessageBubble key={msg.id as string} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose */}
      <form onSubmit={handleSend} className="p-4 bg-white border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || sending}
            className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {sending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </form>
    </>
  );
}

interface MessageBubbleProps {
  message: Record<string, unknown>;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound';

  const statusIcon = () => {
    switch (message.status) {
      case 'delivered':
        return <CheckCheck className="w-4 h-4 text-blue-500" />;
      case 'sent':
        return <Check className="w-4 h-4 text-gray-400" />;
      case 'failed':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-300" />;
    }
  };

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[70%] ${isOutbound ? 'order-2' : ''}`}>
        <div
          className={`px-4 py-2 rounded-2xl ${
            isOutbound
              ? 'bg-orange-500 text-white rounded-br-md'
              : 'bg-white border rounded-bl-md'
          }`}
        >
          <p className="text-sm">{message.body as string}</p>
        </div>
        <div className={`flex items-center gap-1 mt-1 ${isOutbound ? 'justify-end' : ''}`}>
          <span className="text-xs text-gray-400">
            {new Date(message.createdAt as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {isOutbound && statusIcon()}
        </div>
      </div>
    </div>
  );
}

interface NewMessageModalProps {
  onSend: (conv: Record<string, unknown>) => void;
  onClose: () => void;
}

function NewMessageModal({ onSend, onClose }: NewMessageModalProps) {
  const [phone, setPhone] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [searchResults, setSearchResults] = useState<Record<string, unknown>[]>([]);
  const [sending, setSending] = useState<boolean>(false);

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const data = await api.get('/api/contacts?limit=100');
      setContacts(data.data || []);
    } catch (error: unknown) {
      console.error('Failed to load contacts:', error);
    }
  };

  const handleSearch = (value: string) => {
    setPhone(value);
    if (value.length >= 2) {
      const results = contacts.filter((c: Record<string, unknown>) =>
        (c.name as string)?.toLowerCase().includes(value.toLowerCase()) ||
        (c.phone as string)?.includes(value)
      );
      setSearchResults(results.slice(0, 5));
    } else {
      setSearchResults([]);
    }
  };

  const selectContact = (contact: Record<string, unknown>) => {
    setPhone(contact.phone as string);
    setSearchResults([]);
  };

  const handleSend = async () => {
    if (!phone || !message.trim()) return;
    setSending(true);
    try {
      const result = await api.post('/api/sms/send', {
        to: phone,
        body: message,
      });
      onSend(result.conversation);
    } catch (error: unknown) {
      alert('Failed to send message');
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <h2 className="text-lg font-bold mb-4">New Message</h2>

          <div className="space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
              <input
                type="text"
                value={phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
                placeholder="Phone number or contact name"
                className="w-full px-3 py-2 border rounded-lg"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg">
                  {searchResults.map((contact: Record<string, unknown>) => (
                    <button
                      key={contact.id as string}
                      onClick={() => selectContact(contact)}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <p className="font-medium">{contact.name as string}</p>
                      <p className="text-sm text-gray-500">{contact.phone as string}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                value={message}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMessage(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg"
                rows={4}
                placeholder="Type your message..."
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSend}
                disabled={!phone || !message.trim() || sending}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50"
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}
