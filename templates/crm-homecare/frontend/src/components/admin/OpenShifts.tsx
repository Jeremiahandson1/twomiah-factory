// src/components/admin/OpenShifts.tsx — the open shift board (ported from the CVHC home care CRM).
// Post a shift, see who it was offered to and whether the first to accept gets it, approve or turn
// down an acceptance, smart-fill, broadcast, or take a posting down.
import React, { useState, useEffect } from 'react';
import { toast } from '../Toast';
import { API_BASE_URL } from '../../config';
import { formatDate, formatDateTime } from '../../utils/datetime';
import { useAuth } from '../../contexts/AuthContext';
import { confirm } from '../ConfirmModal';

const OpenShifts = () => {
  const { token } = useAuth();
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: 'active', urgency: '' });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showClaimsModal, setShowClaimsModal] = useState(false);
  const [currentShift, setCurrentShift] = useState(null);
  const [claims, setClaims] = useState([]);
  const [clients, setClients] = useState([]);
  const [careTypes, setCareTypes] = useState([]);
  const [smartFillShift, setSmartFillShift] = useState(null);
  const [smartFillSuggestions, setSmartFillSuggestions] = useState([]);
  const [smartFillLoading, setSmartFillLoading] = useState(false);
  const [smartFillBusy, setSmartFillBusy] = useState(null);
  const [smartFillNote, setSmartFillNote] = useState('');

  const authHdr = { Authorization: `Bearer ${token}` };

  // Ranked suggestions come from the scheduling module's suggest-caregivers when the tenant has it.
  // Without it, fall back to the shift's own eligible-caregivers list (free at that time first) so the
  // office can still assign in one click.
  const loadSmartFillSuggestions = async (shift) => {
    setSmartFillLoading(true);
    setSmartFillSuggestions([]);
    setSmartFillNote('');
    try {
      const qs = new URLSearchParams({
        clientId: shift.client_id,
        date: String(shift.shift_date).slice(0, 10),
        startTime: shift.start_time?.slice(0, 5),
        endTime: shift.end_time?.slice(0, 5),
      });
      const r = await fetch(`${API_BASE_URL}/api/scheduling/suggest-caregivers?${qs}`, { headers: authHdr });
      const data = r.ok ? await r.json().catch(() => null) : null;
      if (data && Array.isArray(data.suggestions)) {
        setSmartFillSuggestions(data.suggestions);
        return;
      }
      const e = await fetch(`${API_BASE_URL}/api/open-shifts/${shift.id}/eligible-caregivers`, { headers: authHdr });
      const list = e.ok ? await e.json() : [];
      const rows = (Array.isArray(list) ? list : [])
        .map((c) => ({ id: c.id, first_name: c.firstName, last_name: c.lastName, tier: c.available ? 'good' : 'avoid', score: null,
          reasons: [c.available ? 'Free at this time' : 'Has another visit at this time', c.notified ? 'Already notified' : null].filter(Boolean) }))
        .sort((a, b) => (a.tier === 'good' ? 0 : 1) - (b.tier === 'good' ? 0 : 1));
      setSmartFillSuggestions(rows);
      setSmartFillNote('Ranking is not available here — caregivers free at this time are listed first.');
    } catch { setSmartFillNote('Could not load caregivers.'); }
    finally { setSmartFillLoading(false); }
  };

  const assignSmartFill = async (caregiverId) => {
    if (!smartFillShift) return;
    setSmartFillBusy(caregiverId);
    try {
      const r = await fetch(`${API_BASE_URL}/api/open-shifts/${smartFillShift.id}/smart-fill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify({ caregiverId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed');
      if (Array.isArray(data.authWarnings) && data.authWarnings.length) toast('Assigned. Authorization notes:\n' + data.authWarnings.join('\n'), 'success');
      setSmartFillShift(null);
      setSmartFillSuggestions([]);
      loadShifts();
    } catch (e) { toast('Smart fill failed: ' + e.message, 'error'); }
    finally { setSmartFillBusy(null); }
  };

  const tierBadge = (tier) => {
    const C = {
      excellent: { bg: '#D1FAE5', fg: '#065F46', label: '★ Excellent' },
      good:      { bg: '#DBEAFE', fg: '#1E40AF', label: '✓ Good' },
      maybe:     { bg: '#FEF3C7', fg: '#92400E', label: '? Maybe' },
      avoid:     { bg: '#FEE2E2', fg: '#991B1B', label: '⚠ Busy' },
    };
    return C[tier] || C.maybe;
  };

  useEffect(() => {
    loadShifts();
    loadClients();
    loadCareTypes();
  }, [filter]);

  const loadShifts = async () => {
    try {
      const params = new URLSearchParams();
      // '' (All) is sent as 'all' — an empty status means "open" to the server.
      params.append('status', filter.status || 'all');
      if (filter.urgency) params.append('urgency', filter.urgency);
      const res = await fetch(`${API_BASE_URL}/api/open-shifts?${params}`, { headers: authHdr });
      const data = res.ok ? await res.json() : [];
      setShifts(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load shifts:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clients`, { headers: authHdr });
      const data = res.ok ? await res.json() : [];
      setClients(Array.isArray(data) ? data : (data.clients || []));
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadCareTypes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/care-types`, { headers: authHdr });
      const data = res.ok ? await res.json() : [];
      setCareTypes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load care types:', error);
    }
  };

  const loadClaims = async (shiftId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/claims`, { headers: authHdr });
      const data = res.ok ? await res.json() : [];
      setClaims(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load claims:', error);
    }
  };

  const createShift = async (formData) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setShowCreateModal(false);
        loadShifts();
      } else {
        const err = await res.json().catch(() => ({}));
        toast('Failed: ' + (err.error || res.status), 'error');
      }
    } catch (error) {
      toast('Failed to create shift: ' + error.message, 'error');
    }
  };

  const approveShift = async (shiftId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/approve`, { method: 'POST', headers: authHdr });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (Array.isArray(data.authWarnings) && data.authWarnings.length) toast('Approved. Authorization notes:\n' + data.authWarnings.join('\n'), 'success');
        loadShifts();
        setShowClaimsModal(false);
      } else {
        toast('Failed: ' + (data.error || res.status), 'error');
      }
    } catch (error) {
      toast('Failed to approve: ' + error.message, 'error');
    }
  };

  // Turn down the acceptance — the shift goes back to open.
  const rejectShift = async (shiftId) => {
    const reason = prompt('Why are you turning this down? (optional)');
    if (reason === null) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHdr },
        body: JSON.stringify({ reason: reason || 'Turned down by office' }),
      });
      if (res.ok) {
        loadShifts();
        setShowClaimsModal(false);
      }
    } catch (error) {
      toast('Failed to turn down: ' + error.message, 'error');
    }
  };

  // Take the posting down. The visit stays with its original caregiver.
  const removeShift = async (shift) => {
    if (!(await confirm('Take this shift off the open shift board? The visit stays with its current caregiver.'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shift.id}/cancel`, { method: 'POST', headers: authHdr });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.status);
      loadShifts();
    } catch (error) {
      toast('Failed to remove: ' + error.message, 'error');
    }
  };

  const broadcastShift = async (shiftId) => {
    if (!(await confirm('Send to all available caregivers?'))) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/open-shifts/${shiftId}/broadcast`, { method: 'POST', headers: authHdr });
      const data = await res.json();
      if (res.ok) {
        toast(`Broadcast sent to ${data.caregiverCount} caregivers`, 'success');
        loadShifts();
      }
    } catch (error) {
      toast('Failed to broadcast: ' + error.message, 'error');
    }
  };

  const badge = (text, bg) => (
    <span style={{ padding: '2px 6px', borderRadius: '4px', fontSize: '0.75rem', fontWeight: 'bold', color: '#fff', backgroundColor: bg }}>{text}</span>
  );
  const getUrgencyBadge = (urgency) => {
    const colors = { normal: '#2E7D32', high: '#B45309', critical: '#C62828', urgent: '#C62828' };
    return badge(urgency?.toUpperCase(), colors[urgency] || '#616161');
  };
  const getStatusBadge = (status) => {
    const colors = { open: '#1565C0', claimed: '#B45309', filled: '#2E7D32', cancelled: '#616161' };
    return badge(status?.toUpperCase(), colors[status] || '#616161');
  };

  const openShiftCount = shifts.filter((s) => s.status === 'open').length;
  const claimedCount = shifts.filter((s) => s.status === 'claimed').length;

  return (
    <div>
      <div className="page-header">
        <h2>📋 Open Shift Board</h2>
        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + Post Open Shift
        </button>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginBottom: '1rem' }}>
        <div className="stat-card" onClick={() => setFilter({ ...filter, status: 'open' })} style={{ cursor: 'pointer' }}>
          <h4>Open</h4>
          <div className="value" style={{ color: '#1565C0' }}>{openShiftCount}</div>
        </div>
        <div className="stat-card" onClick={() => setFilter({ ...filter, status: 'claimed' })} style={{ cursor: 'pointer' }}>
          <h4>Accepted (Needs You)</h4>
          <div className="value" style={{ color: '#B45309' }}>{claimedCount}</div>
        </div>
        <div className="stat-card" onClick={() => setFilter({ ...filter, status: '' })} style={{ cursor: 'pointer' }}>
          <h4>Total</h4>
          <div className="value">{shifts.length}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="active">Needs attention (open + accepted)</option>
              <option value="">All</option>
              <option value="open">Open</option>
              <option value="claimed">Accepted</option>
              <option value="filled">Filled</option>
              <option value="cancelled">Removed</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Urgency</label>
            <select value={filter.urgency} onChange={(e) => setFilter({ ...filter, urgency: e.target.value })}>
              <option value="">All</option>
              <option value="urgent">Urgent</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : shifts.length === 0 ? (
          <p>No open shifts found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Client</th>
                  <th>Offered to</th>
                  <th>Rate</th>
                  <th>Bonus</th>
                  <th>Urgency</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map((shift) => (
                  <tr key={shift.id}>
                    <td><strong>{formatDate(shift.shift_date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong></td>
                    <td>{shift.start_time?.slice(0, 5)} - {shift.end_time?.slice(0, 5)}</td>
                    <td>{shift.client_first_name} {shift.client_last_name}</td>
                    <td style={{ maxWidth: 200, fontSize: '0.82rem' }}>
                      {shift.offered_to || 'Everyone'}
                      {shift.auto_assign && (
                        <div style={{ fontSize: '0.72rem', color: '#065F46', fontWeight: 600 }}>First to accept gets it</div>
                      )}
                    </td>
                    <td>{shift.hourly_rate != null ? `$${Number(parseFloat(shift.hourly_rate) || 0).toFixed(2)}/hr` : '-'}</td>
                    <td>
                      {parseFloat(shift.bonus_amount) > 0 ? (
                        <span style={{ color: '#2E7D32', fontWeight: 'bold' }}>+${Number(shift.bonus_amount).toFixed(2)}</span>
                      ) : '-'}
                    </td>
                    <td>{getUrgencyBadge(shift.urgency)}</td>
                    <td>
                      {getStatusBadge(shift.status)}
                      {shift.status === 'claimed' && (
                        <div style={{ fontSize: '0.8rem', marginTop: '2px' }}>by {shift.claimed_by_first} {shift.claimed_by_last}</div>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                        {shift.status === 'open' && (
                          <>
                            <button className="btn btn-sm" style={{ background: '#0F766E', color: '#fff', border: 'none' }}
                              onClick={() => { setSmartFillShift(shift); loadSmartFillSuggestions(shift); }}
                              title="Suggest caregivers and one-click assign">
                              ✨ Smart Fill
                            </button>
                            <button className="btn btn-sm btn-secondary" onClick={() => broadcastShift(shift.id)} title="Send to caregivers">📢</button>
                          </>
                        )}
                        {shift.status === 'claimed' && (
                          <>
                            <button className="btn btn-sm btn-success" onClick={() => approveShift(shift.id)}>✓ Approve</button>
                            <button className="btn btn-sm btn-danger" onClick={() => rejectShift(shift.id)} title="Turn down — the shift reopens">✗ Turn down</button>
                          </>
                        )}
                        {(shift.status === 'open' || shift.status === 'claimed') && (
                          <button className="btn btn-sm btn-secondary" onClick={() => removeShift(shift)} title="Take this posting down">🗑 Remove</button>
                        )}
                        <button className="btn btn-sm btn-secondary"
                          onClick={() => { setCurrentShift(shift); loadClaims(shift.id); setShowClaimsModal(true); }}>
                          View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal active" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Post Open Shift</h3>
              <button className="modal-close" onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            <CreateShiftForm clients={clients} careTypes={careTypes} onSubmit={createShift} onCancel={() => setShowCreateModal(false)} />
          </div>
        </div>
      )}

      {showClaimsModal && currentShift && (
        <div className="modal active" onClick={() => setShowClaimsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Shift Details</h3>
              <button className="modal-close" onClick={() => setShowClaimsModal(false)}>×</button>
            </div>
            <div>
              <p><strong>Client:</strong> {currentShift.client_first_name} {currentShift.client_last_name}</p>
              <p><strong>Date:</strong> {formatDate(currentShift.shift_date)}</p>
              <p><strong>Time:</strong> {currentShift.start_time?.slice(0, 5)} - {currentShift.end_time?.slice(0, 5)}</p>
              <p><strong>Rate:</strong> {currentShift.hourly_rate != null ? `$${Number(parseFloat(currentShift.hourly_rate) || 0).toFixed(2)}/hr` : '-'}</p>
              {parseFloat(currentShift.bonus_amount) > 0 && (
                <p><strong>Bonus:</strong> <span style={{ color: '#2E7D32' }}>+${Number(currentShift.bonus_amount).toFixed(2)}</span></p>
              )}
              <p><strong>Offered to:</strong> {currentShift.offered_to || 'Everyone'}{currentShift.auto_assign ? ' — first to accept gets it' : ' — waits for your approval'}</p>
              <p><strong>Status:</strong> {getStatusBadge(currentShift.status)}</p>
              {currentShift.notes && <p><strong>Notes:</strong> {currentShift.notes}</p>}
              <hr style={{ margin: '1rem 0' }} />
              <h4>Accepted by ({claims.length})</h4>
              {claims.length === 0 ? (
                <p style={{ color: '#4B5563' }}>No caregiver has accepted this shift yet.</p>
              ) : (
                <table className="table">
                  <thead><tr><th>Caregiver</th><th>Phone</th><th>Status</th><th>Submitted</th></tr></thead>
                  <tbody>
                    {claims.map((claim) => (
                      <tr key={claim.id}>
                        <td>{claim.first_name} {claim.last_name}</td>
                        <td>{claim.phone}</td>
                        <td>{claim.status}</td>
                        <td>{formatDateTime(claim.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {smartFillShift && (
        <div className="modal active" onClick={() => !smartFillBusy && setSmartFillShift(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <div className="modal-header">
              <h3>✨ Smart Fill — Suggested Caregivers</h3>
              <button className="modal-close" onClick={() => setSmartFillShift(null)}>×</button>
            </div>
            <div>
              <div style={{ background: '#F9FAFB', color: '#111827', padding: '0.75rem', borderRadius: 6, marginBottom: '0.75rem', fontSize: '0.88rem' }}>
                <strong>{smartFillShift.client_first_name} {smartFillShift.client_last_name}</strong> ·{' '}
                {formatDate(smartFillShift.shift_date)} ·{' '}
                {smartFillShift.start_time?.slice(0, 5)}–{smartFillShift.end_time?.slice(0, 5)}
              </div>
              {smartFillNote && <p style={{ fontSize: '0.8rem', color: '#4B5563' }}>{smartFillNote}</p>}
              {smartFillLoading ? (
                <p style={{ color: '#4B5563' }}>Ranking caregivers…</p>
              ) : smartFillSuggestions.length === 0 ? (
                <p style={{ color: '#4B5563' }}>No suitable caregivers found. Try broadcasting the shift instead.</p>
              ) : (
                <div style={{ display: 'grid', gap: '0.4rem', maxHeight: 460, overflow: 'auto' }}>
                  {smartFillSuggestions.slice(0, 12).map((sg, idx) => {
                    const t = tierBadge(sg.tier);
                    return (
                      <div key={sg.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '0.6rem 0.75rem', background: '#fff', color: '#111827', border: '1px solid #E5E7EB', borderRadius: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span style={{ fontWeight: 700 }}>{idx + 1}. {sg.first_name} {sg.last_name}</span>
                            <span style={{ background: t.bg, color: t.fg, fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
                              {t.label}{sg.score != null ? ` · ${sg.score}` : ''}
                            </span>
                          </div>
                          {sg.reasons && sg.reasons.length > 0 && (
                            <div style={{ marginTop: 2, fontSize: '0.72rem', color: '#4B5563' }}>{sg.reasons.slice(0, 4).join(' · ')}</div>
                          )}
                        </div>
                        <button className="btn btn-sm btn-primary" disabled={!!smartFillBusy} onClick={() => assignSmartFill(sg.id)} style={{ marginLeft: 8 }}>
                          {smartFillBusy === sg.id ? 'Assigning…' : 'Assign'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const CreateShiftForm = ({ clients, careTypes, onSubmit, onCancel }) => {
  const [formData, setFormData] = useState({
    clientId: '', shiftDate: '', startTime: '08:00', endTime: '16:00', careTypeId: '',
    hourlyRate: '', bonusAmount: '0', urgency: 'normal', notes: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.clientId || !formData.shiftDate) { toast('Client and date are required', 'error'); return; }
    const rate = formData.hourlyRate === '' ? null : Number(formData.hourlyRate);
    const bonus = formData.bonusAmount === '' ? 0 : Number(formData.bonusAmount);
    if (rate !== null && (!isFinite(rate) || rate < 0)) { toast('Hourly rate must be a positive number', 'error'); return; }
    if (!isFinite(bonus) || bonus < 0) { toast('Bonus must be a positive number', 'error'); return; }
    onSubmit({ ...formData, hourlyRate: rate, bonusAmount: bonus });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-group">
        <label>Client *</label>
        <select value={formData.clientId} onChange={(e) => setFormData({ ...formData, clientId: e.target.value })} required>
          <option value="">Select Client</option>
          {clients.filter((c) => c.is_active !== false && c.isActive !== false).map((c) => (
            <option key={c.id} value={c.id}>{c.first_name || c.firstName} {c.last_name || c.lastName}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Date *</label>
          <input type="date" value={formData.shiftDate} onChange={(e) => setFormData({ ...formData, shiftDate: e.target.value })} required />
        </div>
        <div className="form-group">
          <label>Start Time</label>
          <input type="time" value={formData.startTime} onChange={(e) => setFormData({ ...formData, startTime: e.target.value })} />
        </div>
        <div className="form-group">
          <label>End Time</label>
          <input type="time" value={formData.endTime} onChange={(e) => setFormData({ ...formData, endTime: e.target.value })} />
        </div>
      </div>
      <div className="form-group">
        <label>Care Type</label>
        <select value={formData.careTypeId} onChange={(e) => setFormData({ ...formData, careTypeId: e.target.value })}>
          <option value="">Select Care Type</option>
          {careTypes.map((ct) => (<option key={ct.id} value={ct.id}>{ct.name}</option>))}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
        <div className="form-group">
          <label>Hourly Rate ($)</label>
          <input type="number" step="0.01" value={formData.hourlyRate} onChange={(e) => setFormData({ ...formData, hourlyRate: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Bonus ($)</label>
          <input type="number" step="0.01" value={formData.bonusAmount} onChange={(e) => setFormData({ ...formData, bonusAmount: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Urgency</label>
          <select value={formData.urgency} onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label>Notes</label>
        <textarea value={formData.notes} onChange={(e) => setFormData({ ...formData, notes: e.target.value })} placeholder="Any special requirements..." />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary">Post Shift</button>
      </div>
    </form>
  );
};

export default OpenShifts;
