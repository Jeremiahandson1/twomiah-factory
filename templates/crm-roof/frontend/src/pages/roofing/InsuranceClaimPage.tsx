import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Shield, Phone, Mail, FileText, Plus, X, Send,
  CheckCircle, XCircle, Clock, MessageSquare, Upload, Download,
  AlertTriangle, DollarSign, Save, ChevronRight, Loader2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useMayWrite } from '../../shared';
import { useToast } from '../../contexts/ToastContext';

const CLAIM_STAGES = [
  'filed', 'adjuster_assigned', 'inspection_scheduled',
  'inspected', 'approved', 'closed',
] as const;

const CLAIM_STAGE_LABELS: Record<string, string> = {
  filed: 'Filed',
  adjuster_assigned: 'Adjuster Assigned',
  inspection_scheduled: 'Inspection Scheduled',
  inspected: 'Inspected',
  approved: 'Approved',
  supplemented: 'Supplemented',
  denied: 'Denied',
  closed: 'Closed',
};

const ACTIVITY_ICONS: Record<string, string> = {
  note: 'msg', call: 'phone', email: 'mail', inspection: 'check',
  approval: 'check', supplement: 'doc', denial: 'x',
  document_uploaded: 'upload', status_change: 'clock', xactimate_export: 'doc',
};

const SUP_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  denied: 'bg-red-100 text-red-700',
  partial: 'bg-yellow-100 text-yellow-700',
};

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt$(n: any) {
  if (n == null || n === '') return '—';
  return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// A money/qty field being typed into holds a STRING, not a number.
//
// The create modal used to coerce on every keystroke — `Number(e.target.value)`, later wrapped in
// `Math.max(0, …)` to stop negatives. That does stop the negative, but it replaces what the typist
// entered with a different, plausible number and says nothing: an intended -1500 becomes a positive
// line nobody queries. Silently rewriting someone's figure is worse than refusing it, because there
// is no wrong-looking value to notice. (roof T18 L7)
//
// So the field keeps the raw text, `num0` is used only to price the row while it is being filled in,
// and the value is checked once on submit — the same shape the EDIT modal below already used.
const num0 = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/**
 * A quantity or a price for the RUNNING TOTAL, which is never negative. (T41)
 *
 *   "Supplement modal live total shows '$-50.00' while typing."
 *
 * num0 above turns half-typed text into 0 so the typist keeps seeing what they typed — but a minus
 * sign is a number, so "-50" priced a line at minus fifty and the modal displayed a supplement worth
 * less than nothing. The server has refused negative money since T17 H2 (`z.number().nonnegative()`),
 * so that total was a figure it would never accept. Clamped here, and the modal says why below.
 */
const price0 = (v: any) => Math.max(0, num0(v));
const anyNegative = (rows: { qty?: any; unitPrice?: any }[]) =>
  rows.some((r) => num0(r.qty) < 0 || num0(r.unitPrice) < 0);
const newSupRow = () => ({ code: '', description: '', qty: '1', unit: 'SQ', unitPrice: '', total: 0 });

// Xactimate code options for line item picker
const XACT_CODES = [
  { code: 'RFG 220', desc: 'Remove asphalt shingles', unit: 'SQ' },
  { code: 'RFG 240', desc: 'Asphalt shingles - 30yr', unit: 'SQ' },
  { code: 'RFG 252', desc: 'Roofing felt - 30lb', unit: 'SQ' },
  { code: 'RFG 300', desc: 'Drip edge', unit: 'LF' },
  { code: 'RFG 180', desc: 'Ice & water shield', unit: 'SQ' },
  { code: 'RFG 350', desc: 'Ridge cap shingles', unit: 'LF' },
  { code: 'WTR 052', desc: 'Flashing', unit: 'LF' },
  { code: 'RFG 100', desc: 'Roof deck repair - plywood', unit: 'SF' },
  { code: 'RFG 260', desc: 'Starter strip', unit: 'LF' },
  { code: 'GUT 100', desc: 'Gutter - aluminum', unit: 'LF' },
  { code: 'GUT 110', desc: 'Downspout - aluminum', unit: 'LF' },
  { code: 'SKY 100', desc: 'Skylight replacement', unit: 'EA' },
  { code: 'VNT 100', desc: 'Roof vent', unit: 'EA' },
  { code: 'PLM 100', desc: 'Plumbing stack flashing', unit: 'EA' },
];

export default function InsuranceClaimPage() {
  // Offer a write only where we know it is allowed. Each permission is the one its own route
  // asks for; crm-roof could not ask this until T41 gave its client the permission list.
  const mayWriteClaim = useMayWrite('insurance:create');
  const { id: jobId } = useParams<{ id: string }>();
  const { token, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  // approve/deny are requireManager on the server. Offering the buttons to a field tech would hand
  // them a 403 on a decision they cannot make. (roof T17)
  const canDecide = ['manager', 'admin', 'owner'].includes(String((user as any)?.role || ''));

  const [claim, setClaim] = useState<any>(null);
  const [activities, setActivities] = useState<any[]>([]);
  const [supplements, setSupplements] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Activity modal
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityType, setActivityType] = useState('note');
  const [activityBody, setActivityBody] = useState('');
  const [activityMeta, setActivityMeta] = useState<any>({});
  const [submittingActivity, setSubmittingActivity] = useState(false);

  // Supplement modal
  const [supOpen, setSupOpen] = useState(false);
  const [supReason, setSupReason] = useState('');
  const [supLineItems, setSupLineItems] = useState<any[]>([newSupRow()]);
  const [supNotes, setSupNotes] = useState('');
  const [submittingSup, setSubmittingSup] = useState(false);

  // Xactimate export
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);
  // null = loaded fine. 'notAllowed' = this role may not read it. 'failed' = something else. (T41)
  const [activityError, setActivityError] = useState<'notAllowed' | 'failed' | null>(null);
  const [supplementError, setSupplementError] = useState<'notAllowed' | 'failed' | null>(null);

  // Starting a claim. Everything behind this page works — the create endpoint, the status rail, the
  // supplements — but there was no way in from the product, so an insurance job could never reach any
  // of it. The empty state now carries the one control that was missing.
  const [jobInfo, setJobInfo] = useState<any>(null);
  const [startOpen, setStartOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newClaim, setNewClaim] = useState({
    claimNumber: '', insuranceCompany: '', policyNumber: '',
    dateOfLoss: '', causeOfLoss: '', deductible: '',
  });

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const claimRes = await fetch(`/api/insurance/claims/${jobId}`, { headers });
      if (!claimRes.ok) {
        // No claim yet. Read the job so the empty state can tell "not filed yet" apart from "this job
        // is not an insurance job" — the create endpoint refuses the second with a 400, and offering
        // a button that cannot succeed is worse than explaining why.
        setClaim(null);
        try {
          const jobRes = await fetch(`/api/jobs/${jobId}`, { headers });
          setJobInfo(jobRes.ok ? await jobRes.json() : null);
        } catch { setJobInfo(null); }
        setLoading(false);
        return;
      }
      const claimData = await claimRes.json();
      setClaim(claimData);

      const [actRes, supRes] = await Promise.all([
        fetch(`/api/insurance/claims/${claimData.id}/activity`, { headers }),
        fetch(`/api/insurance/claims/${claimData.id}/supplements`, { headers }),
      ]);
      /**
       * "NO ACTIVITY YET" AND "WE COULD NOT LOAD IT" ARE NOT THE SAME SENTENCE. (T41)
       *
       *   "Staff see an empty claim trail: activity returns 0 entries for staff while manager and
       *    owner see 'filed' and 'submitted'."
       *
       * The endpoint itself does NOT refuse the staff seat — driven directly, it answers 200 with
       * exactly the rows the owner gets, and this file now has a test that says so. What this page
       * did was turn ANY non-OK response into an empty array, so a claim whose history failed to
       * load for any reason read as a claim with no history. That is the same fault the report files
       * against the Snow page ("tells staff 'No snow contracts yet' instead of 'no access'"), and it
       * is why the trail looked empty rather than broken.
       *
       * The two cases are now distinguished, so the screen says which one happened.
       */
      if (actRes.ok) { setActivities(await actRes.json()); setActivityError(null); }
      else { setActivities([]); setActivityError(actRes.status === 403 ? 'notAllowed' : 'failed'); }
      if (supRes.ok) { setSupplements(await supRes.json()); setSupplementError(null); }
      else { setSupplements([]); setSupplementError(supRes.status === 403 ? 'notAllowed' : 'failed'); }
    } catch {
      toast.error('Failed to load claim');
    } finally {
      setLoading(false);
    }
  }, [jobId, token]);

  useEffect(() => { load(); }, [load]);

  const createClaim = async () => {
    if (!newClaim.claimNumber.trim() || !newClaim.insuranceCompany.trim()) {
      toast.error('Claim number and insurance company are required');
      return;
    }
    setCreating(true);
    try {
      // Only the two required fields are always sent; the rest go only when filled, because the
      // server treats '' as a value and would store an empty cause of loss as a real one.
      const payload: Record<string, string> = {
        jobId: String(jobId),
        claimNumber: newClaim.claimNumber.trim(),
        insuranceCompany: newClaim.insuranceCompany.trim(),
      };
      for (const k of ['policyNumber', 'dateOfLoss', 'causeOfLoss', 'deductible'] as const) {
        const v = String(newClaim[k] || '').trim();
        if (v) payload[k] = v;
      }
      const res = await fetch('/api/insurance/claims', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // 409 means someone else filed it while this page was open — reload onto the real claim
        // rather than reporting a failure the user cannot act on.
        if (res.status === 409) { toast.error('A claim already exists for this job'); setStartOpen(false); await load(); return; }
        throw new Error(err?.error || 'Could not start the claim');
      }
      toast.success('Insurance claim started');
      setStartOpen(false);
      setNewClaim({ claimNumber: '', insuranceCompany: '', policyNumber: '', dateOfLoss: '', causeOfLoss: '', deductible: '' });
      await load();
    } catch (e: any) {
      toast.error(e?.message || 'Could not start the claim');
    } finally {
      setCreating(false);
    }
  };

  const saveClaim = async (updates: any) => {
    if (!claim) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/insurance/claims/${claim.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setClaim(updated);
      toast.success('Saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (status: string) => {
    if (!claim) return;
    try {
      const res = await fetch(`/api/insurance/claims/${claim.id}/status`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setClaim(updated);
      load(); // Reload activities
      toast.success(`Status updated to ${formatStatus(status)}`);
    } catch {
      toast.error('Failed to update status');
    }
  };

  const submitActivity = async () => {
    if (!activityBody.trim()) return;
    setSubmittingActivity(true);
    try {
      const res = await fetch(`/api/insurance/claims/${claim.id}/activity`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activityType,
          body: activityBody,
          metadata: Object.keys(activityMeta).length > 0 ? activityMeta : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setActivityOpen(false);
      setActivityBody('');
      setActivityMeta({});
      load();
      toast.success('Activity logged');
    } catch {
      toast.error('Failed to log activity');
    } finally {
      setSubmittingActivity(false);
    }
  };

  const createSupplement = async () => {
    if (!supReason.trim()) { toast.error('Reason required'); return; }
    // The fields hold text while they are being typed, so this is where it becomes money. A value
    // that is not a number, or is negative, is REFUSED and named — never quietly rounded up to 0,
    // which is how a mistyped figure used to turn into a real line item. (roof T18 L7)
    const lineItems = supLineItems
      .filter((li) => String(li.description || '').trim())
      .map((li) => ({ ...li, qty: Number(li.qty), unitPrice: Number(li.unitPrice) }));
    if (!lineItems.length) { toast.error('A supplement needs at least one line item'); return; }
    if (lineItems.some((li) => !Number.isFinite(li.qty) || li.qty < 0 || !Number.isFinite(li.unitPrice) || li.unitPrice < 0)) {
      toast.error('Quantity and price must be zero or more');
      return;
    }
    const total = lineItems.reduce((s, li) => s + num0(li.total), 0);
    if (total <= 0) { toast.error('A supplement needs a total above zero'); return; }
    setSubmittingSup(true);
    try {
      // totalAmount is deliberately not sent — the server computes it from the line items.
      const res = await fetch(`/api/insurance/claims/${claim.id}/supplements`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: supReason,
          lineItems,
          notes: supNotes || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || ''); }
      setSupOpen(false);
      setSupReason('');
      setSupLineItems([newSupRow()]);
      setSupNotes('');
      load();
      toast.success('Supplement created');
    } catch (e: any) {
      // Say what the server refused. A bare "Failed to create supplement" on a 400 leaves the typist
      // re-pressing a button that will never work.
      toast.error(e?.message || 'Failed to create supplement');
    } finally {
      setSubmittingSup(false);
    }
  };

  const submitSupplement = async (supId: string) => {
    try {
      const res = await fetch(`/api/insurance/supplements/${supId}/submit`, { method: 'POST', headers });
      if (!res.ok) throw new Error();
      load();
      toast.success('Supplement submitted');
    } catch {
      toast.error('Failed to submit');
    }
  };

  // ── editing a draft, and answering a submitted one ───────────────────────────────────────────────
  // PUT /supplements/:id, POST .../approve and POST .../deny have all existed since the module was
  // built. None of them had a control anywhere in the product, so a typo in a draft could not be
  // corrected and a carrier's answer could not be recorded at all. (roof T17)
  const [editSup, setEditSup] = useState<any>(null);
  const [editReason, setEditReason] = useState('');
  const [editItems, setEditItems] = useState<any[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const [decideSup, setDecideSup] = useState<any>(null);
  const [decideMode, setDecideMode] = useState<'approve' | 'deny'>('approve');
  const [approvedAmount, setApprovedAmount] = useState('');
  const [denialReason, setDenialReason] = useState('');
  const [deciding, setDeciding] = useState(false);

  const openEditSupplement = (sup: any) => {
    setEditSup(sup);
    setEditReason(sup.reason || '');
    setEditItems((Array.isArray(sup.lineItems) ? sup.lineItems : []).map((li: any) => ({
      code: li.code || '', description: li.description || '', unit: li.unit || 'EA',
      qty: String(li.qty ?? li.quantity ?? 0), unitPrice: String(li.unitPrice ?? li.unitCost ?? 0),
    })));
  };

  const saveSupplementEdit = async () => {
    if (!editSup) return;
    const lineItems = editItems
      .filter((li) => li.description.trim())
      .map((li) => ({ code: li.code || undefined, description: li.description, unit: li.unit || 'EA', qty: Number(li.qty), unitPrice: Number(li.unitPrice) }));
    if (!lineItems.length) { toast.error('A supplement needs at least one line item'); return; }
    if (lineItems.some((li) => !Number.isFinite(li.qty) || li.qty < 0 || !Number.isFinite(li.unitPrice) || li.unitPrice < 0)) {
      toast.error('Quantity and price must be zero or more');
      return;
    }
    setSavingEdit(true);
    try {
      // totalAmount is deliberately not sent — the server computes it from the line items.
      const res = await fetch(`/api/insurance/supplements/${editSup.id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: editReason, lineItems }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || ''); }
      setEditSup(null);
      load();
      toast.success('Supplement updated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update supplement');
    } finally {
      setSavingEdit(false);
    }
  };

  const openDecide = (sup: any, mode: 'approve' | 'deny') => {
    setDecideSup(sup);
    setDecideMode(mode);
    // Changing an existing approval starts from the figure already recorded, not from the ask —
    // otherwise "change the approved amount" silently proposes reverting it. Falls back to what was
    // requested when there is nothing recorded yet. (T41)
    setApprovedAmount(mode === 'approve' ? String(sup.approvedAmount ?? sup.totalAmount ?? '') : '');
    // …and amending a denial starts from the reason on the record, for the same reason.
    setDenialReason(mode === 'deny' ? String(sup.denialReason ?? '') : '');
  };

  const decide = async () => {
    if (!decideSup) return;
    if (decideMode === 'approve') {
      const n = Number(approvedAmount);
      if (!Number.isFinite(n) || n < 0) { toast.error('Approved amount must be a number of 0 or more'); return; }
      // An approval ABOVE the ask is allowed — an adjuster adds scope and the letter comes back
      // higher — so this confirms rather than refuses, and the claim's activity line records that
      // it was above the ask. Silently accepting it is what the report objected to. (T41)
      const asked = Number(decideSup.totalAmount ?? 0);
      if (n > asked + 0.005 && !window.confirm(
        `${decideSup.supplementNumber} asked the carrier for ${fmt$(asked)}, and you are recording ${fmt$(n)}.\n\n`
        + 'That is allowed — carriers do allow more than was asked — and the claim history will say so. Record it?',
      )) return;
    } else if (!denialReason.trim()) {
      toast.error('A denial needs a reason — it is what the claim record shows later');
      return;
    }
    setDeciding(true);
    try {
      // Spelled out per branch rather than interpolating the mode: check-insurance-reachable matches
      // literal path segments, so `/${decideMode}` would read as nothing calling either endpoint.
      const url = decideMode === 'approve'
        ? `/api/insurance/supplements/${decideSup.id}/approve`
        : `/api/insurance/supplements/${decideSup.id}/deny`
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(decideMode === 'approve' ? { approvedAmount: String(Number(approvedAmount).toFixed(2)) } : { denialReason: denialReason.trim() }),
      });
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || ''); }
      setDecideSup(null);
      load();
      toast.success(decideMode === 'approve' ? 'Supplement approved' : 'Supplement denied');
    } catch (e: any) {
      toast.error(e?.message || `Failed to ${decideMode} the supplement`);
    } finally {
      setDeciding(false);
    }
  };

  /**
   * TWO SCOPES, AND THE CONTRACTOR SAYS WHICH. (T41)
   *
   * `basis: 'ask'` is every supplement that has not been denied, at the amounts requested — the
   * document that goes to the carrier, and what this button has always produced (roof T18 D3).
   * `basis: 'approved'` is only the supplements the carrier approved, reconciled to the approved
   * amount, which is what a contractor needs once the response is in. Asking for one and getting
   * the other is how an approved scope came to be overstated.
   */
  const generateExport = async (basis: 'ask' | 'approved' = 'ask') => {
    if (!claim) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/insurance/claims/${claim.id}/xactimate-export?basis=${basis}`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) throw new Error();
      const result = await res.json();
      setExportResult(result);
      load();
      toast.success('Xactimate scope generated');
    } catch {
      toast.error('Failed to generate export');
    } finally {
      setExporting(false);
    }
  };

  /**
   * Open one of the generated claim documents. (T41)
   *
   * /media/insurance/* is behind the sign-in now, and this app sends its token in an Authorization
   * header — which a browser navigation does not do. So the file is fetched with the header and
   * handed to the browser as a blob. The object URL is revoked on the next tick: the download (or
   * the tab) has already taken the bytes by then, and leaving it alive pins the whole document in
   * memory for as long as the page is open.
   *
   * A CSV is saved rather than opened, which is what the server asks for with its
   * Content-Disposition — nothing previews a CSV, and an inline one is where spreadsheet-formula
   * injection gets interesting.
   */
  const [fetchingDoc, setFetchingDoc] = useState<string | null>(null);
  const openDocument = async (url: string, filename: string) => {
    setFetchingDoc(url);
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(res.status === 401 ? 'Your session has expired — sign in again.' : 'Could not open that document.');
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      if (filename.endsWith('.csv')) a.download = filename;
      else a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 0);
    } catch (e) {
      toast.error((e as Error).message || 'Could not open that document.');
    } finally {
      setFetchingDoc(null);
    }
  };

  const saveAdjusterToDirectory = async () => {
    if (!claim?.adjusterName) { toast.error('Adjuster name required'); return; }
    try {
      const res = await fetch('/api/insurance/adjusters', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: claim.adjusterName,
          phone: claim.adjusterPhone,
          email: claim.adjusterEmail,
          adjusterCompany: claim.adjusterCompany,
          insuranceCarrier: claim.insuranceCompany,
        }),
      });
      if (!res.ok) throw new Error();
      toast.success('Saved to adjuster directory');
    } catch {
      toast.error('Failed to save adjuster');
    }
  };

  const updateSupLineItem = (idx: number, field: string, value: any) => {
    setSupLineItems(prev => prev.map((li, i) => {
      if (i !== idx) return li;
      const updated = { ...li, [field]: value };
      if (field === 'qty' || field === 'unitPrice') {
        // Half-typed text ("", "-", "1.") prices as 0 for the running total; it is not written back
        // to the field, so the typist keeps seeing exactly what they typed.
        // price0, not num0: a typed minus sign is a number, and it made the line — and the modal's
        // running total — negative, which the server has always refused. (T41)
        updated.total = Math.round(price0(updated.qty) * price0(updated.unitPrice) * 100) / 100;
      }
      if (field === 'code') {
        const match = XACT_CODES.find(c => c.code === value);
        if (match) {
          updated.description = match.desc;
          updated.unit = match.unit;
        }
      }
      return updated;
    }));
  };

  if (loading) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  }

  if (!claim) {
    const notInsurance = !!jobInfo && jobInfo.jobType !== 'insurance';
    return (
      <div className="p-6 max-w-lg mx-auto">
        <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-200">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-8 text-center">
          <Shield className="w-10 h-10 mx-auto text-gray-400 mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">No insurance claim yet</h2>

          {notInsurance ? (
            // The create endpoint refuses a non-insurance job with a 400, so say that instead of
            // offering a button that cannot work.
            <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
              This job is set to <span className="font-medium">{String(jobInfo.jobType || 'retail')}</span>. Change the job type to
              Insurance on the job first, then start the claim here.
            </p>
          ) : !startOpen ? (
            <>
              <p className="mt-2 text-sm text-gray-600 dark:text-slate-400">
                Start one to track the adjuster, inspection, supplements and the Xactimate scope.
              </p>
              <button
                onClick={() => setStartOpen(true)}
                className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold">
                <Plus className="w-4 h-4" /> Start insurance claim
              </button>
            </>
          ) : (
            <div className="mt-5 text-left space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Claim number <span className="text-red-600">*</span></label>
                <input autoFocus value={newClaim.claimNumber} onChange={(e) => setNewClaim({ ...newClaim, claimNumber: e.target.value })}
                  className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" placeholder="CLM-2026-0001" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Insurance company <span className="text-red-600">*</span></label>
                <input value={newClaim.insuranceCompany} onChange={(e) => setNewClaim({ ...newClaim, insuranceCompany: e.target.value })}
                  className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" placeholder="State Farm" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Policy number</label>
                  <input value={newClaim.policyNumber} onChange={(e) => setNewClaim({ ...newClaim, policyNumber: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Date of loss</label>
                  <input type="date" value={newClaim.dateOfLoss} onChange={(e) => setNewClaim({ ...newClaim, dateOfLoss: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Cause of loss</label>
                  <select value={newClaim.causeOfLoss} onChange={(e) => setNewClaim({ ...newClaim, causeOfLoss: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700">
                    <option value="">—</option>
                    <option value="hail">Hail</option>
                    <option value="wind">Wind</option>
                    <option value="fire">Fire</option>
                    <option value="water">Water</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Deductible</label>
                  <input type="number" min="0" step="0.01" inputMode="decimal" value={newClaim.deductible}
                    onChange={(e) => setNewClaim({ ...newClaim, deductible: e.target.value })}
                    className="w-full text-sm border rounded-lg px-3 py-2 dark:bg-slate-800 dark:border-slate-700" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={createClaim} disabled={creating}
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white rounded-lg text-sm font-semibold">
                  {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : 'Start claim'}
                </button>
                <button onClick={() => setStartOpen(false)} disabled={creating}
                  className="px-4 py-2 border border-gray-300 dark:border-slate-700 rounded-lg text-sm text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // The money on an insurance job, totalled the way the scope export in services/xactimate.ts already
  // totals it — and the way the trade reads it.
  //
  // What was here computed `(finalApprovedAmount || rcv) - deductible` and called it "Net to
  // Contractor". That is wrong three ways at once:
  //
  //   1. APPROVED SUPPLEMENTS WERE LEFT OUT. The panel printed "Supplement Total $4,200" one row above
  //      a headline that excluded it. Supplementing is the whole profit lever on a restoration job —
  //      an approved supplement is a revised carrier scope, and it RAISES the claim. The scope export
  //      has always added supplement line items into its subtotal; only this panel disagreed.
  //   2. It subtracted the deductible from an RCV figure. The export subtracts it from ACV, which is
  //      the correct ladder: depreciation comes off first, and the deductible comes off the cheque the
  //      carrier writes, not off the value of the job.
  //   3. The deductible is not lost revenue at all. The homeowner pays it TO the contractor. Netting it
  //      out of the headline understated the job by exactly the amount collected at the door.
  //
  // So the headline is the total approved claim, and the ladder under it shows where the money lands.
  // `finalApprovedAmount` stays authoritative when it has been entered — a carrier's revised figure
  // beats our arithmetic — and the ladder says so, so a stale entry is visible rather than silent.
  // (roof T18 D3)
  const baseRcv = Number(claim.rcv || 0);
  const supTotal = Number(claim.supplementAmount || 0);
  const hasFinal = claim.finalApprovedAmount != null && String(claim.finalApprovedAmount) !== '';
  const totalApproved = hasFinal ? Number(claim.finalApprovedAmount) : baseRcv + supTotal;
  const depHeld = Number(claim.depreciationHeld || 0);
  const deductible = Number(claim.deductible || 0);
  const acvNow = totalApproved - depHeld;
  const carrierFirstCheck = acvNow - deductible;
  const daysSinceLoss = claim.dateOfLoss ? Math.floor((Date.now() - new Date(claim.dateOfLoss).getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 dark:bg-slate-900">
        <button onClick={() => navigate(`/crm/jobs/${jobId}`)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 mb-3 dark:text-slate-400">
          <ArrowLeft className="w-4 h-4" /> Back to Job
        </button>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-orange-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Insurance Claim — {claim.claimNumber}</h1>
          {claim.claimStatus === 'denied' && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-700">DENIED</span>
          )}
          {daysSinceLoss !== null && daysSinceLoss > 45 && (
            <span className="flex items-center gap-1 text-xs font-semibold text-red-600">
              <AlertTriangle className="w-3.5 h-3.5" /> {daysSinceLoss}d since loss
            </span>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* LEFT — Timeline (2 cols) */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Claim Timeline</h2>
              {/* POST /claims/:id/activity asks insurance:create. A crew reads the trail — it is
                  how they know where the claim stands — and does not write to it. (T41) */}
              {mayWriteClaim && (
                <button onClick={() => setActivityOpen(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <Plus className="w-3.5 h-3.5" /> Log Activity
                </button>
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4 max-h-[600px] overflow-y-auto dark:bg-slate-900">
              {activityError ? (
                <p className="text-sm text-amber-700 dark:text-amber-300 text-center py-8">
                  {activityError === 'notAllowed'
                    ? 'Your role cannot see this claim’s history.'
                    : 'The claim history could not be loaded. Reload the page to try again.'}
                </p>
              ) : activities.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400 text-center py-8">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a, i) => {
                    const iconType = ACTIVITY_ICONS[a.activityType] || 'clock';
                    return (
                      <div key={a.id || i} className="flex gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center dark:bg-slate-800">
                          {iconType === 'phone' && <Phone className="w-3.5 h-3.5 text-blue-500" />}
                          {iconType === 'mail' && <Mail className="w-3.5 h-3.5 text-purple-500" />}
                          {iconType === 'check' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                          {iconType === 'x' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                          {iconType === 'doc' && <FileText className="w-3.5 h-3.5 text-orange-500" />}
                          {iconType === 'upload' && <Upload className="w-3.5 h-3.5 text-gray-500 dark:text-slate-400" />}
                          {iconType === 'clock' && <Clock className="w-3.5 h-3.5 text-gray-400" />}
                          {iconType === 'msg' && <MessageSquare className="w-3.5 h-3.5 text-blue-400" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900 dark:text-slate-100">{a.body}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-slate-400">
                            <span>{a.createdAt ? new Date(a.createdAt).toLocaleString() : ''}</span>
                            {a.metadata?.callDuration && <span>({a.metadata.callDuration} min)</span>}
                            {a.metadata?.subject && <span>Subject: {a.metadata.subject}</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — Claim Details (3 cols) */}
          <div className="lg:col-span-3 space-y-6">
            {/* Claim Status Stepper */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 dark:text-slate-100">Claim Status</h3>
              <div className="flex items-center gap-1 overflow-x-auto pb-2">
                {CLAIM_STAGES.map((stage, i) => {
                  const currentIdx = CLAIM_STAGES.indexOf(claim.claimStatus as any);
                  const stageIdx = i;
                  const isActive = claim.claimStatus === stage;
                  const isPast = stageIdx < currentIdx;
                  const isDenied = claim.claimStatus === 'denied';

                  return (
                    <div key={stage} className="flex items-center">
                      <button
                        onClick={() => updateStatus(stage)}
                        className={`flex flex-col items-center px-2 py-1.5 rounded-lg text-[10px] font-medium transition min-w-[80px] ${
                          isActive ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300' :
                          isPast ? 'bg-green-50 text-green-700' :
                          'bg-gray-50 text-gray-600 hover:bg-gray-100'
                        } ${isDenied && isActive ? 'bg-red-100 text-red-700 ring-red-300' : ''}`}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center mb-1 ${
                          isActive ? 'bg-blue-600 text-white' :
                          isPast ? 'bg-green-500 text-white' :
                          'bg-gray-200 text-gray-600'
                        }`}>
                          {isPast ? <CheckCircle className="w-3 h-3" /> : <span className="text-[8px]">{i + 1}</span>}
                        </div>
                        {CLAIM_STAGE_LABELS[stage]}
                      </button>
                      {i < CLAIM_STAGES.length - 1 && (
                        <ChevronRight className={`w-3 h-3 mx-0.5 flex-shrink-0 ${isPast ? 'text-green-400' : 'text-gray-300'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              {claim.claimStatus === 'denied' && claim.denialReason && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
                  <strong>Denial Reason:</strong> {claim.denialReason}
                </div>
              )}
            </div>

            {/* Claim Info */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 mb-4 dark:text-slate-100">Claim Info</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Claim Number</label>
                  <input defaultValue={claim.claimNumber || ''} onBlur={(e) => saveClaim({ claimNumber: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Insurance Company</label>
                  <input defaultValue={claim.insuranceCompany || ''} onBlur={(e) => saveClaim({ insuranceCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Policy Number</label>
                  <input defaultValue={claim.policyNumber || ''} onBlur={(e) => saveClaim({ policyNumber: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Date of Loss</label>
                  <input type="date" defaultValue={claim.dateOfLoss ? new Date(claim.dateOfLoss).toISOString().split('T')[0] : ''} onBlur={(e) => saveClaim({ dateOfLoss: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Cause of Loss</label>
                  <select defaultValue={claim.causeOfLoss || ''} onChange={(e) => saveClaim({ causeOfLoss: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                    <option value="">Select...</option>
                    <option value="hail">Hail</option>
                    <option value="wind">Wind</option>
                    <option value="fire">Fire</option>
                    <option value="water">Water</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Adjuster Inspection Date</label>
                  <input type="date" defaultValue={claim.adjusterInspectionDate ? new Date(claim.adjusterInspectionDate).toISOString().split('T')[0] : ''} onBlur={(e) => saveClaim({ adjusterInspectionDate: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>

              {/* Adjuster */}
              <h4 className="text-xs font-semibold text-gray-700 mt-5 mb-2 dark:text-slate-200">Adjuster</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Name</label>
                  <input defaultValue={claim.adjusterName || ''} onBlur={(e) => saveClaim({ adjusterName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Phone</label>
                  <input defaultValue={claim.adjusterPhone || ''} onBlur={(e) => saveClaim({ adjusterPhone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Email</label>
                  <input defaultValue={claim.adjusterEmail || ''} onBlur={(e) => saveClaim({ adjusterEmail: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Company</label>
                  <input defaultValue={claim.adjusterCompany || ''} onBlur={(e) => saveClaim({ adjusterCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <button onClick={saveAdjusterToDirectory} className="mt-3 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">
                Save to Adjuster Directory
              </button>
            </div>

            {/* Financials */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <DollarSign className="w-4 h-4 text-green-500" /> Financials
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Deductible</label>
                  <input defaultValue={claim.deductible || ''} onBlur={(e) => saveClaim({ deductible: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">RCV</label>
                  <input defaultValue={claim.rcv || ''} onBlur={(e) => saveClaim({ rcv: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">ACV</label>
                  <input defaultValue={claim.acv || ''} onBlur={(e) => saveClaim({ acv: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Depreciation Held</label>
                  <input defaultValue={claim.depreciationHeld || ''} onBlur={(e) => saveClaim({ depreciationHeld: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Supplement Total</label>
                  <p className="text-sm font-medium text-gray-900 px-3 py-2 dark:text-slate-100">{fmt$(claim.supplementAmount)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Final Approved</label>
                  <input defaultValue={claim.finalApprovedAmount || ''} onBlur={(e) => saveClaim({ finalApprovedAmount: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
              </div>
              {/* NOTHING APPROVED YET MEANS THERE IS NO CHEQUE TO WORK OUT. (T41)
                  "Claim financials show 'Carrier's first cheque (ACV net) $-1,000.00' before an RCV
                   is entered." With no RCV and no final figure, totalApproved is 0, so the
                   breakdown subtracted the deductible from nothing and printed a NEGATIVE cheque —
                   a number that says the carrier will be sending the homeowner a bill. The
                   arithmetic is right once there is something to do it to; before that it has no
                   meaning, so the panel says what is missing instead of showing a figure. */}
              {totalApproved <= 0 ? (
                <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Enter the carrier&rsquo;s RCV above and this will work out the first cheque — the approved
                  total less depreciation held and less the deductible you collect from the homeowner.
                </div>
              ) : (
              <div className="mt-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/25">
                <div className="flex items-center justify-between p-3">
                  <span className="text-sm font-medium text-green-800 dark:text-green-200">Total approved (RCV)</span>
                  <span className="text-lg font-bold text-green-700 dark:text-green-200">{fmt$(totalApproved)}</span>
                </div>
                <dl className="border-t border-green-200 dark:border-green-800 px-3 py-2 text-xs text-green-900 dark:text-green-100">
                  {hasFinal ? (
                    <div className="flex justify-between py-0.5">
                      <dt>Carrier&rsquo;s final approved figure</dt>
                      <dd className="tabular-nums">{fmt$(claim.finalApprovedAmount)}</dd>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between py-0.5">
                        <dt>Original RCV</dt>
                        <dd className="tabular-nums">{fmt$(baseRcv)}</dd>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <dt>Approved supplements</dt>
                        <dd className="tabular-nums">+ {fmt$(supTotal)}</dd>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between py-0.5">
                    <dt>Less depreciation held</dt>
                    <dd className="tabular-nums">&minus; {fmt$(depHeld)}</dd>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <dt>Less deductible &mdash; you collect this from the homeowner</dt>
                    <dd className="tabular-nums">&minus; {fmt$(deductible)}</dd>
                  </div>
                  <div className="flex justify-between py-1 mt-1 border-t border-green-200 dark:border-green-800 font-semibold">
                    <dt>Carrier&rsquo;s first cheque (ACV net)</dt>
                    {/* Floored at zero: a cheque is money coming IN, and a negative one reads as the
                        carrier invoicing the contractor. The note below says what a zero means. */}
                    <dd className="tabular-nums">{fmt$(Math.max(0, carrierFirstCheck))}</dd>
                  </div>
                  {depHeld > 0 && (
                    <p className="pt-1.5 text-green-800 dark:text-green-200">
                      {fmt$(depHeld)} of recoverable depreciation is released once the work is complete and invoiced.
                    </p>
                  )}
                  {/* It can still come out negative with a real RCV — a small claim under a big
                      deductible genuinely pays nothing. Say that, rather than printing a cheque
                      for minus money. */}
                  {carrierFirstCheck <= 0 && (
                    <p className="pt-1.5 text-green-800 dark:text-green-200">
                      The deductible is larger than what the carrier allowed after depreciation, so there is no
                      first cheque on this claim — the homeowner covers the work.
                    </p>
                  )}
                </dl>
              </div>
              )}
            </div>

            {/* Documents / Xactimate */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4 dark:text-slate-100">
                <FileText className="w-4 h-4 text-gray-400" /> Documents & Xactimate Export
              </h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {/* FETCHED WITH THE TOKEN, not opened as a plain link. (T41)
                    "Export PDF and CSV links under /media/insurance/ open without signing in
                    (random IDs)." /media/insurance/* now requires a signed-in caller whose company
                    owns the key — and this app authenticates with a Bearer header, which a plain
                    <a href> navigation does not send. Left as a link it would simply 401, so
                    closing the hole on the server without changing this would have broken the
                    button. Same rule as everywhere else: a new refusal needs its client. */}
                {claim.xactimateScopeUrl && (
                  <button type="button" onClick={() => openDocument(claim.xactimateScopeUrl!, `scope-${claim.claimNumber || claim.id}.pdf`)} disabled={!!fetchingDoc} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200 disabled:opacity-50">
                    {fetchingDoc === claim.xactimateScopeUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Scope PDF
                  </button>
                )}
                {claim.xactimateExportUrl && (
                  <button type="button" onClick={() => openDocument(claim.xactimateExportUrl!, `scope-${claim.claimNumber || claim.id}.csv`)} disabled={!!fetchingDoc} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 disabled:opacity-50">
                    {fetchingDoc === claim.xactimateExportUrl ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} CSV Export
                  </button>
                )}
              </div>
              {/* Two documents, named for what they are rather than hidden behind one button. (T41) */}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => generateExport('ask')} disabled={exporting} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {exporting ? 'Building scope...' : 'Scope as requested'}
                </button>
                <button onClick={() => generateExport('approved')} disabled={exporting} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-green-700 text-white rounded-lg hover:bg-green-800 disabled:opacity-50">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  {exporting ? 'Building scope...' : 'Scope as approved'}
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400 max-w-prose">
                <strong>As requested</strong> is the document you send the carrier: every supplement that has
                not been denied, at the amounts you asked for. <strong>As approved</strong> is the settled
                scope: only supplements the carrier approved, brought to the amount they approved.
              </p>

              {exportResult && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
                  {/* Which of the two documents this table is, so the figures are never read as the
                      other one. (T41) */}
                  <p className="text-xs font-semibold text-gray-700 mb-2 dark:text-slate-200">
                    Generated Line Items ({exportResult.lineItems?.length || 0})
                    {exportResult.basis === 'approved'
                      ? <span className="ml-2 font-normal text-green-700 dark:text-green-300">— as approved by the carrier</span>
                      : <span className="ml-2 font-normal text-orange-700 dark:text-orange-300">— as requested</span>}
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-gray-500 dark:text-slate-400">
                        <th className="text-left pb-1">Code</th>
                        <th className="text-left pb-1">Description</th>
                        <th className="text-right pb-1">Qty</th>
                        <th className="text-right pb-1">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exportResult.lineItems?.map((li: any, i: number) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 font-mono">{li.code}</td>
                          <td className="py-1">{li.description}</td>
                          <td className="py-1 text-right">{li.qty} {li.unit}</td>
                          <td className="py-1 text-right">{fmt$(li.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {exportResult.totals && (
                    <div className="mt-3 pt-3 border-t space-y-1 text-xs">
                      <div className="flex justify-between"><span>Subtotal</span><span>{fmt$(exportResult.totals.subtotal)}</span></div>
                      <div className="flex justify-between"><span>O&P (10%+10%)</span><span>{fmt$(exportResult.totals.overhead + exportResult.totals.profit)}</span></div>
                      <div className="flex justify-between font-bold"><span>RCV Total</span><span>{fmt$(exportResult.totals.rcvTotal)}</span></div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Supplements */}
            <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Supplements</h3>
                {/* POST /claims/:id/supplements asks insurance:create. (T41) */}
                {mayWriteClaim && (
                  <button onClick={() => setSupOpen(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                    <Plus className="w-3.5 h-3.5" /> Add Supplement
                  </button>
                )}
              </div>
              {supplements.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400">No supplements yet</p>
              ) : (
                <div className="space-y-3">
                  {supplements.map((sup) => (
                    <div key={sup.id} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono font-semibold">{sup.supplementNumber}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${SUP_STATUS_COLORS[sup.status] || 'bg-gray-100'}`}>
                            {formatStatus(sup.status)}
                          </span>
                        </div>
                        <span className="text-sm font-bold">{fmt$(sup.totalAmount)}</span>
                      </div>
                      <p className="text-sm text-gray-600 mb-2 dark:text-slate-400">{sup.reason}</p>
                      {Array.isArray(sup.lineItems) && sup.lineItems.length > 0 && (
                        <table className="w-full text-xs mb-2">
                          <tbody>
                            {sup.lineItems.map((li: any, i: number) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-0.5 font-mono text-gray-500 dark:text-slate-400">{li.code || '—'}</td>
                                <td className="py-0.5">{li.description}</td>
                                <td className="py-0.5 text-right">{fmt$(li.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {sup.status === 'approved' && sup.approvedAmount && (
                        <p className="text-xs text-green-700 font-medium dark:text-green-300">Approved: {fmt$(sup.approvedAmount)}</p>
                      )}
                      {sup.status === 'denied' && sup.denialReason && (
                        <p className="text-xs text-red-700 dark:text-red-300">Denied: {sup.denialReason}</p>
                      )}
                      {sup.status === 'draft' && mayWriteClaim && (
                        <div className="mt-2 flex items-center gap-4">
                          <button onClick={() => submitSupplement(sup.id)} className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 font-medium hover:text-blue-800 dark:hover:text-blue-300">
                            <Send className="w-3 h-3" /> Submit to Carrier
                          </button>
                          <button onClick={() => openEditSupplement(sup)} className="flex items-center gap-1 text-xs text-gray-600 font-medium hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200">
                            <Save className="w-3 h-3" /> Edit
                          </button>
                        </div>
                      )}
                      {/* A CARRIER'S DECISION IS NOT FINAL, AND THE SCREEN HAS TO SAY SO. (T41)
                          "No on-screen way to change an approved supplement: once approved it shows
                           only 'Approved: $X', so re-approve and deny work only through the API."
                          Carriers come back with a different number, or deny what they had allowed.
                          The server accepts those transitions (routes/insurance.ts DECIDABLE covers
                          submitted, approved and denied — a DRAFT is excluded, because a supplement
                          nobody sent has no decision to record). So the same two controls are
                          offered on all three, worded for what they do from here. */}
                      {['submitted', 'approved', 'denied'].includes(sup.status) && (
                        canDecide ? (
                          <div className="mt-2 flex items-center gap-4 flex-wrap">
                            <button onClick={() => openDecide(sup, 'approve')} className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium hover:text-green-800 dark:hover:text-green-300">
                              <CheckCircle className="w-3 h-3" /> {sup.status === 'approved' ? 'Change the approved amount' : sup.status === 'denied' ? 'Record an approval instead' : 'Record Approval'}
                            </button>
                            <button onClick={() => openDecide(sup, 'deny')} className="flex items-center gap-1 text-xs text-red-700 dark:text-red-400 font-medium hover:text-red-800 dark:hover:text-red-300">
                              <XCircle className="w-3 h-3" /> {sup.status === 'approved' ? 'Record a denial instead' : sup.status === 'denied' ? 'Change the denial reason' : 'Record Denial'}
                            </button>
                          </div>
                        ) : sup.status === 'submitted' ? (
                          <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Awaiting the carrier. A manager records their answer.</p>
                        ) : null
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Activity Modal ── */}
      {activityOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setActivityOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Log Activity</h2>
              <button onClick={() => setActivityOpen(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Type</label>
                <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="note">Note</option>
                  <option value="call">Phone Call</option>
                  <option value="email">Email</option>
                  <option value="inspection">Inspection</option>
                  <option value="document_uploaded">Document Upload</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Details</label>
                <textarea value={activityBody} onChange={(e) => setActivityBody(e.target.value)} rows={3} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="What happened?" />
              </div>
              {activityType === 'call' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Duration (minutes)</label>
                  <input type="number" value={activityMeta.callDuration || ''} onChange={(e) => setActivityMeta({ ...activityMeta, callDuration: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              )}
              {activityType === 'email' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Subject</label>
                  <input value={activityMeta.subject || ''} onChange={(e) => setActivityMeta({ ...activityMeta, subject: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setActivityOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={submitActivity} disabled={submittingActivity} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {submittingActivity ? 'Saving...' : 'Log'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Supplement Modal ── */}
      {supOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSupOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Add Supplement</h2>
              <button onClick={() => setSupOpen(false)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Reason for Supplement *</label>
                <textarea value={supReason} onChange={(e) => setSupReason(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="Why is this supplement needed?" />
              </div>

              {/* Line items */}
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-2 dark:text-slate-200">Line Items</label>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b dark:text-slate-400">
                      <th className="pb-1 w-32">Code</th>
                      <th className="pb-1">Description</th>
                      <th className="pb-1 w-16 text-right">Qty</th>
                      <th className="pb-1 w-16 text-center">Unit</th>
                      <th className="pb-1 w-20 text-right">Price</th>
                      <th className="pb-1 w-20 text-right">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {supLineItems.map((li, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1 pr-1">
                          <select value={li.code} onChange={(e) => updateSupLineItem(i, 'code', e.target.value)} className="w-full text-xs border rounded px-1 py-1">
                            <option value="">Select...</option>
                            {XACT_CODES.map(c => (
                              <option key={c.code} value={c.code}>{c.code}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 pr-1">
                          <input value={li.description} onChange={(e) => updateSupLineItem(i, 'description', e.target.value)} className="w-full text-xs border rounded px-1 py-1" />
                        </td>
                        <td className="py-1 pr-1">
                          <input type="number" min="0" step="any" inputMode="decimal" value={li.qty}
                            onChange={(e) => updateSupLineItem(i, 'qty', e.target.value)}
                            className="w-full text-xs border rounded px-1 py-1 text-right" />
                        </td>
                        <td className="py-1 pr-1">
                          <input value={li.unit} onChange={(e) => updateSupLineItem(i, 'unit', e.target.value)} className="w-full text-xs border rounded px-1 py-1 text-center" />
                        </td>
                        <td className="py-1 pr-1">
                          {/* Holds the raw text: see num0/newSupRow above. Coercing here is what let
                              a typed -1500 come back as a different positive number with no warning. */}
                          <input type="number" min="0" step="0.01" inputMode="decimal" value={li.unitPrice}
                            onChange={(e) => updateSupLineItem(i, 'unitPrice', e.target.value)}
                            className="w-full text-xs border rounded px-1 py-1 text-right" />
                        </td>
                        <td className="py-1 pr-1 text-right text-xs font-medium">{fmt$(li.total)}</td>
                        <td className="py-1">
                          {supLineItems.length > 1 && (
                            <button onClick={() => setSupLineItems(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 dark:hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={() => setSupLineItems(prev => [...prev, newSupRow()])} className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium">
                  + Add Line Item
                </button>
                <div className="flex flex-col items-end mt-2">
                  <span className="text-sm font-bold">Total: {fmt$(supLineItems.reduce((s, li) => s + price0(li.total), 0))}</span>
                  {anyNegative(supLineItems) && (
                    <span className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      A quantity or price is negative. Those lines count as nothing here, and the carrier
                      cannot be asked for a negative amount — use a separate credit instead.
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Notes (optional)</label>
                <textarea value={supNotes} onChange={(e) => setSupNotes(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setSupOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={createSupplement} disabled={submittingSup} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {submittingSup ? 'Creating...' : 'Save as Draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit a DRAFT supplement. The server refuses anything else, and recomputes the total from the
          line items — this form never sends one. */}
      {editSup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditSup(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 max-h-[90vh] overflow-y-auto dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Edit {editSup.supplementNumber}</h2>
              <button onClick={() => setEditSup(null)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Reason</label>
            <textarea value={editReason} onChange={(e) => setEditReason(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2 mb-4" placeholder="Why is this supplement needed?" />

            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 dark:text-slate-400">Line items</label>
              <button onClick={() => setEditItems([...editItems, { code: '', description: '', unit: 'EA', qty: '1', unitPrice: '0' }])} className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300">+ Add line</button>
            </div>
            <div className="space-y-2">
              {editItems.map((li, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <input value={li.code} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} placeholder="Code" className="col-span-2 text-sm border rounded-lg px-2 py-1.5 font-mono" />
                  <input value={li.description} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} placeholder="Description" className="col-span-4 text-sm border rounded-lg px-2 py-1.5" />
                  <input value={li.unit} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} placeholder="Unit" className="col-span-1 text-sm border rounded-lg px-2 py-1.5" />
                  <input type="number" min="0" step="0.01" value={li.qty} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} placeholder="Qty" className="col-span-2 text-sm border rounded-lg px-2 py-1.5" />
                  <input type="number" min="0" step="0.01" value={li.unitPrice} onChange={(e) => setEditItems(editItems.map((x, j) => j === i ? { ...x, unitPrice: e.target.value } : x))} placeholder="Unit price" className="col-span-2 text-sm border rounded-lg px-2 py-1.5" />
                  <button onClick={() => setEditItems(editItems.filter((_, j) => j !== i))} aria-label="Remove line" className="col-span-1 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-400"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-gray-600 dark:text-slate-400">
              {/* The EDIT modal had the same negative-total fault as the create one, one screen
                  along — a report naming one is not a reason to leave its sibling. (T41) */}
              Total <span className="font-bold text-gray-900 dark:text-slate-100">{fmt$(editItems.reduce((s, li) => s + price0(li.qty) * price0(li.unitPrice), 0).toFixed(2))}</span>
              {anyNegative(editItems) && (
                <span className="block text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                  A quantity or price is negative. Those lines count as nothing here, and the carrier cannot
                  be asked for a negative amount.
                </span>
              )}
              <span className="text-xs"> — calculated from the lines above; the server recomputes it on save.</span>
            </p>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditSup(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-slate-400">Cancel</button>
              <button onClick={saveSupplementEdit} disabled={savingEdit} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {savingEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record the carrier's answer on a SUBMITTED supplement. Manager and above — the server says so
          too, so this is not the only thing standing between a field tech and the decision. */}
      {decideSup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDecideSup(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">
                {decideMode === 'approve' ? 'Record approval' : 'Record denial'} — {decideSup.supplementNumber}
              </h2>
              <button onClick={() => setDecideSup(null)} className="text-gray-500 dark:text-slate-400 hover:text-gray-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">Requested {fmt$(decideSup.totalAmount)}</p>

            {decideMode === 'approve' ? (
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Amount the carrier approved *</label>
                <input type="number" min="0" step="0.01" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} className="w-full text-sm border rounded-lg px-3 py-2" />
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                  A carrier often approves less than was asked. The claim&rsquo;s supplement total is the sum of what is approved, so this figure is the one that moves the money.
                </p>
              </div>
            ) : (
              <div>
                <label className="text-xs text-gray-500 block mb-1 dark:text-slate-400">Reason given *</label>
                <textarea value={denialReason} onChange={(e) => setDenialReason(e.target.value)} rows={3} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="What the carrier said" />
                <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Denying one that had been approved takes its amount back off the claim.</p>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setDecideSup(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg dark:text-slate-400">Cancel</button>
              <button
                onClick={decide}
                disabled={deciding}
                className={`px-4 py-2 text-sm text-white rounded-lg disabled:opacity-50 ${decideMode === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
              >
                {deciding ? 'Saving...' : decideMode === 'approve' ? 'Record Approval' : 'Record Denial'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
