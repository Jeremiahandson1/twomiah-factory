import React, { useState, useEffect } from 'react';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getRedirects, createRedirect, deleteRedirect } from './api';

function AdminRedirects() {
  const [redirects, setRedirects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newType, setNewType] = useState('301');
  const toast = useToast();

  useEffect(() => {
    loadRedirects();
  }, []);

  const loadRedirects = async () => {
    setLoading(true);
    try {
      const data = await getRedirects();
      setRedirects(data || []);
    } catch (err) {
      toast.error('Failed to load redirects');
    }
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newFrom || !newTo) {
      toast.error('From and To URLs are required');
      return;
    }
    
    try {
      const result = await createRedirect(newFrom, newTo, newType);
      setRedirects([...redirects, result.redirect]);
      setShowAdd(false);
      setNewFrom('');
      setNewTo('');
      toast.success('Redirect created');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (redirectId) => {
    if (!confirm('Delete this redirect?')) return;
    
    try {
      await deleteRedirect(redirectId);
      setRedirects(redirects.filter(r => r.id !== redirectId));
      toast.success('Redirect deleted');
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  return (
    <AdminLayout title="Redirects" subtitle="Manage URL redirects (old URLs → new URLs)">
      {/* Add Button */}
      <div className="admin-section">
        <button 
          className="admin-btn admin-btn-primary"
          onClick={() => setShowAdd(true)}
        >
          + Add Redirect
        </button>
      </div>

      {/* Info */}
      <div className="admin-section">
        <div className="info-box">
          <strong>💡 How Redirects Work</strong>
          <p>
            Use redirects when you've moved or renamed a page. Visitors to the old URL 
            will be automatically sent to the new URL. This also helps preserve SEO rankings.
          </p>
          <p>
            <strong>301 (Permanent)</strong> - Use when a page has permanently moved<br/>
            <strong>302 (Temporary)</strong> - Use for temporary redirects
          </p>
        </div>
      </div>

      {/* Redirects List */}
      <div className="admin-section">
        <h2>Active Redirects</h2>
        
        {loading ? (
          <div className="loading-skeleton">
            <div className="skeleton-content" style={{ height: '150px' }}></div>
          </div>
        ) : redirects.length === 0 ? (
          <div className="empty-state">
            <p>No redirects configured yet.</p>
          </div>
        ) : (
          <div className="redirects-list">
            <div className="redirects-header">
              <span>From URL</span>
              <span></span>
              <span>To URL</span>
              <span>Type</span>
              <span></span>
            </div>
            {redirects.map(redirect => (
              <div key={redirect.id} className="redirect-item">
                <code className="redirect-from">{redirect.from}</code>
                <span className="redirect-arrow">→</span>
                <code className="redirect-to">{redirect.to}</code>
                <span className={`redirect-type type-${redirect.type}`}>
                  {redirect.type}
                </span>
                <button 
                  className="admin-btn admin-btn-danger admin-btn-sm"
                  onClick={() => handleDelete(redirect.id)}
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Modal */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Add Redirect</h3>
            
            <div className="form-group">
              <label>From URL (old path)</label>
              <input 
                type="text"
                value={newFrom}
                onChange={e => setNewFrom(e.target.value)}
                placeholder="/old-page"
              />
              <span className="field-hint">Start with / for paths on your site</span>
            </div>
            
            <div className="form-group">
              <label>To URL (new path)</label>
              <input 
                type="text"
                value={newTo}
                onChange={e => setNewTo(e.target.value)}
                placeholder="/new-page or https://example.com"
              />
            </div>
            
            <div className="form-group">
              <label>Redirect Type</label>
              <select value={newType} onChange={e => setNewType(e.target.value)}>
                <option value="301">301 - Permanent Redirect</option>
                <option value="302">302 - Temporary Redirect</option>
              </select>
            </div>
            
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button className="admin-btn admin-btn-primary" onClick={handleAdd}>
                Add Redirect
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminRedirects;
