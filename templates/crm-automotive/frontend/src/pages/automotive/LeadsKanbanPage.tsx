import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import {
  Plus, Upload, X, ChevronDown, Clock, User, Car, Phone, Mail,
  Calendar, FileText, RefreshCw, ArrowRight, Loader2
} from 'lucide-react';

interface SalesLead {
  id: string;
  contactId?: string;
  contactName: string;
  contactPhone?: string;
  contactEmail?: string;
  vehicleId?: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  source: string;
  stage: string;
  salespersonId?: string;
  salespersonName?: string;
  notes?: string;
  tradeInInfo?: string;
  followUpDate?: string;
  createdAt: string;
}

interface Contact { id: string; name: string; phone?: string; email?: string; }
interface Vehicle { id: string; year: number; make: string; model: string; trim?: string; price?: number; }
interface TeamMember { id: string; name: string; role?: string; }

const STAGES = ['New', 'Contacted', 'Demo', 'Desking', 'Closed Won', 'Closed Lost'] as const;

const STAGE_COLORS: Record<string, { bg: string; border: string; header: string }> = {
  'New':         { bg: '#f0f4ff', border: '#bfcfff', header: '#3b5bdb' },
  'Contacted':   { bg: '#fff8e1', border: '#ffe082', header: '#f9a825' },
  'Demo':        { bg: '#e8f5e9', border: '#a5d6a7', header: '#2e7d32' },
  'Desking':     { bg: '#fff3e0', border: '#ffcc80', header: '#e65100' },
  'Closed Won':  { bg: '#e0f2f1', border: '#80cbc4', header: '#00695c' },
  'Closed Lost': { bg: '#fafafa', border: '#e0e0e0', header: '#757575' },
};

const SOURCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  adf_xml:  { bg: '#ede7f6', text: '#5e35b1', label: 'ADF/XML' },
  walk_in:  { bg: '#e8f5e9', text: '#2e7d32', label: 'Walk-In' },
  web:      { bg: '#e3f2fd', text: '#1565c0', label: 'Web' },
  phone:    { bg: '#fff3e0', text: '#e65100', label: 'Phone' },
  referral: { bg: '#e0f2f1', text: '#00695c', label: 'Referral' },
};

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export default function LeadsKanbanPage() {
  const { token } = useAuth();
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [showNewModal, setShowNewModal] = useState(false);
  const [showAdfModal, setShowAdfModal] = useState(false);
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [stageDropdown, setStageDropdown] = useState<string | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sales-leads', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Request failed');
      const json = await res.json();
      setLeads(json.data || json || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  const fetchDropdowns = useCallback(async () => {
    const [c, v, t] = await Promise.all([
      fetch('/api/contacts?type=lead', { headers: { Authorization: `Bearer ${token}` } }).then(r => { if (!r.ok) throw new Error('Request failed'); return r.json(); }).catch(() => []),
      fetch('/api/vehicles?status=available', { headers: { Authorization: `Bearer ${token}` } }).then(r => { if (!r.ok) throw new Error('Request failed'); return r.json(); }).catch(() => []),
      fetch('/api/team', { headers: { Authorization: `Bearer ${token}` } }).then(r => { if (!r.ok) throw new Error('Request failed'); return r.json(); }).catch(() => []),
    ]);
    setContacts(c.data || c || []);
    setVehicles(v.data || v || []);
    setTeam(t.data || t || []);
  }, [token]);

  useEffect(() => { fetchLeads(); fetchDropdowns(); }, [fetchLeads, fetchDropdowns]);

  const updateStage = async (id: string, stage: string) => {
    try {
      await fetch(`/api/sales-leads/${id}`, { method: 'PUT', headers, body: JSON.stringify({ stage }) });
      setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l));
      setStageDropdown(null);
    } catch (e) {
      console.error('updateStage failed:', e);
    }
  };

  const stageCounts = STAGES.reduce((acc, s) => {
    acc[s] = leads.filter(l => l.stage === s).length;
    return acc;
  }, {} as Record<string, number>);

  // --- Stats Bar ---
  const statsBar = (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      {STAGES.map(s => {
        const colors = STAGE_COLORS[s];
        return (
          <div key={s} style={{ flex: 1, minWidth: 120, padding: '10px 14px', borderRadius: 8, background: colors.bg, border: `1px solid ${colors.border}` }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 2 }}>{s}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: colors.header }}>{stageCounts[s] || 0}</div>
          </div>
        );
      })}
    </div>
  );

  // --- Lead Card ---
  const renderCard = (lead: SalesLead) => {
    const src = SOURCE_STYLES[lead.source] || { bg: '#f5f5f5', text: '#616161', label: lead.source };
    const days = daysSince(lead.createdAt);
    const isExpanded = expandedLead === lead.id;
    const vehicle = [lead.vehicleYear, lead.vehicleMake, lead.vehicleModel].filter(Boolean).join(' ');

    return (
      <div key={lead.id} style={{ background: '#fff', borderRadius: 8, padding: 12, marginBottom: 8, boxShadow: '0 1px 3px rgba(0,0,0,0.08)', cursor: 'pointer', border: isExpanded ? '2px solid #3b5bdb' : '1px solid #e8e8e8' }}
        onClick={() => setExpandedLead(isExpanded ? null : lead.id)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 6 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{lead.contactName}</div>
          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: src.bg, color: src.text, fontWeight: 600, whiteSpace: 'nowrap' }}>{src.label}</span>
        </div>
        {vehicle && <div style={{ fontSize: 12, color: '#444', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Car size={12} /> {vehicle}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: '#888' }}>
          {lead.salespersonName && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><User size={11} /> {lead.salespersonName}</span>}
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={11} /> {days}d</span>
        </div>

        {isExpanded && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #eee', fontSize: 13 }} onClick={e => e.stopPropagation()}>
            {lead.contactPhone && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><Phone size={12} /> {lead.contactPhone}</div>}
            {lead.contactEmail && <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><Mail size={12} /> {lead.contactEmail}</div>}
            {lead.notes && <div style={{ margin: '6px 0', padding: 8, background: '#f9f9f9', borderRadius: 6, fontSize: 12 }}><FileText size={12} style={{ display: 'inline', marginRight: 4 }} />{lead.notes}</div>}
            {lead.tradeInInfo && <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>Trade-in: {lead.tradeInInfo}</div>}
            {lead.followUpDate && <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#1565c0', marginBottom: 6 }}><Calendar size={12} /> Follow-up: {new Date(lead.followUpDate).toLocaleDateString()}</div>}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
              {STAGES.filter(s => s !== lead.stage).map(s => (
                <button key={s} onClick={() => updateStage(lead.id, s)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, border: `1px solid ${STAGE_COLORS[s].border}`, background: STAGE_COLORS[s].bg, color: STAGE_COLORS[s].header, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                  <ArrowRight size={10} /> {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {!isExpanded && (
          <div style={{ position: 'relative', marginTop: 6 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setStageDropdown(stageDropdown === lead.id ? null : lead.id)}
              style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid #ddd', background: '#fafafa', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
              Move <ChevronDown size={10} />
            </button>
            {stageDropdown === lead.id && (
              <div style={{ position: 'absolute', top: 24, left: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 10, minWidth: 130 }}>
                {STAGES.filter(s => s !== lead.stage).map(s => (
                  <div key={s} onClick={() => updateStage(lead.id, s)}
                    style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: STAGE_COLORS[s].header, borderBottom: '1px solid #f0f0f0' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f5f5f5')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#fff')}>
                    {s}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // --- New Lead Modal ---
  const NewLeadModal = () => {
    const [form, setForm] = useState({ contactId: '', vehicleId: '', source: 'walk_in', salespersonId: '', notes: '' });
    const [saving, setSaving] = useState(false);
    const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

    const submit = async () => {
      setSaving(true);
      await fetch('/api/sales-leads', { method: 'POST', headers, body: JSON.stringify(form) });
      setSaving(false);
      setShowNewModal(false);
      fetchLeads();
    };

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowNewModal(false)}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 440, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>New Lead</h3>
            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowNewModal(false)} />
          </div>
          <label style={labelStyle}>Contact</label>
          <select style={inputStyle} value={form.contactId} onChange={e => set('contactId', e.target.value)}>
            <option value="">Select contact...</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <label style={labelStyle}>Vehicle of Interest</label>
          <select style={inputStyle} value={form.vehicleId} onChange={e => set('vehicleId', e.target.value)}>
            <option value="">Select vehicle...</option>
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.year} {v.make} {v.model} {v.trim || ''}</option>)}
          </select>
          <label style={labelStyle}>Source</label>
          <select style={inputStyle} value={form.source} onChange={e => set('source', e.target.value)}>
            {Object.entries(SOURCE_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <label style={labelStyle}>Assign Salesperson</label>
          <select style={inputStyle} value={form.salespersonId} onChange={e => set('salespersonId', e.target.value)}>
            <option value="">Unassigned</option>
            {team.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <label style={labelStyle}>Notes</label>
          <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Additional notes..." />
          <button onClick={submit} disabled={saving || !form.contactId}
            style={{ marginTop: 12, width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: (!form.contactId) ? '#ccc' : '#3b5bdb', color: '#fff', fontWeight: 600, fontSize: 14, cursor: (!form.contactId) ? 'default' : 'pointer' }}>
            {saving ? 'Saving...' : 'Create Lead'}
          </button>
        </div>
      </div>
    );
  };

  // --- ADF Import Modal ---
  const AdfModal = () => {
    const [xml, setXml] = useState('');
    const [importing, setImporting] = useState(false);
    const [result, setResult] = useState('');

    const submit = async () => {
      setImporting(true);
      try {
        const res = await fetch('/api/sales-leads/import-adf', { method: 'POST', headers, body: JSON.stringify({ xml }) });
        const json = await res.json();
        setResult(res.ok ? `Imported successfully (${json.count || 1} lead${json.count > 1 ? 's' : ''})` : `Error: ${json.error || 'Import failed'}`);
        if (res.ok) fetchLeads();
      } catch { setResult('Network error'); }
      setImporting(false);
    };

    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setShowAdfModal(false)}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 500, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 18 }}>Import ADF/XML</h3>
            <X size={20} style={{ cursor: 'pointer' }} onClick={() => setShowAdfModal(false)} />
          </div>
          <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>Paste your ADF/XML lead data below. Supports standard Auto-Lead Data Format.</p>
          <textarea style={{ ...inputStyle, minHeight: 180, fontFamily: 'monospace', fontSize: 12 }} value={xml} onChange={e => setXml(e.target.value)} placeholder={'<?xml version="1.0"?>\n<?adf version="1.0"?>\n<adf>...</adf>'} />
          {result && <div style={{ marginTop: 8, padding: 8, borderRadius: 6, background: result.startsWith('Error') ? '#ffeaea' : '#e8f5e9', color: result.startsWith('Error') ? '#c62828' : '#2e7d32', fontSize: 13 }}>{result}</div>}
          <button onClick={submit} disabled={importing || !xml.trim()}
            style={{ marginTop: 12, width: '100%', padding: '10px 0', borderRadius: 8, border: 'none', background: !xml.trim() ? '#ccc' : '#5e35b1', color: '#fff', fontWeight: 600, fontSize: 14, cursor: !xml.trim() ? 'default' : 'pointer' }}>
            {importing ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>Sales Pipeline</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => fetchLeads()} style={iconBtnStyle} title="Refresh"><RefreshCw size={16} /></button>
          <button onClick={() => setShowAdfModal(true)} style={{ ...btnStyle, background: '#5e35b1' }}><Upload size={14} /> Import ADF</button>
          <button onClick={() => setShowNewModal(true)} style={{ ...btnStyle, background: '#3b5bdb' }}><Plus size={14} /> New Lead</button>
        </div>
      </div>

      {statsBar}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#888' }}><Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} /><style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style></div>
      ) : (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
          {STAGES.map(stage => {
            const colors = STAGE_COLORS[stage];
            const stageLeads = leads.filter(l => l.stage === stage);
            return (
              <div key={stage} style={{ minWidth: 260, maxWidth: 300, flex: 1, background: colors.bg, borderRadius: 10, border: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '10px 14px', borderBottom: `2px solid ${colors.header}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: colors.header }}>{stage}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: colors.header, background: '#fff', borderRadius: 10, padding: '1px 8px' }}>{stageLeads.length}</span>
                </div>
                <div style={{ padding: 8, flex: 1, overflowY: 'auto', maxHeight: 'calc(100vh - 280px)' }}>
                  {stageLeads.length === 0 && <div style={{ textAlign: 'center', color: '#aaa', fontSize: 12, padding: 20 }}>No leads</div>}
                  {stageLeads.map(renderCard)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showNewModal && <NewLeadModal />}
      {showAdfModal && <AdfModal />}
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#444', marginBottom: 4, marginTop: 12 };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' };
const btnStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' };
const iconBtnStyle: React.CSSProperties = { padding: 8, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center' };
