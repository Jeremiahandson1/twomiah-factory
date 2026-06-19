import { useState, useEffect, useCallback } from 'react';
import {
  Wrench, Plus, Search, Filter, CheckCircle, Clock, AlertTriangle,
  ChevronLeft, ChevronRight, X, Trash2, Loader2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

const API = import.meta.env.VITE_API_URL || '';

const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
  open: { label: 'Open', bg: '#dbeafe', text: '#1d4ed8' },
  in_progress: { label: 'In Progress', bg: '#fef9c3', text: '#a16207' },
  waiting_parts: { label: 'Waiting Parts', bg: '#ffedd5', text: '#c2410c' },
  ready: { label: 'Ready', bg: '#dcfce7', text: '#15803d' },
  closed: { label: 'Closed', bg: '#f3f4f6', text: '#6b7280' },
};

interface ServiceLine {
  description: string;
  laborHours: number;
  partsCost: number;
  laborCost: number;
}

const emptyLine: ServiceLine = { description: '', laborHours: 0, partsCost: 0, laborCost: 0 };

export default function ServicePage() {
  const { token } = useAuth();
  const [orders, setOrders] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingIn, setCheckingIn] = useState<number | null>(null);
  const [alertBanner, setAlertBanner] = useState<{ id: number; message: string } | null>(null);
  const [alertedIds, setAlertedIds] = useState<Set<number>>(new Set());

  // Form state
  const [formContactId, setFormContactId] = useState('');
  const [formUnitId, setFormUnitId] = useState('');
  const [formUnitInfo, setFormUnitInfo] = useState({ vin: '', year: '', make: '', modelName: '', mileage: '' });
  const [formAdvisor, setFormAdvisor] = useState('');
  const [formServices, setFormServices] = useState<ServiceLine[]>([{ ...emptyLine }]);
  const [formNotes, setFormNotes] = useState('');

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (statusFilter) params.set('status', statusFilter);
      const res = await fetch(`${API}/api/repair-orders?${params}`, { headers });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      setOrders(data.data || data || []);
      setTotalPages(data.pagination?.totalPages || 1);
    } catch { /* silently fail */ } finally { setLoading(false); }
  }, [page, statusFilter, token]);

  useEffect(() => { loadOrders(); }, [loadOrders]);
  useEffect(() => { setPage(1); }, [statusFilter]);

  const loadDropdowns = useCallback(async () => {
    try {
      const [cRes, uRes] = await Promise.all([
        fetch(`${API}/api/contacts?limit=200`, { headers }),
        fetch(`${API}/api/units?limit=200`, { headers }),
      ]);
      if (!cRes.ok) throw new Error('Request failed');
      if (!uRes.ok) throw new Error('Request failed');
      setContacts(await cRes.json().then(d => d.data || d || []));
      setUnits(await uRes.json().then(d => d.data || d || []));
    } catch { /* */ }
  }, [token]);

  useEffect(() => { loadDropdowns(); }, [loadDropdowns]);

  const handleCheckIn = async (id: number) => {
    setCheckingIn(id);
    try {
      const res = await fetch(`${API}/api/repair-orders/${id}/check-in`, { method: 'POST', headers });
      if (!res.ok) throw new Error('Request failed');
      const data = await res.json();
      if (data.alertTriggered) {
        setAlertBanner({ id, message: data.alertMessage || 'Customer has an active lead.' });
        setAlertedIds(prev => new Set(prev).add(id));
        setTimeout(() => setAlertBanner(null), 8000);
      }
      loadOrders();
    } catch { /* */ } finally { setCheckingIn(null); }
  };

  const estimatedTotal = formServices.reduce((sum, s) => sum + (s.partsCost || 0) + (s.laborCost || 0), 0);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const body: any = {
        contactId: formContactId ? Number(formContactId) : undefined,
        unitId: formUnitId ? Number(formUnitId) : undefined,
        customerUnitInfo: (!formUnitId && formUnitInfo.make) ? formUnitInfo : undefined,
        advisor: formAdvisor,
        services: formServices.filter(s => s.description),
        estimatedTotal,
        notes: formNotes,
      };
      await fetch(`${API}/api/repair-orders`, { method: 'POST', headers, body: JSON.stringify(body) });
      setModalOpen(false);
      resetForm();
      loadOrders();
    } catch { /* */ } finally { setSaving(false); }
  };

  const resetForm = () => {
    setFormContactId(''); setFormUnitId('');
    setFormUnitInfo({ vin: '', year: '', make: '', modelName: '', mileage: '' });
    setFormAdvisor(''); setFormServices([{ ...emptyLine }]); setFormNotes('');
  };

  const updateServiceLine = (idx: number, field: keyof ServiceLine, value: string | number) => {
    setFormServices(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString() : '—';

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
      {/* Alert banner */}
      {alertBanner && (
        <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 8, padding: '12px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={18} color="#d97706" />
            <span style={{ fontWeight: 600, color: '#92400e' }}>Sales alert sent!</span>
            <span style={{ color: '#78350f' }}>{alertBanner.message}</span>
          </div>
          <button onClick={() => setAlertBanner(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={16} /></button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Repair Orders</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>Service write-ups and check-ins for RV &amp; powersports units</p>
        </div>
        <button onClick={() => { resetForm(); setModalOpen(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>
          <Plus size={18} /> New RO
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <Filter size={16} color="#6b7280" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14 }}>
          <option value="">All Statuses</option>
          {Object.entries(statusConfig).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 48 }}><Loader2 size={24} className="animate-spin" /></div>
      ) : orders.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#9ca3af' }}>
          <Wrench size={40} style={{ margin: '0 auto 12px' }} />
          <p>No repair orders found.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                {['RO #', 'Customer', 'Unit', 'Advisor', 'Status', 'Write-Up Date', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((ro: any) => {
                const st = statusConfig[ro.status] || statusConfig.open;
                const highlighted = alertedIds.has(ro.id);
                const unit = ro.unitYear
                  ? `${ro.unitYear} ${ro.unitMake} ${ro.unitModelName}`
                  : ro.customerUnitInfo
                    ? `${ro.customerUnitInfo.year || ''} ${ro.customerUnitInfo.make || ''} ${ro.customerUnitInfo.modelName || ''}`.trim()
                    : '—';
                return (
                  <tr key={ro.id} style={{ borderBottom: '1px solid #f3f4f6', borderLeft: highlighted ? '3px solid #f59e0b' : '3px solid transparent' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600 }}>{ro.roNumber || ro.id}</td>
                    <td style={{ padding: '10px 12px' }}>{ro.customerName || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>{unit}</td>
                    <td style={{ padding: '10px 12px' }}>{ro.advisor || '—'}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ background: st.bg, color: st.text, padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>{st.label}</span>
                    </td>
                    <td style={{ padding: '10px 12px' }}>{formatDate(ro.writeUpDate || ro.createdAt)}</td>
                    <td style={{ padding: '10px 12px' }}>
                      {ro.status === 'open' && (
                        <button onClick={() => handleCheckIn(ro.id)} disabled={checkingIn === ro.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: checkingIn === ro.id ? 0.6 : 1 }}>
                          {checkingIn === ro.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Check In
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 16, marginTop: 20 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', opacity: page <= 1 ? 0.4 : 1 }}><ChevronLeft size={16} /></button>
          <span style={{ fontSize: 14, color: '#6b7280' }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '6px 10px', cursor: 'pointer', opacity: page >= totalPages ? 0.4 : 1 }}><ChevronRight size={16} /></button>
        </div>
      )}

      {/* New RO Modal */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }} onClick={() => setModalOpen(false)}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: '100%', maxWidth: 640, maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>New Repair Order</h2>
              <button onClick={() => setModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>

            {/* Customer */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>Customer</label>
            <select value={formContactId} onChange={e => setFormContactId(e.target.value)} style={inputStyle}>
              <option value="">Select customer...</option>
              {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>

            {/* Unit from inventory */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 14 }}>Unit (from inventory)</label>
            <select value={formUnitId} onChange={e => setFormUnitId(e.target.value)} style={inputStyle}>
              <option value="">None — enter walk-in unit manually below</option>
              {units.map((u: any) => <option key={u.id} value={u.id}>{u.year} {u.make} {u.modelName} — {u.stockNumber || u.vin}</option>)}
            </select>

            {/* Manual walk-in unit info */}
            {!formUnitId && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 13, fontWeight: 600, color: '#6b7280' }}>Or enter walk-in unit info manually</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 6 }}>
                  <input placeholder="VIN / HIN" value={formUnitInfo.vin} onChange={e => setFormUnitInfo(p => ({ ...p, vin: e.target.value }))} style={inputStyle} />
                  <input placeholder="Year" value={formUnitInfo.year} onChange={e => setFormUnitInfo(p => ({ ...p, year: e.target.value }))} style={inputStyle} />
                  <input placeholder="Make" value={formUnitInfo.make} onChange={e => setFormUnitInfo(p => ({ ...p, make: e.target.value }))} style={inputStyle} />
                  <input placeholder="Model" value={formUnitInfo.modelName} onChange={e => setFormUnitInfo(p => ({ ...p, modelName: e.target.value }))} style={inputStyle} />
                  <input placeholder="Mileage / Hours" value={formUnitInfo.mileage} onChange={e => setFormUnitInfo(p => ({ ...p, mileage: e.target.value }))} style={inputStyle} />
                </div>
              </div>
            )}

            {/* Advisor */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 14 }}>Service Advisor</label>
            <input value={formAdvisor} onChange={e => setFormAdvisor(e.target.value)} placeholder="Advisor name" style={inputStyle} />

            {/* Service lines */}
            <div style={{ marginTop: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Services</label>
              {formServices.map((s, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', gap: 6, marginTop: 6, alignItems: 'center' }}>
                  <input placeholder="Description" value={s.description} onChange={e => updateServiceLine(i, 'description', e.target.value)} style={inputStyle} />
                  <input type="number" placeholder="Hrs" value={s.laborHours || ''} onChange={e => updateServiceLine(i, 'laborHours', Number(e.target.value))} style={inputStyle} />
                  <input type="number" placeholder="Parts $" value={s.partsCost || ''} onChange={e => updateServiceLine(i, 'partsCost', Number(e.target.value))} style={inputStyle} />
                  <input type="number" placeholder="Labor $" value={s.laborCost || ''} onChange={e => updateServiceLine(i, 'laborCost', Number(e.target.value))} style={inputStyle} />
                  {formServices.length > 1 && (
                    <button onClick={() => setFormServices(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={16} /></button>
                  )}
                </div>
              ))}
              <button onClick={() => setFormServices(prev => [...prev, { ...emptyLine }])} style={{ marginTop: 8, fontSize: 13, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>+ Add line item</button>
            </div>

            {/* Estimated total */}
            <div style={{ marginTop: 12, fontSize: 14, fontWeight: 600, color: '#374151' }}>Estimated Total: ${estimatedTotal.toFixed(2)}</div>

            {/* Notes */}
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, marginTop: 14 }}>Notes</label>
            <textarea value={formNotes} onChange={e => setFormNotes(e.target.value)} rows={3} placeholder="Additional notes..." style={{ ...inputStyle, resize: 'vertical' }} />

            {/* Submit */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
              <button onClick={() => setModalOpen(false)} style={{ padding: '10px 18px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer' }}>Cancel</button>
              <button onClick={handleCreate} disabled={saving || !formContactId} style={{ padding: '10px 18px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer', opacity: saving || !formContactId ? 0.6 : 1 }}>
                {saving ? 'Creating...' : 'Create RO'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  fontSize: 14,
  boxSizing: 'border-box',
};
