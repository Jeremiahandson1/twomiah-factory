// Onboarding queue — post-hire packets (ported from CVHC OnboardingPacketsAdmin.jsx).
// Statuses: sent | opened | in_progress | submitted | expired | cancelled.
// Actions: view detail, resend link, download the Gusto import CSV, mark Gusto-synced, and — for a
// Wisconsin agency — retry a WORCS submission that failed.
import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../Toast';
import { formatDate } from '../../utils/date';
import EligibilityCard, { isWisconsinAgency } from './EligibilityCard';
import { formatDateTime } from '../../utils/datetime';

const STATUS_META: Record<string, { label: string; cls: string }> = {
  sent:        { label: 'Invite Sent', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  opened:      { label: 'Opened',      cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200' },
  in_progress: { label: 'In Progress', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' },
  submitted:   { label: 'Submitted',   cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' },
  expired:     { label: 'Expired',     cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
  cancelled:   { label: 'Cancelled',   cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' },
};

const fmtDate = (d: any) => (d ? formatDate(d) : '—');
const fmtDT = (d: any) => (d ? formatDateTime(d) : '—');
const btnOutline = 'px-3 py-1.5 rounded-lg border-2 text-sm font-bold bg-white dark:bg-slate-800';
const fieldLabel = 'block text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-slate-300 mb-0.5';
const fieldValue = 'text-sm text-gray-900 dark:text-slate-100 mb-3';

export default function OnboardingPacketsAdmin() {
  const { token, company } = useAuth();
  const wisconsin = isWisconsinAgency(company);
  const [packets, setPackets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [gustoInput, setGustoInput] = useState('');
  const [retrying, setRetrying] = useState(false);

  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets`, { headers: hdr });
      if (!r.ok) throw new Error('Failed to load packets');
      setPackets(await r.json());
    } catch (e: any) {
      toast('Error: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const active = (p: any) => ['sent', 'opened', 'in_progress'].includes(p.status);
  const filtered = packets.filter((p) => {
    if (tab === 'active') return active(p);
    if (tab === 'submitted') return p.status === 'submitted';
    if (tab === 'needs_gusto') return p.status === 'submitted' && !p.gusto_synced_at;
    return true;
  });

  const openDetail = async (p: any) => {
    setDetailLoading(true);
    setDetail({ stub: p });
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/${p.id}`, { headers: hdr });
      if (!r.ok) throw new Error('Load detail failed');
      const full = await r.json();
      setDetail(full);
      setGustoInput(full.gusto_employee_id || '');
    } catch (e: any) {
      toast('Error: ' + e.message, 'error');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const resend = async (p: any) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/${p.id}/resend`, { method: 'POST', headers: hdr });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Resend failed');
      toast('Fresh invite sent', 'success');
      load();
    } catch (e: any) { toast('Error: ' + e.message, 'error'); }
  };

  // A download needs the Authorization header, so fetch the blob rather than link to it.
  const downloadCsv = (p: { id: string; last_name?: string }) => {
    fetch(`${API_BASE_URL}/api/onboarding-packets/${p.id}/gusto-export.csv`, { headers: hdr })
      .then(async (r) => {
        if (!r.ok) throw new Error('CSV download failed');
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement('a');
        a.href = url;
        a.download = `gusto-import-${(p.last_name || 'caregiver').toLowerCase()}.csv`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((err) => toast('Error: ' + err.message, 'error'));
  };

  const markGustoSynced = async () => {
    if (!detail?.id) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/${detail.id}/mark-gusto-synced`, {
        method: 'POST', headers: hdr, body: JSON.stringify({ gustoEmployeeId: gustoInput.trim() || null }),
      });
      if (!r.ok) throw new Error('Mark synced failed');
      toast('Marked as synced to Gusto', 'success');
      openDetail(detail);
      load();
    } catch (e: any) { toast('Error: ' + e.message, 'error'); }
  };

  const retryWorcs = async () => {
    if (!detail?.id) return;
    setRetrying(true);
    try {
      const r = await fetch(`${API_BASE_URL}/api/onboarding-packets/${detail.id}/retry-worcs`, { method: 'POST', headers: hdr });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'WORCS submission failed');
      toast('Background check submitted to WORCS', 'success');
      openDetail(detail);
    } catch (e: any) {
      toast('Error: ' + e.message, 'error');
    } finally {
      setRetrying(false);
    }
  };

  const counts = {
    active: packets.filter(active).length,
    submitted: packets.filter((p) => p.status === 'submitted').length,
    needs_gusto: packets.filter((p) => p.status === 'submitted' && !p.gusto_synced_at).length,
    all: packets.length,
  };
  const TABS: Array<[keyof typeof counts, string]> = [['active', 'Active'], ['submitted', 'Submitted'], ['needs_gusto', 'Needs Gusto'], ['all', 'All']];

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-100">📬 Onboarding Packets</h1>
        <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">
          Post-hire: background check consent{wisconsin ? ', WORCS check' : ''}, Gusto sync.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-slate-700 mb-4">
        {TABS.map(([id, name]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 -mb-px text-sm border-b-2 ${tab === id
              ? 'border-primary-600 text-primary-700 dark:text-primary-200 font-extrabold'
              : 'border-transparent text-gray-600 dark:text-slate-300 font-medium'}`}>
            {name} ({counts[id]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-600 dark:text-slate-300">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-10 text-center">
          <div className="text-3xl">📭</div>
          <div className="font-bold text-gray-800 dark:text-slate-100">No packets in this view</div>
        </div>
      ) : filtered.map((p) => {
        const meta = STATUS_META[p.status] || STATUS_META.sent;
        return (
          <div key={p.id} className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 mb-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <div className="font-extrabold text-gray-900 dark:text-slate-100">{p.legal_first_name || p.first_name} {p.legal_last_name || p.last_name}</div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${meta.cls}`}>{meta.label}</span>
                  {p.gusto_synced_at && <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200">Gusto Synced</span>}
                </div>
                <div className="text-sm text-gray-600 dark:text-slate-300">{p.email}</div>
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                  Hired {fmtDate(p.created_at)}
                  {p.submitted_at && ` · Submitted ${fmtDate(p.submitted_at)}`}
                  {p.bgc_consent_signed_at && ` · Consent signed ${fmtDate(p.bgc_consent_signed_at)}`}
                  {p.expires_at && ` · Expires ${fmtDate(p.expires_at)}`}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 min-w-[150px]">
                <button className={`${btnOutline} border-primary-600 text-primary-700 dark:text-primary-200`} onClick={() => openDetail(p)}>View Detail</button>
                {['sent', 'opened', 'in_progress', 'expired'].includes(p.status) && (
                  <button className={`${btnOutline} border-gray-500 text-gray-700 dark:text-slate-200`} onClick={() => resend(p)}>Resend Link</button>
                )}
                {p.status === 'submitted' && !p.gusto_synced_at && (
                  <button className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 text-sm font-bold" onClick={() => downloadCsv(p)}>Download Gusto CSV</button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {detail && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4" onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-slate-100">
                {detailLoading ? 'Loading…' : `${detail.legal_first_name || detail.first_name} ${detail.legal_last_name || detail.last_name}`}
              </h2>
              <button className={`${btnOutline} border-gray-400 text-gray-700 dark:text-slate-200`} onClick={() => setDetail(null)}>✕</button>
            </div>

            {!detailLoading && detail.id && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 mb-2">
                  <div><span className={fieldLabel}>Preferred Name</span><div className={fieldValue}>{detail.preferred_name || '—'}</div></div>
                  <div><span className={fieldLabel}>Pronouns</span><div className={fieldValue}>{detail.pronouns || '—'}</div></div>
                  <div><span className={fieldLabel}>Legal Full Name</span><div className={fieldValue}>{[detail.legal_first_name, detail.legal_middle_name, detail.legal_last_name].filter(Boolean).join(' ') || '—'}</div></div>
                  <div><span className={fieldLabel}>Date of Birth</span><div className={fieldValue}>{fmtDate(detail.date_of_birth)}</div></div>
                  <div className="sm:col-span-2"><span className={fieldLabel}>Address</span><div className={fieldValue}>{detail.address ? `${detail.address}, ${detail.city || ''} ${detail.state || ''} ${detail.zip || ''}` : '—'}</div></div>
                  <div><span className={fieldLabel}>Driver's License</span><div className={fieldValue}>{detail.drivers_license_number ? `${detail.drivers_license_number} (${detail.drivers_license_state || '—'})` : '—'}</div></div>
                  <div><span className={fieldLabel}>Emergency Contact</span><div className={fieldValue}>
                    {detail.emergency_contact_name ? `${detail.emergency_contact_name} (${detail.emergency_contact_relationship || '—'}) · ${detail.emergency_contact_phone || '—'}` : '—'}
                  </div></div>
                </div>

                <div className={`rounded-lg border px-4 py-3 mb-4 ${detail.bgc_consent_signed_at
                  ? 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800'
                  : 'bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800'}`}>
                  <div className={`font-bold mb-1 ${detail.bgc_consent_signed_at ? 'text-green-900 dark:text-green-100' : 'text-amber-900 dark:text-amber-100'}`}>
                    {detail.bgc_consent_signed_at ? '✅ Background check consent on file' : '⚠️ Consent not yet signed'}
                  </div>
                  {detail.bgc_consent_signed_at && (
                    <div className="text-sm text-gray-700 dark:text-slate-200">
                      Signed by <strong>{detail.bgc_consent_signature}</strong> on {fmtDT(detail.bgc_consent_signed_at)}<br />
                      IP: {detail.bgc_consent_ip || '—'} · Disclosure v{detail.bgc_consent_version || '—'}
                    </div>
                  )}
                  {wisconsin && detail.worcs_submission_pending && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-sm text-amber-900 dark:text-amber-100">The automatic WORCS submission has not gone through.</span>
                      <button className="px-3 py-1.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold disabled:opacity-60" onClick={retryWorcs} disabled={retrying}>
                        {retrying ? 'Submitting…' : 'Retry WORCS'}
                      </button>
                    </div>
                  )}
                </div>

                {wisconsin && <EligibilityCard caregiverId={detail.caregiver_id} token={token} />}

                <div className={`rounded-xl border p-4 mb-4 ${detail.gusto_synced_at
                  ? 'bg-green-50 border-green-200 dark:bg-green-900/30 dark:border-green-800'
                  : 'bg-amber-50 border-amber-200 dark:bg-amber-900/30 dark:border-amber-800'}`}>
                  <div className="font-extrabold mb-1.5 text-gray-900 dark:text-slate-100">{detail.gusto_synced_at ? '✅ Synced to Gusto' : '📤 Add to Gusto'}</div>
                  {detail.gusto_synced_at ? (
                    <div className="text-sm text-gray-700 dark:text-slate-200">
                      Employee ID: <strong>{detail.gusto_employee_id || '—'}</strong> · Marked {fmtDT(detail.gusto_synced_at)}
                    </div>
                  ) : (
                    <>
                      <p className="text-sm text-amber-900 dark:text-amber-100 mb-2.5">
                        Gusto does not offer API access for agencies to auto-create employees. Download the CSV, upload it in Gusto
                        (<strong>Team &gt; Add Employees &gt; CSV Import</strong>), then paste the Gusto employee ID below and click Mark
                        Synced. Gusto will email the caregiver their W-4, I-9, and direct-deposit onboarding.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-gray-900 text-sm font-bold" onClick={() => downloadCsv({ id: detail.id, last_name: detail.legal_last_name || detail.last_name })}>Download Gusto CSV</button>
                        <input placeholder="Paste Gusto employee ID" value={gustoInput} onChange={(e) => setGustoInput(e.target.value)}
                          className="flex-1 min-w-[180px] rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-1.5 text-sm" />
                        <button className="px-3 py-1.5 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-bold" onClick={markGustoSynced}>Mark Synced</button>
                      </div>
                    </>
                  )}
                </div>

                {Array.isArray(detail.events) && detail.events.length > 0 && (
                  <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <div className="font-extrabold mb-2 text-gray-900 dark:text-slate-100">Audit Trail</div>
                    <div className="text-sm">
                      {detail.events.map((ev: any) => (
                        <div key={ev.id} className="py-1 border-b border-gray-100 dark:border-slate-700 text-gray-700 dark:text-slate-200">
                          <strong>{ev.event_type}</strong> — {fmtDT(ev.created_at)}
                          {ev.ip_address && <span className="text-gray-500 dark:text-slate-400"> · {ev.ip_address}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
