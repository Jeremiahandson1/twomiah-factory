// src/components/admin/ClientReportModal.tsx — ported from CVHC ClientReportModal.jsx
// Generate a comprehensive per-client report (PDF) with a date range and section toggles: one record
// for audits, surveyor visits, family requests, incident investigations and legal requests.
// Generating it — preview or PDF — is written to the client's audit trail.
import React, { useState } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../Toast';

const SECTIONS = [
  { key: 'care_plan', label: 'Care Plan & ADL Requirements' },
  { key: 'medications', label: 'Medications & Administration Log' },
  { key: 'adls', label: 'ADL Activity Log' },
  { key: 'visits', label: 'Visit / EVV History' },
  { key: 'incidents', label: 'Incident Reports' },
  { key: 'communications', label: 'Communication Log' },
  { key: 'documents', label: 'Documents on File' },
  { key: 'authorizations', label: 'Payer Authorizations' },
  { key: 'billing', label: 'Invoices' },
  { key: 'audit', label: 'Access / Change Audit Trail' },
];
const DEFAULT_SECTIONS: Record<string, boolean> = SECTIONS.reduce((acc, s) => ({ ...acc, [s.key]: true }), {});
const PRESETS = [
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
  { label: 'Year to date', ytd: true },
  { label: 'Last 12 months', days: 365 },
];
// Local calendar date as YYYY-MM-DD (toISOString would give tomorrow's date every evening west of UTC).
const ymd = (d: Date) => d.toLocaleDateString('en-CA');

interface Props { client: any; isOpen: boolean; onClose: () => void }

const ClientReportModal = ({ client, isOpen, onClose }: Props) => {
  const { token } = useAuth();
  const [fromDate, setFromDate] = useState(ymd(new Date(Date.now() - 90 * 86400 * 1000)));
  const [toDate, setToDate] = useState(ymd(new Date()));
  const [sections, setSections] = useState<Record<string, boolean>>(DEFAULT_SECTIONS);
  const [preview, setPreview] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (!isOpen || !client) return null;
  const firstName = client.first_name ?? client.firstName;
  const lastName = client.last_name ?? client.lastName;

  const applyPreset = (preset: any) => {
    const now = new Date();
    setFromDate(preset.ytd ? ymd(new Date(now.getFullYear(), 0, 1)) : ymd(new Date(Date.now() - preset.days * 86400 * 1000)));
    setToDate(ymd(now));
    setPreview(null);
  };
  const toggleSection = (key: string) => { setSections(s => ({ ...s, [key]: !s[key] })); setPreview(null); };
  const setAll = (value: boolean) => { setSections(SECTIONS.reduce((acc, s) => ({ ...acc, [s.key]: value }), {})); setPreview(null); };
  const selectedKeys = () => SECTIONS.filter(s => sections[s.key]).map(s => s.key);
  const buildQuery = () => {
    const params = new URLSearchParams({ from: fromDate, to: toDate });
    const keys = selectedKeys();
    if (keys.length < SECTIONS.length) params.set('sections', keys.join(','));
    return params.toString();
  };

  const loadPreview = async () => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/reports/client/${client.id}?${buildQuery()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load preview');
      setPreview(await res.json());
    } catch (err: any) {
      toast('Preview failed: ' + err.message, 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/reports/client/${client.id}/pdf?${buildQuery()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `client-report-${lastName}-${fromDate}-to-${toDate}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast('Report downloaded', 'success');
    } catch (err: any) {
      toast('Download failed: ' + err.message, 'error');
    } finally {
      setDownloading(false);
    }
  };

  const counts = preview ? {
    visits: preview.visits?.length ?? null,
    incidents: preview.incidents?.length ?? null,
    communications: preview.communications?.length ?? null,
    medicationLogs: preview.medicationLogs?.length ?? null,
    adlLogs: preview.adlLogs?.length ?? null,
    documents: preview.documents?.length ?? null,
    invoices: preview.invoices?.length ?? null,
    authorizations: preview.authorizations?.length ?? null,
    auditEvents: preview.auditLog?.length ?? null,
  } : null;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Generate client report"
        style={{ background: '#fff', color: '#111827', borderRadius: 12, width: '100%', maxWidth: 760, maxHeight: '92vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.25rem' }}>📄 Generate Client Report</h2>
            <div style={{ color: '#4B5563', fontSize: '0.9rem', marginTop: 4 }}>{firstName} {lastName}</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: '#4B5563' }} aria-label="Close">×</button>
        </div>

        <div style={{ padding: '1.25rem 1.5rem' }}>
          <section style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Date Range</h3>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {PRESETS.map(p => (
                <button key={p.label} type="button" className="btn btn-sm btn-secondary" onClick={() => applyPreset(p)}>{p.label}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4B5563', marginBottom: 4 }}>From</label>
                <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPreview(null); }} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: '#4B5563', marginBottom: 4 }}>To</label>
                <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPreview(null); }} style={{ width: '100%' }} />
              </div>
            </div>
          </section>

          <section style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ fontSize: '1rem', margin: 0 }}>Include Sections</h3>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAll(true)}>All</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setAll(false)}>None</button>
              </div>
            </div>
            <div style={{ fontSize: '0.85rem', color: '#4B5563', marginBottom: '0.5rem' }}>
              Client info, emergency contacts, and caregiver assignments are always included.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))', gap: '0.5rem' }}>
              {SECTIONS.map(s => (
                <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0.75rem', border: '1px solid #E5E7EB', borderRadius: 8, cursor: 'pointer', background: sections[s.key] ? '#F0FDF9' : '#fff', color: '#111827' }}>
                  <input type="checkbox" checked={!!sections[s.key]} onChange={() => toggleSection(s.key)} style={{ width: 'auto' }} />
                  <span style={{ fontSize: '0.9rem' }}>{s.label}</span>
                </label>
              ))}
            </div>
          </section>

          {preview && counts && (
            <section style={{ marginBottom: '1.5rem', padding: '0.75rem 1rem', background: '#F9FAFB', borderRadius: 8 }}>
              <div style={{ fontSize: '0.85rem', color: '#4B5563', marginBottom: '0.5rem' }}>Records found in the selected period:</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem', fontSize: '0.9rem' }}>
                {counts.visits != null && <div>🕒 Visits: <strong>{counts.visits}</strong></div>}
                {counts.medicationLogs != null && <div>💊 Med admins: <strong>{counts.medicationLogs}</strong></div>}
                {counts.adlLogs != null && <div>✅ ADL entries: <strong>{counts.adlLogs}</strong></div>}
                {counts.incidents != null && <div>⚠️ Incidents: <strong>{counts.incidents}</strong></div>}
                {counts.communications != null && <div>💬 Comm log: <strong>{counts.communications}</strong></div>}
                {counts.documents != null && <div>📎 Documents: <strong>{counts.documents}</strong></div>}
                {counts.authorizations != null && <div>🧾 Auths: <strong>{counts.authorizations}</strong></div>}
                {counts.invoices != null && <div>💰 Invoices: <strong>{counts.invoices}</strong></div>}
                {counts.auditEvents != null && <div>🔍 Audit events: <strong>{counts.auditEvents}</strong></div>}
              </div>
            </section>
          )}
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap', position: 'sticky', bottom: 0, background: '#fff' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={loadPreview} disabled={previewLoading || selectedKeys().length === 0}>
              {previewLoading ? 'Loading…' : '👁️ Preview counts'}
            </button>
            <button type="button" className="btn btn-primary" onClick={downloadPdf} disabled={downloading}>
              {downloading ? 'Generating PDF…' : '📄 Download PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClientReportModal;
