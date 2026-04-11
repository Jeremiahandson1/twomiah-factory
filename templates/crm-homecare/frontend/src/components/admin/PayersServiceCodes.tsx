import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/PayersServiceCodes.tsx
// Payers & Service Codes management with tabbed CRUD
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';

const PayersServiceCodes = () => {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState('payers');
  const [payers, setPayers] = useState([]);
  const [serviceCodes, setServiceCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showPayerModal, setShowPayerModal] = useState(false);
  const [showCodeModal, setShowCodeModal] = useState(false);
  const [editingPayer, setEditingPayer] = useState(null);
  const [editingCode, setEditingCode] = useState(null);

  const [payerForm, setPayerForm] = useState({
    name: '', type: 'insurance', contactName: '', contactEmail: '', contactPhone: '',
    address: '', city: '', state: '', zip: '', payerId: '', isActivePayer: true, notes: ''
  });

  const [codeForm, setCodeForm] = useState({
    code: '', description: '', ratePerUnit: '', unitType: 'hour', revenueCode: '',
    requiresAuth: false, notes: ''
  });

  useEffect(() => {
    loadPayers();
    loadServiceCodes();
  }, []);

  const loadPayers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/payers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setPayers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load payers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadServiceCodes = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/service-codes`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setServiceCodes(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load service codes:', error);
    }
  };

  const savePayer = async (e) => {
    e.preventDefault();
    try {
      const url = editingPayer
        ? `${API_BASE_URL}/api/payers/${editingPayer.id}`
        : `${API_BASE_URL}/api/payers`;
      const res = await fetch(url, {
        method: editingPayer ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payerForm)
      });
      if (res.ok) {
        toast(editingPayer ? 'Payer updated' : 'Payer created', 'success');
        setShowPayerModal(false);
        setEditingPayer(null);
        resetPayerForm();
        loadPayers();
      } else {
        const err = await res.json();
        toast(err.error || 'Failed to save payer', 'error');
      }
    } catch (error) {
      toast('Failed to save payer: ' + error.message, 'error');
    }
  };

  const saveServiceCode = async (e) => {
    e.preventDefault();
    try {
      const url = editingCode
        ? `${API_BASE_URL}/api/service-codes/${editingCode.id}`
        : `${API_BASE_URL}/api/service-codes`;
      const payload = { ...codeForm, ratePerUnit: codeForm.ratePerUnit ? parseFloat(codeForm.ratePerUnit) : null };
      const res = await fetch(url, {
        method: editingCode ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        toast(editingCode ? 'Service code updated' : 'Service code created', 'success');
        setShowCodeModal(false);
        setEditingCode(null);
        resetCodeForm();
        loadServiceCodes();
      } else {
        const err = await res.json();
        toast(err.error || 'Failed to save service code', 'error');
      }
    } catch (error) {
      toast('Failed to save service code: ' + error.message, 'error');
    }
  };

  const resetPayerForm = () => {
    setPayerForm({ name: '', type: 'insurance', contactName: '', contactEmail: '', contactPhone: '', address: '', city: '', state: '', zip: '', payerId: '', isActivePayer: true, notes: '' });
  };

  const resetCodeForm = () => {
    setCodeForm({ code: '', description: '', ratePerUnit: '', unitType: 'hour', revenueCode: '', requiresAuth: false, notes: '' });
  };

  const openEditPayer = (payer) => {
    setEditingPayer(payer);
    setPayerForm({
      name: payer.name || '', type: payer.type || 'insurance',
      contactName: payer.contactName || '', contactEmail: payer.contactEmail || '',
      contactPhone: payer.contactPhone || '', address: payer.address || '',
      city: payer.city || '', state: payer.state || '', zip: payer.zip || '',
      payerId: payer.payerId || '', isActivePayer: payer.isActivePayer ?? true,
      notes: payer.notes || ''
    });
    setShowPayerModal(true);
  };

  const openEditCode = (code) => {
    setEditingCode(code);
    setCodeForm({
      code: code.code || '', description: code.description || '',
      ratePerUnit: code.ratePerUnit?.toString() || '', unitType: code.unitType || 'hour',
      revenueCode: code.revenueCode || '', requiresAuth: code.requiresAuth ?? false,
      notes: code.notes || ''
    });
    setShowCodeModal(true);
  };

  const getTypeBadge = (type) => {
    const colors = {
      insurance: '#2196f3', medicaid: '#9c27b0', medicare: '#4caf50',
      private: '#ff9800', other: '#9e9e9e'
    };
    return (
      <span style={{
        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem',
        fontWeight: 'bold', color: 'white', backgroundColor: colors[type] || '#9e9e9e'
      }}>
        {type?.toUpperCase() || 'N/A'}
      </span>
    );
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-header">
        <h2>🏦 Payers & Service Codes</h2>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          className={`btn ${activeTab === 'payers' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('payers')}
        >
          Payers ({payers.length})
        </button>
        <button
          className={`btn ${activeTab === 'service-codes' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('service-codes')}
        >
          Service Codes ({serviceCodes.length})
        </button>
      </div>

      {/* PAYERS TAB */}
      {activeTab === 'payers' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn btn-primary" onClick={() => { resetPayerForm(); setEditingPayer(null); setShowPayerModal(true); }}>
              + Add Payer
            </button>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Payer ID</th>
                  <th>Contact</th>
                  <th>Phone</th>
                  <th>Active Payer</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {payers.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>No payers found</td></tr>
                ) : payers.map(p => (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td>{getTypeBadge(p.type)}</td>
                    <td>{p.payerId || '—'}</td>
                    <td>{p.contactName || '—'}</td>
                    <td>{p.contactPhone || '—'}</td>
                    <td>
                      <span style={{
                        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold',
                        color: 'white', backgroundColor: p.isActivePayer ? '#4caf50' : '#9e9e9e'
                      }}>
                        {p.isActivePayer ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => openEditPayer(p)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SERVICE CODES TAB */}
      {activeTab === 'service-codes' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button className="btn btn-primary" onClick={() => { resetCodeForm(); setEditingCode(null); setShowCodeModal(true); }}>
              + Add Service Code
            </button>
          </div>

          <div className="card" style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Rate</th>
                  <th>Unit Type</th>
                  <th>Revenue Code</th>
                  <th>Requires Auth</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {serviceCodes.length === 0 ? (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>No service codes found</td></tr>
                ) : serviceCodes.map(sc => (
                  <tr key={sc.id}>
                    <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{sc.code}</td>
                    <td>{sc.description || '—'}</td>
                    <td>{sc.ratePerUnit ? `$${parseFloat(sc.ratePerUnit).toFixed(2)}` : '—'}</td>
                    <td>{sc.unitType || '—'}</td>
                    <td>{sc.revenueCode || '—'}</td>
                    <td>
                      <span style={{
                        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 'bold',
                        color: 'white', backgroundColor: sc.requiresAuth ? '#ff9800' : '#9e9e9e'
                      }}>
                        {sc.requiresAuth ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn-sm" onClick={() => openEditCode(sc)}>Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAYER MODAL */}
      {showPayerModal && (
        <div className="modal-overlay" onClick={() => setShowPayerModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3>{editingPayer ? 'Edit Payer' : 'Add Payer'}</h3>
              <button className="modal-close" onClick={() => setShowPayerModal(false)}>&times;</button>
            </div>
            <form onSubmit={savePayer}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Name *</label>
                  <input type="text" value={payerForm.name} onChange={(e) => setPayerForm({ ...payerForm, name: e.target.value })} required />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Type</label>
                    <select value={payerForm.type} onChange={(e) => setPayerForm({ ...payerForm, type: e.target.value })}>
                      <option value="insurance">Insurance</option>
                      <option value="medicaid">Medicaid</option>
                      <option value="medicare">Medicare</option>
                      <option value="private">Private Pay</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payer ID</label>
                    <input type="text" value={payerForm.payerId} onChange={(e) => setPayerForm({ ...payerForm, payerId: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Contact Name</label>
                    <input type="text" value={payerForm.contactName} onChange={(e) => setPayerForm({ ...payerForm, contactName: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Contact Phone</label>
                    <input type="text" value={payerForm.contactPhone} onChange={(e) => setPayerForm({ ...payerForm, contactPhone: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Contact Email</label>
                  <input type="email" value={payerForm.contactEmail} onChange={(e) => setPayerForm({ ...payerForm, contactEmail: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>
                    <input type="checkbox" checked={payerForm.isActivePayer} onChange={(e) => setPayerForm({ ...payerForm, isActivePayer: e.target.checked })} style={{ marginRight: '0.5rem' }} />
                    Active Payer
                  </label>
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={payerForm.notes} onChange={(e) => setPayerForm({ ...payerForm, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowPayerModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingPayer ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SERVICE CODE MODAL */}
      {showCodeModal && (
        <div className="modal-overlay" onClick={() => setShowCodeModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
            <div className="modal-header">
              <h3>{editingCode ? 'Edit Service Code' : 'Add Service Code'}</h3>
              <button className="modal-close" onClick={() => setShowCodeModal(false)}>&times;</button>
            </div>
            <form onSubmit={saveServiceCode}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Code *</label>
                    <input type="text" value={codeForm.code} onChange={(e) => setCodeForm({ ...codeForm, code: e.target.value })} required placeholder="e.g. T1019" />
                  </div>
                  <div className="form-group">
                    <label>Revenue Code</label>
                    <input type="text" value={codeForm.revenueCode} onChange={(e) => setCodeForm({ ...codeForm, revenueCode: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input type="text" value={codeForm.description} onChange={(e) => setCodeForm({ ...codeForm, description: e.target.value })} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Rate Per Unit ($)</label>
                    <input type="number" step="0.01" value={codeForm.ratePerUnit} onChange={(e) => setCodeForm({ ...codeForm, ratePerUnit: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Unit Type</label>
                    <select value={codeForm.unitType} onChange={(e) => setCodeForm({ ...codeForm, unitType: e.target.value })}>
                      <option value="hour">Hour</option>
                      <option value="15min">15-Minute</option>
                      <option value="visit">Visit</option>
                      <option value="day">Day</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>
                    <input type="checkbox" checked={codeForm.requiresAuth} onChange={(e) => setCodeForm({ ...codeForm, requiresAuth: e.target.checked })} style={{ marginRight: '0.5rem' }} />
                    Requires Authorization
                  </label>
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={codeForm.notes} onChange={(e) => setCodeForm({ ...codeForm, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCodeModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editingCode ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default PayersServiceCodes;
