import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { Search, BookOpen, ChevronDown, ChevronRight, Bot, Send, ArrowLeft, ExternalLink, Plus, Edit2, Trash2, X, Eye } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

type Article = {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  isFaq: boolean;
  viewCount: number;
  sortOrder: number;
};

export default function HelpPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [selected, setSelected] = useState<Article | null>(null);
  const [expandedFaqs, setExpandedFaqs] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'browse' | 'article' | 'ai-chat' | 'manage'>('browse');

  // AI Chat
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);

  // Admin edit
  const [editArticle, setEditArticle] = useState<Partial<Article> | null>(null);

  const fetchArticles = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (search) params.search = search;
      if (filterCategory !== 'all') params.category = filterCategory;
      const data = await api.get('/api/support/kb', params);
      setArticles(Array.isArray(data) ? data : []);
    } catch { setArticles([]); }
    setLoading(false);
  }, [search, filterCategory]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const categories = [...new Set(articles.map(a => a.category).filter(Boolean))] as string[];
  const faqs = articles.filter(a => a.isFaq);
  const kbArticles = articles.filter(a => {
    if (filterCategory !== 'all' && a.category !== filterCategory) return false;
    return true;
  });

  const toggleFaq = (id: string) => {
    setExpandedFaqs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const openArticle = (article: Article) => {
    setSelected(article);
    setView('article');
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const msg = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, msg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const data = await api.post('/api/support/ai-chat', { message: msg.content, conversationHistory: chatMessages });
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'AI support is unavailable. Please submit a ticket instead.' }]);
    }
    setChatLoading(false);
  };

  const saveArticle = async () => {
    if (!editArticle?.title || !editArticle?.content) return;
    try {
      if (editArticle.id) {
        await api.put('/api/support/kb/' + editArticle.id, editArticle);
      } else {
        await api.post('/api/support/kb', editArticle);
      }
      setEditArticle(null);
      fetchArticles();
    } catch {}
  };

  const deleteArticle = async (id: string) => {
    try {
      await api.request('/api/support/kb/' + id, { method: 'DELETE' });
      fetchArticles();
    } catch {}
  };

  // ─── Article Detail ────────────────────────────────────────────────────────
  if (view === 'article' && selected) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button onClick={() => { setView('browse'); setSelected(null); }} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back to Help
        </button>
        {selected.category && <span className="text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded mb-2 inline-block">{selected.category}</span>}
        <h1 className="text-xl font-bold text-white mb-4">{selected.title}</h1>
        <div className="prose prose-invert prose-sm max-w-none">
          <div className="text-gray-300 text-sm whitespace-pre-wrap leading-relaxed">{selected.content}</div>
        </div>
      </div>
    );
  }

  // ─── AI Chat ───────────────────────────────────────────────────────────────
  if (view === 'ai-chat') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <button onClick={() => setView('browse')} className="flex items-center gap-1 text-gray-400 hover:text-white text-sm mb-4">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2 mb-4">
          <Bot size={22} className="text-purple-400" />
          <h1 className="text-lg font-bold text-white">AI Support Assistant</h1>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl min-h-[400px] flex flex-col">
          <div className="flex-1 p-4 space-y-3 overflow-y-auto max-h-[500px]">
            {chatMessages.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-8">Ask a question and our AI will help using the knowledge base.</p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={'flex ' + (msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={'max-w-[80%] rounded-xl px-4 py-2 text-sm ' + (msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300')}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && <div className="flex justify-start"><div className="bg-gray-800 rounded-xl px-4 py-2 text-sm text-gray-400">Thinking...</div></div>}
          </div>
          <div className="border-t border-gray-800 p-3 flex gap-2">
            <input value={chatInput} onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
              placeholder="Ask a question..." className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none" />
            <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-sm">
              <Send size={16} />
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-2">
          Can't find an answer? <a href="/crm/support" className="text-blue-400 hover:underline">Submit a support ticket</a>
        </p>
      </div>
    );
  }

  // ─── Admin Manage Articles ─────────────────────────────────────────────────
  if (view === 'manage' && isAdmin) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setView('browse')} className="text-gray-400 hover:text-white"><ArrowLeft size={18} /></button>
            <h1 className="text-lg font-bold text-white">Manage Help Articles</h1>
          </div>
          <button onClick={() => setEditArticle({ title: '', content: '', category: '', isFaq: false, sortOrder: 0 })}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm">
            <Plus size={14} /> Add Article
          </button>
        </div>
        <div className="space-y-2">
          {articles.map(a => (
            <div key={a.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center justify-between">
              <div>
                <span className="text-white text-sm font-medium">{a.title}</span>
                <div className="flex items-center gap-2 mt-0.5">
                  {a.category && <span className="text-xs text-gray-500">{a.category}</span>}
                  {a.isFaq && <span className="text-xs bg-yellow-500/20 text-yellow-400 px-1 py-0.5 rounded">FAQ</span>}
                  <span className="text-xs text-gray-600"><Eye size={10} className="inline" /> {a.viewCount}</span>
                </div>
              </div>
              <div className="flex gap-1">
                <button onClick={() => setEditArticle(a)} className="p-1.5 text-gray-400 hover:text-white"><Edit2 size={14} /></button>
                <button onClick={() => deleteArticle(a.id)} className="p-1.5 text-gray-400 hover:text-red-400"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
          {articles.length === 0 && <p className="text-gray-500 text-sm text-center py-8">No articles yet. Add your first help article.</p>}
        </div>

        {/* Edit Modal */}
        {editArticle && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-bold text-white">{editArticle.id ? 'Edit' : 'New'} Article</h2>
                <button onClick={() => setEditArticle(null)} className="text-gray-500 hover:text-white"><X size={18} /></button>
              </div>
              <div className="space-y-3">
                <input value={editArticle.title || ''} onChange={e => setEditArticle({ ...editArticle, title: e.target.value })}
                  placeholder="Title" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none" />
                <textarea value={editArticle.content || ''} onChange={e => setEditArticle({ ...editArticle, content: e.target.value })}
                  placeholder="Content" rows={8} className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none resize-none" />
                <div className="grid grid-cols-2 gap-3">
                  <input value={editArticle.category || ''} onChange={e => setEditArticle({ ...editArticle, category: e.target.value })}
                    placeholder="Category" className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none" />
                  <label className="flex items-center gap-2 text-sm text-gray-300 px-3 py-2">
                    <input type="checkbox" checked={editArticle.isFaq || false} onChange={e => setEditArticle({ ...editArticle, isFaq: e.target.checked })} />
                    Show as FAQ
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={() => setEditArticle(null)} className="px-3 py-1.5 text-gray-400 text-sm">Cancel</button>
                <button onClick={saveArticle} disabled={!editArticle.title || !editArticle.content}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Browse View ───────────────────────────────────────────────────────────
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-white">Help Center</h1>
        <div className="flex gap-2">
          <button onClick={() => setView('ai-chat')}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 rounded-lg text-sm">
            <Bot size={16} /> Ask AI
          </button>
          {isAdmin && (
            <button onClick={() => setView('manage')}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm">
              <Edit2 size={14} /> Manage
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search help articles..."
            className="w-full pl-10 pr-3 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600" />
        </div>
        {categories.length > 0 && (
          <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
            className="px-3 py-2.5 bg-gray-900 border border-gray-800 rounded-xl text-sm text-gray-300 focus:outline-none">
            <option value="all">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {/* FAQ Accordion */}
      {faqs.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Frequently Asked Questions</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden divide-y divide-gray-800">
            {faqs.map(faq => (
              <div key={faq.id}>
                <button onClick={() => toggleFaq(faq.id)}
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/50 transition-colors">
                  <span className="text-sm text-white font-medium">{faq.title}</span>
                  {expandedFaqs.has(faq.id) ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
                </button>
                {expandedFaqs.has(faq.id) && (
                  <div className="px-4 pb-3">
                    <p className="text-sm text-gray-400 whitespace-pre-wrap">{faq.content}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge Base Articles */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        {search ? 'Search Results' : 'Knowledge Base'}
      </h2>
      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : kbArticles.length === 0 ? (
        <div className="border border-dashed border-gray-700 rounded-xl p-12 text-center">
          <BookOpen size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">{search ? 'No matching articles found' : 'No help articles yet'}</p>
          <button onClick={() => setView('ai-chat')} className="mt-3 text-purple-400 hover:underline text-sm">Try asking our AI assistant</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {kbArticles.map(a => (
            <div key={a.id} onClick={() => openArticle(a)}
              className="bg-gray-900 border border-gray-800 rounded-xl p-4 cursor-pointer hover:bg-gray-800/50 transition-colors">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-white">{a.title}</h3>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{a.content.slice(0, 120)}...</p>
                </div>
                <ChevronRight size={16} className="text-gray-600 mt-0.5 flex-shrink-0" />
              </div>
              {a.category && <span className="text-xs text-gray-600 mt-2 inline-block">{a.category}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Support ticket link */}
      <div className="mt-6 bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
        <p className="text-sm text-gray-400">Can't find what you need?</p>
        <a href="/crm/support" className="text-blue-400 hover:underline text-sm font-medium">Submit a support ticket</a>
      </div>
    </div>
  );
}
