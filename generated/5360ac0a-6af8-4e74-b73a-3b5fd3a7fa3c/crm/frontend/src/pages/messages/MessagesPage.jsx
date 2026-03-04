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
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState('');
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [unreadFilter, setUnreadFilter] = useState(false);

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
    } catch (error) {
      console.error('Failed to load conversations:', error);
      setLoading(false);
    }
  };

  const selectConversation = async (conv) => {
    setSelectedConversation(conv);
    setLoadingMessages(true);
    try {
      const data = await api.get(`/api/sms/conversations/${conv.id}/messages`);
      setMessages(data || []);
      // Mark as read
      if (conv.unreadCount > 0) {
        await api.post(`/api/sms/conversations/${conv.id}/read`);
        loadConversations();
      }
    } catch (error) {
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
              onChange={(e) => setSearch(e.target.value)}
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
            conversations.map(conv => (
              <ConversationItem
                key={conv.id}
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
                  {selectedConversation.contact?.name || selectedConversation.phoneNumber}
                </p>
                <p className="text-sm text-gray-500">{selectedConversation.phoneNumber}</p>
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
              conversationId={selectedConversation.id}
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
          onSend={(conv) => {
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

function ConversationItem({ conversation, selected, onClick }) {
  const lastMessage = conversation.lastMessage;
  const timeAgo = lastMessage ? formatTimeAgo(lastMessage.createdAt) : '';

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
          {conversation.unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-orange-500 text-white text-xs rounded-full flex items-center justify-center">
              {conversation.unreadCount}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <p className={`font-medium truncate ${conversation.unreadCount > 0 ? 'text-gray-900' : 'text-gray-700'}`}>
              {conversation.contact?.name || conversation.phoneNumber}
            </p>
            <span className="text-xs text-gray-500">{timeAgo}</span>
          </div>
          {lastMessage && (
            <p className={`text-sm truncate ${conversation.unreadCount > 0 ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
              {lastMessage.direction === 'outbound' && '↑ '}
              {lastMessage.body}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function MessageThread({ messages, loading, conversationId, onMessageSent }) {
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || sending) return;

    setSending(true);
    try {
      await api.post(`/api/sms/conversations/${conversationId}/messages`, {
        body: newMessage,
      });
      setNewMessage('');
      onMessageSent();
    } catch (error) {
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
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Compose */}
      <form onSubmit={handleSend} className="p-4 bg-white border-t">
        <div className="flex gap-2">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
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

function MessageBubble({ message }) {
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
          <p className="text-sm">{message.body}</p>
        </div>
        <div className={`flex items-center gap-1 mt-1 ${isOutbound ? 'justify-end' : ''}`}>
          <span className="text-xs text-gray-400">
            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {isOutbound && statusIcon()}
        </div>
      </div>
    </div>
  );
}

function NewMessageModal({ onSend, onClose }) {
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [contacts, setContacts] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    loadContacts();
  }, []);

  const loadContacts = async () => {
    try {
      const data = await api.get('/api/contacts?limit=100');
      setContacts(data.data || []);
    } catch (error) {
      console.error('Failed to load contacts:', error);
    }
  };

  const handleSearch = (value) => {
    setPhone(value);
    if (value.length >= 2) {
      const results = contacts.filter(c =>
        c.name?.toLowerCase().includes(value.toLowerCase()) ||
        c.phone?.includes(value)
      );
      setSearchResults(results.slice(0, 5));
    } else {
      setSearchResults([]);
    }
  };

  const selectContact = (contact) => {
    setPhone(contact.phone);
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
    } catch (error) {
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
                onChange={(e) => handleSearch(e.target.value)}
                placeholder="Phone number or contact name"
                className="w-full px-3 py-2 border rounded-lg"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border rounded-lg shadow-lg">
                  {searchResults.map(contact => (
                    <button
                      key={contact.id}
                      onClick={() => selectContact(contact)}
                      className="w-full px-4 py-2 text-left hover:bg-gray-50"
                    >
                      <p className="font-medium">{contact.name}</p>
                      <p className="text-sm text-gray-500">{contact.phone}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
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

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}
