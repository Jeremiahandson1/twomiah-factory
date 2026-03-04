import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getTrash, restoreFromTrash, deleteFromTrash, emptyTrash } from './api';

function AdminTrash() {
  const [trash, setTrash] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    loadTrash();
  }, []);

  const loadTrash = async () => {
    setLoading(true);
    try {
      const data = await getTrash();
      setTrash(data || []);
    } catch (err) {
      toast.error('Failed to load trash');
    }
    setLoading(false);
  };

  const handleRestore = async (trashId) => {
    try {
      const result = await restoreFromTrash(trashId);
      setTrash(trash.filter(t => t.id !== trashId));
      toast.success('Page restored!');
      // Optionally navigate to restored page
      if (result.pageId) {
        navigate(`/edit/${encodeURIComponent(result.pageId)}`);
      }
    } catch (err) {
      toast.error('Failed to restore: ' + err.message);
    }
  };

  const handleDelete = async (trashId) => {
    if (!confirm('Permanently delete this page? This cannot be undone.')) return;
    
    try {
      await deleteFromTrash(trashId);
      setTrash(trash.filter(t => t.id !== trashId));
      toast.success('Permanently deleted');
    } catch (err) {
      toast.error('Failed to delete');
    }
  };

  const handleEmptyTrash = async () => {
    try {
      await emptyTrash();
      setTrash([]);
      setShowEmptyConfirm(false);
      toast.success('Trash emptied');
    } catch (err) {
      toast.error('Failed to empty trash');
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getDaysUntilDelete = (dateStr) => {
    const deleted = new Date(dateStr);
    const expiry = new Date(deleted.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const now = new Date();
    const days = Math.ceil((expiry - now) / (24 * 60 * 60 * 1000));
    return days > 0 ? days : 0;
  };

  return (
    <AdminLayout title="Trash" subtitle="Recover deleted pages (kept for 30 days)">
      {/* Actions */}
      {trash.length > 0 && (
        <div className="admin-section">
          <button 
            className="admin-btn admin-btn-danger"
            onClick={() => setShowEmptyConfirm(true)}
          >
            🗑️ Empty Trash ({trash.length} items)
          </button>
        </div>
      )}

      {/* Trash List */}
      <div className="admin-section">
        {loading ? (
          <div className="loading-skeleton">
            <div className="skeleton-content" style={{ height: '200px' }}></div>
          </div>
        ) : trash.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: '4rem', marginBottom: '16px' }}>🗑️</div>
            <h3>Trash is empty</h3>
            <p style={{ color: 'var(--admin-text-secondary)' }}>Deleted pages will appear here for 30 days before being permanently removed.</p>
          </div>
        ) : (
          <div className="trash-list">
            {trash.map(item => (
              <div key={item.id} className="trash-item">
                <div className="trash-info">
                  <h3>{item.page?.title || item.pageId}</h3>
                  <div className="trash-meta">
                    <span>Deleted: {formatDate(item.deletedAt)}</span>
                    <span className="trash-expiry">
                      {getDaysUntilDelete(item.deletedAt)} days until permanent deletion
                    </span>
                  </div>
                </div>
                <div className="trash-actions">
                  <button 
                    className="admin-btn admin-btn-primary admin-btn-sm"
                    onClick={() => handleRestore(item.id)}
                  >
                    ↩️ Restore
                  </button>
                  <button 
                    className="admin-btn admin-btn-danger admin-btn-sm"
                    onClick={() => handleDelete(item.id)}
                  >
                    Delete Forever
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Empty Trash Confirmation */}
      {showEmptyConfirm && (
        <div className="modal-overlay" onClick={() => setShowEmptyConfirm(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>⚠️ Empty Trash?</h3>
            <p style={{ color: 'var(--admin-text-secondary)', margin: '16px 0' }}>
              This will permanently delete all {trash.length} items in the trash. 
              This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setShowEmptyConfirm(false)}>
                Cancel
              </button>
              <button className="admin-btn admin-btn-danger" onClick={handleEmptyTrash}>
                Empty Trash
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminTrash;
