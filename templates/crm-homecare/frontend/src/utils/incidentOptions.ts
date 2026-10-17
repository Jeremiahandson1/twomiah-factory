// Mirrors backend/src/config/incidentOptions.ts — keep the two lists identical.
// INCIDENT_TYPES values are the ones the incident form has always stored.
import { API_BASE_URL, apiCall } from '../config';

export type Option = { value: string; label: string };

export const INCIDENT_TYPES: Option[] = [
  { value: 'accident', label: 'Accident' },
  { value: 'fall', label: 'Fall' },
  { value: 'medication_error', label: 'Medication Error' },
  { value: 'missing_medication', label: 'Missing / Misappropriated Medication' },
  { value: 'behavioral', label: 'Behavioral Issue' },
  { value: 'injury', label: 'Injury' },
  { value: 'property_damage', label: 'Property Damage' },
  { value: 'health_emergency', label: 'Health Emergency' },
  { value: 'other', label: 'Other' },
];

export const SEVERITIES: Option[] = [
  { value: 'minor', label: 'Minor' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'critical', label: 'Critical' },
];

export const INCIDENT_STATUSES: Option[] = [
  { value: 'open', label: 'Open' },
  { value: 'investigating', label: 'Investigating' },
  { value: 'closed', label: 'Closed' },
];

export const DISPOSITIONS: Option[] = [
  { value: 'substantiated', label: 'Substantiated' },
  { value: 'unsubstantiated', label: 'Unsubstantiated' },
  { value: 'inconclusive', label: 'Inconclusive' },
];

export const MANDATORY_REPORT_STATUSES: Option[] = [
  { value: 'not_required', label: 'Not required' },
  { value: 'pending', label: 'Decision pending' },
  { value: 'reported', label: 'Reported' },
];

export const ENTRY_TYPES: Option[] = [
  { value: 'call', label: 'Phone call' },
  { value: 'interview', label: 'Interview' },
  { value: 'document', label: 'Document reviewed' },
  { value: 'action', label: 'Action taken' },
  { value: 'schedule', label: 'Schedule change' },
  { value: 'note', label: 'Note' },
];

export const ATTACHMENT_CATEGORIES: Option[] = [
  { value: 'payer_notice', label: 'Payer / MCO notice' },
  { value: 'statement', label: 'Signed statement' },
  { value: 'background_check', label: 'Background check' },
  { value: 'training', label: 'Training record' },
  { value: 'signed_response', label: 'Signed response' },
  { value: 'photo', label: 'Photo' },
  { value: 'other', label: 'Other' },
];

export const TRAINING_ACK_METHODS: Option[] = [
  { value: 'in_person', label: 'In person' },
  { value: 'phone', label: 'Phone' },
  { value: 'video', label: 'Video' },
];

const toMap = (list: Option[]) => Object.fromEntries(list.map((o) => [o.value, o.label]));
const MAPS: Record<string, Record<string, string>> = {
  type: toMap(INCIDENT_TYPES), severity: toMap(SEVERITIES), status: toMap(INCIDENT_STATUSES),
  disposition: toMap(DISPOSITIONS), mandatory: toMap(MANDATORY_REPORT_STATUSES),
  entry: toMap(ENTRY_TYPES), category: toMap(ATTACHMENT_CATEGORIES), method: toMap(TRAINING_ACK_METHODS),
};

export const incidentLabel = (kind: string, value?: string | null) => (MAPS[kind] && value && MAPS[kind][value]) || value || '';

// Same raw-file cap the backend enforces (base64 must fit its 9.5 MB data-URI limit).
export const ATTACHMENT_MAX_BYTES = 7_000_000;
export const ATTACHMENT_ACCEPT = 'application/pdf,image/jpeg,image/png,image/gif,image/webp';

// Status / severity chips: every ground has its dark partner and its ink.
export const STATUS_CHIP: Record<string, string> = {
  open: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  investigating: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  closed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
};
export const SEVERITY_CHIP: Record<string, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  severe: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  moderate: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  minor: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200',
};
export const SEVERITY_BORDER: Record<string, string> = {
  critical: 'border-red-500 dark:border-red-400',
  severe: 'border-amber-500 dark:border-amber-400',
  moderate: 'border-yellow-500 dark:border-yellow-400',
  minor: 'border-green-600 dark:border-green-400',
};

// Today's date in the browser's calendar (YYYY-MM-DD), never the UTC date.
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const localTimeHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// Shared field classes for the incident screens.
export const FIELD = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-gray-100 disabled:text-gray-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:disabled:bg-slate-700 dark:disabled:text-slate-400';
export const LABEL = 'mb-1 block text-xs font-semibold text-gray-700 dark:text-slate-300';
export const CARD = 'mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800';
export const H3 = 'mb-3 text-base font-bold text-gray-900 dark:text-slate-100';
export const MUTED = 'text-sm text-gray-600 dark:text-slate-400';
export const BTN_PRIMARY = 'inline-flex items-center gap-1 rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 dark:bg-teal-600 dark:hover:bg-teal-500';
export const BTN_SECONDARY = 'inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:hover:bg-slate-600';
export const BTN_DANGER = 'inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500';

/** JSON call through the app's client (which ends an expired session). */
export const incidentsApi = (token: string) => (path: string, options: RequestInit = {}) =>
  apiCall(`/api/incidents${path}`, options as any, token);

/** A file download (PDF, attachment): returns the Blob, or throws the server's reason. */
export const incidentsBlob = async (token: string, path: string): Promise<Blob> => {
  const res = await fetch(`${API_BASE_URL}/api/incidents${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error('Your session has expired. Sign in again.');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || 'Download failed');
  }
  return res.blob();
};

export const saveBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
