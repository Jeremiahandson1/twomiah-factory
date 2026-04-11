import { toast } from '../Toast';
// src/components/admin/EVVDashboard.tsx
// Electronic Visit Verification dashboard
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  if (typeof dateStr === 'string' && dateStr.includes('T')) {
    const [datePart] = dateStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(dateStr);
};

const formatDate = (dateStr) => {
  const date = parseDate(dateStr);
  if (!date || isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US');
};

const formatTime = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const EVVDashboard = () => {
  const { token } = useAuth();
  const [visits, setVisits] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState({ status: '', startDate: '', endDate: '' });
  const limit = 50;

  useEffect(() => {
    loadVisits();
  }, [page, filter]);

  const loadVisits = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', limit.toString());
      if (filter.status) params.append('status', filter.status);
      if (filter.startDate) params.append('startDate', filter.startDate);
      if (filter.endDate) params.append('endDate', filter.endDate);

      const res = await fetch(`${API_BASE_URL}/api/evv?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setVisits(Array.isArray(data.visits) ? data.visits : []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to load EVV visits:', error);
    } finally {
      setLoading(false);
    }
  };

  const verifyVisit = async (visitId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/evv/${visitId}/verify`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast('Visit verified', 'success');
        loadVisits();
      } else {
        toast('Failed to verify visit', 'error');
      }
    } catch (error) {
      toast('Failed to verify: ' + error.message, 'error');
    }
  };

  const getSandataStatusBadge = (status) => {
    const colors = {
      pending: '#ff9800', submitted: '#2196f3', accepted: '#4caf50',
      rejected: '#f44336', error: '#b71c1c', not_submitted: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem',
        fontWeight: 'bold', color: 'white', backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {(status || 'pending').replace('_', ' ').toUpperCase()}
      </span>
    );
  };

  const getVerifiedBadge = (isVerified, hasGps) => {
    if (isVerified) {
      return (
        <span style={{
          padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem',
          fontWeight: 'bold', color: 'white', backgroundColor: '#4caf50'
        }}>
          VERIFIED
        </span>
      );
    }
    if (hasGps) {
      return (
        <span style={{
          padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem',
          fontWeight: 'bold', color: 'white', backgroundColor: '#ff9800'
        }}>
          GPS OK
        </span>
      );
    }
    return (
      <span style={{
        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem',
        fontWeight: 'bold', color: 'white', backgroundColor: '#9e9e9e'
      }}>
        UNVERIFIED
      </span>
    );
  };

  // Summary stats
  const totalVisits = total;
  const verifiedCount = visits.filter(v => v.isVerified).length;
  const acceptedCount = visits.filter(v => v.sandataStatus === 'accepted').length;
  const rejectedCount = visits.filter(v => v.sandataStatus === 'rejected' || v.sandataStatus === 'error').length;
  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <div className="page-header">
        <h2>📍 EVV Dashboard</h2>
        <button className="btn btn-secondary" onClick={loadVisits}>Refresh</button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1rem' }}>
        <div className="stat-card">
          <h4>Total Visits</h4>
          <div className="value">{totalVisits}</div>
        </div>
        <div className="stat-card">
          <h4>Verified</h4>
          <div className="value" style={{ color: '#4caf50' }}>{verifiedCount}</div>
          <small>This page</small>
        </div>
        <div className="stat-card">
          <h4>Sandata Accepted</h4>
          <div className="value" style={{ color: '#2196f3' }}>{acceptedCount}</div>
          <small>This page</small>
        </div>
        <div className="stat-card">
          <h4>Rejected/Error</h4>
          <div className="value" style={{ color: '#f44336' }}>{rejectedCount}</div>
          <small>This page</small>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Sandata Status</label>
            <select value={filter.status} onChange={(e) => { setFilter({ ...filter, status: e.target.value }); setPage(1); }}>
              <option value="">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="error">Error</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Start Date</label>
            <input type="date" value={filter.startDate} onChange={(e) => { setFilter({ ...filter, startDate: e.target.value }); setPage(1); }} />
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>End Date</label>
            <input type="date" value={filter.endDate} onChange={(e) => { setFilter({ ...filter, endDate: e.target.value }); setPage(1); }} />
          </div>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Service Date</th>
                <th>Client</th>
                <th>Service Code</th>
                <th>Clock In</th>
                <th>Clock Out</th>
                <th>Units</th>
                <th>GPS / Verified</th>
                <th>Sandata</th>
                <th>Method</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visits.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>No EVV visits found</td></tr>
              ) : visits.map(v => {
                const hasGps = v.gpsInLat != null && v.gpsInLng != null;
                return (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{formatDate(v.serviceDate)}</td>
                    <td>
                      {v.client ? `${v.client.firstName || ''} ${v.client.lastName || ''}`.trim() : '—'}
                      {v.client?.mcoMemberId && (
                        <div style={{ fontSize: '0.75rem', color: '#888' }}>MCO: {v.client.mcoMemberId}</div>
                      )}
                    </td>
                    <td style={{ fontFamily: 'monospace' }}>
                      {v.serviceCode || '—'}
                      {v.modifier ? <span style={{ color: '#888' }}>:{v.modifier}</span> : ''}
                    </td>
                    <td>{formatTime(v.actualStart || v.timeEntry?.startTime)}</td>
                    <td>{formatTime(v.actualEnd || v.timeEntry?.endTime)}</td>
                    <td>{v.unitsOfService || (v.timeEntry?.durationMinutes ? (v.timeEntry.durationMinutes / 60).toFixed(1) : '—')}</td>
                    <td>{getVerifiedBadge(v.isVerified, hasGps)}</td>
                    <td>
                      {getSandataStatusBadge(v.sandataStatus)}
                      {v.sandataExceptionCode && (
                        <div style={{ fontSize: '0.75rem', color: '#f44336', marginTop: '2px' }}>
                          {v.sandataExceptionCode}: {v.sandataExceptionDesc || ''}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: '0.8rem', color: '#666' }}>{v.evvMethod || '—'}</td>
                    <td>
                      {!v.isVerified && (
                        <button className="btn btn-sm" onClick={() => verifyVisit(v.id)}>Verify</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', padding: '1rem 0' }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
              <span style={{ fontSize: '0.9rem', color: '#666' }}>Page {page} of {totalPages}</span>
              <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default EVVDashboard;
