import { useEffect, useState } from 'react'
import { supabase, API_URL } from '../supabase'
import { LifeBuoy, Plus, Search, AlertTriangle, Star, Send, ArrowLeft, Clock, BarChart3, X, BookOpen, MessageSquare, Edit2, Trash2, ThumbsUp, ChevronDown, Eye, EyeOff, Tag } from 'lucide-react'

type Ticket = {
  id: string
  number: string
  subject: string
  description: string | null
  status: string
  priority: string
  category: string | null
  source: string
  tenant_id: string
  submitter_email: string | null
  submitter_name: string | null
  assigned_to: string | null
  sla_response_due: string | null
  sla_resolve_due: string | null
  first_response_at: string | null
  resolved_at: string | null
  escalation_level: number
  rating: number | null
  rating_comment: string | null
  created_at: string
  updated_at: string
  tenants?: { name: string; slug: string; plan: string; email: string }
  messages?: Message[]
}

type Message = {
  id: string
  body: string
  is_internal: boolean
  is_ai: boolean
  sender_type: string
  sender_email: string | null
  sender_name: string | null
  created_at: string
}

type Stats = {
  open: number
  in_progress: number
  waiting: number
  resolved: number
  closed: number
  total: number
  sla_breached: number
  avgRating: string | null
  ratedCount: number
}

type Patterns = {
  byCategory: { category: string; count: number }[]
  byPriority: { priority: string; count: number }[]
  avgRating: string | null
  ratedCount: number
  dailyTrend: { day: string; count: number }[]
  topFeedback: { title: string; votes: number; status: string; category: string }[]
}

type KBArticle = {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  published: boolean
  created_at: string
  updated_at: string
}

type Feedback = {
  id: string
  title: string
  description?: string
  category: string
  status: string
  votes: number
  created_at: string
  updated_at: string
}

async function apiFetch(path: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(API_URL + '/api/v1/factory' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session?.access_token, ...(opts?.headers || {}) },
  })
  if (!res.ok) throw new Error('Request failed')
  return res.json()
}

const priorityColors: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400',
  urgent: 'bg-orange-500/20 text-orange-400',
  high: 'bg-yellow-500/20 text-yellow-400',
  normal: 'bg-blue-500/20 text-blue-400',
  low: 'bg-gray-500/20 text-gray-400',
}

const statusColors: Record<string, string> = {
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  waiting: 'bg-purple-500/20 text-purple-400',
  resolved: 'bg-green-500/20 text-green-400',
  closed: 'bg-gray-500/20 text-gray-400',
}

const feedbackStatusColors: Record<string, string> = {
  new: 'bg-blue-500/20 text-blue-400',
  planned: 'bg-purple-500/20 text-purple-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-green-500/20 text-green-400',
  declined: 'bg-red-500/20 text-red-400',
}

const KB_CATEGORIES = ['general', 'getting_started', 'billing', 'technical', 'troubleshooting', 'faq', 'api', 'integrations']

export default function SupportPage() {
  const [view, setView] = useState<'list' | 'detail' | 'patterns' | 'kb' | 'feedback'>('list')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [patterns, setPatterns] = useState<Patterns | null>(null)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterPriority, setFilterPriority] = useState('all')
  const [showCreate, setShowCreate] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [isInternal, setIsInternal] = useState(false)

  // New ticket form
  const [newTicket, setNewTicket] = useState({ subject: '', description: '', priority: 'normal', tenant_id: '', submitter_email: '', submitter_name: '' })
  const [tenants, setTenants] = useState<{ id: string; name: string; email: string }[]>([])

  // KB state
  const [kbArticles, setKbArticles] = useState<KBArticle[]>([])
  const [kbLoading, setKbLoading] = useState(false)
  const [kbSearch, setKbSearch] = useState('')
  const [kbCategoryFilter, setKbCategoryFilter] = useState('all')
  const [showKbModal, setShowKbModal] = useState(false)
  const [editingArticle, setEditingArticle] = useState<KBArticle | null>(null)
  const [kbForm, setKbForm] = useState({ title: '', content: '', category: 'general', tags: '', published: true })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Feedback state
  const [feedbackItems, setFeedbackItems] = useState<Feedback[]>([])
  const [feedbackLoading, setFeedbackLoading] = useState(false)

  const fetchTickets = async () => {
    const params = new URLSearchParams()
    if (filterStatus !== 'all') params.set('status', filterStatus)
    if (filterPriority !== 'all') params.set('priority', filterPriority)
    if (search) params.set('search', search)
    const data = await apiFetch('/support/tickets?' + params.toString())
    setTickets(data.data || [])
    setLoading(false)
  }

  const fetchStats = async () => {
    const data = await apiFetch('/support/stats')
    setStats(data)
  }

  useEffect(() => { fetchTickets(); fetchStats() }, [filterStatus, filterPriority, search])

  const openTicket = async (id: string) => {
    const data = await apiFetch('/support/tickets/' + id)
    setSelected(data)
    setView('detail')
  }

  const sendReply = async () => {
    if (!replyText.trim() || !selected) return
    await apiFetch('/support/tickets/' + selected.id + '/messages', {
      method: 'POST',
      body: JSON.stringify({ body: replyText, sender_type: 'agent', is_internal: isInternal }),
    })
    setReplyText('')
    openTicket(selected.id)
  }

  const updateTicketStatus = async (id: string, status: string) => {
    await apiFetch('/support/tickets/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    if (selected?.id === id) openTicket(id)
    fetchTickets()
    fetchStats()
  }

  const createTicket = async () => {
    if (!newTicket.subject || !newTicket.tenant_id) return
    await apiFetch('/support/tickets', {
      method: 'POST',
      body: JSON.stringify(newTicket),
    })
    setShowCreate(false)
    setNewTicket({ subject: '', description: '', priority: 'normal', tenant_id: '', submitter_email: '', submitter_name: '' })
    fetchTickets()
    fetchStats()
  }

  const loadPatterns = async () => {
    const data = await apiFetch('/support/patterns')
    setPatterns(data)
    setView('patterns')
  }

  const loadTenants = async () => {
    const { data } = await supabase.from('tenants').select('id, name, email').order('name')
    setTenants(data || [])
  }

  useEffect(() => { loadTenants() }, [])

  const isSlaBreached = (ticket: Ticket) => {
    if (['resolved', 'closed'].includes(ticket.status)) return false
    if (ticket.sla_resolve_due && new Date(ticket.sla_resolve_due) < new Date()) return true
    return false
  }

  // ─── KB Functions ─────────────────────────────────────────────────────────
  const fetchKbArticles = async () => {
    setKbLoading(true)
    const data = await apiFetch('/support/kb')
    setKbArticles(data.data || data || [])
    setKbLoading(false)
  }

  const openKbView = () => {
    setView('kb')
    fetchKbArticles()
  }

  const openCreateArticle = () => {
    setEditingArticle(null)
    setKbForm({ title: '', content: '', category: 'general', tags: '', published: true })
    setShowKbModal(true)
  }

  const openEditArticle = (article: KBArticle) => {
    setEditingArticle(article)
    setKbForm({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: (article.tags || []).join(', '),
      published: article.published,
    })
    setShowKbModal(true)
  }

  const saveArticle = async () => {
    if (!kbForm.title.trim() || !kbForm.content.trim()) return
    const body = {
      title: kbForm.title,
      content: kbForm.content,
      category: kbForm.category,
      tags: kbForm.tags.split(',').map(t => t.trim()).filter(Boolean),
      published: kbForm.published,
    }
    if (editingArticle) {
      await apiFetch('/support/kb/' + editingArticle.id, { method: 'PUT', body: JSON.stringify(body) })
    } else {
      await apiFetch('/support/kb', { method: 'POST', body: JSON.stringify(body) })
    }
    setShowKbModal(false)
    fetchKbArticles()
  }

  const deleteArticle = async (id: string) => {
    await apiFetch('/support/kb/' + id, { method: 'DELETE' })
    setDeleteConfirm(null)
    fetchKbArticles()
  }

  const filteredKbArticles = kbArticles.filter(a => {
    if (kbCategoryFilter !== 'all' && a.category !== kbCategoryFilter) return false
    if (kbSearch && !a.title.toLowerCase().includes(kbSearch.toLowerCase()) && !a.content.toLowerCase().includes(kbSearch.toLowerCase())) return false
    return true
  })

  // ─── Feedback Functions ───────────────────────────────────────────────────
  const fetchFeedback = async () => {
    setFeedbackLoading(true)
    const data = await apiFetch('/support/feedback')
    setFeedbackItems(data.data || data || [])
    setFeedbackLoading(false)
  }

  const openFeedbackView = () => {
    setView('feedback')
    fetchFeedback()
  }

  const voteFeedback = async (id: string, delta: number) => {
    const item = feedbackItems.find(f => f.id === id)
    if (!item) return
    await apiFetch('/support/feedback/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ votes: (item.votes || 0) + delta }),
    })
    fetchFeedback()
  }

  const updateFeedbackStatus = async (id: string, status: string) => {
    await apiFetch('/support/feedback/' + id, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
    fetchFeedback()
  }

  // ─── Ticket Detail View ────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="p-8">
        <button onClick={() => { setView('list'); setSelected(null) }} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back to tickets
        </button>

        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm font-mono">{selected.number}</span>
              <span className={'text-xs px-2 py-1 rounded-full font-medium capitalize ' + (statusColors[selected.status] || '')}>{selected.status.replace('_', ' ')}</span>
              <span className={'text-xs px-2 py-1 rounded-full font-medium capitalize ' + (priorityColors[selected.priority] || '')}>{selected.priority}</span>
              {isSlaBreached(selected) && <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400 font-medium">SLA BREACHED</span>}
            </div>
            <h1 className="text-xl font-bold text-white mt-2">{selected.subject}</h1>
            <p className="text-gray-500 text-sm mt-1">
              {selected.tenants?.name || 'Unknown'} &middot; {selected.submitter_email || selected.tenants?.email} &middot; {new Date(selected.created_at).toLocaleDateString()}
            </p>
          </div>
          <div className="flex gap-2">
            {selected.status !== 'resolved' && (
              <button onClick={() => updateTicketStatus(selected.id, 'resolved')} className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm">Resolve</button>
            )}
            {selected.status !== 'closed' && (
              <button onClick={() => updateTicketStatus(selected.id, 'closed')} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm">Close</button>
            )}
          </div>
        </div>

        {selected.description && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
            <p className="text-gray-300 text-sm whitespace-pre-wrap">{selected.description}</p>
          </div>
        )}

        {/* SLA Info */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">Response Due</p>
            <p className={'text-sm font-medium ' + (selected.sla_response_due && new Date(selected.sla_response_due) < new Date() && !selected.first_response_at ? 'text-red-400' : 'text-white')}>
              {selected.sla_response_due ? new Date(selected.sla_response_due).toLocaleString() : '—'}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">Resolve Due</p>
            <p className={'text-sm font-medium ' + (isSlaBreached(selected) ? 'text-red-400' : 'text-white')}>
              {selected.sla_resolve_due ? new Date(selected.sla_resolve_due).toLocaleString() : '—'}
            </p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3">
            <p className="text-xs text-gray-500">Category</p>
            <p className="text-sm font-medium text-white capitalize">{selected.category || 'General'}</p>
          </div>
        </div>

        {/* Rating */}
        {selected.rating && (
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-3 mb-4 flex items-center gap-2">
            <Star size={16} className="text-yellow-400" />
            <span className="text-yellow-400 font-medium">{selected.rating}/5</span>
            {selected.rating_comment && <span className="text-gray-400 text-sm ml-2">{selected.rating_comment}</span>}
          </div>
        )}

        {/* Messages */}
        <div className="space-y-3 mb-4">
          {(selected.messages || []).map(msg => (
            <div key={msg.id} className={'border rounded-xl p-4 ' + (msg.is_internal ? 'bg-yellow-900/10 border-yellow-800/30' : msg.sender_type === 'agent' ? 'bg-blue-900/10 border-blue-800/30' : 'bg-gray-900 border-gray-800')}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium text-gray-400">{msg.sender_name || msg.sender_email || (msg.sender_type === 'agent' ? 'Support Agent' : 'Customer')}</span>
                {msg.is_internal && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Internal</span>}
                {msg.is_ai && <span className="text-xs bg-purple-500/20 text-purple-400 px-1.5 py-0.5 rounded">AI</span>}
                <span className="text-xs text-gray-600 ml-auto">{new Date(msg.created_at).toLocaleString()}</span>
              </div>
              <p className="text-gray-300 text-sm whitespace-pre-wrap">{msg.body}</p>
            </div>
          ))}
        </div>

        {/* Reply */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Type a reply..."
            className="w-full bg-transparent text-white text-sm resize-none outline-none min-h-[80px] placeholder-gray-600"
          />
          <div className="flex items-center justify-between mt-2">
            <label className="flex items-center gap-2 text-sm text-gray-400 cursor-pointer">
              <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)} className="rounded" />
              Internal note
            </label>
            <button onClick={sendReply} disabled={!replyText.trim()} className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm">
              <Send size={14} /> Send
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Patterns View ─────────────────────────────────────────────────────────
  if (view === 'patterns' && patterns) {
    return (
      <div className="p-8">
        <button onClick={() => setView('list')} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back
        </button>
        <h1 className="text-2xl font-bold text-white mb-6">Pattern Detection</h1>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-2">Average Rating</p>
            <div className="flex items-center gap-2">
              <Star size={20} className="text-yellow-400" />
              <span className="text-2xl font-bold text-white">{patterns.avgRating || '—'}</span>
              <span className="text-gray-500 text-sm">/ 5 ({patterns.ratedCount} rated)</span>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-2">By Category</p>
            <div className="space-y-1">
              {patterns.byCategory.map(c => (
                <div key={c.category} className="flex items-center justify-between">
                  <span className="text-xs text-gray-400 capitalize">{c.category}</span>
                  <span className="text-xs font-medium text-white">{c.count}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-2">By Priority</p>
            <div className="space-y-1">
              {patterns.byPriority.map(p => (
                <div key={p.priority} className="flex items-center justify-between">
                  <span className={'text-xs capitalize ' + (priorityColors[p.priority]?.split(' ')[1] || 'text-gray-400')}>{p.priority}</span>
                  <span className="text-xs font-medium text-white">{p.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Daily trend */}
        {patterns.dailyTrend.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-6">
            <p className="text-xs text-gray-500 mb-3">Tickets Per Day (Last 30 Days)</p>
            <div className="flex items-end gap-1 h-32">
              {patterns.dailyTrend.map((d, i) => {
                const max = Math.max(...patterns.dailyTrend.map(x => x.count))
                const h = max > 0 ? (d.count / max) * 100 : 0
                return <div key={i} className="flex-1 bg-blue-500/40 rounded-t" style={{ height: h + '%' }} title={d.day + ': ' + d.count} />
              })}
            </div>
          </div>
        )}

        {/* Top feedback */}
        {patterns.topFeedback.length > 0 && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-3">Top Product Feedback</p>
            {patterns.topFeedback.map((f, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                <div>
                  <span className="text-sm text-white">{f.title}</span>
                  <span className="text-xs text-gray-500 ml-2 capitalize">{f.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">{f.votes} votes</span>
                  <span className={'text-xs px-2 py-0.5 rounded capitalize ' + (f.status === 'done' ? 'bg-green-500/20 text-green-400' : f.status === 'planned' ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-500/20 text-gray-400')}>{f.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── Knowledge Base View ──────────────────────────────────────────────────
  if (view === 'kb') {
    return (
      <div className="p-8">
        <button onClick={() => setView('list')} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
            <p className="text-gray-400 text-sm mt-1">{kbArticles.length} articles</p>
          </div>
          <button onClick={openCreateArticle} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> New Article
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" value={kbSearch} onChange={e => setKbSearch(e.target.value)} placeholder="Search articles..."
              className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600" />
          </div>
          <select value={kbCategoryFilter} onChange={e => setKbCategoryFilter(e.target.value)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none">
            <option value="all">All Categories</option>
            {KB_CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
        </div>

        {/* Article list */}
        {kbLoading ? (
          <p className="text-gray-400 text-sm">Loading...</p>
        ) : filteredKbArticles.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-xl p-16 text-center">
            <BookOpen size={40} className="text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No articles found</p>
            <p className="text-gray-600 text-sm mt-1">Create your first knowledge base article</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredKbArticles.map(article => (
              <div key={article.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-medium text-sm truncate">{article.title}</h3>
                      {article.published ? (
                        <span className="flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full"><Eye size={10} /> Published</span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs bg-gray-500/20 text-gray-400 px-2 py-0.5 rounded-full"><EyeOff size={10} /> Draft</span>
                      )}
                    </div>
                    <p className="text-gray-500 text-xs mb-2 line-clamp-2">{article.content.substring(0, 200)}{article.content.length > 200 ? '...' : ''}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 capitalize">{article.category.replace('_', ' ')}</span>
                      {(article.tags || []).map(tag => (
                        <span key={tag} className="flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">
                          <Tag size={8} /> {tag}
                        </span>
                      ))}
                      <span className="text-xs text-gray-600 ml-auto">{new Date(article.updated_at || article.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <button onClick={() => openEditArticle(article)} className="p-1.5 text-gray-500 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
                      <Edit2 size={14} />
                    </button>
                    {deleteConfirm === article.id ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => deleteArticle(article.id)} className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded">Delete</button>
                        <button onClick={() => setDeleteConfirm(null)} className="px-2 py-1 text-xs text-gray-400 hover:text-white">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirm(article.id)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors">
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Article Modal */}
        {showKbModal && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">{editingArticle ? 'Edit Article' : 'New Article'}</h2>
                <button onClick={() => setShowKbModal(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Title</label>
                  <input value={kbForm.title} onChange={e => setKbForm({ ...kbForm, title: e.target.value })}
                    placeholder="Article title..."
                    className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-gray-600" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Content</label>
                  <textarea value={kbForm.content} onChange={e => setKbForm({ ...kbForm, content: e.target.value })}
                    placeholder="Write the article content..."
                    className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-gray-600 min-h-[200px] resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500">Category</label>
                    <select value={kbForm.category} onChange={e => setKbForm({ ...kbForm, category: e.target.value })}
                      className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none">
                      {KB_CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Tags (comma-separated)</label>
                    <input value={kbForm.tags} onChange={e => setKbForm({ ...kbForm, tags: e.target.value })}
                      placeholder="setup, config, auth..."
                      className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none focus:border-gray-600" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" checked={kbForm.published} onChange={e => setKbForm({ ...kbForm, published: e.target.checked })} className="sr-only peer" />
                    <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                  <span className="text-sm text-gray-400">Published</span>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setShowKbModal(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
                <button onClick={saveArticle} disabled={!kbForm.title.trim() || !kbForm.content.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                  {editingArticle ? 'Save Changes' : 'Create Article'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ─── Feedback View ────────────────────────────────────────────────────────
  if (view === 'feedback') {
    return (
      <div className="p-8">
        <button onClick={() => setView('list')} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Product Feedback</h1>
            <p className="text-gray-400 text-sm mt-1">{feedbackItems.length} feedback items</p>
          </div>
        </div>

        {/* Feedback list */}
        {feedbackLoading ? (
          <p className="text-gray-400 text-sm">Loading...</p>
        ) : feedbackItems.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-xl p-16 text-center">
            <MessageSquare size={40} className="text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 font-medium">No feedback yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {feedbackItems.map(item => (
              <div key={item.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                <div className="flex items-start gap-3">
                  {/* Vote buttons */}
                  <div className="flex flex-col items-center gap-0.5 pt-0.5">
                    <button onClick={() => voteFeedback(item.id, 1)}
                      className="p-1 text-gray-500 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors">
                      <ThumbsUp size={14} />
                    </button>
                    <span className="text-sm font-bold text-white">{item.votes || 0}</span>
                    <button onClick={() => voteFeedback(item.id, -1)}
                      className="p-1 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors rotate-180">
                      <ThumbsUp size={14} />
                    </button>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-white font-medium text-sm">{item.title}</h3>
                      <span className={'text-xs px-2 py-0.5 rounded-full font-medium capitalize ' + (feedbackStatusColors[item.status] || 'bg-gray-500/20 text-gray-400')}>
                        {item.status.replace('_', ' ')}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-gray-500 text-xs mb-2">{item.description}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 capitalize">{item.category}</span>
                      <span className="text-xs text-gray-600">{new Date(item.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Status dropdown */}
                  <div className="relative">
                    <select
                      value={item.status}
                      onChange={e => updateFeedbackStatus(item.id, e.target.value)}
                      className="appearance-none pl-3 pr-7 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300 focus:outline-none focus:border-gray-600 cursor-pointer"
                    >
                      <option value="new">New</option>
                      <option value="planned">Planned</option>
                      <option value="in_progress">In Progress</option>
                      <option value="completed">Completed</option>
                      <option value="declined">Declined</option>
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ─── Ticket List View ──────────────────────────────────────────────────────
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Support</h1>
          <p className="text-gray-400 text-sm mt-1">{stats?.total || 0} total tickets</p>
        </div>
        <div className="flex gap-2">
          <button onClick={openFeedbackView} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors">
            <MessageSquare size={16} /> Feedback
          </button>
          <button onClick={openKbView} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors">
            <BookOpen size={16} /> Knowledge Base
          </button>
          <button onClick={loadPatterns} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg text-sm transition-colors">
            <BarChart3 size={16} /> Patterns
          </button>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> New Ticket
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Open', value: stats.open, color: 'text-blue-400' },
            { label: 'In Progress', value: stats.in_progress, color: 'text-yellow-400' },
            { label: 'Resolved', value: stats.resolved, color: 'text-green-400' },
            { label: 'SLA Breached', value: stats.sla_breached, color: stats.sla_breached > 0 ? 'text-red-400' : 'text-white' },
            { label: 'Avg Rating', value: stats.avgRating || '—', color: 'text-yellow-400' },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={'text-xl font-bold ' + s.color}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tickets..."
            className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600" />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_progress">In Progress</option>
          <option value="waiting">Waiting</option>
          <option value="resolved">Resolved</option>
          <option value="closed">Closed</option>
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none">
          <option value="all">All Priority</option>
          <option value="critical">Critical</option>
          <option value="urgent">Urgent</option>
          <option value="high">High</option>
          <option value="normal">Normal</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Ticket list */}
      {loading ? (
        <p className="text-gray-400 text-sm">Loading...</p>
      ) : tickets.length === 0 ? (
        <div className="border border-dashed border-gray-700 rounded-xl p-16 text-center">
          <LifeBuoy size={40} className="text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 font-medium">No support tickets</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Ticket</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Customer</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Priority</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Status</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Category</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">SLA</th>
                <th className="text-right text-xs text-gray-500 font-medium px-6 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => (
                <tr key={t.id} onClick={() => openTicket(t.id)}
                  className={'cursor-pointer hover:bg-gray-800/50 transition-colors ' + (i < tickets.length - 1 ? 'border-b border-gray-800' : '')}>
                  <td className="px-6 py-3">
                    <div className="font-medium text-white text-sm">{t.subject}</div>
                    <div className="text-gray-500 text-xs font-mono">{t.number}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm text-gray-300">{t.tenants?.name || '—'}</div>
                    <div className="text-xs text-gray-500">{t.submitter_email || t.tenants?.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={'text-xs px-2 py-1 rounded-full font-medium capitalize ' + (priorityColors[t.priority] || '')}>{t.priority}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={'text-xs px-2 py-1 rounded-full font-medium capitalize ' + (statusColors[t.status] || '')}>{t.status.replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400 capitalize">{t.category || '—'}</td>
                  <td className="px-4 py-3">
                    {isSlaBreached(t) ? (
                      <span className="flex items-center gap-1 text-xs text-red-400"><AlertTriangle size={12} /> Breached</span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-gray-500"><Clock size={12} /> OK</span>
                    )}
                  </td>
                  <td className="px-6 py-3 text-right text-xs text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Ticket Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white">New Support Ticket</h2>
              <button onClick={() => setShowCreate(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Customer</label>
                <select value={newTicket.tenant_id} onChange={e => setNewTicket({ ...newTicket, tenant_id: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none">
                  <option value="">Select customer...</option>
                  {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Subject</label>
                <input value={newTicket.subject} onChange={e => setNewTicket({ ...newTicket, subject: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Description</label>
                <textarea value={newTicket.description} onChange={e => setNewTicket({ ...newTicket, description: e.target.value })}
                  className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none min-h-[80px] resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">Priority</label>
                  <select value={newTicket.priority} onChange={e => setNewTicket({ ...newTicket, priority: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none">
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500">Submitter Email</label>
                  <input value={newTicket.submitter_email} onChange={e => setNewTicket({ ...newTicket, submitter_email: e.target.value })}
                    className="w-full mt-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-gray-400 hover:text-white text-sm">Cancel</button>
              <button onClick={createTicket} disabled={!newTicket.subject || !newTicket.tenant_id}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-medium">
                Create Ticket
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
