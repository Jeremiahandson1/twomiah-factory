import React, { useState, useEffect } from 'react';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getActivity, exportData, importData } from './api';

function AdminActivity() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importMerge, setImportMerge] = useState(true);
  const toast = useToast();

  useEffect(() => {
    loadActivity();
  }, []);

  const loadActivity = async () => {
    setLoading(true);
    try {
      const data = await getActivity();
      setActivities(data || []);
    } catch (err) {
      toast.error('Failed to load activity');
    }
    setLoading(false);
  };

  const handleExport = async () => {
    try {
      const data = await exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `integrity-home-healthcare-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export downloaded');
      setShowExport(false);
    } catch (err) {
      toast.error('Export failed: ' + err.message);
    }
  };

  const handleImport = async () => {
    try {
      const data = JSON.parse(importText);
      if (!data.pages) throw new Error('Invalid format: missing pages');
      
      await importData(data.pages, importMerge);
      toast.success('Import successful');
      setShowImport(false);
      setImportText('');
      loadActivity();
    } catch (err) {
      toast.error('Import failed: ' + err.message);
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    return date.toLocaleDateString();
  };

  const getActionIcon = (action) => {
    const icons = {
      'login': '🔐',
      'password_changed': '🔑',
      'page_saved': '💾',
      'page_deleted': '🗑️',
      'page_duplicated': '📋',
      'revision_restored': '↩️',
      'image_uploaded': '🖼️',
      'image_deleted': '🗑️',
      'data_imported': '📥'
    };
    return icons[action] || '📝';
  };

  const getActionLabel = (action, details) => {
    switch (action) {
      case 'login': return 'Admin logged in';
      case 'password_changed': return 'Password changed';
      case 'page_saved': return `Saved "${details.pageId}" (${details.status})`;
      case 'page_deleted': return `Deleted "${details.pageId}"`;
      case 'page_duplicated': return `Duplicated "${details.sourceId}" → "${details.newId}"`;
      case 'revision_restored': return `Restored revision on "${details.pageId}"`;
      case 'image_uploaded': return `Uploaded "${details.filename}"`;
      case 'image_deleted': return `Deleted "${details.filename}"`;
      case 'data_imported': return `Imported ${details.pageCount} pages`;
      default: return action;
    }
  };

  return (
    <AdminLayout title="Activity Log" subtitle="Track all admin actions">
      {/* Actions */}
      <div className="admin-section">
        <div style={{ display: 'flex', gap: '12px' }}>
          <button className="admin-btn admin-btn-secondary" onClick={() => setShowExport(true)}>
            📤 Export Data
          </button>
          <button className="admin-btn admin-btn-secondary" onClick={() => setShowImport(true)}>
            📥 Import Data
          </button>
          <button className="admin-btn admin-btn-secondary" onClick={loadActivity}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {/* Activity List */}
      <div className="admin-section">
        <h2>Recent Activity</h2>
        
        {loading ? (
          <div className="loading-skeleton">
            <div className="skeleton-content" style={{ height: '300px' }}></div>
          </div>
        ) : activities.length === 0 ? (
          <p style={{ color: 'var(--admin-text-secondary)' }}>No activity recorded yet.</p>
        ) : (
          <div className="activity-list">
            {activities.map(activity => (
              <div key={activity.id} className="activity-item">
                <span className="activity-icon">{getActionIcon(activity.action)}</span>
                <div className="activity-content">
                  <span className="activity-label">{getActionLabel(activity.action, activity.details)}</span>
                  <span className="activity-time">{formatDate(activity.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export Modal */}
      {showExport && (
        <div className="modal-overlay" onClick={() => setShowExport(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Export Data</h3>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '16px' }}>
              Download all page content and settings as a JSON backup file.
            </p>
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowExport(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleExport}>Download Backup</button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal-content modal-lg" onClick={e => e.stopPropagation()}>
            <h3>Import Data</h3>
            <p style={{ color: 'var(--admin-text-secondary)', marginBottom: '16px' }}>
              Paste exported JSON data to restore pages.
            </p>
            <div className="form-group">
              <label>JSON Data</label>
              <textarea 
                value={importText} 
                onChange={e => setImportText(e.target.value)}
                placeholder='{"pages": {...}}'
                rows={10}
                style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}
              />
            </div>
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" checked={importMerge} onChange={e => setImportMerge(e.target.checked)} />
                Merge with existing data (recommended)
              </label>
              <span className="field-hint">If unchecked, all existing pages will be replaced.</span>
            </div>
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowImport(false)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleImport} disabled={!importText.trim()}>
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminActivity;
