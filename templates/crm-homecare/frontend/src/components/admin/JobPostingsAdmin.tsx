// Job postings — the openings on the public careers page (/careers). Ported from CVHC
// JobPostingsAdmin.jsx. No published, open posting → the careers page shows the general
// "always building our caregiver pool" copy and still takes applications.
import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from '../Toast';
import { confirm } from '../ConfirmModal';
import { formatDate } from '../../utils/date';

type Posting = any;

const EMPTY_FORM = {
  title: '', employmentType: 'part_time', location: '',
  payRangeMin: '', payRangeMax: '', payRateUnit: 'hour',
  summary: '', description: '', responsibilities: '', qualifications: '',
  isPublished: false, closesAt: '',
};

const isClosed = (p: Posting) => !!p.closes_at && new Date(p.closes_at) <= new Date();
const statusBadge = (p: Posting) => {
  if (isClosed(p)) return { text: 'Closed', cls: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200' };
  if (p.is_published) return { text: 'Published', cls: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' };
  return { text: 'Draft', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' };
};

const label = 'block text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-slate-300 mb-1';
const input = 'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const btnOutline = 'px-3 py-1.5 rounded-lg border-2 text-sm font-bold bg-white dark:bg-slate-800';

export default function JobPostingsAdmin() {
  const { token } = useAuth();
  const [postings, setPostings] = useState<Posting[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('all');
  const [editing, setEditing] = useState<null | 'new' | Posting>(null);
  const [form, setForm] = useState<any>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const hdr = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = tab === 'all' ? `${API_BASE_URL}/api/job-postings` : `${API_BASE_URL}/api/job-postings?status=${tab}`;
      const r = await fetch(url, { headers: hdr });
      if (!r.ok) throw new Error('Failed to load postings');
      setPostings(await r.json());
    } catch (e: any) {
      toast('Error: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [tab, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm(EMPTY_FORM); setEditing('new'); };
  const openEdit = (p: Posting) => {
    setForm({
      title: p.title || '', employmentType: p.employment_type || 'part_time', location: p.location || '',
      payRangeMin: p.pay_range_min ?? '', payRangeMax: p.pay_range_max ?? '', payRateUnit: p.pay_rate_unit || 'hour',
      summary: p.summary || '', description: p.description || '',
      responsibilities: p.responsibilities || '', qualifications: p.qualifications || '',
      isPublished: !!p.is_published, closesAt: p.closes_at ? String(p.closes_at).slice(0, 10) : '',
    });
    setEditing(p);
  };

  const save = async () => {
    if (!form.title.trim() || !form.description.trim()) { toast('Title and description are required', 'error'); return; }
    // The pay fields hold what was typed; they are checked here, on save, not clamped while typing.
    for (const [k, name] of [['payRangeMin', 'Pay min'], ['payRangeMax', 'Pay max']]) {
      const v = String(form[k]).trim();
      if (v !== '' && (!Number.isFinite(Number(v)) || Number(v) < 0)) { toast(`${name} must be a number of zero or more`, 'error'); return; }
    }
    if (String(form.payRangeMin).trim() !== '' && String(form.payRangeMax).trim() !== '' && Number(form.payRangeMax) < Number(form.payRangeMin)) {
      toast('Pay max cannot be less than pay min', 'error'); return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(), employmentType: form.employmentType, location: form.location.trim() || null,
        payRangeMin: String(form.payRangeMin).trim() === '' ? null : Number(form.payRangeMin),
        payRangeMax: String(form.payRangeMax).trim() === '' ? null : Number(form.payRangeMax),
        payRateUnit: form.payRateUnit, summary: form.summary.trim() || null, description: form.description.trim(),
        responsibilities: form.responsibilities.trim() || null, qualifications: form.qualifications.trim() || null,
        isPublished: form.isPublished, closesAt: form.closesAt || null,
      };
      const isNew = editing === 'new';
      const r = await fetch(isNew ? `${API_BASE_URL}/api/job-postings` : `${API_BASE_URL}/api/job-postings/${(editing as Posting).id}`, {
        method: isNew ? 'POST' : 'PUT', headers: hdr, body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Save failed');
      toast(isNew ? 'Posting created' : 'Posting saved', 'success');
      setEditing(null);
      load();
    } catch (e: any) {
      toast('Error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (p: Posting, action: string) => {
    try {
      const r = await fetch(`${API_BASE_URL}/api/job-postings/${p.id}/${action}`, { method: 'POST', headers: hdr });
      if (!r.ok) throw new Error('Status change failed');
      load();
    } catch (e: any) { toast('Error: ' + e.message, 'error'); }
  };

  const remove = async (p: Posting) => {
    if (!(await confirm(`Delete "${p.title}"? This cannot be undone.`, { danger: true }))) return;
    try {
      const r = await fetch(`${API_BASE_URL}/api/job-postings/${p.id}`, { method: 'DELETE', headers: hdr });
      if (!r.ok) throw new Error('Delete failed');
      toast('Posting deleted', 'success');
      load();
    } catch (e: any) { toast('Error: ' + e.message, 'error'); }
  };

  const publishedCount = postings.filter((p) => p.is_published && !isClosed(p)).length;
  const careersUrl = `${window.location.origin}/careers`;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-100">📋 Job Postings</h1>
          <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">
            {publishedCount === 0
              ? 'No published openings — the careers page shows the general "building our caregiver pool" copy.'
              : `${publishedCount} opening${publishedCount === 1 ? '' : 's'} live on the careers page.`}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
            Careers page: <a className="underline text-primary-700 dark:text-primary-200" href={careersUrl} target="_blank" rel="noreferrer">{careersUrl}</a>
          </p>
        </div>
        <button className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold" onClick={openNew}>+ New Posting</button>
      </div>

      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700 mb-4">
        {['all', 'published', 'draft', 'closed'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 -mb-px text-sm border-b-2 ${tab === t
              ? 'border-primary-600 text-primary-700 dark:text-primary-200 font-extrabold'
              : 'border-transparent text-gray-600 dark:text-slate-300 font-medium'}`}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-600 dark:text-slate-300">Loading…</div>
      ) : postings.length === 0 ? (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-10 text-center">
          <div className="text-3xl mb-2">📭</div>
          <div className="font-bold text-gray-800 dark:text-slate-100">No postings in this view</div>
          <div className="text-sm text-gray-600 dark:text-slate-300 mt-1">Create a new posting to publish an opening.</div>
        </div>
      ) : postings.map((p) => {
        const badge = statusBadge(p);
        const closed = isClosed(p);
        const count = Number(p.applications_count_live ?? p.applications_count ?? 0);
        return (
          <div key={p.id} className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 mb-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <div className="font-extrabold text-gray-900 dark:text-slate-100">{p.title}</div>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${badge.cls}`}>{badge.text}</span>
                </div>
                <div className="text-sm text-gray-600 dark:text-slate-300">
                  {String(p.employment_type || '').replace('_', ' ')}
                  {p.location ? ` · ${p.location}` : ''}
                  {p.pay_range_min ? ` · $${p.pay_range_min}${p.pay_range_max && p.pay_range_max !== p.pay_range_min ? `–$${p.pay_range_max}` : ''}/${p.pay_rate_unit}` : ''}
                </div>
                {p.summary && <div className="text-sm text-gray-700 dark:text-slate-200 mt-1.5">{p.summary}</div>}
                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">
                  {count} application{count === 1 ? '' : 's'}
                  {p.published_at && ` · Posted ${formatDate(p.published_at)}`}
                  {p.closes_at && ` · Closes ${formatDate(p.closes_at)}`}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 min-w-[120px]">
                <button className={`${btnOutline} border-primary-600 text-primary-700 dark:text-primary-200`} onClick={() => openEdit(p)}>Edit</button>
                {p.is_published && !closed && <button className={`${btnOutline} border-gray-500 text-gray-700 dark:text-slate-200`} onClick={() => setStatus(p, 'unpublish')}>Unpublish</button>}
                {!p.is_published && !closed && <button className={`${btnOutline} border-green-600 text-green-700 dark:text-green-300`} onClick={() => setStatus(p, 'publish')}>Publish</button>}
                {!closed && <button className={`${btnOutline} border-red-600 text-red-700 dark:text-red-300`} onClick={() => setStatus(p, 'close')}>Close</button>}
                <button className={`${btnOutline} border-red-600 text-red-700 dark:text-red-300`} onClick={() => remove(p)}>Delete</button>
              </div>
            </div>
          </div>
        );
      })}

      {editing && (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/55 p-4" onClick={(e) => { if (e.target === e.currentTarget) setEditing(null); }}>
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-white dark:bg-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-extrabold text-gray-900 dark:text-slate-100">{editing === 'new' ? 'New Job Posting' : `Edit: ${editing.title}`}</h2>
              <button className={`${btnOutline} border-gray-400 text-gray-700 dark:text-slate-200`} onClick={() => setEditing(null)}>✕</button>
            </div>

            <div className="mb-3">
              <label className={label}>Title *</label>
              <input className={input} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Caregiver — part time" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Employment Type</label>
                <select className={input} value={form.employmentType} onChange={(e) => setForm({ ...form, employmentType: e.target.value })}>
                  <option value="part_time">Part Time</option>
                  <option value="full_time">Full Time</option>
                  <option value="prn">PRN / As Needed</option>
                  <option value="contract">Contract</option>
                </select>
              </div>
              <div>
                <label className={label}>Location</label>
                <input className={input} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="City, State" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className={label}>Pay Min</label>
                <input inputMode="decimal" className={input} value={form.payRangeMin} onChange={(e) => setForm({ ...form, payRangeMin: e.target.value })} />
              </div>
              <div>
                <label className={label}>Pay Max</label>
                <input inputMode="decimal" className={input} value={form.payRangeMax} onChange={(e) => setForm({ ...form, payRangeMax: e.target.value })} />
              </div>
              <div>
                <label className={label}>Per</label>
                <select className={input} value={form.payRateUnit} onChange={(e) => setForm({ ...form, payRateUnit: e.target.value })}>
                  <option value="hour">hour</option>
                  <option value="visit">visit</option>
                  <option value="week">week</option>
                  <option value="year">year</option>
                </select>
              </div>
            </div>
            <div className="mt-3">
              <label className={label}>Short Summary (shown on listing card)</label>
              <input className={input} maxLength={240} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} placeholder="Flexible hours, paid training, serve clients near you." />
            </div>
            <div className="mt-3">
              <label className={label}>Full Description *</label>
              <textarea className={`${input} min-h-[130px]`} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Describe the role, the team, the clients they'll serve…" />
            </div>
            <div className="mt-3">
              <label className={label}>Responsibilities (one per line)</label>
              <textarea className={`${input} min-h-[90px]`} value={form.responsibilities} onChange={(e) => setForm({ ...form, responsibilities: e.target.value })} placeholder={'Bathing, dressing, grooming assistance\nLight housekeeping and meal prep\nEVV clock-in/out on each visit'} />
            </div>
            <div className="mt-3">
              <label className={label}>Qualifications (one per line)</label>
              <textarea className={`${input} min-h-[90px]`} value={form.qualifications} onChange={(e) => setForm({ ...form, qualifications: e.target.value })} placeholder={"Valid driver's license and reliable transportation\nAble to pass a caregiver background check\nCompassion and reliability"} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className={label}>Closes On (optional)</label>
                <input type="date" className={input} value={form.closesAt} onChange={(e) => setForm({ ...form, closesAt: e.target.value })} />
              </div>
              <label className="flex items-end gap-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
                <input type="checkbox" checked={form.isPublished} onChange={(e) => setForm({ ...form, isPublished: e.target.checked })} />
                Publish immediately (visible on the careers page)
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button className={`${btnOutline} border-gray-400 text-gray-700 dark:text-slate-200`} onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
              <button className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold disabled:opacity-60" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editing === 'new' ? 'Create Posting' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
