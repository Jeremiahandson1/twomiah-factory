import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from './AdminLayout';
import ImagePicker from './ImagePicker';
import { useToast } from './Toast';
import {
  getPosts, getPost, createPost, updatePost, deletePost
} from './api';
import { useAdmin } from './AdminContext';

function AdminBlog() {
  const toast = useToast();
  const { settings } = useAdmin();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null = list view, object = editing
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all'); // all, published, draft
  const contentRef = useRef(null);

  useEffect(() => {
    loadPosts();
  }, []);

  const loadPosts = async () => {
    try {
      const data = await getPosts();
      setPosts(Array.isArray(data) ? data : []);
    } catch (err) {
      toast.error('Failed to load posts');
    }
    setLoading(false);
  };

  const handleNew = () => {
    setEditing({
      id: '',
      title: '',
      slug: '',
      excerpt: '',
      content: '',
      author: settings?.companyName || settings?.siteName || '',
      category: 'roofing',
      tags: [],
      image: '',
      relatedServices: [],
      featured: false,
      published: false,
      publishedAt: new Date().toISOString().slice(0, 16),
      _isNew: true
    });
  };

  const handleEdit = (post) => {
    setEditing({
      ...post,
      publishedAt: post.publishedAt ? post.publishedAt.slice(0, 16) : new Date().toISOString().slice(0, 16),
      tags: post.tags || [],
      relatedServices: post.relatedServices || [],
      _isNew: false
    });
  };

  const handleSave = async () => {
    if (!editing.title.trim()) {
      toast.error('Title is required');
      return;
    }

    setSaving(true);
    try {
      const slug = editing.slug || editing.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

      const postData = {
        title: editing.title,
        slug,
        excerpt: editing.excerpt,
        content: editing.content,
        author: editing.author,
        category: editing.category,
        tags: editing.tags,
        image: editing.image,
        relatedServices: editing.relatedServices,
        featured: editing.featured,
        published: editing.published,
        publishedAt: editing.publishedAt ? new Date(editing.publishedAt).toISOString() : new Date().toISOString()
      };

      if (editing._isNew) {
        const created = await createPost(postData);
        toast.success('Post created');
        setEditing({ ...created, _isNew: false, publishedAt: created.publishedAt?.slice(0, 16) });
      } else {
        const updated = await updatePost(editing.id, postData);
        toast.success('Post saved');
        setEditing({ ...updated, _isNew: false, publishedAt: updated.publishedAt?.slice(0, 16) });
      }
      loadPosts();
    } catch (err) {
      toast.error(err.message || 'Failed to save');
    }
    setSaving(false);
  };

  const handleDelete = async (post) => {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    try {
      await deletePost(post.id);
      toast.success('Post deleted');
      if (editing?.id === post.id) setEditing(null);
      loadPosts();
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const handleTogglePublish = async (post) => {
    try {
      await updatePost(post.id, { published: !post.published });
      toast.success(post.published ? 'Post unpublished' : 'Post published');
      loadPosts();
    } catch (err) {
      toast.error('Failed to update');
    }
  };

  const updateField = (field, value) => {
    setEditing(prev => ({ ...prev, [field]: value }));
  };

  const generateSlug = () => {
    if (!editing?.title) return;
    const slug = editing.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    updateField('slug', slug);
  };

  const handleTagInput = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = e.target.value.trim().replace(/,$/,'');
      if (tag && !editing.tags.includes(tag)) {
        updateField('tags', [...editing.tags, tag]);
      }
      e.target.value = '';
    }
  };

  const removeTag = (tag) => {
    updateField('tags', editing.tags.filter(t => t !== tag));
  };

  const serviceOptions = ['roofing', 'siding', 'windows', 'insulation', 'remodeling', 'new-construction'];
  const categoryOptions = ['roofing', 'siding', 'windows', 'insulation', 'remodeling', 'tips', 'news'];

  const toggleService = (svc) => {
    const current = editing.relatedServices || [];
    if (current.includes(svc)) {
      updateField('relatedServices', current.filter(s => s !== svc));
    } else {
      updateField('relatedServices', [...current, svc]);
    }
  };

  const filteredPosts = posts.filter(p => {
    if (filter === 'published') return p.published;
    if (filter === 'draft') return !p.published;
    return true;
  });

  const formatDate = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const wordCount = (html) => {
    return (html || '').replace(/<[^>]*>/g, '').split(/\s+/).filter(w => w).length;
  };

  // Keyboard shortcut: Cmd+S to save
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's' && editing) {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing]);

  // =========== LIST VIEW ===========
  if (!editing) {
    return (
      <AdminLayout
        title="Blog Posts"
        subtitle={`${posts.length} post${posts.length !== 1 ? 's' : ''}`}
        actions={
          <button className="admin-btn admin-btn-primary" onClick={handleNew}>
            + New Post
          </button>
        }
      >
        {/* Filters */}
        <div className="admin-section">
          <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
            {['all', 'published', 'draft'].map(f => (
              <button
                key={f}
                className={`admin-btn ${filter === f ? 'admin-btn-primary' : 'admin-btn-secondary'}`}
                onClick={() => setFilter(f)}
                style={{ textTransform: 'capitalize', fontSize: '0.8rem', padding: '6px 14px' }}
              >
                {f} ({f === 'all' ? posts.length : posts.filter(p => f === 'published' ? p.published : !p.published).length})
              </button>
            ))}
          </div>

          {loading ? (
            <p style={{ color: 'var(--admin-text-secondary)' }}>Loading...</p>
          ) : filteredPosts.length === 0 ? (
            <div className="admin-card" style={{ textAlign: 'center', padding: '40px' }}>
              <p style={{ fontSize: '1.1rem', marginBottom: '12px' }}>No posts yet</p>
              <button className="admin-btn admin-btn-primary" onClick={handleNew}>Create Your First Post</button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {filteredPosts.map(post => (
                <div
                  key={post.id}
                  className="admin-card"
                  style={{
                    display: 'flex', alignItems: 'center', gap: '16px',
                    padding: '16px', cursor: 'pointer',
                    borderLeft: post.published ? '3px solid #22c55e' : '3px solid #94a3b8'
                  }}
                  onClick={() => handleEdit(post)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '1rem' }}>{post.title}</strong>
                      {post.featured && (
                        <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>Featured</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--admin-text-secondary)', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span style={{ textTransform: 'capitalize' }}>{post.category}</span>
                      <span>{formatDate(post.publishedAt)}</span>
                      <span>{wordCount(post.content)} words</span>
                      <span style={{ color: post.published ? '#22c55e' : '#94a3b8' }}>
                        {post.published ? '● Published' : '○ Draft'}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '4px 10px' }}
                      onClick={() => handleTogglePublish(post)}
                    >
                      {post.published ? 'Unpublish' : 'Publish'}
                    </button>
                    <button
                      className="admin-btn admin-btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '4px 10px', color: '#ef4444' }}
                      onClick={() => handleDelete(post)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </AdminLayout>
    );
  }

  // =========== EDITOR VIEW ===========
  return (
    <AdminLayout
      title={editing._isNew ? 'New Blog Post' : 'Edit Post'}
      subtitle={editing._isNew ? '' : editing.title}
      actions={
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="admin-btn admin-btn-secondary" onClick={() => setEditing(null)}>
            ← Back
          </button>
          <button
            className="admin-btn admin-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save Post'}
          </button>
        </div>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>
        {/* Main Content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Title */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <div className="form-group" style={{ marginBottom: '12px' }}>
              <label>Title</label>
              <input
                type="text"
                value={editing.title}
                onChange={e => updateField('title', e.target.value)}
                placeholder="Post title..."
                style={{ fontSize: '1.2rem', fontWeight: 600 }}
              />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                Slug
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', color: 'var(--admin-primary)', cursor: 'pointer', fontSize: '0.75rem' }}
                  onClick={generateSlug}
                >
                  Auto-generate
                </button>
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                <span style={{ padding: '8px 12px', background: 'var(--admin-surface-hover)', borderRadius: '6px 0 0 6px', border: '1px solid var(--admin-border)', borderRight: 'none', fontSize: '0.85rem', color: 'var(--admin-text-secondary)', whiteSpace: 'nowrap' }}>
                  /blog/
                </span>
                <input
                  type="text"
                  value={editing.slug}
                  onChange={e => updateField('slug', e.target.value)}
                  placeholder="post-url-slug"
                  style={{ borderRadius: '0 6px 6px 0' }}
                />
              </div>
            </div>
          </div>

          {/* Excerpt */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Excerpt</label>
              <textarea
                value={editing.excerpt}
                onChange={e => updateField('excerpt', e.target.value)}
                placeholder="Brief summary for blog listing and SEO..."
                rows={3}
                style={{ resize: 'vertical' }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--admin-text-secondary)', marginTop: '4px' }}>
                {(editing.excerpt || '').length}/160 characters (ideal for SEO)
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Content (HTML)</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-secondary)', fontWeight: 400 }}>
                  {wordCount(editing.content)} words
                </span>
              </label>
              {/* Toolbar */}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                {[
                  { label: 'H2', tag: 'h2' },
                  { label: 'H3', tag: 'h3' },
                  { label: 'B', tag: 'strong' },
                  { label: 'I', tag: 'em' },
                  { label: 'P', tag: 'p' },
                  { label: 'Link', tag: 'a' },
                  { label: 'UL', tag: 'ul' },
                ].map(btn => (
                  <button
                    key={btn.label}
                    type="button"
                    className="admin-btn admin-btn-secondary"
                    style={{ padding: '4px 10px', fontSize: '0.75rem', fontWeight: 700, minWidth: '32px' }}
                    onClick={() => {
                      const ta = contentRef.current;
                      if (!ta) return;
                      const start = ta.selectionStart;
                      const end = ta.selectionEnd;
                      const selected = ta.value.substring(start, end);
                      let insert;
                      if (btn.tag === 'a') {
                        const href = prompt('Link URL:', '/');
                        if (!href) return;
                        insert = `<a href="${href}">${selected || 'link text'}</a>`;
                      } else if (btn.tag === 'ul') {
                        insert = `<ul>\n  <li>${selected || 'item'}</li>\n</ul>`;
                      } else {
                        insert = `<${btn.tag}>${selected || ''}</${btn.tag}>`;
                      }
                      const newVal = ta.value.substring(0, start) + insert + ta.value.substring(end);
                      updateField('content', newVal);
                      setTimeout(() => {
                        ta.focus();
                        ta.selectionStart = ta.selectionEnd = start + insert.length;
                      }, 0);
                    }}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
              <textarea
                ref={contentRef}
                value={editing.content}
                onChange={e => updateField('content', e.target.value)}
                placeholder="<p>Write your post content here...</p>"
                rows={20}
                style={{ fontFamily: 'monospace', fontSize: '0.85rem', resize: 'vertical', lineHeight: 1.6 }}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Status */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Status</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editing.published}
                  onChange={e => updateField('published', e.target.checked)}
                />
                Published
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editing.featured}
                  onChange={e => updateField('featured', e.target.checked)}
                />
                Featured
              </label>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label style={{ fontSize: '0.8rem' }}>Publish Date</label>
                <input
                  type="datetime-local"
                  value={editing.publishedAt}
                  onChange={e => updateField('publishedAt', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Category */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Category</h3>
            <select
              value={editing.category}
              onChange={e => updateField('category', e.target.value)}
              style={{ width: '100%' }}
            >
              {categoryOptions.map(c => (
                <option key={c} value={c} style={{ textTransform: 'capitalize' }}>{c}</option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Tags</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: editing.tags.length ? '8px' : 0 }}>
              {editing.tags.map(tag => (
                <span
                  key={tag}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    background: 'var(--admin-surface-hover)', padding: '4px 10px',
                    borderRadius: '4px', fontSize: '0.8rem'
                  }}
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--admin-text-secondary)', padding: 0, fontSize: '1rem', lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              type="text"
              placeholder="Type tag and press Enter..."
              onKeyDown={handleTagInput}
              style={{ fontSize: '0.85rem' }}
            />
          </div>

          {/* Related Services */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Related Services</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {serviceOptions.map(svc => (
                <label key={svc} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', textTransform: 'capitalize' }}>
                  <input
                    type="checkbox"
                    checked={(editing.relatedServices || []).includes(svc)}
                    onChange={() => toggleService(svc)}
                  />
                  {svc.replace(/-/g, ' ')}
                </label>
              ))}
            </div>
          </div>

          {/* Featured Image */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Featured Image</h3>
            <ImagePicker
              label=""
              value={editing.image}
              onChange={(url) => updateField('image', url)}
              aspectRatio="16/9"
              placeholder="Click to select featured image"
            />
          </div>

          {/* Author */}
          <div className="admin-card" style={{ padding: '20px' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: '0.9rem' }}>Author</h3>
            <input
              type="text"
              value={editing.author}
              onChange={e => updateField('author', e.target.value)}
              style={{ fontSize: '0.85rem' }}
            />
          </div>
        </div>
      </div>

      {/* Content Preview */}
      {editing.content && (
        <div className="admin-section" style={{ marginTop: '24px' }}>
          <h2>Preview</h2>
          <div
            className="admin-card"
            style={{ padding: '32px', maxWidth: '720px' }}
          >
            <h1 style={{ fontSize: '1.8rem', marginBottom: '8px' }}>{editing.title || 'Untitled'}</h1>
            <p style={{ color: 'var(--admin-text-secondary)', fontSize: '0.85rem', marginBottom: '24px' }}>
              {formatDate(editing.publishedAt)} · {wordCount(editing.content)} words · {Math.ceil(wordCount(editing.content) / 225)} min read
            </p>
            <div
              dangerouslySetInnerHTML={{ __html: editing.content }}
              style={{ lineHeight: 1.7, fontSize: '1rem' }}
            />
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminBlog;
