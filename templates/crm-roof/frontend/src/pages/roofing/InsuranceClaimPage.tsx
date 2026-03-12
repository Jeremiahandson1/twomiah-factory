import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Shield, Phone, Mail, FileText, Plus, X, Send,
  CheckCircle, XCircle, Clock, MessageSquare, Upload, Download,
  AlertTriangle, DollarSign, Save, ChevronRight, Loader2,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
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
  const { id: jobId } = useParams<{ id: string }>();
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

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
  const [supLineItems, setSupLineItems] = useState<any[]>([{ code: '', description: '', qty: 1, unit: 'SQ', unitPrice: 0, total: 0 }]);
  const [supNotes, setSupNotes] = useState('');
  const [submittingSup, setSubmittingSup] = useState(false);

  // Xactimate export
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<any>(null);

  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    try {
      const claimRes = await fetch(`/api/insurance/claims/${jobId}`, { headers });
      if (!claimRes.ok) { setClaim(null); setLoading(false); return; }
      const claimData = await claimRes.json();
      setClaim(claimData);

      const [actRes, supRes] = await Promise.all([
        fetch(`/api/insurance/claims/${claimData.id}/activity`, { headers }),
        fetch(`/api/insurance/claims/${claimData.id}/supplements`, { headers }),
      ]);
      setActivities(actRes.ok ? await actRes.json() : []);
      setSupplements(supRes.ok ? await supRes.json() : []);
    } catch {
      toast.error('Failed to load claim');
    } finally {
      setLoading(false);
    }
  }, [jobId, token]);

  useEffect(() => { load(); }, [load]);

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
    const total = supLineItems.reduce((s, li) => s + Number(li.total || 0), 0);
    if (total <= 0) { toast.error('Add line items'); return; }
    setSubmittingSup(true);
    try {
      const res = await fetch(`/api/insurance/claims/${claim.id}/supplements`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: supReason,
          lineItems: supLineItems,
          totalAmount: String(total),
          notes: supNotes || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setSupOpen(false);
      setSupReason('');
      setSupLineItems([{ code: '', description: '', qty: 1, unit: 'SQ', unitPrice: 0, total: 0 }]);
      setSupNotes('');
      load();
      toast.success('Supplement created');
    } catch {
      toast.error('Failed to create supplement');
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

  const generateExport = async () => {
    if (!claim) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/insurance/claims/${claim.id}/xactimate-export`, {
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
        updated.total = Math.round(Number(updated.qty || 0) * Number(updated.unitPrice || 0) * 100) / 100;
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
    return <div className="p-6 text-center text-gray-500">No insurance claim found for this job.</div>;
  }

  const netToCont = Number(claim.finalApprovedAmount || claim.rcv || 0) - Number(claim.deductible || 0);
  const daysSinceLoss = claim.dateOfLoss ? Math.floor((Date.now() - new Date(claim.dateOfLoss).getTime()) / (1000 * 60 * 60 * 24)) : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <button onClick={() => navigate(`/crm/jobs/${jobId}`)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <ArrowLeft className="w-4 h-4" /> Back to Job
        </button>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-orange-500" />
          <h1 className="text-xl font-bold text-gray-900">Insurance Claim — {claim.claimNumber}</h1>
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
              <h2 className="text-sm font-semibold text-gray-900">Claim Timeline</h2>
              <button onClick={() => setActivityOpen(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                <Plus className="w-3.5 h-3.5" /> Log Activity
              </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4 max-h-[600px] overflow-y-auto">
              {activities.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
              ) : (
                <div className="space-y-3">
                  {activities.map((a, i) => {
                    const iconType = ACTIVITY_ICONS[a.activityType] || 'clock';
                    return (
                      <div key={a.id || i} className="flex gap-3">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                          {iconType === 'phone' && <Phone className="w-3.5 h-3.5 text-blue-500" />}
                          {iconType === 'mail' && <Mail className="w-3.5 h-3.5 text-purple-500" />}
                          {iconType === 'check' && <CheckCircle className="w-3.5 h-3.5 text-green-500" />}
                          {iconType === 'x' && <XCircle className="w-3.5 h-3.5 text-red-500" />}
                          {iconType === 'doc' && <FileText className="w-3.5 h-3.5 text-orange-500" />}
                          {iconType === 'upload' && <Upload className="w-3.5 h-3.5 text-gray-500" />}
                          {iconType === 'clock' && <Clock className="w-3.5 h-3.5 text-gray-400" />}
                          {iconType === 'msg' && <MessageSquare className="w-3.5 h-3.5 text-blue-400" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-900">{a.body}</p>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
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
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Claim Status</h3>
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
                          'bg-gray-50 text-gray-400 hover:bg-gray-100'
                        } ${isDenied && isActive ? 'bg-red-100 text-red-700 ring-red-300' : ''}`}
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center mb-1 ${
                          isActive ? 'bg-blue-600 text-white' :
                          isPast ? 'bg-green-500 text-white' :
                          'bg-gray-200 text-gray-400'
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
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Claim Info</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Claim Number</label>
                  <input defaultValue={claim.claimNumber || ''} onBlur={(e) => saveClaim({ claimNumber: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Insurance Company</label>
                  <input defaultValue={claim.insuranceCompany || ''} onBlur={(e) => saveClaim({ insuranceCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Policy Number</label>
                  <input defaultValue={claim.policyNumber || ''} onBlur={(e) => saveClaim({ policyNumber: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Date of Loss</label>
                  <input type="date" defaultValue={claim.dateOfLoss ? new Date(claim.dateOfLoss).toISOString().split('T')[0] : ''} onBlur={(e) => saveClaim({ dateOfLoss: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Cause of Loss</label>
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
                  <label className="text-xs text-gray-500 block mb-1">Adjuster Inspection Date</label>
                  <input type="date" defaultValue={claim.adjusterInspectionDate ? new Date(claim.adjusterInspectionDate).toISOString().split('T')[0] : ''} onBlur={(e) => saveClaim({ adjusterInspectionDate: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>

              {/* Adjuster */}
              <h4 className="text-xs font-semibold text-gray-700 mt-5 mb-2">Adjuster</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Name</label>
                  <input defaultValue={claim.adjusterName || ''} onBlur={(e) => saveClaim({ adjusterName: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Phone</label>
                  <input defaultValue={claim.adjusterPhone || ''} onBlur={(e) => saveClaim({ adjusterPhone: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <input defaultValue={claim.adjusterEmail || ''} onBlur={(e) => saveClaim({ adjusterEmail: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Company</label>
                  <input defaultValue={claim.adjusterCompany || ''} onBlur={(e) => saveClaim({ adjusterCompany: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <button onClick={saveAdjusterToDirectory} className="mt-3 text-xs text-blue-600 hover:text-blue-800 font-medium">
                Save to Adjuster Directory
              </button>
            </div>

            {/* Financials */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <DollarSign className="w-4 h-4 text-green-500" /> Financials
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Deductible</label>
                  <input defaultValue={claim.deductible || ''} onBlur={(e) => saveClaim({ deductible: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">RCV</label>
                  <input defaultValue={claim.rcv || ''} onBlur={(e) => saveClaim({ rcv: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">ACV</label>
                  <input defaultValue={claim.acv || ''} onBlur={(e) => saveClaim({ acv: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Depreciation Held</label>
                  <input defaultValue={claim.depreciationHeld || ''} onBlur={(e) => saveClaim({ depreciationHeld: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Supplement Total</label>
                  <p className="text-sm font-medium text-gray-900 px-3 py-2">{fmt$(claim.supplementAmount)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Final Approved</label>
                  <input defaultValue={claim.finalApprovedAmount || ''} onBlur={(e) => saveClaim({ finalApprovedAmount: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="$0.00" />
                </div>
              </div>
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
                <span className="text-sm font-medium text-green-800">Net to Contractor</span>
                <span className="text-lg font-bold text-green-700">{fmt$(netToCont > 0 ? netToCont : 0)}</span>
              </div>
            </div>

            {/* Documents / Xactimate */}
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2 mb-4">
                <FileText className="w-4 h-4 text-gray-400" /> Documents & Xactimate Export
              </h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {claim.xactimateScopeUrl && (
                  <a href={claim.xactimateScopeUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-purple-100 text-purple-700 rounded-lg hover:bg-purple-200">
                    <Download className="w-3.5 h-3.5" /> Scope PDF
                  </a>
                )}
                {claim.xactimateExportUrl && (
                  <a href={claim.xactimateExportUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200">
                    <Download className="w-3.5 h-3.5" /> CSV Export
                  </a>
                )}
              </div>
              <button onClick={generateExport} disabled={exporting} className="flex items-center gap-1.5 px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {exporting ? 'Building scope...' : 'Generate Xactimate Export'}
              </button>

              {exportResult && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                  <p className="text-xs font-semibold text-gray-700 mb-2">Generated Line Items ({exportResult.lineItems?.length || 0})</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-gray-500">
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
            <div className="bg-white rounded-xl shadow-sm border p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-900">Supplements</h3>
                <button onClick={() => setSupOpen(true)} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                  <Plus className="w-3.5 h-3.5" /> Add Supplement
                </button>
              </div>
              {supplements.length === 0 ? (
                <p className="text-sm text-gray-400">No supplements yet</p>
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
                      <p className="text-sm text-gray-600 mb-2">{sup.reason}</p>
                      {Array.isArray(sup.lineItems) && sup.lineItems.length > 0 && (
                        <table className="w-full text-xs mb-2">
                          <tbody>
                            {sup.lineItems.map((li: any, i: number) => (
                              <tr key={i} className="border-b last:border-0">
                                <td className="py-0.5 font-mono text-gray-500">{li.code || '—'}</td>
                                <td className="py-0.5">{li.description}</td>
                                <td className="py-0.5 text-right">{fmt$(li.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {sup.status === 'approved' && sup.approvedAmount && (
                        <p className="text-xs text-green-700 font-medium">Approved: {fmt$(sup.approvedAmount)}</p>
                      )}
                      {sup.status === 'denied' && sup.denialReason && (
                        <p className="text-xs text-red-700">Denied: {sup.denialReason}</p>
                      )}
                      {sup.status === 'draft' && (
                        <button onClick={() => submitSupplement(sup.id)} className="mt-2 flex items-center gap-1 text-xs text-blue-600 font-medium hover:text-blue-800">
                          <Send className="w-3 h-3" /> Submit to Carrier
                        </button>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Log Activity</h2>
              <button onClick={() => setActivityOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Type</label>
                <select value={activityType} onChange={(e) => setActivityType(e.target.value)} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="note">Note</option>
                  <option value="call">Phone Call</option>
                  <option value="email">Email</option>
                  <option value="inspection">Inspection</option>
                  <option value="document_uploaded">Document Upload</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Details</label>
                <textarea value={activityBody} onChange={(e) => setActivityBody(e.target.value)} rows={3} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="What happened?" />
              </div>
              {activityType === 'call' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Duration (minutes)</label>
                  <input type="number" value={activityMeta.callDuration || ''} onChange={(e) => setActivityMeta({ ...activityMeta, callDuration: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              )}
              {activityType === 'email' && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Subject</label>
                  <input value={activityMeta.subject || ''} onChange={(e) => setActivityMeta({ ...activityMeta, subject: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setActivityOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
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
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">Add Supplement</h2>
              <button onClick={() => setSupOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reason for Supplement *</label>
                <textarea value={supReason} onChange={(e) => setSupReason(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" placeholder="Why is this supplement needed?" />
              </div>

              {/* Line items */}
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-2">Line Items</label>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b">
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
                          <input type="number" value={li.qty} onChange={(e) => updateSupLineItem(i, 'qty', Number(e.target.value))} className="w-full text-xs border rounded px-1 py-1 text-right" />
                        </td>
                        <td className="py-1 pr-1">
                          <input value={li.unit} onChange={(e) => updateSupLineItem(i, 'unit', e.target.value)} className="w-full text-xs border rounded px-1 py-1 text-center" />
                        </td>
                        <td className="py-1 pr-1">
                          <input type="number" step="0.01" value={li.unitPrice} onChange={(e) => updateSupLineItem(i, 'unitPrice', Number(e.target.value))} className="w-full text-xs border rounded px-1 py-1 text-right" />
                        </td>
                        <td className="py-1 pr-1 text-right text-xs font-medium">{fmt$(li.total)}</td>
                        <td className="py-1">
                          {supLineItems.length > 1 && (
                            <button onClick={() => setSupLineItems(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={() => setSupLineItems(prev => [...prev, { code: '', description: '', qty: 1, unit: 'SQ', unitPrice: 0, total: 0 }])} className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium">
                  + Add Line Item
                </button>
                <div className="flex justify-end mt-2">
                  <span className="text-sm font-bold">Total: {fmt$(supLineItems.reduce((s, li) => s + Number(li.total || 0), 0))}</span>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes (optional)</label>
                <textarea value={supNotes} onChange={(e) => setSupNotes(e.target.value)} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setSupOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={createSupplement} disabled={submittingSup} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {submittingSup ? 'Creating...' : 'Save as Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
