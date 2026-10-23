// Moved from templates/crm-homecare/frontend/src/components/admin/IncidentDetail.tsx.
// One incident's case file. Everything here reads/writes /api/incidents/:id/* (server/crm/homecare/office/incidents.ts).
// Changes in the move:
//   · its own page at /crm/incidents/:id (the id from the address); "Back to incidents" navigates to /crm/incidents
//     (the template swapped it in over the list and took incidentId / onBack props);
//   · replies are read as the unified server answers: the case is camelCase (incidentNumber, clientName,
//     incidentDateYmd, caregiverRemovedFromYmd, trainingAckSignedAt …), the timeline, attachments and pickers are
//     { data, pagination } lists, the schedule's rows camelCase (dayOfWeek, startTime, pausedFrom). The removal record
//     is a JSON column and keeps its stored keys (removal.open_shifts);
//   · the timeline entry and attachment "Delete" buttons show only for care-compliance:delete (the server's check).
import { useState, useEffect, useCallback, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useConfirm, usePermissions, useToast } from '../../../../shared';
import { api, rows, errorMessage } from '../lib/http';
import { formatDate } from '../lib/date';
import { formatDateTime } from '../lib/datetime';
import { useMay } from '../lib/useMay';
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, incidentLabel,
  ATTACHMENT_MAX_BYTES, ATTACHMENT_ACCEPT, incidentsApi, incidentsBlob, saveBlob, agencyToday,
  STATUS_CHIP, FIELD, LABEL, CARD, H3, MUTED, BTN_PRIMARY, BTN_SECONDARY, BTN_DANGER,
} from '../lib/incidentOptions';
import type { PersonOption } from './IncidentReporting';

/** GET /api/incidents/:id (data/homecareOffice.ts incidentCase: the row and its names, camelCase). */
interface IncidentCase {
  id: string;
  incidentNumber?: string | null;
  clientId?: string | null;
  caregiverId?: string | null;
  clientName?: string | null;
  caregiverName?: string | null;
  reportedByRole?: string | null;
  incidentType?: string | null;
  severity?: string | null;
  status?: string | null;
  description?: string | null;
  witnesses?: string | null;
  injuriesOrDamage?: string | null;
  actionTaken?: string | null;
  followUpRequired?: boolean | null;
  followUpNotes?: string | null;
  reportedBy?: string | null;
  reporterContactName?: string | null;
  reporterPhone?: string | null;
  reporterEmail?: string | null;
  disposition?: string | null;
  findings?: string | null;
  payerResponseNotes?: string | null;
  mandatoryReportStatus?: string | null;
  mandatoryReportDetails?: string | null;
  incidentDateYmd?: string | null;
  incidentTimeHhmm?: string | null;
  reportedDateYmd?: string | null;
  responseDueDateYmd?: string | null;
  responseSentDateYmd?: string | null;
  closedDateYmd?: string | null;
  caregiverRemovedFromYmd?: string | null;
  caregiverReturnedOnYmd?: string | null;
  trainingAckSignedAt?: string | null;
  trainingAckSignerName?: string | null;
  trainingAckSignature?: string | null;
  trainingAckSupervisor?: string | null;
  trainingAckMethod?: string | null;
}

/** GET /api/incidents/:id/notes rows. */
interface TimelineEntry { id: string; entryDateYmd?: string | null; entryType?: string | null; summary?: string | null; createdByName?: string | null }

/** GET /api/incidents/:id/attachments rows (no file data). */
interface Attachment {
  id: string; category?: string | null; fileName: string; fileSize?: number | null; description?: string | null;
  createdAt?: string | null; uploadedByName?: string | null;
}

/** GET /api/incidents/:id/caregiver-schedule. `removal` is the stored JSON record (its keys as stored). */
interface CaregiverSchedule {
  caregiverId: string | null;
  today?: string;
  removal?: { open_shifts?: unknown[] } | null;
  schedules: Array<{ id: string; dayOfWeek?: number | null; date?: string | null; startTime?: string | null; endTime?: string | null; frequency?: string | null; pausedFrom?: string | null }>;
  upcomingVisits: number;
  lastVisit: string | null;
}

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
  return isNaN(d.getTime()) ? '' : formatDateTime(d);
};

const toForm = (i: IncidentCase) => ({
  clientId: i.clientId || '',
  caregiverId: i.caregiverId || '',
  incidentType: i.incidentType || 'other',
  severity: i.severity || 'moderate',
  incidentDate: i.incidentDateYmd || '',
  incidentTime: i.incidentTimeHhmm || '',
  description: i.description || '',
  witnesses: i.witnesses || '',
  injuriesOrDamage: i.injuriesOrDamage || '',
  actionsTaken: i.actionTaken || '',
  followUpRequired: !!i.followUpRequired,
  followUpNotes: i.followUpNotes || '',
  reportedBy: i.reportedBy || '',
  reportedDate: i.reportedDateYmd || '',
  reporterContactName: i.reporterContactName || '',
  reporterPhone: i.reporterPhone || '',
  reporterEmail: i.reporterEmail || '',
  responseDueDate: i.responseDueDateYmd || '',
  responseSentDate: i.responseSentDateYmd || '',
  status: i.status || 'open',
  disposition: i.disposition || '',
  findings: i.findings || '',
  payerResponseNotes: i.payerResponseNotes || '',
  mandatoryReportStatus: i.mandatoryReportStatus || '',
  mandatoryReportDetails: i.mandatoryReportDetails || '',
  closedDate: i.closedDateYmd || '',
});
type CaseForm = ReturnType<typeof toForm>;

const Field = ({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) => (
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
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    // Dark ink on the pad, which is white in both themes (the saved image is the signature on white).
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111827';
  }, [open]);

  if (!open) return null;
  const context = () => canvasRef.current?.getContext('2d') ?? null;
  const pos = (e: ReactPointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const start = (e: ReactPointerEvent) => {
    e.preventDefault(); drawing.current = true;
    const ctx = context(); if (!ctx) return;
    const { x, y } = pos(e);
    ctx.beginPath(); ctx.moveTo(x, y);
  };
  const move = (e: ReactPointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = context(); if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y); ctx.stroke(); setDirty(true);
  };
  const end = () => { drawing.current = false; };
  const clear = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); setDirty(false);
  };
  const sign = async () => {
    setError('');
    if (!dirty) { setError('Draw the signature first'); return; }
    if (!typedName.trim()) { setError('Type the full name'); return; }
    setBusy(true);
    try { await onSign(canvasRef.current!.toDataURL('image/png'), typedName.trim()); }
    catch (e) { setError(errorMessage(e, 'Signing failed')); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Sign: ${documentName}`}>
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

export default function IncidentDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const incidentId = id;
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { can, known } = usePermissions();
  const mayDelete = !known || can('care-compliance:delete');
  const may = useMay('care-compliance'); // save, entries, uploads, schedule removal and the acknowledgement: create / update (lib/useMay.ts)
  const onBack = () => navigate('/crm/incidents');
  const [loading, setLoading] = useState(true);
  const [incident, setIncident] = useState<IncidentCase | null>(null);
  const [form, setForm] = useState<CaseForm | null>(null);
  const [notes, setNotes] = useState<TimelineEntry[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [schedule, setSchedule] = useState<CaregiverSchedule | null>(null);
  const [clients, setClients] = useState<PersonOption[]>([]);
  const [caregivers, setCaregivers] = useState<PersonOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState('');
  const [includeSchedule, setIncludeSchedule] = useState(false); // packet Exhibit A; off unless the payer asked for visit records
  const [noteForm, setNoteForm] = useState({ entryDate: agencyToday(), entryType: 'interview', summary: '' });
  const [uploadForm, setUploadForm] = useState({ category: 'payer_notice', description: '' });
  const [uploading, setUploading] = useState(false);
  const [removalForm, setRemovalForm] = useState({ fromDate: agencyToday(), postOpenShifts: true, coverageWeeks: 4 });
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [ackForm, setAckForm] = useState({ supervisorName: '', method: 'in_person' });
  const [sigOpen, setSigOpen] = useState(false);

  const loadCase = useCallback(async () => {
    try {
      const [inc, n, a, s] = await Promise.all([
        incidentsApi(`/${incidentId}`) as Promise<IncidentCase>,
        incidentsApi(`/${incidentId}/notes`),
        incidentsApi(`/${incidentId}/attachments`),
        incidentsApi(`/${incidentId}/caregiver-schedule`) as Promise<CaregiverSchedule>,
      ]);
      setIncident(inc);
      setForm(toForm(inc));
      setNotes(rows<TimelineEntry>(n));
      setAttachments(rows<Attachment>(a));
      setSchedule(s);
      const today = s?.today;
      if (today) setRemovalForm((f) => (f.fromDate < today ? { ...f, fromDate: today } : f));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [incidentId, toast]);

  useEffect(() => { loadCase(); }, [loadCase]);
  useEffect(() => {
    Promise.all([incidentsApi('/my-clients').catch(() => null), api.get('/api/users/caregivers').catch(() => null)])
      .then(([c, cg]) => { setClients(rows<PersonOption>(c)); setCaregivers(rows<PersonOption>(cg)); });
  }, []);

  const set = <K extends keyof CaseForm>(k: K, v: CaseForm[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const saveCase = async (overrides: Partial<CaseForm> = {}) => {
    setSaving(true);
    try {
      await incidentsApi(`/${incidentId}`, { method: 'PUT', body: JSON.stringify({ ...form, ...overrides }) });
      toast.success('Incident saved');
      await loadCase();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const downloadPdf = async (kind: 'report' | 'packet') => {
    setDownloading(kind);
    try {
      const path = kind === 'packet' ? `response-packet${includeSchedule ? '?includeSchedule=1' : ''}` : 'pdf';
      const blob = await incidentsBlob(`/${incidentId}/${path}`);
      saveBlob(blob, `${kind === 'packet' ? 'incident-response-packet' : 'incident-report'}-${incident?.incidentNumber || incidentId}.pdf`);
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error('Download failed: ' + errorMessage(e));
    } finally {
      setDownloading('');
    }
  };

  // ── Timeline ──
  const addNote = async () => {
    if (!noteForm.summary.trim()) { toast.error('Describe what happened'); return; }
    try {
      await incidentsApi(`/${incidentId}/notes`, { method: 'POST', body: JSON.stringify(noteForm) });
      setNoteForm({ entryDate: agencyToday(), entryType: noteForm.entryType, summary: '' });
      setNotes(rows<TimelineEntry>(await incidentsApi(`/${incidentId}/notes`)));
    } catch (e) { toast.error(errorMessage(e)); }
  };
  const deleteNote = async (noteId: string) => {
    if (!(await confirm('Delete this investigation entry?', { danger: true }))) return;
    try {
      await incidentsApi(`/${incidentId}/notes/${noteId}`, { method: 'DELETE' });
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
    } catch (e) { toast.error(errorMessage(e)); }
  };

  // ── Attachments ──
  const uploadFile = async (file?: File | null) => {
    if (!file) return;
    if (file.size > ATTACHMENT_MAX_BYTES) { toast.error('File is too large (7 MB max)'); return; }
    setUploading(true);
    try {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(file);
      });
      await incidentsApi(`/${incidentId}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ category: uploadForm.category, fileName: file.name, dataUri, description: uploadForm.description }),
      });
      setUploadForm((f) => ({ ...f, description: '' }));
      setAttachments(rows<Attachment>(await incidentsApi(`/${incidentId}/attachments`)));
      toast.success('Attached');
    } catch (e) {
      toast.error('Upload failed: ' + errorMessage(e));
    } finally {
      setUploading(false);
    }
  };
  const viewAttachment = async (att: Attachment) => {
    try { saveBlob(await incidentsBlob(`/${incidentId}/attachments/${att.id}`), att.fileName); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const deleteAttachment = async (att: Attachment) => {
    if (!(await confirm(`Delete ${att.fileName}? This cannot be undone.`, { danger: true }))) return;
    try {
      await incidentsApi(`/${incidentId}/attachments/${att.id}`, { method: 'DELETE' });
      setAttachments((prev) => prev.filter((a) => a.id !== att.id));
    } catch (e) { toast.error(errorMessage(e)); }
  };

  // ── Caregiver schedule ──
  const removeCaregiver = async () => {
    if (!incident) return;
    const msg = `Remove ${incident.caregiverName} from ${incident.clientName}'s schedule starting ${formatDate(removalForm.fromDate)}?\n\n`
      + 'Their visits with this client stop being scheduled from that date.'
      + (removalForm.postOpenShifts ? ` Visits for the next ${removalForm.coverageWeeks} weeks are posted as open shifts for coverage.` : ' No open shifts will be posted, so arrange coverage yourself.')
      + '\n\nYou can return them to the schedule later from this page.';
    if (!(await confirm(msg, { danger: true }))) return;
    setScheduleBusy(true);
    try {
      const r: { summary?: string } | null = await incidentsApi(`/${incidentId}/remove-caregiver`, { method: 'POST', body: JSON.stringify(removalForm) });
      toast.success(r?.summary || 'Caregiver removed from this client');
      await loadCase();
    } catch (e) { toast.error(errorMessage(e)); } finally { setScheduleBusy(false); }
  };
  const returnCaregiver = async () => {
    if (!incident) return;
    if (!(await confirm(`Return ${incident.caregiverName} to ${incident.clientName}'s schedule today? Unclaimed coverage shifts are cancelled. Visits a replacement already took stay with the replacement.`, { danger: false }))) return;
    setScheduleBusy(true);
    try {
      const r: { summary?: string } | null = await incidentsApi(`/${incidentId}/return-caregiver`, { method: 'POST', body: JSON.stringify({}) });
      toast.success(r?.summary || 'Caregiver returned to the schedule');
      await loadCase();
    } catch (e) { toast.error(errorMessage(e)); } finally { setScheduleBusy(false); }
  };

  // ── Training acknowledgement ──
  const startSigning = () => {
    if (!ackForm.supervisorName.trim()) { toast.error('Enter who is reviewing it with the caregiver'); return; }
    setSigOpen(true);
  };
  const onSign = async (dataUri: string, typedName: string) => {
    // A thrown error is shown in the signing dialog, which stays open.
    await incidentsApi(`/${incidentId}/training-acknowledgement`, {
      method: 'POST',
      body: JSON.stringify({ signature: dataUri, signerName: typedName, supervisorName: ackForm.supervisorName, method: ackForm.method }),
    });
    setSigOpen(false);
    toast.success('Signed and added to the caregiver\'s training record');
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

  const today = schedule?.today || agencyToday();
  const removalActive = !!(incident.caregiverRemovedFromYmd && !incident.caregiverReturnedOnYmd);
  const dueSoon = form.responseDueDate && !incident.responseSentDateYmd && incident.status !== 'closed';
  const removal = schedule?.removal || null;
  const openShiftCount = Array.isArray(removal?.open_shifts) ? removal.open_shifts.length : 0;
  const status = incident.status || 'open';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button className={`${BTN_SECONDARY} mb-2`} onClick={onBack}>← Back to incidents</button>
          <h2 className="text-xl font-bold text-gray-900 dark:text-slate-100">{incident.incidentNumber || 'Incident'} · {incident.clientName}</h2>
          <div className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            {incidentLabel('type', incident.incidentType)} · {formatDate(incident.incidentDateYmd)}
            {incident.reportedByRole === 'caregiver' && ' · Reported from the caregiver app'}
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
          Response to {incident.reportedBy || 'the reporter'} is due {formatDate(form.responseDueDate)}.
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
              {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              {!clients.some((c) => c.id === form.clientId) && form.clientId && <option value={form.clientId}>{incident.clientName}</option>}
            </select>
          </Field>
          <Field label="Caregiver Involved">
            <select className={FIELD} value={form.caregiverId} onChange={(e) => set('caregiverId', e.target.value)} disabled={removalActive}>
              <option value="">None</option>
              {caregivers.map((cg) => <option key={cg.id} value={cg.id}>{cg.firstName} {cg.lastName}</option>)}
              {!caregivers.some((cg) => cg.id === form.caregiverId) && form.caregiverId && <option value={form.caregiverId}>{incident.caregiverName}</option>}
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
          {may.update && <button className={BTN_PRIMARY} onClick={() => saveCase()} disabled={saving}>{saving ? 'Saving…' : 'Save Case Details'}</button>}
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
                    <td className="whitespace-nowrap py-2 pr-3">{formatDate(n.entryDateYmd)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{incidentLabel('entry', n.entryType)}</td>
                    <td className="whitespace-pre-wrap py-2 pr-3">{n.summary}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{n.createdByName || '—'}</td>
                    <td className="py-2">{mayDelete && <button className={BTN_DANGER} onClick={() => deleteNote(n.id)}>Delete</button>}</td>
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
        {may.create && <button className={`${BTN_PRIMARY} mt-3`} onClick={addNote}>Add Entry</button>}
      </div>

      {/* ── Caregiver & schedule ── */}
      <div className={CARD}>
        <h3 className={H3}>Caregiver &amp; Schedule</h3>
        {!schedule?.caregiverId ? (
          <p className={MUTED}>No caregiver is named on this incident. Pick one in Case Details to manage their schedule here.</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-gray-800 dark:text-slate-200">
              <strong>{incident.caregiverName}</strong> with <strong>{incident.clientName}</strong>
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
                    {schedule.schedules.map((s) => (
                      <tr key={s.id} className="border-b border-gray-100 text-gray-800 dark:border-slate-700 dark:text-slate-200">
                        <td className="py-2 pr-3">{s.dayOfWeek != null ? `Every ${['biweekly', 'bi-weekly'].includes(s.frequency || '') ? 'other ' : ''}${DAY[s.dayOfWeek]}` : formatDate(s.date)}</td>
                        <td className="py-2 pr-3">{clock(s.startTime)} – {clock(s.endTime)}</td>
                        <td className="py-2">
                          {s.pausedFrom
                            ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Paused from {formatDate(s.pausedFrom)}</span>
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
                  <strong>Removed from this client's schedule effective {formatDate(incident.caregiverRemovedFromYmd)}</strong> pending investigation.
                  {openShiftCount ? ` ${openShiftCount} visit${openShiftCount === 1 ? '' : 's'} were posted as open shifts for coverage.` : ''}
                </div>
                {may.update && <button className={`${BTN_SECONDARY} mt-3`} onClick={returnCaregiver} disabled={scheduleBusy}>
                  {scheduleBusy ? 'Working…' : 'Return caregiver to schedule'}
                </button>}
              </div>
            ) : (
              <div className="mt-4 border-t border-gray-200 pt-4 dark:border-slate-700">
                {incident.caregiverReturnedOnYmd && (
                  <p className={`${MUTED} mb-2`}>
                    Previously removed {formatDate(incident.caregiverRemovedFromYmd)} and returned {formatDate(incident.caregiverReturnedOnYmd)}.
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
                {may.update && <button className={`${BTN_DANGER} mt-3`} onClick={removeCaregiver} disabled={scheduleBusy || schedule.schedules.length === 0}>
                  {scheduleBusy ? 'Working…' : 'Remove caregiver from this client'}
                </button>}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Training acknowledgement ── */}
      <div className={CARD}>
        <h3 className={H3}>Training Acknowledgement: Medication Handling &amp; Misappropriation</h3>
        {!incident.caregiverId ? (
          <p className={MUTED}>No caregiver is named on this incident.</p>
        ) : incident.trainingAckSignedAt ? (
          <div>
            <p className="mb-2 text-sm text-gray-800 dark:text-slate-200">
              Signed by <strong>{incident.trainingAckSignerName}</strong> on {dateTime(incident.trainingAckSignedAt)},
              reviewed with {incident.trainingAckSupervisor} ({incidentLabel('method', incident.trainingAckMethod).toLowerCase()}).
              It is on the caregiver's training record.
            </p>
            {incident.trainingAckSignature && (
              <img src={incident.trainingAckSignature} alt="Caregiver signature" className="max-w-xs rounded-md border border-gray-200 bg-white dark:border-slate-600 dark:bg-white" />
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
            {may.update && <button className={`${BTN_PRIMARY} mt-3`} onClick={startSigning}>✍️ Caregiver signs now</button>}
            <p className="mt-2 text-xs text-gray-600 dark:text-slate-400">
              Hand the device to {incident.caregiverName}. Signing adds completed training records to their file.
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
                      <div className="font-semibold">{a.fileName}</div>
                      {a.description && <div className="text-xs text-gray-600 dark:text-slate-400">{a.description}</div>}
                    </td>
                    <td className="py-2 pr-3">{incidentLabel('category', a.category)}</td>
                    <td className="py-2 pr-3">{fileSize(a.fileSize)}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{dateTime(a.createdAt)}{a.uploadedByName ? ` · ${a.uploadedByName}` : ''}</td>
                    <td className="whitespace-nowrap py-2">
                      <button className={BTN_SECONDARY} onClick={() => viewAttachment(a)}>Open</button>{' '}
                      {mayDelete && <button className={BTN_DANGER} onClick={() => deleteAttachment(a)}>Delete</button>}
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
            <input className={FIELD} type="file" accept={ATTACHMENT_ACCEPT} disabled={uploading || !may.create}
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
            {may.update && <button className={BTN_PRIMARY} onClick={() => saveCase()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}
            {may.update && !incident.responseSentDateYmd && (
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
