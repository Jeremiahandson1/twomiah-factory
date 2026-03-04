import React, { useState, useEffect, useRef } from 'react';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getNavConfig, updateNavConfig, getCustomPages } from './api';
import { services } from '../data/services';

function AdminMenus() {
  const [navConfig, setNavConfig] = useState({ items: [], footerLinks: [] });
  const [customPages, setCustomPages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [activeTab, setActiveTab] = useState('header');
  const [editingItem, setEditingItem] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTarget, setAddTarget] = useState(null); // null for top-level, or parent item id
  const [dragItem, setDragItem] = useState(null);
  const [dragOverItem, setDragOverItem] = useState(null);
  const [expandedItems, setExpandedItems] = useState({});
  const toast = useToast();

  // New item form state
  const [newItem, setNewItem] = useState({
    type: 'custom', // 'custom', 'page', 'service'
    label: '',
    href: '',
    pageId: '',
    openNewTab: false
  });

  useEffect(() => {
    loadData();
  }, []);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges) handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hasChanges, navConfig]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [config, pages] = await Promise.all([
        getNavConfig(),
        getCustomPages().catch(() => [])
      ]);
      
      // Ensure footerLinks exists
      if (!config.footerLinks) {
        config.footerLinks = [
          { id: 'footer-home', label: 'Home', href: '/', visible: true },
          { id: 'footer-about', label: 'About', href: '/about', visible: true },
          { id: 'footer-gallery', label: 'Gallery', href: '/gallery', visible: true },
          { id: 'footer-contact', label: 'Contact', href: '/contact', visible: true }
        ];
      }
      
      setNavConfig(config);
      setCustomPages(pages || []);
      
      // Auto-expand all items initially
      const expanded = {};
      config.items?.forEach(item => {
        if (item.children?.length > 0) {
          expanded[item.id] = true;
        }
      });
      setExpandedItems(expanded);
    } catch (err) {
      toast.error('Failed to load navigation config');
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateNavConfig(navConfig);
      toast.success('Navigation saved!');
      setHasChanges(false);
    } catch (err) {
      toast.error('Failed to save navigation');
    }
    setSaving(false);
  };

  const updateConfig = (newConfig) => {
    setNavConfig(newConfig);
    setHasChanges(true);
  };

  const toggleVisibility = (itemId, parentId = null) => {
    const newConfig = { ...navConfig };
    
    if (activeTab === 'footer') {
      newConfig.footerLinks = newConfig.footerLinks.map(item =>
        item.id === itemId ? { ...item, visible: !item.visible } : item
      );
    } else if (parentId) {
      newConfig.items = newConfig.items.map(item => {
        if (item.id === parentId) {
          return {
            ...item,
            children: item.children.map(child =>
              child.id === itemId ? { ...child, visible: !child.visible } : child
            )
          };
        }
        return item;
      });
    } else {
      newConfig.items = newConfig.items.map(item =>
        item.id === itemId ? { ...item, visible: !item.visible } : item
      );
    }
    
    updateConfig(newConfig);
  };

  const deleteItem = (itemId, parentId = null) => {
    if (!confirm('Remove this menu item?')) return;
    
    const newConfig = { ...navConfig };
    
    if (activeTab === 'footer') {
      newConfig.footerLinks = newConfig.footerLinks.filter(item => item.id !== itemId);
    } else if (parentId) {
      newConfig.items = newConfig.items.map(item => {
        if (item.id === parentId) {
          return {
            ...item,
            children: item.children.filter(child => child.id !== itemId)
          };
        }
        return item;
      });
    } else {
      newConfig.items = newConfig.items.filter(item => item.id !== itemId);
    }
    
    updateConfig(newConfig);
    toast.success('Item removed');
  };

  const startEdit = (item, parentId = null) => {
    setEditingItem({ ...item, parentId });
  };

  const saveEdit = () => {
    if (!editingItem) return;
    
    const newConfig = { ...navConfig };
    const { parentId, ...itemData } = editingItem;
    
    if (activeTab === 'footer') {
      newConfig.footerLinks = newConfig.footerLinks.map(item =>
        item.id === itemData.id ? itemData : item
      );
    } else if (parentId) {
      newConfig.items = newConfig.items.map(item => {
        if (item.id === parentId) {
          return {
            ...item,
            children: item.children.map(child =>
              child.id === itemData.id ? itemData : child
            )
          };
        }
        return item;
      });
    } else {
      newConfig.items = newConfig.items.map(item =>
        item.id === itemData.id ? { ...item, ...itemData } : item
      );
    }
    
    updateConfig(newConfig);
    setEditingItem(null);
    toast.success('Item updated');
  };

  const openAddModal = (parentId = null) => {
    setAddTarget(parentId);
    setNewItem({ type: 'custom', label: '', href: '', pageId: '', openNewTab: false });
    setShowAddModal(true);
  };

  const addMenuItem = () => {
    let item = {
      id: `custom-${Date.now()}`,
      label: newItem.label,
      href: newItem.href,
      visible: true,
      openNewTab: newItem.openNewTab
    };
    
    if (newItem.type === 'page' && newItem.pageId) {
      const page = customPages.find(p => p.id === newItem.pageId);
      if (page) {
        item.label = newItem.label || page.title;
        item.href = `/${newItem.pageId}`;
        item.pageRef = newItem.pageId;
      }
    } else if (newItem.type === 'service' && newItem.pageId) {
      // Find service or sub-service
      let service = services.find(s => s.id === newItem.pageId);
      if (service) {
        item.label = newItem.label || service.title;
        item.href = `/services/${service.id}`;
        item.serviceRef = service.id;
      } else {
        // Check sub-services
        for (const s of services) {
          const sub = s.subServices?.find(ss => ss.id === newItem.pageId);
          if (sub) {
            item.label = newItem.label || sub.title;
            item.href = `/services/${s.id}/${sub.id}`;
            item.serviceRef = `${s.id}/${sub.id}`;
            break;
          }
        }
      }
    }
    
    if (!item.label || !item.href) {
      toast.error('Label and URL are required');
      return;
    }
    
    const newConfig = { ...navConfig };
    
    if (activeTab === 'footer') {
      newConfig.footerLinks = [...(newConfig.footerLinks || []), item];
    } else if (addTarget) {
      newConfig.items = newConfig.items.map(navItem => {
        if (navItem.id === addTarget) {
          return {
            ...navItem,
            children: [...(navItem.children || []), item]
          };
        }
        return navItem;
      });
    } else {
      // Add as top-level with empty children array for potential dropdown
      item.children = [];
      newConfig.items = [...newConfig.items, item];
    }
    
    updateConfig(newConfig);
    setShowAddModal(false);
    toast.success('Item added');
  };

  // Drag and drop handlers
  const handleDragStart = (e, item, parentId = null) => {
    setDragItem({ item, parentId });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e, item, parentId = null) => {
    e.preventDefault();
    if (dragItem?.item.id !== item.id) {
      setDragOverItem({ item, parentId });
    }
  };

  const handleDragEnd = () => {
    if (!dragItem || !dragOverItem) {
      setDragItem(null);
      setDragOverItem(null);
      return;
    }
    
    const newConfig = { ...navConfig };
    
    if (activeTab === 'footer') {
      // Reorder footer links
      const items = [...newConfig.footerLinks];
      const fromIndex = items.findIndex(i => i.id === dragItem.item.id);
      const toIndex = items.findIndex(i => i.id === dragOverItem.item.id);
      
      if (fromIndex !== -1 && toIndex !== -1) {
        const [removed] = items.splice(fromIndex, 1);
        items.splice(toIndex, 0, removed);
        newConfig.footerLinks = items;
      }
    } else if (dragItem.parentId === dragOverItem.parentId) {
      // Same level reorder
      if (dragItem.parentId) {
        // Reorder within children
        newConfig.items = newConfig.items.map(item => {
          if (item.id === dragItem.parentId) {
            const children = [...item.children];
            const fromIndex = children.findIndex(c => c.id === dragItem.item.id);
            const toIndex = children.findIndex(c => c.id === dragOverItem.item.id);
            
            if (fromIndex !== -1 && toIndex !== -1) {
              const [removed] = children.splice(fromIndex, 1);
              children.splice(toIndex, 0, removed);
            }
            return { ...item, children };
          }
          return item;
        });
      } else {
        // Reorder top-level items
        const items = [...newConfig.items];
        const fromIndex = items.findIndex(i => i.id === dragItem.item.id);
        const toIndex = items.findIndex(i => i.id === dragOverItem.item.id);
        
        if (fromIndex !== -1 && toIndex !== -1) {
          const [removed] = items.splice(fromIndex, 1);
          items.splice(toIndex, 0, removed);
          newConfig.items = items;
        }
      }
    }
    
    updateConfig(newConfig);
    setDragItem(null);
    setDragOverItem(null);
  };

  const toggleExpand = (itemId) => {
    setExpandedItems(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  };

  const renderMenuItem = (item, parentId = null, index = 0) => {
    const hasChildren = item.children?.length > 0;
    const isExpanded = expandedItems[item.id];
    const isDragging = dragItem?.item.id === item.id;
    const isDragOver = dragOverItem?.item.id === item.id;
    
    return (
      <div key={item.id} className="menu-item-wrapper">
        <div 
          className={`menu-item ${!item.visible ? 'menu-item-hidden' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
          draggable
          onDragStart={(e) => handleDragStart(e, item, parentId)}
          onDragOver={(e) => handleDragOver(e, item, parentId)}
          onDragEnd={handleDragEnd}
        >
          <div className="menu-item-handle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
              <circle cx="9" cy="5" r="1"></circle>
              <circle cx="9" cy="12" r="1"></circle>
              <circle cx="9" cy="19" r="1"></circle>
              <circle cx="15" cy="5" r="1"></circle>
              <circle cx="15" cy="12" r="1"></circle>
              <circle cx="15" cy="19" r="1"></circle>
            </svg>
          </div>
          
          {hasChildren && (
            <button className="menu-item-expand" onClick={() => toggleExpand(item.id)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"
                   style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                <polyline points="9 18 15 12 9 6"></polyline>
              </svg>
            </button>
          )}
          
          <div className="menu-item-content">
            <span className="menu-item-label">{item.label}</span>
            <span className="menu-item-href">{item.href}</span>
            {item.builtIn && <span className="menu-item-badge">Built-in</span>}
            {item.pageRef && <span className="menu-item-badge page">Page</span>}
            {item.openNewTab && <span className="menu-item-badge external">↗</span>}
          </div>
          
          <div className="menu-item-actions">
            <button 
              className={`menu-action-btn ${item.visible ? 'visible' : 'hidden'}`}
              onClick={() => toggleVisibility(item.id, parentId)}
              title={item.visible ? 'Hide' : 'Show'}
            >
              {item.visible ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                  <line x1="1" y1="1" x2="23" y2="23"></line>
                </svg>
              )}
            </button>
            
            <button className="menu-action-btn" onClick={() => startEdit(item, parentId)} title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
              </svg>
            </button>
            
            <button className="menu-action-btn danger" onClick={() => deleteItem(item.id, parentId)} title="Remove">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            
            {!parentId && activeTab === 'header' && (
              <button className="menu-action-btn add" onClick={() => openAddModal(item.id)} title="Add sub-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
              </button>
            )}
          </div>
        </div>
        
        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="menu-children">
            {item.children.map((child, i) => renderMenuItem(child, item.id, i))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <AdminLayout title="Menu Management" subtitle="Configure site navigation">
        <div className="loading-skeleton">
          <div className="skeleton-content" style={{ height: '400px' }}></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout 
      title="Menu Management" 
      subtitle="Configure header and footer navigation"
      actions={
        <button 
          className="admin-btn admin-btn-primary" 
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? 'Saving...' : hasChanges ? 'Save Changes' : 'Saved'}
        </button>
      }
    >
      {/* Tabs */}
      <div className="admin-section">
        <div className="menu-tabs">
          <button 
            className={`menu-tab ${activeTab === 'header' ? 'active' : ''}`}
            onClick={() => setActiveTab('header')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="9" x2="21" y2="9"></line>
            </svg>
            Header Menu
          </button>
          <button 
            className={`menu-tab ${activeTab === 'footer' ? 'active' : ''}`}
            onClick={() => setActiveTab('footer')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="3" y1="15" x2="21" y2="15"></line>
            </svg>
            Footer Links
          </button>
        </div>
      </div>

      {/* Instructions */}
      <div className="admin-section">
        <div className="menu-help">
          <p>
            <strong>Drag</strong> items to reorder • 
            <strong> Click eye</strong> to show/hide • 
            <strong> +</strong> adds sub-items to dropdowns
          </p>
        </div>
      </div>

      {/* Menu Items */}
      <div className="admin-section">
        <div className="menu-list">
          {activeTab === 'header' ? (
            <>
              {navConfig.items?.map((item, i) => renderMenuItem(item, null, i))}
              <button className="add-menu-item-btn" onClick={() => openAddModal(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add Menu Item
              </button>
            </>
          ) : (
            <>
              {navConfig.footerLinks?.map((item, i) => renderMenuItem(item, null, i))}
              <button className="add-menu-item-btn" onClick={() => openAddModal(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add Footer Link
              </button>
            </>
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="admin-section">
        <h2>Preview</h2>
        <div className="menu-preview">
          {activeTab === 'header' ? (
            <nav className="preview-nav">
              {navConfig.items?.filter(i => i.visible).map(item => (
                <div key={item.id} className="preview-nav-item">
                  <span>{item.label}</span>
                  {item.children?.filter(c => c.visible).length > 0 && (
                    <div className="preview-dropdown">
                      {item.children.filter(c => c.visible).map(child => (
                        <span key={child.id}>{child.label}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          ) : (
            <div className="preview-footer">
              {navConfig.footerLinks?.filter(i => i.visible).map(item => (
                <span key={item.id}>{item.label}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {editingItem && (
        <div className="modal-overlay" onClick={() => setEditingItem(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Edit Menu Item</h3>
            
            <div className="form-group">
              <label>Label</label>
              <input
                type="text"
                value={editingItem.label}
                onChange={e => setEditingItem({ ...editingItem, label: e.target.value })}
                placeholder="Menu label"
              />
            </div>
            
            <div className="form-group">
              <label>URL</label>
              <input
                type="text"
                value={editingItem.href}
                onChange={e => setEditingItem({ ...editingItem, href: e.target.value })}
                placeholder="/page-url"
                disabled={editingItem.builtIn}
              />
              {editingItem.builtIn && (
                <small style={{ color: 'var(--admin-text-secondary)' }}>Built-in items have fixed URLs</small>
              )}
            </div>
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={editingItem.openNewTab || false}
                  onChange={e => setEditingItem({ ...editingItem, openNewTab: e.target.checked })}
                />
                Open in new tab
              </label>
            </div>
            
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setEditingItem(null)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={saveEdit}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Add {addTarget ? 'Sub-Item' : 'Menu Item'}</h3>
            
            <div className="form-group">
              <label>Type</label>
              <div className="radio-group">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="itemType"
                    value="custom"
                    checked={newItem.type === 'custom'}
                    onChange={e => setNewItem({ ...newItem, type: e.target.value, pageId: '' })}
                  />
                  Custom Link
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="itemType"
                    value="page"
                    checked={newItem.type === 'page'}
                    onChange={e => setNewItem({ ...newItem, type: e.target.value, pageId: '' })}
                  />
                  Custom Page
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="itemType"
                    value="service"
                    checked={newItem.type === 'service'}
                    onChange={e => setNewItem({ ...newItem, type: e.target.value, pageId: '' })}
                  />
                  Service Page
                </label>
              </div>
            </div>
            
            {newItem.type === 'custom' && (
              <>
                <div className="form-group">
                  <label>Label</label>
                  <input
                    type="text"
                    value={newItem.label}
                    onChange={e => setNewItem({ ...newItem, label: e.target.value })}
                    placeholder="Menu label"
                  />
                </div>
                <div className="form-group">
                  <label>URL</label>
                  <input
                    type="text"
                    value={newItem.href}
                    onChange={e => setNewItem({ ...newItem, href: e.target.value })}
                    placeholder="/page or https://external.com"
                  />
                </div>
              </>
            )}
            
            {newItem.type === 'page' && (
              <>
                <div className="form-group">
                  <label>Select Page</label>
                  <select
                    value={newItem.pageId}
                    onChange={e => setNewItem({ ...newItem, pageId: e.target.value })}
                  >
                    <option value="">Choose a page...</option>
                    {customPages.map(page => (
                      <option key={page.id} value={page.id}>{page.title}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Label (optional - defaults to page title)</label>
                  <input
                    type="text"
                    value={newItem.label}
                    onChange={e => setNewItem({ ...newItem, label: e.target.value })}
                    placeholder="Custom label"
                  />
                </div>
              </>
            )}
            
            {newItem.type === 'service' && (
              <>
                <div className="form-group">
                  <label>Select Service</label>
                  <select
                    value={newItem.pageId}
                    onChange={e => setNewItem({ ...newItem, pageId: e.target.value })}
                  >
                    <option value="">Choose a service...</option>
                    {services.map(service => (
                      <optgroup key={service.id} label={service.title}>
                        <option value={service.id}>{service.title} (Overview)</option>
                        {service.subServices?.map(sub => (
                          <option key={sub.id} value={sub.id}>{sub.title}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Label (optional - defaults to service title)</label>
                  <input
                    type="text"
                    value={newItem.label}
                    onChange={e => setNewItem({ ...newItem, label: e.target.value })}
                    placeholder="Custom label"
                  />
                </div>
              </>
            )}
            
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newItem.openNewTab}
                  onChange={e => setNewItem({ ...newItem, openNewTab: e.target.checked })}
                />
                Open in new tab
              </label>
            </div>
            
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={addMenuItem}>Add Item</button>
            </div>
          </div>
        </div>
      )}

      {/* Styles */}
      <style>{`
        .menu-tabs {
          display: flex;
          gap: 8px;
          border-bottom: 1px solid var(--admin-border);
          padding-bottom: 12px;
        }
        
        .menu-tab {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          border: none;
          background: var(--admin-surface);
          border-radius: 8px 8px 0 0;
          cursor: pointer;
          color: var(--admin-text-secondary);
          font-size: 0.9rem;
          transition: all 0.2s;
        }
        
        .menu-tab:hover {
          background: var(--admin-surface-hover);
          color: var(--admin-text);
        }
        
        .menu-tab.active {
          background: var(--admin-primary);
          color: white;
        }
        
        .menu-help {
          background: var(--admin-surface);
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 0.875rem;
          color: var(--admin-text-secondary);
        }
        
        .menu-help p {
          margin: 0;
        }
        
        .menu-help strong {
          color: var(--admin-text);
        }
        
        .menu-list {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .menu-item-wrapper {
          display: flex;
          flex-direction: column;
        }
        
        .menu-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: var(--admin-surface);
          border: 1px solid var(--admin-border);
          border-radius: 8px;
          transition: all 0.2s;
        }
        
        .menu-item:hover {
          border-color: var(--admin-primary);
        }
        
        .menu-item.menu-item-hidden {
          opacity: 0.5;
        }
        
        .menu-item.dragging {
          opacity: 0.5;
          border-style: dashed;
        }
        
        .menu-item.drag-over {
          border-color: var(--admin-primary);
          background: var(--admin-primary-light, rgba(59, 130, 246, 0.1));
        }
        
        .menu-item-handle {
          cursor: grab;
          color: var(--admin-text-secondary);
          padding: 4px;
        }
        
        .menu-item-handle:active {
          cursor: grabbing;
        }
        
        .menu-item-expand {
          background: none;
          border: none;
          padding: 4px;
          cursor: pointer;
          color: var(--admin-text-secondary);
          display: flex;
          align-items: center;
        }
        
        .menu-item-content {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }
        
        .menu-item-label {
          font-weight: 500;
          color: var(--admin-text);
        }
        
        .menu-item-href {
          font-size: 0.8rem;
          color: var(--admin-text-secondary);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        
        .menu-item-badge {
          font-size: 0.7rem;
          padding: 2px 6px;
          border-radius: 4px;
          background: var(--admin-surface-hover);
          color: var(--admin-text-secondary);
        }
        
        .menu-item-badge.page {
          background: #dbeafe;
          color: #1d4ed8;
        }
        
        .menu-item-badge.external {
          background: #fef3c7;
          color: #d97706;
        }
        
        .menu-item-actions {
          display: flex;
          gap: 4px;
        }
        
        .menu-action-btn {
          background: none;
          border: none;
          padding: 6px;
          cursor: pointer;
          color: var(--admin-text-secondary);
          border-radius: 4px;
          transition: all 0.2s;
        }
        
        .menu-action-btn:hover {
          background: var(--admin-surface-hover);
          color: var(--admin-text);
        }
        
        .menu-action-btn.visible {
          color: var(--admin-success, #22c55e);
        }
        
        .menu-action-btn.hidden {
          color: var(--admin-text-secondary);
        }
        
        .menu-action-btn.danger:hover {
          color: var(--admin-danger, #ef4444);
        }
        
        .menu-action-btn.add:hover {
          color: var(--admin-primary);
        }
        
        .menu-children {
          margin-left: 40px;
          padding-left: 16px;
          border-left: 2px solid var(--admin-border);
          display: flex;
          flex-direction: column;
          gap: 4px;
          margin-top: 4px;
        }
        
        .add-menu-item-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px;
          background: none;
          border: 2px dashed var(--admin-border);
          border-radius: 8px;
          color: var(--admin-text-secondary);
          cursor: pointer;
          transition: all 0.2s;
          font-size: 0.9rem;
          margin-top: 8px;
        }
        
        .add-menu-item-btn:hover {
          border-color: var(--admin-primary);
          color: var(--admin-primary);
          background: var(--admin-primary-light, rgba(59, 130, 246, 0.05));
        }
        
        .menu-preview {
          background: var(--admin-surface);
          border: 1px solid var(--admin-border);
          border-radius: 8px;
          padding: 16px;
        }
        
        .preview-nav {
          display: flex;
          gap: 24px;
        }
        
        .preview-nav-item {
          position: relative;
          padding: 8px 0;
          font-weight: 500;
          cursor: default;
        }
        
        .preview-nav-item:hover .preview-dropdown {
          display: flex;
        }
        
        .preview-dropdown {
          display: none;
          position: absolute;
          top: 100%;
          left: 0;
          background: white;
          border: 1px solid var(--admin-border);
          border-radius: 8px;
          padding: 8px;
          flex-direction: column;
          gap: 4px;
          min-width: 150px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          z-index: 10;
        }
        
        .preview-dropdown span {
          padding: 6px 12px;
          border-radius: 4px;
          font-weight: 400;
          font-size: 0.9rem;
        }
        
        .preview-dropdown span:hover {
          background: var(--admin-surface-hover);
        }
        
        .preview-footer {
          display: flex;
          gap: 24px;
          font-size: 0.9rem;
          color: var(--admin-text-secondary);
        }
        
        .radio-group {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
        }
        
        .radio-label, .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          font-size: 0.9rem;
        }
        
        .radio-label input, .checkbox-label input {
          width: auto;
        }
      `}</style>
    </AdminLayout>
  );
}

export default AdminMenus;
