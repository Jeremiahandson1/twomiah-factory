import React, { useState, useEffect } from 'react';
import AdminLayout from './AdminLayout';
import { useToast } from './Toast';
import { getLeads, updateLead, deleteLead } from './api';

const statusColors = {
  new: { bg: 'var(--admin-primary-light)', color: 'var(--admin-primary)' },
  contacted: { bg: 'var(--admin-warning-bg)', color: '#92400e' },
  quoted: { bg: 'var(--admin-info-bg)', color: '#1e40af' },
  won: { bg: 'var(--admin-success-bg)', color: 'var(--admin-success)' },
  lost: { bg: 'var(--admin-error-bg)', color: 'var(--admin-error)' }
};

function AdminLeads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selectedLead, setSelectedLead] = useState(null);
  const [notes, setNotes] = useState('');
  const toast = useToast();

  useEffect(() => {
    loadLeads();
  }, []);

  const loadLeads = async () => {
    setLoading(true);
    try {
      const data = await getLeads();
      setLeads(data || []);
    } catch (err) {
      toast.error('Failed to load leads');
    }
    setLoading(false);
  };

  const handleStatusChange = async (leadId, status) => {
    try {
      await updateLead(leadId, { status });
      setLeads(leads.map(l => l.id === leadId ? { ...l, status } : l));
      toast.success('Status updated');
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    try {
      await updateLead(selectedLead.id, { notes });
      setLeads(leads.map(l => l.id === selectedLead.id ? { ...l, notes } : l));
      setSelectedLead(null);
      toast.success('Notes saved');
    } catch (err) {
      toast.error('Failed to save notes');
    }
  };

  const handleDelete = async (leadId) => {
    if (!confirm('Delete this lead?')) return;
    try {
      await deleteLead(leadId);
      setLeads(leads.filter(l => l.id !== leadId));
      toast.success('Lead deleted');
    } catch (err) {
      toast.error('Failed to delete lead');
    }
  };

  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`;
    return date.toLocaleDateString();
  };

  const filteredLeads = filter === 'all' 
    ? leads 
    : leads.filter(l => l.status === filter);

  const stats = {
    total: leads.length,
    new: leads.filter(l => l.status === 'new').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    won: leads.filter(l => l.status === 'won').length
  };

  return (
    <AdminLayout title="Form Submissions" subtitle="View and manage contact form leads">
      {/* Stats */}
      <div className="admin-section">
        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-card-label">Total Leads</div>
            <div className="stat-card-value">{stats.total}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: '3px solid var(--admin-primary)' }}>
            <div className="stat-card-label">New</div>
            <div className="stat-card-value">{stats.new}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: '3px solid #f59e0b' }}>
            <div className="stat-card-label">Contacted</div>
            <div className="stat-card-value">{stats.contacted}</div>
          </div>
          <div className="stat-card" style={{ borderLeft: '3px solid var(--admin-success)' }}>
            <div className="stat-card-label">Won</div>
            <div className="stat-card-value">{stats.won}</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="admin-section">
        <div className="filter-tabs">
          {['all', 'new', 'contacted', 'quoted', 'won', 'lost'].map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f !== 'all' && <span className="filter-count">{leads.filter(l => l.status === f).length}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Leads List */}
      <div className="admin-section">
        {loading ? (
          <div className="loading-skeleton">
            <div className="skeleton-content" style={{ height: '200px' }}></div>
          </div>
        ) : filteredLeads.length === 0 ? (
          <div className="empty-state">
            <p>No leads found.</p>
          </div>
        ) : (
          <div className="leads-list">
            {filteredLeads.map(lead => (
              <div key={lead.id} className="lead-card">
                <div className="lead-header">
                  <div className="lead-info">
                    <h3>{lead.name}</h3>
                    <span className="lead-time">{formatDate(lead.createdAt)}</span>
                  </div>
                  <div 
                    className="lead-status"
                    style={{ 
                      background: statusColors[lead.status]?.bg, 
                      color: statusColors[lead.status]?.color 
                    }}
                  >
                    {lead.status}
                  </div>
                </div>
                
                <div className="lead-contact">
                  <a href={`mailto:${lead.email}`}>📧 {lead.email}</a>
                  {lead.phone && <a href={`tel:${lead.phone}`}>📞 {lead.phone}</a>}
                </div>
                
                {lead.service && (
                  <div className="lead-service">Service: {lead.service}</div>
                )}
                
                {lead.message && (
                  <div className="lead-message">{lead.message}</div>
                )}
                
                {lead.notes && (
                  <div className="lead-notes">
                    <strong>Notes:</strong> {lead.notes}
                  </div>
                )}
                
                <div className="lead-actions">
                  <select 
                    value={lead.status} 
                    onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                    className="status-select"
                  >
                    <option value="new">New</option>
                    <option value="contacted">Contacted</option>
                    <option value="quoted">Quoted</option>
                    <option value="won">Won</option>
                    <option value="lost">Lost</option>
                  </select>
                  
                  <button 
                    className="admin-btn admin-btn-secondary admin-btn-sm"
                    onClick={() => { setSelectedLead(lead); setNotes(lead.notes || ''); }}
                  >
                    ✏️ Notes
                  </button>
                  
                  <button 
                    className="admin-btn admin-btn-danger admin-btn-sm"
                    onClick={() => handleDelete(lead.id)}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes Modal */}
      {selectedLead && (
        <div className="modal-overlay" onClick={() => setSelectedLead(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>Notes for {selectedLead.name}</h3>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add notes about this lead..."
              rows={5}
              style={{ width: '100%', marginTop: '12px' }}
            />
            <div className="modal-actions">
              <button className="admin-btn admin-btn-secondary" onClick={() => setSelectedLead(null)}>Cancel</button>
              <button className="admin-btn admin-btn-primary" onClick={handleSaveNotes}>Save Notes</button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}

export default AdminLeads;
