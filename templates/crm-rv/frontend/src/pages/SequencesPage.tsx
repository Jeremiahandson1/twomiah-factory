import { useState, useEffect, useCallback } from 'react';
import {
  Send, Plus, Loader2, X, Trash2, Edit, Users, ChevronUp, ChevronDown,
  Play, Pause, Mail, MessageSquare
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const PRIMARY = '{{PRIMARY_COLOR}}';

type Channel = 'sms' | 'email';
type Trigger = 'manual' | 'new_lead' | 'after_sale' | 'after_service';

const TRIGGERS: { value: Trigger; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'new_lead', label: 'New Lead' },
  { value: 'after_sale', label: 'After Sale' },
  { value: 'after_service', label: 'After Service' },
];

const triggerLabel = (t: string) => TRIGGERS.find(x => x.value === t)?.label || t;

interface Step {
  delayHours: number;
  channel: Channel;
  subject: string;
  body: string;
}

interface Sequence {
  id: string;
  name: string;
  description: string;
  trigger: Trigger;
  active: boolean;
  stepCount: number;
  activeEnrollments: number;
}

interface SequenceDetail extends Sequence {
  steps?: Step[];
}

interface Enrollment {
  enrollment: {
    id: string;
    status: string;
    currentStep: number;
    nextRunAt: string | null;
    enrolledAt: string;
  };
  contactName: string;
}

interface Contact {
  id: string;
  name: string;
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

export default function SequencesPage() {
  const { token } = useAuth();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SequenceDetail | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [enrollmentsFor, setEnrollmentsFor] = useState<Sequence | null>(null);

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/sequences', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      setSequences(data.sequences || []);
    } catch (err) {
      console.error('Failed to load sequences:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setShowModal(true); };

  const openEdit = async (seq: Sequence) => {
    // Fetch full detail (with steps) before opening the editor.
    try {
      const res = await fetch(`/api/sequences/${seq.id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        setEditing(data.sequence || { ...seq, steps: [] });
      } else {
        setEditing({ ...seq, steps: [] });
      }
    } catch {
      setEditing({ ...seq, steps: [] });
    }
    setShowModal(true);
  };

  const toggleActive = async (seq: Sequence) => {
    try {
      const res = await fetch(`/api/sequences/${seq.id}`, {
        method: 'PUT', headers, body: JSON.stringify({ active: !seq.active }),
      });
      if (!res.ok) throw new Error('Failed');
      load();
    } catch (err) {
      console.error('Failed to toggle sequence:', err);
      alert('Failed to update sequence.');
    }
  };

  const handleDelete = async (seq: Sequence) => {
    if (!confirm(`Delete sequence "${seq.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/sequences/${seq.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed');
      load();
    } catch (err) {
      console.error('Failed to delete sequence:', err);
      alert('Failed to delete sequence.');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#111827', margin: 0 }}>Sequences</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>Automated follow-up cadences</p>
        </div>
        <button
          onClick={openCreate}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
        >
          <Plus size={16} /> New Sequence
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
        </div>
      ) : sequences.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#6b7280' }}>
          <Send size={40} style={{ marginBottom: 12, opacity: 0.4 }} />
          <p style={{ fontSize: 16 }}>No sequences yet</p>
        </div>
      ) : (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Trigger</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Steps</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Enrolled</th>
                <th style={{ ...thStyle, textAlign: 'center' }}>Active</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sequences.map((s, i) => (
                <tr key={s.id || i} style={{ borderTop: '1px solid #f3f4f6' }}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600, color: '#111827' }}>{s.name}</div>
                    {s.description && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>{s.description}</div>}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#f3f4f6', color: '#374151' }}>{triggerLabel(s.trigger)}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{s.stepCount ?? 0}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>{s.activeEnrollments ?? 0}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    <button
                      onClick={() => toggleActive(s)}
                      title={s.active ? 'Active — click to pause' : 'Paused — click to activate'}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 14, fontSize: 12, fontWeight: 600,
                        border: 'none', cursor: 'pointer',
                        background: s.active ? '#dcfce7' : '#f3f4f6', color: s.active ? '#166534' : '#6b7280',
                      }}
                    >
                      {s.active ? <Play size={12} /> : <Pause size={12} />} {s.active ? 'Active' : 'Paused'}
                    </button>
                  </td>
                  <td style={{ ...tdStyle, textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      <IconBtn title="Enrollments" onClick={() => setEnrollmentsFor(s)}><Users size={16} /></IconBtn>
                      <IconBtn title="Edit" onClick={() => openEdit(s)}><Edit size={16} /></IconBtn>
                      <IconBtn title="Delete" onClick={() => handleDelete(s)} danger><Trash2 size={16} /></IconBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <SequenceModal
          headers={headers}
          existing={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
      {enrollmentsFor && (
        <EnrollmentsModal
          sequence={enrollmentsFor}
          token={token}
          headers={headers}
          onClose={() => setEnrollmentsFor(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 6, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', color: danger ? '#dc2626' : '#6b7280' }}>
      {children}
    </button>
  );
}

// --- Create / Edit modal ------------------------------------------------------
const blankStep = (): Step => ({ delayHours: 24, channel: 'sms', subject: '', body: '' });

function SequenceModal({ headers, existing, onClose, onSaved }: { headers: Record<string, string>; existing: SequenceDetail | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(existing?.name || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [trigger, setTrigger] = useState<Trigger>(existing?.trigger || 'manual');
  const [active, setActive] = useState(existing?.active ?? true);
  const [steps, setSteps] = useState<Step[]>(
    existing?.steps && existing.steps.length > 0
      ? existing.steps.map(s => ({ delayHours: s.delayHours ?? 0, channel: s.channel || 'sms', subject: s.subject || '', body: s.body || '' }))
      : [blankStep()]
  );
  const [saving, setSaving] = useState(false);

  const setStep = (idx: number, patch: Partial<Step>) =>
    setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  const addStep = () => setSteps(prev => [...prev, blankStep()]);
  const removeStep = (idx: number) => setSteps(prev => prev.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    setSteps(prev => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) { alert('Name is required.'); return; }
    setSaving(true);
    try {
      const body = {
        name: name.trim(),
        description,
        trigger,
        active,
        steps: steps.map(s => ({
          delayHours: Number(s.delayHours) || 0,
          channel: s.channel,
          subject: s.channel === 'email' ? s.subject : '',
          body: s.body,
        })),
      };
      const url = existing ? `/api/sequences/${existing.id}` : '/api/sequences';
      const method = existing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('Save failed');
      onSaved();
    } catch (err) {
      console.error('Failed to save sequence:', err);
      alert('Failed to save sequence.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={overlayWrap}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ ...modalBox, maxWidth: 720 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{existing ? 'Edit Sequence' : 'New Sequence'}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={20} color="#6b7280" /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div>
            <label style={labelStyle}>Name <span style={{ color: '#dc2626' }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Trigger</label>
            <select value={trigger} onChange={e => setTrigger(e.target.value as Trigger)} style={{ ...inputStyle, background: '#fff' }}>
              {TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20, fontSize: 14, color: '#374151', cursor: 'pointer' }}>
          <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
          Active
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5, margin: 0 }}>Steps</h3>
          <button onClick={addStep} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
            <Plus size={14} /> Add Step
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
          {steps.map((step, idx) => (
            <div key={idx} style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, background: '#f9fafb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: '#374151' }}>
                  {step.channel === 'email' ? <Mail size={15} /> : <MessageSquare size={15} />} Step {idx + 1}
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <IconBtn title="Move up" onClick={() => move(idx, -1)}><ChevronUp size={15} /></IconBtn>
                  <IconBtn title="Move down" onClick={() => move(idx, 1)}><ChevronDown size={15} /></IconBtn>
                  {steps.length > 1 && <IconBtn title="Remove step" onClick={() => removeStep(idx)} danger><Trash2 size={15} /></IconBtn>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>Delay (hours after previous step)</label>
                  <input type="number" min={0} value={step.delayHours} onChange={e => setStep(idx, { delayHours: e.target.value === '' ? 0 : Number(e.target.value) })} style={{ ...inputStyle, background: '#fff' }} />
                </div>
                <div>
                  <label style={labelStyle}>Channel</label>
                  <select value={step.channel} onChange={e => setStep(idx, { channel: e.target.value as Channel })} style={{ ...inputStyle, background: '#fff' }}>
                    <option value="sms">SMS</option>
                    <option value="email">Email</option>
                  </select>
                </div>
              </div>
              {step.channel === 'email' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>Subject</label>
                  <input value={step.subject} onChange={e => setStep(idx, { subject: e.target.value })} style={{ ...inputStyle, background: '#fff' }} />
                </div>
              )}
              <div>
                <label style={labelStyle}>Body</label>
                <textarea value={step.body} onChange={e => setStep(idx, { body: e.target.value })} rows={3} style={{ ...inputStyle, background: '#fff', resize: 'vertical' }} />
                <p style={{ margin: '6px 0 0', fontSize: 11, color: '#9ca3af' }}>Tokens: {'{{firstName}}'}, {'{{name}}'}, {'{{companyName}}'}</p>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={cancelBtn}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} style={{ ...primaryBtn, cursor: saving || !name.trim() ? 'default' : 'pointer', opacity: saving || !name.trim() ? 0.6 : 1 }}>
            {saving ? 'Saving...' : 'Save Sequence'}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Enrollments modal --------------------------------------------------------
function EnrollmentsModal({ sequence, token, headers, onClose, onChanged }: { sequence: Sequence; token: string; headers: Record<string, string>; onClose: () => void; onChanged: () => void }) {
  const [loading, setLoading] = useState(true);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pickerValue, setPickerValue] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  const loadEnrollments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/enrollments`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setEnrollments(data.enrollments || []);
    } catch (err) {
      console.error('Failed to load enrollments:', err);
    } finally {
      setLoading(false);
    }
  }, [sequence.id, token]);

  useEffect(() => { loadEnrollments(); }, [loadEnrollments]);

  // Load a contact list for the picker. Falls back to a manual id input if empty.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/contacts?limit=200', { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const list: Contact[] = (data.data || data.contacts || []).map((c: { id: string; name?: string }) => ({ id: c.id, name: c.name || c.id }));
        if (!cancelled) setContacts(list);
      } catch {
        /* picker falls back to manual id entry */
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const handleEnroll = async () => {
    const contactId = pickerValue.trim();
    if (!contactId) return;
    setEnrolling(true);
    try {
      const res = await fetch(`/api/sequences/${sequence.id}/enroll`, {
        method: 'POST', headers, body: JSON.stringify({ contactId }),
      });
      if (!res.ok) throw new Error('Failed');
      setPickerValue('');
      loadEnrollments();
      onChanged();
    } catch (err) {
      console.error('Failed to enroll contact:', err);
      alert('Failed to enroll contact.');
    } finally {
      setEnrolling(false);
    }
  };

  const handleCancel = async (enrollmentId: string) => {
    try {
      const res = await fetch(`/api/sequences/enrollments/${enrollmentId}/cancel`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed');
      loadEnrollments();
      onChanged();
    } catch (err) {
      console.error('Failed to cancel enrollment:', err);
      alert('Failed to cancel enrollment.');
    }
  };

  return (
    <div style={overlayWrap}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)' }} onClick={onClose} />
      <div style={{ ...modalBox, maxWidth: 620 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Enrollments</h2>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280' }}>{sequence.name}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}><X size={20} color="#6b7280" /></button>
        </div>

        {/* Enroll a contact */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Enroll a contact</label>
            {contacts.length > 0 ? (
              <select value={pickerValue} onChange={e => setPickerValue(e.target.value)} style={{ ...inputStyle, background: '#fff' }}>
                <option value="">Select a contact...</option>
                {contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            ) : (
              <input value={pickerValue} onChange={e => setPickerValue(e.target.value)} placeholder="Contact ID" style={inputStyle} />
            )}
          </div>
          <button onClick={handleEnroll} disabled={enrolling || !pickerValue.trim()} style={{ ...primaryBtn, height: 38, padding: '0 18px', cursor: enrolling || !pickerValue.trim() ? 'default' : 'pointer', opacity: enrolling || !pickerValue.trim() ? 0.6 : 1 }}>
            {enrolling ? 'Enrolling...' : 'Enroll'}
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: '#9ca3af' }} />
          </div>
        ) : enrollments.length === 0 ? (
          <p style={{ textAlign: 'center', padding: 30, color: '#9ca3af', fontSize: 14, margin: 0 }}>No active enrollments.</p>
        ) : (
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={thStyle}>Contact</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Step</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Next Run</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((e, i) => (
                  <tr key={e.enrollment.id || i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={tdStyle}>{e.contactName || '--'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{(e.enrollment.currentStep ?? 0) + 1}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: '#f3f4f6', color: '#374151' }}>{e.enrollment.status}</span>
                    </td>
                    <td style={{ ...tdStyle, fontSize: 13, color: '#6b7280' }}>{fmtDate(e.enrollment.nextRunAt)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {e.enrollment.status === 'active' && (
                        <button onClick={() => handleCancel(e.enrollment.id)} style={{ padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '10px 16px', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle: React.CSSProperties = { padding: '12px 16px', fontSize: 14, color: '#111827' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };
const overlayWrap: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' };
const modalBox: React.CSSProperties = { position: 'relative', background: '#fff', borderRadius: 12, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' };
const cancelBtn: React.CSSProperties = { padding: '10px 20px', border: '1px solid #d1d5db', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };
const primaryBtn: React.CSSProperties = { padding: '10px 24px', background: PRIMARY, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14 };
