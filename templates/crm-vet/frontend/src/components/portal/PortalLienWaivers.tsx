import { useEffect, useState } from 'react';
import { FileSignature, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

interface Waiver {
  id: string;
  projectName?: string | null;
  projectNumber?: string | null;
  vendorName: string;
  vendorType?: string | null;
  waiverType: string;
  throughDate?: string | null;
  amountCurrent?: string | number;
  amountTotal?: string | number;
  status: string;
  requestedAt?: string | null;
  dueDate?: string | null;
  signedDate?: string | null;
  documentUrl?: string | null;
  notes?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  requested: 'bg-blue-100 text-blue-700',
  received: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const WAIVER_LABELS: Record<string, string> = {
  conditional_progress: 'Conditional — Progress',
  unconditional_progress: 'Unconditional — Progress',
  conditional_final: 'Conditional — Final',
  unconditional_final: 'Unconditional — Final',
};

export default function PortalLienWaivers() {
  const { fetch: portalFetch } = usePortal();
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState<Waiver | null>(null);
  const [documentUrl, setDocumentUrl] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    portalFetch('/lien-waivers')
      .then((data) => setWaivers(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load waivers:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSign = (w: Waiver) => {
    setSigning(w);
    setDocumentUrl(w.documentUrl || '');
    setNotes('');
  };

  const submitSign = async () => {
    if (!signing) return;
    setBusy(true);
    try {
      await portalFetch(`/lien-waivers/${signing.id}/sign`, {
        method: 'POST',
        body: JSON.stringify({ documentUrl: documentUrl || null, notes: notes || null }),
      });
      setSigning(null);
      load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const pending = waivers.filter((w) => w.status === 'draft' || w.status === 'requested');
  const done = waivers.filter((w) => w.status === 'received' || w.status === 'approved');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Lien Waivers</h1>
        <p className="text-gray-600">Review and sign lien waivers for your work.</p>
      </div>

      {waivers.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileSignature className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No lien waivers yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Pending ({pending.length})</>}>
              {pending.map((w) => (
                <WaiverCard key={w.id} waiver={w} onSign={() => openSign(w)} />
              ))}
            </Section>
          )}
          {done.length > 0 && (
            <Section title={<><CheckCircle2 className="w-5 h-5 text-green-500" /> Signed ({done.length})</>}>
              {done.map((w) => (
                <WaiverCard key={w.id} waiver={w} onSign={null} />
              ))}
            </Section>
          )}
        </div>
      )}

      {signing && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Sign Lien Waiver</h2>
            <p className="text-sm text-gray-600 mb-4">
              {signing.projectName} · {WAIVER_LABELS[signing.waiverType] || signing.waiverType}
              {signing.amountTotal ? ` · $${Number(signing.amountTotal).toLocaleString()}` : ''}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Signed Document URL (optional)</label>
                <input
                  type="url"
                  value={documentUrl}
                  onChange={(e) => setDocumentUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">Paste a link to the signed PDF, or leave blank.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setSigning(null)} disabled={busy} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button onClick={submitSign} disabled={busy} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {busy ? 'Signing…' : 'Confirm Sign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function WaiverCard({ waiver, onSign }: { waiver: Waiver; onSign: (() => void) | null }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-blue-100 rounded-lg shrink-0">
            <FileSignature className="w-5 h-5 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900">{WAIVER_LABELS[waiver.waiverType] || waiver.waiverType}</p>
            {waiver.projectName && (
              <p className="text-sm text-gray-500">
                Project: {waiver.projectNumber ? `${waiver.projectNumber} · ` : ''}
                {waiver.projectName}
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
              {waiver.throughDate && <span>Through {new Date(waiver.throughDate).toLocaleDateString()}</span>}
              {waiver.dueDate && <span>Due {new Date(waiver.dueDate).toLocaleDateString()}</span>}
              {waiver.signedDate && <span>Signed {new Date(waiver.signedDate).toLocaleDateString()}</span>}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          {waiver.amountTotal !== undefined && (
            <p className="font-bold text-gray-900">${Number(waiver.amountTotal).toLocaleString()}</p>
          )}
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mt-1 ${STATUS_STYLES[waiver.status] || 'bg-gray-100 text-gray-700'}`}>
            {waiver.status}
          </span>
          {onSign && (
            <div className="mt-2">
              <button onClick={onSign} className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                Sign
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
