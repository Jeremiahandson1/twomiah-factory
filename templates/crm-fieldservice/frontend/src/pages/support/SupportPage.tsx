import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import api from '../../services/api';
import { LifeBuoy, Plus, Search, MessageSquare, Star, Send, ArrowLeft, Clock, AlertTriangle, X, Bot, ChevronRight } from 'lucide-react';

type Ticket = {
  id: string;
  number: string;
  subject: string;
  description: string | null;
  status: string;
  priority: string;
  category: string | null;
  type: string;
  source: string;
  contactId: string | null;
  assignedToId: string | null;
  slaResponseDue: string | null;
  slaResolveDue: string | null;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  rating: number | null;
  ratingComment: string | null;
  tags: string[];
  createdAt: string;
};

type Message = {
  id: string;
  body: string;
  isInternal: boolean;
  isAi: boolean;
  userId: string | null;
  contactId: string | null;
  createdAt: string;
};

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  urgent: 'bg-orange-500/20 text-orange-400',
  high: 'bg-yellow-500/20 text-yellow-400',
  normal: 'bg-blue-500/20 text-blue-400',
  low: 'bg-gray-500/20 text-gray-400',
};

const statusColors: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  waiting: 'bg-purple-500/20 text-purple-400',
  resolved: 'bg-green-500/20 text-green-400',
  closed: 'bg-gray-500/20 text-gray-400',
};

export default function SupportPage() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'detail' | 'ai-chat'>('list');
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [ratingValue, setRatingValue] = useState(0);

  // AI Chat state
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // New ticket form
  const [newTicket, setNewTicket] = useState({ subject: '', description: '', priority: 'normal', type: 'internal' });

  const fetchTickets = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (filterStatus !== 'all') params.status = filterStatus;
      if (search) params.search = search;
      const data = await api.get('/api/support/tickets', params);
      setTickets(data.data || []);
      setLoading(false);
    } catch {
      setTickets([]);
      setLoading(false);
    }
  }, [filterStatus, search]);

  const fetchStats = async () => {
    try {
      const data = await api.get('/api/support/tickets/stats');
      setStats(data);
    } catch {}
  };

  useEffect(() => { fetchTickets(); fetchStats(); }, [fetchTickets]);

  const openTicket = async (id: string) => {
    const ticket = await api.get('/api/support/tickets/' + id);
    setSelected(ticket);
    const msgs = await api.get('/api/support/tickets/' + id + '/messages');
    setMessages(msgs);
    setView('detail');
  };

  const createTicket = async () => {
    if (!newTicket.subject) return;
    await api.post('/api/support/tickets', newTicket);
    setShowCreate(false);
    setNewTicket({ subject: '', description: '', priority: 'normal', type: 'internal' });
    fetchTickets();
    fetchStats();
  };

  const sendReply = async () => {
    if (!replyText.trim() || !selected) return;
    await api.post('/api/support/tickets/' + selected.id + '/messages', {
      body: replyText,
      isInternal,
    });
    setReplyText('');
    openTicket(selected.id);
  };

  const updateStatus = async (id: string, status: string) => {
    await api.request('/api/support/tickets/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (selected?.id === id) openTicket(id);
    fetchTickets();
    fetchStats();
  };

  const rateTicket = async (id: string) => {
    if (ratingValue < 1) return;
    await api.post('/api/support/tickets/' + id + '/rate', { rating: ratingValue });
    setRatingValue(0);
    openTicket(id);
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userMsg = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setChatLoading(true);

    try {
      const data = await api.post('/api/support/ai-chat', {
        message: userMsg.content,
        conversationHistory: chatMessages,
      });
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, the AI assistant is unavailable. Please create a ticket instead.' }]);
    }
    setChatLoading(false);
  };

  const isSlaBreached = (t: Ticket) => {
    if (['resolved', 'closed'].includes(t.status)) return false;
    return t.slaResolveDue ? new Date(t.slaResolveDue) < new Date() : false;
  };

  // ─── AI Chat View ──────────────────────────────────────────────────────────
  if (view === 'ai-chat') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <button onClick={() => setView('list')} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2 mb-6">
          <Bot size={24} className="text-purple-400" />
          <h1 className="text-xl font-bold text-white">AI Support Assistant</h1>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl min-h-[400px] flex flex-col">
          <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[500px]">
            {chatMessages.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">Ask a question and our AI will try to help using the knowledge base.</p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={'flex ' + (msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={'max-w-[80%] rounded-xl px-4 py-2 text-sm ' + (msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300')}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-400">Thinking...</div>
              </div>
            )}
          </div>
          <div className="border-t border-gray-800 p-3 flex gap-2">
            <input
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
              placeholder="Ask a question..."
              className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none"
            />
            <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm">
              <Send size={16} />
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-2">Can't find an answer? <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:underline">Create a ticket</button></p>
      </div>
    );
  }

  // ─── Ticket Detail View ────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="p-6">
        <button onClick={() => { setView('list'); setSelected(null); }} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs font-mono">{selected.number}</span>
              <span className={'text-xs px-2 py-0.5 rounded-full font-medium capitalize ' + (statusColors[selected.status] || '')}>{selected.status.replace('_', ' ')}</span>
              <span className={'text-xs px-2 py-0.5 rounded-full font-medium capitalize ' + (priorityColors[selected.priority] || '')}>{selected.priority}</span>
              {isSlaBreached(selected) && <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">SLA BREACHED</span>}
            </div>
            <h2 className="text-lg font-bold text-white mt-1">{selected.subject}</h2>
          </div>
          <div className="flex gap-2">
            {selected.status !== 'resolved' && (
              <button onClick={() => updateStatus(selected.id, 'resolved')} className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-xs">Resolve</button>
            )}
            {selected.status !== 'closed' && (
              <button onClick={() => updateStatus(selected.id, 'closed')} className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs">Close</button>
            )}
          </div>
        </div>

        {selected.description && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mb-4">
            <p className="text-gray-300 text-sm whitespace-pre-wrap">{selected.description}</p>
          </div>
        )}

        {/* Messages */}
        <div className="space-y-2 mb-4">
          {messages.map(msg => (
            <div key={msg.id} className={'border rounded-lg p-3 ' + (msg.isInternal ? 'bg-yellow-900/10 border-yellow-800/30' : msg.userId ? 'bg-blue-900/10 border-blue-800/30' : 'bg-gray-900 border-gray-800')}>
              <div className="flex items-center gap-2 mb-1">
                {msg.isInternal && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded">Internal</span>}
                {msg.isAi && <span className="text-xs bg-purple-500/20 text-purple-400 px-1 py-0.5 rounded">AI</span>}
                <span className="text-xs text-gray-600 ml-auto">{new Date(msg.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-gray-300 text-sm whitespace-pre-wrap">{msg.body}</p>
            </div>
          ))}
        </div>

        {/* Rating (for resolved tickets) */}
        {['resolved', 'closed'].includes(selected.status) && !selected.rating && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mb-4">
            <p className="text-xs text-gray-500 mb-2">Rate this support experience</p>
            <div className="flex items-center gap-1 mb-2">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} onClick={() => setRatingValue(n)} className="p-1">
                  <Star size={20} className={n <= ratingValue ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'} />
                </button>
              ))}
              {ratingValue > 0 && (
                <button onClick={() => rateTicket(selected.id)} className="ml-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs">Submit</button>
              )}
            </div>
          </div>
        )}
        {selected.rating && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mb-4 flex items-center gap-2">
            <Star size={16} className="text-yellow-400 fill-yellow-400" />
            <span className="text-yellow-400 text-sm font-medium">{selected.rating}/5</span>
            {selected.ratingComment && <span className="text-gray-400 text-sm">{selected.ratingComment}</span>}
          </div>
        )}

        {/* Reply */}
        {!['closed'].includes(selected.status) && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Type a reply..."
              className="w-full bg-transparent text-white text-sm resize-none outline-none min-h-[60px] placeholder-gray-600" />
            <div className="flex items-center justify-between mt-2">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} />
                Internal note
              </label>
              <button onClick={sendReply} disabled={!replyText.trim()} className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-xs">
                <Send size={12} /> Send
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Ticket List ───────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white">Support Tickets</h1>
        <div className="flex gap-2">
          <button onClick={() => setView('ai-chat')} className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded-lg text-sm">
            <Bot size={16} /> AI Chat
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
            <Plus size={16} /> New Ticket
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Open', value: stats.open || 0, color: 'text-blue-400' },
          { label: 'In Progress', value: stats.in_progress || 0, color: 'text-yellow-400' },
          { label: 'Resolved', value: stats.resolved || 0, color: 'text-green-400' },
          { label: 'SLA Breach', value: stats.sla_breached || 0, color: (stats.sla_breached || 0) > 0 ? 'text-red-400' : 'text-gray-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={'text-lg font-bold ' + s.color}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
            className="w-full pl-8 pr-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : tickets.length === 0 ? (
        <div className="border border-dashed border-gray-700 rounded-xl p-12 text-center">
          <LifeBuoy size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No tickets yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tickets.map(t => (
            <div key={t.id} onClick={() => openTicket(t.id)}
              className="bg-gray-900 border border-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-800/50 transition-colors flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-white text-sm font-medium">{t.subject}</span>
                  <span className={'text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ' + (statusColors[t.status] || '')}>{t.status.replace('_', ' ')}</span>
                  <span className={'text-xs px-1.5 py-0.5 rounded-full font-medium capitalize ' + (priorityColors[t.priority] || '')}>{t.priority}</span>
                  {isSlaBreached(t) && <AlertTriangle size={12} className="text-red-400" />}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {t.number} &middot; {t.category || 'General'} &middot; {new Date(t.createdAt).toLocaleDateString()}
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-600" />
            </div>
          ))}
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white">New Ticket</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <input value={newTicket.subject} onChange={e => setNewTicket({ ...newTicket, subject: e.target.value })}
                placeholder="Subject" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none" />
              <textarea value={newTicket.description} onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                placeholder="Description (optional)" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none min-h-[80px] resize-none" />
              <select value={newTicket.priority} onChange={e => setNewTicket({ ...newTicket, priority: e.target.value })}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-gray-400 text-sm">Cancel</button>
              <button onClick={createTicket} disabled={!newTicket.subject}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
