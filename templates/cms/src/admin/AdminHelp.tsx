import React, { useState, useEffect, useCallback } from 'react';
import AdminLayout from './AdminLayout';
import { apiRequest } from './api';

type Article = {
  id: string;
  title: string;
  content: string;
  category: string | null;
  tags: string[];
  is_faq: boolean;
  view_count: number;
};

export default function AdminHelp() {
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

  // Edit
  const [editArticle, setEditArticle] = useState<Partial<Article> | null>(null);

  const fetchArticles = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterCategory !== 'all') params.set('category', filterCategory);
      const data = await apiRequest('/admin/help/kb?' + params.toString());
      setArticles(Array.isArray(data) ? data : []);
    } catch { setArticles([]); }
    setLoading(false);
  }, [search, filterCategory]);

  useEffect(() => { fetchArticles(); }, [fetchArticles]);

  const categories = [...new Set(articles.map(a => a.category).filter(Boolean))] as string[];
  const faqs = articles.filter(a => a.is_faq);

  const toggleFaq = (id: string) => {
    setExpandedFaqs(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const msg = { role: 'user', content: chatInput };
    setChatMessages(prev => [...prev, msg]);
    setChatInput('');
    setChatLoading(true);
    try {
      const data = await apiRequest('/admin/help/ai-chat', {
        method: 'POST',
        body: JSON.stringify({ message: msg.content, conversationHistory: chatMessages }),
      });
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: 'AI support is unavailable right now.' }]);
    }
    setChatLoading(false);
  };

  const saveArticle = async () => {
    if (!editArticle?.title || !editArticle?.content) return;
    try {
      if (editArticle.id) {
        await apiRequest('/admin/help/kb/' + editArticle.id, { method: 'PUT', body: JSON.stringify(editArticle) });
      } else {
        await apiRequest('/admin/help/kb', { method: 'POST', body: JSON.stringify(editArticle) });
      }
      setEditArticle(null);
      fetchArticles();
    } catch {}
  };

  const deleteArticle = async (id: string) => {
    try {
      await apiRequest('/admin/help/kb/' + id, { method: 'DELETE' });
      fetchArticles();
    } catch {}
  };

  // ─── Article View ──────────────────────────────────────────────────────────
  if (view === 'article' && selected) {
    return (
      <AdminLayout title="Help Center">
        <div style={{ maxWidth: 700, margin: '0 auto', padding: '2rem 1rem' }}>
          <button onClick={() => { setView('browse'); setSelected(null); }}
            className="admin-btn" style={{ marginBottom: '1rem', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>
            ← Back to Help
          </button>
          {selected.category && (
            <span style={{ display: 'inline-block', background: 'var(--color-primary-light, #e0f2fe)', color: 'var(--color-primary, #1e3a5f)', padding: '2px 8px', borderRadius: 4, fontSize: '0.75rem', marginBottom: 8 }}>
              {selected.category}
            </span>
          )}
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '1rem' }}>{selected.title}</h2>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, fontSize: '0.9375rem', color: '#555' }}>{selected.content}</div>
        </div>
      </AdminLayout>
    );
  }

  // ─── AI Chat View ──────────────────────────────────────────────────────────
  if (view === 'ai-chat') {
    return (
      <AdminLayout title="AI Support Assistant">
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '2rem 1rem' }}>
          <button onClick={() => setView('browse')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', marginBottom: '1rem', color: '#666' }}>
            ← Back
          </button>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, minHeight: 400, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', maxHeight: 450 }}>
              {chatMessages.length === 0 && (
                <p style={{ textAlign: 'center', color: '#999', padding: '3rem 0', fontSize: '0.875rem' }}>
                  Ask a question about managing your website.
                </p>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                  <div style={{
                    maxWidth: '80%', borderRadius: 12, padding: '8px 14px', fontSize: '0.875rem',
                    background: msg.role === 'user' ? 'var(--color-primary, #1e3a5f)' : '#f3f4f6',
                    color: msg.role === 'user' ? '#fff' : '#333',
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <div style={{ background: '#f3f4f6', borderRadius: 12, padding: '8px 14px', fontSize: '0.875rem', color: '#999' }}>Thinking...</div>
                </div>
              )}
            </div>
            <div style={{ borderTop: '1px solid #e5e7eb', padding: 12, display: 'flex', gap: 8 }}>
              <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder="Ask a question..."
                style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: '0.875rem', outline: 'none' }} />
              <button onClick={sendChat} disabled={chatLoading || !chatInput.trim()}
                style={{ padding: '8px 16px', background: 'var(--color-primary, #1e3a5f)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', opacity: chatLoading || !chatInput.trim() ? 0.5 : 1 }}>
                Send
              </button>
            </div>
          </div>
        </div>
      </AdminLayout>
    );
  }

  // ─── Manage View ───────────────────────────────────────────────────────────
  if (view === 'manage') {
    return (
      <AdminLayout title="Manage Help Articles" actions={
        <button className="admin-btn admin-btn-primary" onClick={() => setEditArticle({ title: '', content: '', category: '', is_faq: false })}>
          + Add Article
        </button>
      }>
        <div style={{ padding: '1rem' }}>
          <button onClick={() => setView('browse')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem', color: '#666', marginBottom: '1rem' }}>
            ← Back
          </button>
          <div className="admin-table">
            {articles.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
                <div>
                  <strong style={{ fontSize: '0.875rem' }}>{a.title}</strong>
                  <div style={{ fontSize: '0.75rem', color: '#999', marginTop: 2 }}>
                    {a.category && <span>{a.category} · </span>}
                    {a.is_faq && <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: 4 }}>FAQ</span>}
                    <span style={{ marginLeft: 8 }}>{a.view_count} views</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button onClick={() => setEditArticle(a)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#666' }}>✏️</button>
                  <button onClick={() => deleteArticle(a.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#666' }}>🗑️</button>
                </div>
              </div>
            ))}
            {articles.length === 0 && <p style={{ textAlign: 'center', color: '#999', padding: '2rem' }}>No articles yet</p>}
          </div>

          {/* Edit Modal */}
          {editArticle && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
              <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 500, padding: '1.5rem' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, marginBottom: '1rem' }}>{editArticle.id ? 'Edit' : 'New'} Article</h3>
                <input value={editArticle.title || ''} onChange={e => setEditArticle({ ...editArticle, title: e.target.value })}
                  placeholder="Title" style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, fontSize: '0.875rem' }} />
                <textarea value={editArticle.content || ''} onChange={e => setEditArticle({ ...editArticle, content: e.target.value })}
                  placeholder="Content" rows={8} style={{ width: '100%', padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, fontSize: '0.875rem', resize: 'none' }} />
                <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
                  <input value={editArticle.category || ''} onChange={e => setEditArticle({ ...editArticle, category: e.target.value })}
                    placeholder="Category" style={{ flex: 1, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: '0.875rem' }} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.875rem' }}>
                    <input type="checkbox" checked={editArticle.is_faq || false} onChange={e => setEditArticle({ ...editArticle, is_faq: e.target.checked })} />
                    FAQ
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button onClick={() => setEditArticle(null)} style={{ padding: '6px 16px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', fontSize: '0.875rem' }}>Cancel</button>
                  <button onClick={saveArticle} disabled={!editArticle.title || !editArticle.content}
                    style={{ padding: '6px 16px', background: 'var(--color-primary, #1e3a5f)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.875rem', opacity: !editArticle.title || !editArticle.content ? 0.5 : 1 }}>Save</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </AdminLayout>
    );
  }

  // ─── Browse View ───────────────────────────────────────────────────────────
  return (
    <AdminLayout title="Help Center" subtitle="Search articles, FAQs, and ask our AI assistant" actions={
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="admin-btn" onClick={() => setView('ai-chat')} style={{ background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: '0.875rem' }}>
          🤖 Ask AI
        </button>
        <button className="admin-btn" onClick={() => setView('manage')} style={{ background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 14px', cursor: 'pointer', fontSize: '0.875rem' }}>
          ✏️ Manage
        </button>
      </div>
    }>
      <div style={{ padding: '1rem' }}>
        {/* Search */}
        <div style={{ display: 'flex', gap: 12, marginBottom: '1.5rem' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search help articles..."
              style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: '0.875rem', outline: 'none' }} />
            <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#999' }}>🔍</span>
          </div>
          {categories.length > 0 && (
            <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
              style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 10, fontSize: '0.875rem' }}>
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
        </div>

        {/* FAQ Accordion */}
        {faqs.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#999', marginBottom: 12 }}>Frequently Asked Questions</h3>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
              {faqs.map((faq, i) => (
                <div key={faq.id} style={{ borderTop: i > 0 ? '1px solid #e5e7eb' : 'none' }}>
                  <button onClick={() => toggleFaq(faq.id)}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: '0.875rem', fontWeight: 500 }}>
                    {faq.title}
                    <span style={{ color: '#999' }}>{expandedFaqs.has(faq.id) ? '▾' : '▸'}</span>
                  </button>
                  {expandedFaqs.has(faq.id) && (
                    <div style={{ padding: '0 16px 12px', fontSize: '0.875rem', color: '#666', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                      {faq.content}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Knowledge Base */}
        <h3 style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, color: '#999', marginBottom: 12 }}>
          {search ? 'Search Results' : 'Knowledge Base'}
        </h3>
        {loading ? (
          <p style={{ color: '#999', fontSize: '0.875rem' }}>Loading...</p>
        ) : articles.filter(a => !a.is_faq).length === 0 ? (
          <div style={{ border: '2px dashed #e5e7eb', borderRadius: 12, padding: '3rem', textAlign: 'center' }}>
            <p style={{ fontSize: '2rem', marginBottom: 8 }}>📚</p>
            <p style={{ color: '#999', fontSize: '0.875rem' }}>{search ? 'No matching articles' : 'No help articles yet'}</p>
            <button onClick={() => setView('ai-chat')} style={{ marginTop: 12, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.875rem' }}>
              Try asking our AI assistant →
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {articles.filter(a => !a.is_faq).map(a => (
              <div key={a.id} onClick={() => { setSelected(a); setView('article'); }}
                style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: '1rem', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}>
                <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>{a.title}</h4>
                <p style={{ fontSize: '0.8rem', color: '#888', lineHeight: 1.4 }}>{a.content.slice(0, 100)}...</p>
                {a.category && <span style={{ fontSize: '0.7rem', color: '#aaa', marginTop: 6, display: 'inline-block' }}>{a.category}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
