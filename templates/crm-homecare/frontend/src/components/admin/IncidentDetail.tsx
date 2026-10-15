// src/components/admin/IncidentDetail.tsx — one incident's case file.
// Opened from IncidentReporting. Everything here reads/writes /api/incidents/:id/* (routes/incidents.ts).
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from '../Toast';
import { confirm } from '../ConfirmModal';
import { formatDate } from '../../utils/date';
import { useAuth } from '../../contexts/AuthContext';
import { apiCall } from '../../config';
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, incidentLabel,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_ACCEPT, incidentsApi, incidentsBlob, saveBlob, localToday,
  STATUS_CHIP, FIELD, LABEL, CARD, H3, MUTED, BTN_PRIMARY, BTN_SECONDARY, BTN_DANGER,
} from '../../utils/incidentOptions';

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "09:00:00" → "9:00 AM" (schedule times are plain clock times)
const clock = (t?: string | null) => {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const fileSize = (n?: number | null) => (n == null ? '' : n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);
const dateTime = (v?: string | null) => {
  if (!v) return '';
  const d = new Date(v);
  return isNaN(d.getTime()) ? '' : d.toLocaleString();
};

const toForm = (i: any) => ({
  clientId: i.client_id || '',
  caregiverId: i.caregiver_id || '',
  incidentType: i.incident_type || 'other',
  severity: i.severity || 'moderate',
  incidentDate: i.incident_date_ymd || '',
  incidentTime: i.incident_time_hhmm || '',
  description: i.description || '',
  witnesses: i.witnesses || '',
  injuriesOrDamage: i.injuries_or_damage || '',
  actionsTaken: i.action_taken || '',
  followUpRequired: !!i.follow_up_required,
  followUpNotes: i.follow_up_notes || '',
  reportedBy: i.reported_by || '',
  reportedDate: i.reported_date_ymd || '',
  reporterContactName: i.reporter_contact_name || '',
  reporterPhone: i.reporter_phone || '',
  reporterEmail: i.reporter_email || '',
  responseDueDate: i.response_due_date_ymd || '',
  responseSentDate: i.response_sent_date_ymd || '',
  status: i.status || 'open',
  disposition: i.disposition || '',
  findings: i.findings || '',
  payerResponseNotes: i.payer_response_notes || '',
  mandatoryReportStatus: i.mandatory_report_status || '',
  mandatoryReportDetails: i.mandatory_report_details || '',
  closedDate: i.closed_date_ymd || '',
});

const Field = ({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={className}>
    <label className={LABEL}>{label}</label>
    {children}
  </div>
);

// Draw-to-sign dialog: the caregiver draws, types their name, and signs. A refusal from the server
// stays on the dialog so nothing is lost.
const SignatureDialog = ({ open, documentName, onClose, onSign }: {
  open: boolean; documentName: string; onClose: () => void; onSign: (dataUri: string, typedName: string) => Promise<void>;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDirty(false); setTypedName(''); setError('');
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
  }, [open]);

  if (!open) return null;
  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e: React.PointerEvent) => {
    e.preventDefault(); drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e);
    ctx.beginPath(); ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext('2d')!; const { x, y } = pos(e);
    ctx.lineTo(x, y); ctx.stroke(); setDirty(true);
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const canvas = canvasRef.current!; canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height); setDirty(false);
  };
  const sign = async () => {
    setError('');
    if (!dirty) { setError('Draw the signature first'); return; }
    if (!typedName.trim()) { setError('Type the full name'); return; }
    setBusy(true);
    try { await onSign(canvasRef.current!.toDataURL('image/png'), typedName.trim()); }
    catch (e: any) { setError(e.message || 'Signing failed'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Sign: ${documentName}`}>
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-2xl dark:bg-slate-900">
        <h3 className={H3}>{documentName}</h3>
        <p className={`${MUTED} mb-3`}>Sign in the box below. Your IP address and timestamp will be recorded.</p>
        {/* The pad stays white in both themes so the signature (dark ink) is what gets saved. */}
        <canvas
          ref={canvasRef}
          onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end}
          className="h-40 w-full cursor-crosshair touch-none rounded-lg border border-dashed border-gray-400 bg-white dark:border-slate-500 dark:bg-white"
        />
        <div className="mt-1 flex justify-end">
          <button type="button" className="text-sm font-semibold text-teal-800 hover:underline dark:text-teal-300" onClick={clear}>Clear</button>
        </div>
        <Field label="Type your full name" className="mt-2">
          <input className={FIELD} value={typedName} onChange={(e) => setTypedName(e.target.value)} />
        </Field>
        {error && <p className="mt-2 text-sm font-semibold text-red-700 dark:text-red-300">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={BTN_PRIMARY} onClick={sign} disabled={busy}>{busy ? 'Signing…' : 'Sign'}</button>
        </div>
      </div>
    </div>
  );
};

export default function IncidentDetail({ incidentId, onBack }: { incidentId: string; onBack: () => void }) {
  const { token } = useAuth();
  const api = useCallback((path: string, options: RequestInit = {}) => incidentsApi(token)(path, options), [token]);
  const [loading, setLoading] = useState(true);
  const [incident, setIncident] = useState<any>(null);
  const [form, setForm] = useState<any>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [caregivers, setCaregivers] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [includeSchedule, setIncludeSchedule] = useState(false); // packet Exhibit A; off unless the payer asked for visit records
  const [noteForm, setNoteForm] = useState({ entryDate: localToday(), entryType: 'interview', summary: '' });
  const [uploadForm, setUploadForm] = useState({ category: 'payer_notice', description: '' });
  const [uploading, setUploading] = useState(false);
  const [removalForm, setRemovalForm] = useState({ fromDate: localToday(), postOpenShifts: true, coverageWeeks: 4 });
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [ackForm, setAckForm] = useState({ supervisorName: '', method: 'in_person' });
  const [sigOpen, setSigOpen] = useState(false);

  const loadCase = useCallback(async () => {
    try {
      const [inc, n, a, s] = await Promise.all([
        api(`/${incidentId}`), api(`/${incidentId}/notes`), api(`/${incidentId}/attachments`), api(`/${incidentId}/caregiver-schedule`),
      ]);
      setIncident(inc);
      setForm(toForm(inc));
      setNotes(Array.isArray(n) ? n : []);
      setAttachments(Array.isArray(a) ? a : []);
      setSchedule(s);
      if (s?.today) setRemovalForm((f) => (f.fromDate < s.today ? { ...f, fromDate: s.today } : f));
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [api, incidentId]);

  useEffect(() => { loadCase(); }, [loadCase]);
  useEffect(() => {
    Promise.all([api('/my-clients').catch(() => []), apiCall('/api/users/caregivers', { method: 'GET' }, token).catch(() => [])])
      .then(([c, cg]) => { setClients(Array.isArray(c) ? c : []); setCaregivers(Array.isArray(cg) ? cg : []); });
  }, [api, token]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const saveCase = async (overrides: Record<string, any> = {}) => {
    setSaving(true);
    try {
      await api(`/${incidentId}`, { method: 'PUT', body: JSON.stringify({ ...form, ...overrides }) });
      toast('Incident saved');
      await loadCase();
    } catch (e: any) {
      toast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (kind: 'report' | 'packet') => {
    setDownloading(kind);
    try {
      const path = kind === 'packet' ? `response-packet${includeSchedule ? '?includeSchedule=1' : ''}` : 'pdf';
      const blob = await incidentsBlob(token, `/${incidentId}/${path}`);
      saveBlob(blob, `${kind === 'packet' ? 'incident-response-packet' : 'incident-report'}-${incident.incident_number || incidentId}.pdf`);
      toast('PDF downloaded');
    } catch (e: any) {
      toast('Download failed: ' + e.message, 'error');
    } finally {
      setDownloading('');
    }
  };

  // ── Timeline ──
  const addNote = async () => {
    if (!noteForm.summary.trim()) { toast('Describe what happened', 'error'); return; }
    try {
      await api(`/${incidentId}/notes`, { method: 'POST', body: JSON.stringify(noteForm) });
      setNoteForm({ entryDate: localToday(), entryType: noteForm.entryType, summary: '' });
      setNotes(await api(`/${incidentId}/notes`));
    } catch (e: any) { toast(e.message, 'error'); }
  };
  const deleteNote = async (noteId: string) => {
    if (!(await confirm('Delete this investigation entry?', { danger: true }))) return;
    try {
      await api(`/${incidentId}/notes/${noteId}`, { method: 'DELETE' });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (e: any) { toast(e.message, 'error'); }
  };

  // ── Attachments ──
  const uploadFile = async (file?: File | null) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) { toast('File is too large (7 MB max)', 'error'); return; }
    setUploading(true);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
      });
      await api(`/${incidentId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ category: uploadForm.category, fileName: file.name, dataUri, description: uploadForm.description }),
      });
      setUploadForm((f) => ({ ...f, description: '' }));
      setAttachments(await api(`/${incidentId}/attachments`));
      toast('Attached');
    } catch (e: any) {
      toast('Upload failed: ' + e.message, 'error');
    } finally {
      setUploading(false);
    }
  };
  const viewAttachment = async (att: any) => {
    try { saveBlob(await incidentsBlob(token, `/${incidentId}/attachments/${att.id}`), att.file_name); }
    catch (e: any) { toast(e.message, 'error'); }
  };
  const deleteAttachment = async (att: any) => {
    if (!(await confirm(`Delete ${att.file_name}? This cannot be undone.`, { danger: true }))) return;
    try {
      await api(`/${incidentId}/attachments/${att.id}`, { method: 'DELETE' });
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    } catch (e: any) { toast(e.message, 'error'); }
  };

  // ── Caregiver schedule ──
  const removeCaregiver = async () => {
    const msg = `Remove ${incident.caregiver_name} from ${incident.client_name}'s schedule starting ${formatDate(removalForm.fromDate)}?\n\n`
      + 'Their visits with this client stop being scheduled from that date.'
      + (removalForm.postOpenShifts ? ` Visits for the next ${removalForm.coverageWeeks} weeks are posted as open shifts for coverage.` : ' No open shifts will be posted, so arrange coverage yourself.')
      + '\n\nYou can return them to the schedule later from this page.';
    if (!(await confirm(msg, { danger: true }))) return;
    setScheduleBusy(true);
    try {
      const r = await api(`/${incidentId}/remove-caregiver`, { method: 'POST', body: JSON.stringify(removalForm) });
      toast(r?.summary || 'Caregiver removed from this client');
      await loadCase();
    } catch (e: any) { toast(e.message, 'error'); } finally { setScheduleBusy(false); }
  };
  const returnCaregiver = async () => {
    if (!(await confirm(`Return ${incident.caregiver_name} to ${incident.client_name}'s schedule today? Unclaimed coverage shifts are cancelled. Visits a replacement already took stay with the replacement.`))) return;
    setScheduleBusy(true);
    try {
      const r = await api(`/${incidentId}/return-caregiver`, { method: 'POST', body: JSON.stringify({}) });
      toast(r?.summary || 'Caregiver returned to the schedule');
      await loadCase();
    } catch (e: any) { toast(e.message, 'error'); } finally { setScheduleBusy(false); }
  };

  // ── Training acknowledgement ──
  const startSigning = () => {
    if (!ackForm.supervisorName.trim()) { toast('Enter who is reviewing it with the caregiver', 'error'); return; }
    setSigOpen(true);
  };
  const onSign = async (dataUri: string, typedName: string) => {
    // A thrown error is shown in the signing dialog, which stays open.
    await api(`/${incidentId}/training-acknowledgement`, {
      method: 'POST',
      body: JSON.stringify({ signature: dataUri, signerName: typedName, supervisorName: ackForm.supervisorName, method: ackForm.method }),
    });
    setSigOpen(false);
    toast('Signed and added to the caregiver\'s training record');
    await loadCase();
  };

  if (loading) return <div className="p-8 text-center text-sm text-gray-600 dark:text-slate-400">Loading case file…</div>;
  if (!incident || !form) {
    return (
      <div className={`${CARD} text-center`}>
        <p className={`${MUTED} mb-3`}>This incident could not be loaded.</p>
        <button className={BTN_SECONDARY} onClick={onBack}>Back to incidents</button>
      </div>
    );
  }

  const today = schedule?.today || localToday();
  const removalActive = !!(incident.caregiver_removed_from_ymd && !incident.caregiver_returned_on_ymd);
  const dueSoon = form.responseDueDate && !incident.response_sent_date_ymd && incident.status !== 'closed';
  const removal = schedule?.removal || null;
  const status = incident.status || 'open';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button className={`${BTN_SECONDARY} mb-2`} onClick={onBack}>← Back to incidents</button>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">{incident.incident_number || 'Incident'} · {incident.client_name}</h2>
          <div className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            {incidentLabel('type', incident.incident_type)} · {formatDate(incident.incident_date_ymd)}
            {incident.reported_by_role === 'caregiver' && ' · Reported from the caregiver app'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${STATUS_CHIP[status] || STATUS_CHIP.open}`}>{incidentLabel('status', status)}</span>
          <button className={BTN_SECONDARY} onClick={() => downloadPdf('report')} disabled={!!downloading}>
            {downloading === 'report' ? 'Generating…' : '🖨️ Print Incident Report'}
          </button>
          <button className={BTN_PRIMARY} onClick={() => downloadPdf('packet')} disabled={!!downloading}>
            {downloading === 'packet' ? 'Generating…' : '📄 Payer Response Packet'}
          </button>
          <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-slate-300"
            title="Adds every scheduled visit at the client's home this year. Only include it if the payer asked for visit records.">
            <input type="checkbox" checked={includeSchedule} onChange={(e) => setIncludeSchedule(e.target.checked)} />
            Include visit schedule
          </label>
        </div>
      </div>

      {dueSoon && (
        <div className={`mb-4 rounded-lg border p-3 text-sm ${form.responseDueDate <= today
          ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100'}`}>
          Response to {incident.reported_by || 'the reporter'} is due {formatDate(form.responseDueDate)}.
          {' '}When it has been sent, use “Mark response sent” below.
        </div>
      )}

      {/* ── Case details ── */}
      <div className={CARD}>
        <h3 className={H3}>Case Details</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Client *">
            <select className={FIELD} value={form.clientId} onChange={(e) => set('clientId', e.target.value)} disabled={removalActive}>
              <option value="">Select client...</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              {!clients.some((c) => c.id === form.clientId) && form.clientId && <option value={form.clientId}>{incident.client_name}</option>}
            </select>
          </Field>
          <Field label="Caregiver Involved">
            <select className={FIELD} value={form.caregiverId} onChange={(e) => set('caregiverId', e.target.value)} disabled={removalActive}>
              <option value="">None</option>
              {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.first_name} {cg.last_name}</option>)}
              {!caregivers.some((cg) => cg.id === form.caregiverId) && form.caregiverId && <option value={form.caregiverId}>{incident.caregiver_name}</option>}
            </select>
          </Field>
          <Field label="Incident Type *">
            <select className={FIELD} value={form.incidentType} onChange={(e) => set('incidentType', e.target.value)}>
              {INCIDENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Severity">
            <select className={FIELD} value={form.severity} onChange={(e) => set('severity', e.target.value)}>
              {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Date It Happened *">
            <input className={FIELD} type="date" value={form.incidentDate} onChange={(e) => set('incidentDate', e.target.value)} />
          </Field>
          <Field label="Time">
            <input className={FIELD} type="time" value={form.incidentTime} onChange={(e) => set('incidentTime', e.target.value)} />
          </Field>
          <Field label="Reported By">
            <input className={FIELD} type="text" value={form.reportedBy} onChange={(e) => set('reportedBy', e.target.value)} placeholder="Person or organization" />
          </Field>
          <Field label="Date Reported">
            <input className={FIELD} type="date" value={form.reportedDate} onChange={(e) => set('reportedDate', e.target.value)} />
          </Field>
          <Field label="Reporter Contact Name">
            <input className={FIELD} type="text" value={form.reporterContactName} onChange={(e) => set('reporterContactName', e.target.value)} placeholder="e.g. the care manager's name" />
          </Field>
          <Field label="Reporter Phone">
            <input className={FIELD} type="tel" value={form.reporterPhone} onChange={(e) => set('reporterPhone', e.target.value)} />
          </Field>
          <Field label="Reporter Email">
            <input className={FIELD} type="email" value={form.reporterEmail} onChange={(e) => set('reporterEmail', e.target.value)} />
          </Field>
          <Field label="Response Due Date">
            <input className={FIELD} type="date" value={form.responseDueDate} onChange={(e) => set('responseDueDate', e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 space-y-3">
          <Field label="Description *">
            <textarea className={FIELD} rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
          <Field label="Witnesses">
            <textarea className={FIELD} rows={2} value={form.witnesses} onChange={(e) => set('witnesses', e.target.value)} />
          </Field>
          <Field label="Injuries or Damage">
            <textarea className={FIELD} rows={2} value={form.injuriesOrDamage} onChange={(e) => set('injuriesOrDamage', e.target.value)} />
          </Field>
          <Field label="Actions Taken">
            <textarea className={FIELD} rows={2} value={form.actionsTaken} onChange={(e) => set('actionsTaken', e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
            <input type="checkbox" checked={form.followUpRequired} onChange={(e) => set('followUpRequired', e.target.checked)} />
            <span>Follow-up Required</span>
          </label>
          {form.followUpRequired && (
            <Field label="Follow-up Notes">
              <textarea className={FIELD} rows={2} value={form.followUpNotes} onChange={(e) => set('followUpNotes', e.target.value)} />
            </Field>
          )}
          {removalActive && <p className="text-xs text-gray-600 dark:text-slate-400">Client and caregiver are locked while the caregiver is removed from the schedule.</p>}
          <button className={BTN_PRIMARY} onClick={() => saveCase()} disabled={saving}>{saving ? 'Saving…' : 'Save Case Details'}</button>
        </div>
      </div>

      {/* ── Investigation timeline ── */}
      <div className={CARD}>
        <h3 className={H3}>Investigation Timeline</h3>
        {notes.length === 0 ? (
          <p className={MUTED}>No entries yet. Log every call, interview, document reviewed, and action taken.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase text-gray-600 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Type</th><th className="py-2 pr-3">What happened</th><th className="py-2 pr-3">Logged by</th><th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.id} className="border-b border-gray-100 align-top text-gray-800 dark:border-slate-700 dark:text-slate-200">
                    <td className="whitespace-nowrap py-2 pr-3">{formatDate(n.entry_date_ymd)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{incidentLabel('entry', n.entry_type)}</td>
                    <td className="whitespace-pre-wrap py-2 pr-3">{n.summary}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{n.created_by_name || '—'}</td>
                    <td className="py-2"><button className={BTN_DANGER} onClick={() => deleteNote(n.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Date">
            <input className={FIELD} type="date" value={noteForm.entryDate} onChange={(e) => setNoteForm((f) => ({ ...f, entryDate: e.target.value }))} />
          </Field>
          <Field label="Type">
            <select className={FIELD} value={noteForm.entryType} onChange={(e) => setNoteForm((f) => ({ ...f, entryType: e.target.value }))}>
              {ENTRY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="What happened" className="mt-3">
          <textarea className={FIELD} rows={3} value={noteForm.summary} onChange={(e) => setNoteForm((f) => ({ ...f, summary: e.target.value }))}
            placeholder="Who you spoke with and what they said, what you reviewed, what you did. Facts only." />
        </Field>
        <button className={`${BTN_PRIMARY} mt-3`} onClick={addNote}>Add Entry</button>
      </div>

      {/* ── Caregiver & schedule ── */}
      <div className={CARD}>
        <h3 className={H3}>Caregiver &amp; Schedule</h3>
        {!schedule?.caregiverId ? (
          <p className={MUTED}>No caregiver is named on this incident. Pick one in Case Details to manage their schedule here.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-800 dark:text-slate-200">
              <strong>{incident.caregiver_name}</strong> with <strong>{incident.client_name}</strong>
              {schedule.lastVisit ? <> · last clocked visit {formatDate(schedule.lastVisit)}</> : ' · no clocked visits on record'}
              {' '}· {schedule.upcomingVisits} visit{schedule.upcomingVisits === 1 ? '' : 's'} scheduled in the next 4 weeks
            </p>
            {schedule.schedules.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase text-gray-600 dark:border-slate-700 dark:text-slate-400">
                      <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Time</th><th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.schedules.map((s: any) => (
                      <tr key={s.id} className="border-b border-gray-100 text-gray-800 dark:border-slate-700 dark:text-slate-200">
                        <td className="py-2 pr-3">{s.day_of_week != null ? `Every ${['biweekly', 'bi-weekly'].includes(s.frequency) ? 'other ' : ''}${DAY[s.day_of_week]}` : formatDate(s.date)}</td>
                        <td className="py-2 pr-3">{clock(s.start_time)} – {clock(s.end_time)}</td>
                        <td className="py-2">
                          {s.paused_from
                            ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Paused from {formatDate(s.paused_from)}</span>
                            : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">Active</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={MUTED}>This caregiver has no current or upcoming schedule with this client.</p>
            )}

            {removalActive ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-100">
                <div>
                  <strong>Removed from this client's schedule effective {formatDate(incident.caregiver_removed_from_ymd)}</strong> pending investigation.
                  {removal?.open_shifts?.length ? ` ${removal.open_shifts.length} visit${removal.open_shifts.length === 1 ? '' : 's'} were posted as open shifts for coverage.` : ''}
                </div>
                <button className={`${BTN_SECONDARY} mt-3`} onClick={returnCaregiver} disabled={scheduleBusy}>
                  {scheduleBusy ? 'Working…' : 'Return caregiver to schedule'}
                </button>
              </div>
            ) : (
              <div className="mt-4 border-t border-gray-200 pt-4 dark:border-slate-700">
                {incident.caregiver_returned_on_ymd && (
                  <p className={`${MUTED} mb-2`}>
                    Previously removed {formatDate(incident.caregiver_removed_from_ymd)} and returned {formatDate(incident.caregiver_returned_on_ymd)}.
                  </p>
                )}
                <h4 className="mb-2 text-sm font-bold text-gray-900 dark:text-slate-100">Remove from this client pending investigation</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <Field label="Starting">
                    <input className={FIELD} type="date" min={today} value={removalForm.fromDate} onChange={(e) => setRemovalForm((f) => ({ ...f, fromDate: e.target.value }))} />
                  </Field>
                  <Field label="Post visits for coverage">
                    <select className={FIELD} value={removalForm.postOpenShifts ? 'yes' : 'no'} onChange={(e) => setRemovalForm((f) => ({ ...f, postOpenShifts: e.target.value === 'yes' }))}>
                      <option value="yes">Yes, post as open shifts</option>
                      <option value="no">No, I will arrange coverage</option>
                    </select>
                  </Field>
                  {removalForm.postOpenShifts && (
                    <Field label="For the next">
                      <select className={FIELD} value={removalForm.coverageWeeks} onChange={(e) => setRemovalForm((f) => ({ ...f, coverageWeeks: Number(e.target.value) }))}>
                        {[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>{w} week{w === 1 ? '' : 's'}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
                <button className={`${BTN_DANGER} mt-3`} onClick={removeCaregiver} disabled={scheduleBusy || schedule.schedules.length === 0}>
                  {scheduleBusy ? 'Working…' : 'Remove caregiver from this client'}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Training acknowledgement ── */}
      <div className={CARD}>
        <h3 className={H3}>Training Acknowledgement: Medication Handling &amp; Misappropriation</h3>
        {!incident.caregiver_id ? (
          <p className={MUTED}>No caregiver is named on this incident.</p>
        ) : incident.training_ack_signed_at ? (
          <div>
            <p className="mb-2 text-sm text-gray-800 dark:text-slate-200">
              Signed by <strong>{incident.training_ack_signer_name}</strong> on {dateTime(incident.training_ack_signed_at)},
              reviewed with {incident.training_ack_supervisor} ({incidentLabel('method', incident.training_ack_method).toLowerCase()}).
              It is on the caregiver's training record.
            </p>
            {incident.training_ack_signature && (
              <img src={incident.training_ack_signature} alt="Caregiver signature" className="max-w-xs rounded-md border border-gray-200 bg-white dark:border-slate-600 dark:bg-white" />
            )}
          </div>
        ) : (
          <div>
            <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-gray-800 dark:text-slate-200">
              <li>Caregivers may remind a client a medication is due. They do not administer, set up, count, store, or remove medications.</li>
              <li>Caregivers do not touch or handle a client's controlled medications, and report any request to the office the same day.</li>
              <li>Zero tolerance for taking, borrowing, holding, or removing any client property, including medications, even if offered.</li>
              <li>Missing or disturbed medications, or a client's concern about them, are reported to the office the same day.</li>
              <li>Every visit is clocked in and out so records show exactly when the caregiver was in the home.</li>
            </ol>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Reviewed with (supervisor name and title)">
                <input className={FIELD} type="text" value={ackForm.supervisorName} onChange={(e) => setAckForm((f) => ({ ...f, supervisorName: e.target.value }))} />
              </Field>
              <Field label="How it was reviewed">
                <select className={FIELD} value={ackForm.method} onChange={(e) => setAckForm((f) => ({ ...f, method: e.target.value }))}>
                  {TRAINING_ACK_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
            </div>
            <button className={`${BTN_PRIMARY} mt-3`} onClick={startSigning}>✍️ Caregiver signs now</button>
            <p className="mt-2 text-xs text-gray-600 dark:text-slate-400">
              Hand the device to {incident.caregiver_name}. Signing adds completed training records to their file.
            </p>
          </div>
        )}
      </div>

      {/* ── Attachments ── */}
      <div className={CARD}>
        <h3 className={H3}>Attachments</h3>
        {attachments.length === 0 ? (
          <p className={MUTED}>Nothing attached yet. Add the payer's notice, signed statements, and the background check letter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-xs uppercase text-gray-600 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-3">File</th><th className="py-2 pr-3">Kind</th><th className="py-2 pr-3">Size</th><th className="py-2 pr-3">Added</th><th className="py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {attachments.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100 align-top text-gray-800 dark:border-slate-700 dark:text-slate-200">
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{a.file_name}</div>
                      {a.description && <div className="text-xs text-gray-600 dark:text-slate-400">{a.description}</div>}
                    </td>
                    <td className="py-2 pr-3">{incidentLabel('category', a.category)}</td>
                    <td className="py-2 pr-3">{fileSize(a.file_size)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{dateTime(a.created_at)}{a.uploaded_by_name ? ` · ${a.uploaded_by_name}` : ''}</td>
                    <td className="whitespace-nowrap py-2">
                      <button className={BTN_SECONDARY} onClick={() => viewAttachment(a)}>Open</button>{' '}
                      <button className={BTN_DANGER} onClick={() => deleteAttachment(a)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Kind of document">
            <select className={FIELD} value={uploadForm.category} onChange={(e) => setUploadForm((f) => ({ ...f, category: e.target.value }))}>
              {ATTACHMENT_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)">
            <input className={FIELD} type="text" value={uploadForm.description} onChange={(e) => setUploadForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="File (PDF or image, 7 MB max)">
            <input className={FIELD} type="file" accept={ATTACHMENT_ACCEPT} disabled={uploading}
              onChange={(e) => { uploadFile(e.target.files?.[0]); e.target.value = ''; }} />
          </Field>
        </div>
        {uploading && <p className={`${MUTED} mt-2`}>Uploading…</p>}
      </div>

      {/* ── Conclusion & response ── */}
      <div className={CARD}>
        <h3 className={H3}>Conclusion &amp; Response</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Status">
            <select className={FIELD} value={form.status} onChange={(e) => set('status', e.target.value)}>
              {INCIDENT_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Conclusion">
            <select className={FIELD} value={form.disposition} onChange={(e) => set('disposition', e.target.value)}>
              <option value="">Not yet determined</option>
              {DISPOSITIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </Field>
          <Field label="Mandatory Report Decision">
            <select className={FIELD} value={form.mandatoryReportStatus} onChange={(e) => set('mandatoryReportStatus', e.target.value)}>
              <option value="">Not recorded</option>
              {MANDATORY_REPORT_STATUSES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field label="Response Sent On">
            <input className={FIELD} type="date" value={form.responseSentDate} onChange={(e) => set('responseSentDate', e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 space-y-3">
          <Field label="Mandatory Report Details">
            <textarea className={FIELD} rows={2} value={form.mandatoryReportDetails} onChange={(e) => set('mandatoryReportDetails', e.target.value)}
              placeholder="Agency, date, confirmation number, or why a report was not required" />
          </Field>
          <Field label="Findings">
            <textarea className={FIELD} rows={4} value={form.findings} onChange={(e) => set('findings', e.target.value)}
              placeholder="What the investigation found. This text goes into the payer response letter." />
          </Field>
          <Field label="Additional Information for the Payer">
            <textarea className={FIELD} rows={3} value={form.payerResponseNotes} onChange={(e) => set('payerResponseNotes', e.target.value)}
              placeholder="Anything the payer asked that the case file has no field for. Printed in the response letter as its own numbered item." />
          </Field>
          {form.status === 'closed' && (
            <Field label="Date Closed" className="max-w-xs">
              <input className={FIELD} type="date" value={form.closedDate} onChange={(e) => set('closedDate', e.target.value)} />
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            <button className={BTN_PRIMARY} onClick={() => saveCase()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            {!incident.response_sent_date_ymd && (
              <button className={BTN_SECONDARY} onClick={() => saveCase({ responseSentDate: today })} disabled={saving}>Mark response sent today</button>
            )}
          </div>
        </div>
      </div>

      <SignatureDialog
        open={sigOpen}
        onClose={() => setSigOpen(false)}
        documentName="Medication Handling & Misappropriation Acknowledgement"
        onSign={onSign}
      />
    </div>
  );
}
