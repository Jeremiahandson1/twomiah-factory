import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getCustomPages, createPage, deletePage, bulkPageAction, reorderPages, movePageToParent } from './api';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ============================================
// DRAG & DROP HOOK
// ============================================
function useDragAndDrop(items, onReorder) {
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const dragNode = useRef(null);

  const handleDragStart = useCallback((e, index) => {
    dragNode.current = e.target.closest('[draggable]');
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      if (dragNode.current) dragNode.current.style.opacity = '0.4';
    }, 0);
  }, []);

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (index !== overIndex) setOverIndex(index);
  }, [overIndex]);

  const handleDragEnd = useCallback(() => {
    if (dragNode.current) dragNode.current.style.opacity = '1';
    if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
      const reordered = [...items];
      const [removed] = reordered.splice(dragIndex, 1);
      reordered.splice(overIndex, 0, removed);
      onReorder(reordered);
    }
    setDragIndex(null);
    setOverIndex(null);
    dragNode.current = null;
  }, [dragIndex, overIndex, items, onReorder]);

  return { dragIndex, overIndex, handleDragStart, handleDragOver, handleDragEnd };
}

// ============================================
// MAIN COMPONENT
// ============================================
function AdminPages() {
  const [customPages, setCustomPages] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newPageId, setNewPageId] = useState('');
  const [newPagePlacement, setNewPagePlacement] = useState('standalone');
  const [newPageParent, setNewPageParent] = useState('');
  const [newPagePosition, setNewPagePosition] = useState('end');
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPages, setSelectedPages] = useState([]);
  const [reorderDirty, setReorderDirty] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => { loadCustomPages(); }, []);

  const loadCustomPages = async () => {
    setLoading(true);
    try {
      const [pages, svcRes] = await Promise.all([
        getCustomPages(),
        fetch(`${API_BASE}/admin/services-data`, {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('adminToken')}` }
        }).then(r => r.ok ? r.json() : []).catch(() => [])
      ]);
      setCustomPages(pages || []);
      setServices(svcRes || []);
    } catch (err) {
      console.error('Failed to load pages data');
    }
    setLoading(false);
  };

  // Auto-slug from title
  const handleTitleChange = (title) => {
    setNewPageTitle(title);
    setNewPageId(title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  };

  const resetCreateForm = () => {
    setNewPageTitle('');
    setNewPageId('');
    setNewPagePlacement('standalone');
    setNewPageParent('');
    setNewPagePosition('end');
  };

  const handleCreate = async () => {
    if (!newPageId.trim() || !newPageTitle.trim()) {
      toast.error('Page ID and title are required');
      return;
    }
    if (newPagePlacement === 'sub-service' && !newPageParent) {
      toast.error('Select a parent service');
      return;
    }

    const cleanId = newPageId.toLowerCase().replace(/\s+/g, '-');
    const fullPageId = newPagePlacement === 'sub-service' && newPageParent
      ? `${newPageParent}/${cleanId}`
      : cleanId;

    const placement = {
      type: newPagePlacement,
      parent: newPagePlacement === 'sub-service' ? newPageParent : null,
      position: newPagePosition,
    };

    setCreating(true);
    try {
      await createPage(fullPageId, newPageTitle, placement);
      toast.success('Page created!');
      setShowCreateModal(false);
      resetCreateForm();
      loadCustomPages();
      navigate(`/edit/${encodeURIComponent(fullPageId)}`);
    } catch (err) {
      toast.error(err.message);
    }
    setCreating(false);
  };

  const handleDelete = async (pageId) => {
    try {
      await deletePage(pageId);
      toast.success('Page deleted');
      setDeleteConfirm(null);
      loadCustomPages();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleBulkAction = async (action) => {
    if (!selectedPages.length) return;
    try {
      await bulkPageAction(action, selectedPages);
      toast.success(`${action} completed on ${selectedPages.length} pages`);
      setSelectedPages([]);
      loadCustomPages();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleSelect = (pageId) => {
    setSelectedPages(prev =>
      prev.includes(pageId) ? prev.filter(p => p !== pageId) : [...prev, pageId]
    );
  };

  // Drag-and-drop reorder for custom standalone pages
  const handleCustomReorder = useCallback((reordered) => {
    setCustomPages(prev => {
      // Keep nested pages intact, only reorder standalone
      const nested = prev.filter(p => p.id.includes('/'));
      return [...reordered, ...nested];
    });
    setReorderDirty(true);
  }, []);

  const saveOrder = async () => {
    try {
      const order = customPages.map((p, i) => ({ id: p.id, sortOrder: i }));
      await reorderPages(order);
      toast.success('Page order saved');
      setReorderDirty(false);
    } catch (err) {
      toast.error('Failed to save order: ' + err.message);
    }
  };

  // Split custom pages into standalone vs nested under services
  const groupedCustomPages = useMemo(() => {
    const standalone = [];
    const byParent = {};

    customPages.forEach(page => {
      const parentId = page.placement?.parent || (page.id.includes('/') ? page.id.split('/')[0] : null);
      if (parentId && services.some(s => s.id === parentId)) {
        if (!byParent[parentId]) byParent[parentId] = [];
        byParent[parentId].push(page);
      } else {
        standalone.push(page);
      }
    });

    return { standalone, byParent };
  }, [customPages]);

  const customDrag = useDragAndDrop(groupedCustomPages.standalone, handleCustomReorder);

  const handleDeleteSubService = async (serviceId, subId, subTitle) => {
    if (!confirm(`Delete sub-service "${subTitle}" from ${serviceId}? This removes it from both services and pages data.`)) return;
    const token = localStorage.getItem('adminToken');
    try {
      // Fetch ALL services, find the right one, remove the sub, save back
      const res = await fetch(`${API_BASE}/admin/services-data`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const allServices = await res.json();
        const service = allServices.find(s => s.id === serviceId);
        if (service) {
          service.subServices = (service.subServices || []).filter(s => s.id !== subId);
          const saveRes = await fetch(`${API_BASE}/admin/services-data/${serviceId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(service)
          });
          if (!saveRes.ok) throw new Error('Failed to update service');
        }
      }
      // Also try removing from pages.json
      try { await deletePage(`${serviceId}/${subId}`); } catch (e) { /* may not exist in pages */ }
      toast.success(`Deleted ${subTitle}`);
      loadCustomPages();
    } catch (err) {
      toast.error('Failed to delete: ' + err.message);
    }
  };

  // Search filtering
  const filteredCustomStandalone = useMemo(() => {
    if (!searchQuery.trim()) return groupedCustomPages.standalone;
    const q = searchQuery.toLowerCase();
    return groupedCustomPages.standalone.filter(p =>
      p.title?.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [searchQuery, groupedCustomPages]);

  return (
    <AdminLayout title="All Pages" subtitle="Edit content for any page on your site">
      {/* Actions Bar */}
      <div className="admin-section">
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="admin-btn admin-btn-primary" onClick={() => setShowCreateModal(true)}>
            + Create New Page
          </button>
          {reorderDirty && (
            <button className="admin-btn admin-btn-success" onClick={saveOrder}
              style={{ background: '#16a34a', color: '#fff', border: 'none' }}>
              💾 Save Page Order
            </button>
          )}
          <div style={{ flex: 1 }} />
          <input
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--admin-border)',
              borderRadius: 'var(--admin-radius)',
              width: '250px',
            }}
          />
        </div>
      </div>

      {/* Drag hint */}
      {!searchQuery && groupedCustomPages.standalone.length > 1 && (
        <div style={{
          padding: '8px 16px',
          background: 'var(--admin-info-bg, #eff6ff)',
          borderRadius: 'var(--admin-radius, 8px)',
          fontSize: '0.85rem',
          color: 'var(--admin-text-secondary)',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          ↕️ Drag pages to reorder. Click "Save Page Order" when done.
        </div>
      )}

      {/* Bulk Actions */}
      {selectedPages.length > 0 && (
        <div className="admin-section">
          <div className="bulk-actions">
            <span>{selectedPages.length} selected</span>
            <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => handleBulkAction('publish')}>Publish All</button>
            <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => handleBulkAction('draft')}>Set as Draft</button>
            <button className="admin-btn admin-btn-danger admin-btn-sm" onClick={() => handleBulkAction('delete')}>Delete All</button>
            <button className="admin-btn admin-btn-secondary admin-btn-sm" onClick={() => setSelectedPages([])}>Clear</button>
          </div>
        </div>
      )}

      {/* ─── CUSTOM STANDALONE PAGES ─── */}
      {filteredCustomStandalone.length > 0 && (
        <div className="admin-section">
          <h2>Custom Pages {searchQuery && `(${filteredCustomStandalone.length} results)`}</h2>
          <div className="page-list">
            {filteredCustomStandalone.map((page, index) => (
              <div
                key={page.id}
                draggable
                onDragStart={e => customDrag.handleDragStart(e, index)}
                onDragOver={e => customDrag.handleDragOver(e, index)}
                onDragEnd={customDrag.handleDragEnd}
                style={{
                  position: 'relative',
                  opacity: customDrag.dragIndex === index ? 0.4 : 1,
                  transition: 'transform 0.12s ease',
                }}
              >
                {/* Drop indicator line */}
                {customDrag.overIndex === index && customDrag.dragIndex !== index && (
                  <div style={{
                    position: 'absolute', top: '-2px', left: 0, right: 0,
                    height: '3px', background: 'var(--admin-primary, #2563eb)',
                    borderRadius: '2px', zIndex: 10,
                  }} />
                )}
                <div className="page-item-wrapper">
                  {/* Drag handle */}
                  <div style={{ cursor: 'grab', padding: '0 4px', display: 'flex', alignItems: 'center' }} title="Drag to reorder">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.35 }}>
                      <circle cx="5" cy="3" r="1.5"/><circle cx="11" cy="3" r="1.5"/>
                      <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
                      <circle cx="5" cy="13" r="1.5"/><circle cx="11" cy="13" r="1.5"/>
                    </svg>
                  </div>
                  <div
                    className={`page-select-box ${selectedPages.includes(page.id) ? 'selected' : ''}`}
                    onClick={() => toggleSelect(page.id)}
                  >
                    {selectedPages.includes(page.id) && '✓'}
                  </div>
                  <Link to={`/edit/${page.id}`} className="page-item">
                    <div className="page-item-icon" style={{ background: 'var(--admin-success-bg)' }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                      </svg>
                    </div>
                    <div className="page-item-content">
                      <div className="page-item-title">
                        {page.title}
                        {page.status === 'draft' && <span className="draft-badge-sm">Draft</span>}
                      </div>
                      <div className="page-item-path">/page/{page.id}</div>
                    </div>
                    <div className="page-item-arrow">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </Link>
                  <button
                    className="page-delete-btn"
                    onClick={e => { e.preventDefault(); setDeleteConfirm(page.id); }}
                    title="Delete page"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── HOME PAGE ─── */}
      <div className="admin-section">
        <h2>Main Pages</h2>
        <div className="page-list">
          <Link to="/edit/home" className="page-item">
            <div className="page-item-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <div className="page-item-content">
              <div className="page-item-title">Home Page</div>
              <div className="page-item-path">/</div>
            </div>
            <div className="page-item-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </Link>
        </div>
      </div>

      {/* ─── SERVICE PAGES ─── */}
      <div className="admin-section">
        <h2>Service Pages</h2>
        {services.map(service => {
          const nestedCustom = groupedCustomPages.byParent[service.id] || [];

          return (
            <div key={service.id} style={{ marginBottom: '24px' }}>
              <div className="page-list">
                <Link to={`/edit/${service.id}`} className="page-item">
                  <div className="page-item-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                  </div>
                  <div className="page-item-content">
                    <div className="page-item-title">{service.title}</div>
                    <div className="page-item-path">/services/{service.id}</div>
                  </div>
                  <div className="page-item-arrow">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                </Link>
              </div>

              {(service.subServices?.length > 0 || nestedCustom.length > 0) && (
                <div className="page-sublist">
                  <div className="page-list">
                    {/* Built-in sub-services */}
                    {service.subServices && service.subServices.map(sub => (
                      <div key={sub.id} className="page-item-wrapper">
                        <Link
                          to={`/edit/${encodeURIComponent(`${service.id}/${sub.id}`)}`}
                          className="page-item"
                        >
                          <div className="page-item-icon" style={{ background: 'var(--admin-surface-hover)' }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </div>
                          <div className="page-item-content">
                            <div className="page-item-title">{sub.title}</div>
                            <div className="page-item-path">/services/{service.id}/{sub.id}</div>
                          </div>
                          <div className="page-item-arrow">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </div>
                        </Link>
                        <button
                          className="page-delete-btn"
                          onClick={e => { e.preventDefault(); handleDeleteSubService(service.id, sub.id, sub.title); }}
                          title="Delete sub-service"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    ))}

                    {/* Custom pages nested under this service */}
                    {nestedCustom.map(page => (
                      <div key={page.id} className="page-item-wrapper">
                        <Link to={`/edit/${encodeURIComponent(page.id)}`} className="page-item">
                          <div className="page-item-icon" style={{ background: 'var(--admin-success-bg)' }}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                              <polyline points="14 2 14 8 20 8" />
                            </svg>
                          </div>
                          <div className="page-item-content">
                            <div className="page-item-title">
                              {page.title}
                              <span style={{
                                fontSize: '0.7rem',
                                background: 'var(--admin-success-bg)',
                                color: 'var(--admin-success)',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                marginLeft: '8px',
                              }}>Custom</span>
                              {page.status === 'draft' && <span className="draft-badge-sm">Draft</span>}
                            </div>
                            <div className="page-item-path">/services/{page.id}</div>
                          </div>
                          <div className="page-item-arrow">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                          </div>
                        </Link>
                        <button
                          className="page-delete-btn"
                          onClick={e => { e.preventDefault(); setDeleteConfirm(page.id); }}
                          title="Delete page"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── CREATE PAGE MODAL ─── */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <h3>Create New Page</h3>

            <div className="form-group">
              <label>Page Title</label>
              <input
                type="text"
                value={newPageTitle}
                onChange={e => handleTitleChange(e.target.value)}
                placeholder="e.g. About Us, Insurance Claims, Storm Damage"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label>Page ID (URL slug)</label>
              <input
                type="text"
                value={newPageId}
                onChange={e => setNewPageId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="e.g. about-us"
              />
              <span className="field-hint">
                {newPagePlacement === 'sub-service' && newPageParent
                  ? `URL: /services/${newPageParent}/${newPageId || 'your-page-id'}`
                  : `URL: /page/${newPageId || 'your-page-id'}`}
              </span>
            </div>

            <div className="form-group">
              <label>Where should this page live?</label>
              <select
                value={newPagePlacement}
                onChange={e => {
                  setNewPagePlacement(e.target.value);
                  if (e.target.value !== 'sub-service') setNewPageParent('');
                }}
                style={{
                  width: '100%', padding: '10px 12px',
                  border: '1px solid var(--admin-border)',
                  borderRadius: 'var(--admin-radius)',
                  fontSize: '0.95rem',
                  background: 'var(--admin-surface, #fff)',
                }}
              >
                <option value="standalone">Standalone Page (at /page/...)</option>
                <option value="sub-service">Under a Service (as sub-page)</option>
              </select>
            </div>

            {/* Parent service picker */}
            {newPagePlacement === 'sub-service' && (
              <div className="form-group">
                <label>Under which service?</label>
                <select
                  value={newPageParent}
                  onChange={e => setNewPageParent(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--admin-border)',
                    borderRadius: 'var(--admin-radius)',
                    fontSize: '0.95rem',
                    background: 'var(--admin-surface, #fff)',
                  }}
                >
                  <option value="">— Select a service —</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.title}</option>
                  ))}
                </select>
                {!newPageParent && (
                  <span className="field-hint" style={{ color: 'var(--admin-error, #dc2626)' }}>
                    Please select a parent service
                  </span>
                )}
              </div>
            )}

            {/* Position within parent */}
            {newPagePlacement === 'sub-service' && newPageParent && (
              <div className="form-group">
                <label>Position in list</label>
                <select
                  value={newPagePosition}
                  onChange={e => setNewPagePosition(e.target.value)}
                  style={{
                    width: '100%', padding: '10px 12px',
                    border: '1px solid var(--admin-border)',
                    borderRadius: 'var(--admin-radius)',
                    fontSize: '0.95rem',
                    background: 'var(--admin-surface, #fff)',
                  }}
                >
                  <option value="start">First (top of list)</option>
                  <option value="end">Last (bottom of list)</option>
                  {(() => {
                    const parent = services.find(s => s.id === newPageParent);
                    if (!parent?.subServices?.length) return null;
                    return parent.subServices.map(sub => (
                      <option key={sub.id} value={`after:${sub.id}`}>After "{sub.title}"</option>
                    ));
                  })()}
                </select>
              </div>
            )}

            {/* Visual placement preview */}
            <div style={{
              margin: '16px 0', padding: '12px',
              background: 'var(--admin-surface-hover, #f8f9fa)',
              borderRadius: 'var(--admin-radius, 8px)',
              border: '1px solid var(--admin-border, #e5e7eb)',
              fontSize: '0.85rem',
            }}>
              <div style={{ fontWeight: 600, marginBottom: '8px', color: 'var(--admin-text-secondary)' }}>
                📍 Preview: Where this page will appear
              </div>

              {newPagePlacement === 'standalone' && (
                <div style={{ color: 'var(--admin-text-secondary)' }}>
                  <div style={{ opacity: 0.5, paddingLeft: '0' }}>🏠 Home</div>
                  <div style={{ opacity: 0.5, paddingLeft: '0' }}>📁 Roofing, Siding, Windows...</div>
                  <div style={{ paddingLeft: '0', color: 'var(--admin-primary, #2563eb)', fontWeight: 600 }}>
                    📄 {newPageTitle || 'New Page'} ← new
                  </div>
                </div>
              )}

              {newPagePlacement === 'sub-service' && newPageParent && (() => {
                const parent = services.find(s => s.id === newPageParent);
                const subs = (parent?.subServices || []).map(s => ({ ...s, isNew: false }));
                const newItem = { id: '__new__', title: newPageTitle || 'New Page', isNew: true };

                if (newPagePosition === 'start') subs.unshift(newItem);
                else if (newPagePosition.startsWith('after:')) {
                  const afterId = newPagePosition.split(':')[1];
                  const idx = subs.findIndex(i => i.id === afterId);
                  subs.splice(idx + 1, 0, newItem);
                } else subs.push(newItem);

                return (
                  <div style={{ color: 'var(--admin-text-secondary)' }}>
                    <div style={{ opacity: 0.5 }}>📁 {parent?.title}</div>
                    {subs.map(item => (
                      <div key={item.id} style={{
                        paddingLeft: '20px',
                        color: item.isNew ? 'var(--admin-primary, #2563eb)' : undefined,
                        fontWeight: item.isNew ? 600 : undefined,
                        opacity: item.isNew ? 1 : 0.5,
                      }}>
                        📄 {item.title} {item.isNew && '← new'}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {newPagePlacement === 'sub-service' && !newPageParent && (
                <div style={{ color: 'var(--admin-text-muted)', fontStyle: 'italic' }}>
                  Select a parent service above to see preview
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => { setShowCreateModal(false); resetCreateForm(); }}>
                Cancel
              </button>
              <button
                className="admin-btn admin-btn-primary"
                onClick={handleCreate}
                disabled={creating || (newPagePlacement === 'sub-service' && !newPageParent)}
              >
                {creating ? 'Creating...' : 'Create Page'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── DELETE CONFIRM ─── */}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Delete Page?</h3>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '16px' }}>
              Are you sure you want to delete this page? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="admin-btn admin-btn-danger" onClick={() => handleDelete(deleteConfirm)}>Delete Page</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminPages;
