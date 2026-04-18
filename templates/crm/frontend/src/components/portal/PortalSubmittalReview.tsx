import { useEffect, useState } from 'react';
import { FileCheck2, Loader2, CheckCircle2, RotateCcw, Clock } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

interface Submittal {
  id: string;
  number: string;
  title: string;
  description?: string | null;
  status: string;
  specSection?: string | null;
  dueDate?: string | null;
  submittedDate?: string | null;
  approvedDate?: string | null;
  approvedBy?: string | null;
  notes?: string | null;
  projectName?: string | null;
  projectNumber?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
  revise: 'bg-yellow-100 text-yellow-700',
  rejected: 'bg-red-100 text-red-700',
};

export default function PortalSubmittalReview() {
  const { fetch: portalFetch, contact } = usePortal();
  const [subs, setSubs] = useState<Submittal[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ kind: 'approve' | 'revise'; submittal: Submittal } | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    portalFetch('/submittals')
      .then((data) => setSubs(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load submittals:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!modal) return;
    setBusy(true);
    try {
      const endpoint = `/submittals/${modal.submittal.id}/${modal.kind}`;
      const payload =
        modal.kind === 'approve'
          ? { signedBy: (contact?.name as string) || undefined, notes: notes || null }
          : { reason: notes || 'Revision requested' };
      await portalFetch(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      setModal(null);
      setNotes('');
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

  const pending = subs.filter((s) => s.status === 'pending');
  const reviewed = subs.filter((s) => s.status !== 'pending');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Submittals</h1>
        <p className="text-gray-600">Review and approve submittals from the contractor.</p>
      </div>

      {subs.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileCheck2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No submittals yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Pending Review ({pending.length})</>}>
              {pending.map((s) => (
                <SubmittalCard
                  key={s.id}
                  submittal={s}
                  onApprove={() => { setModal({ kind: 'approve', submittal: s }); setNotes(''); }}
                  onRevise={() => { setModal({ kind: 'revise', submittal: s }); setNotes(''); }}
                />
              ))}
            </Section>
          )}
          {reviewed.length > 0 && (
            <Section title={<><CheckCircle2 className="w-5 h-5 text-green-500" /> Reviewed ({reviewed.length})</>}>
              {reviewed.map((s) => (
                <SubmittalCard key={s.id} submittal={s} onApprove={null} onRevise={null} />
              ))}
            </Section>
          )}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">
              {modal.kind === 'approve' ? 'Approve Submittal' : 'Request Revision'}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              {modal.submittal.number} — {modal.submittal.title}
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {modal.kind === 'approve' ? 'Notes (optional)' : 'Reason for revision'}
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                placeholder={modal.kind === 'revise' ? 'Explain what needs to change…' : ''}
              />
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModal(null)} disabled={busy} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || (modal.kind === 'revise' && !notes.trim())}
                className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 ${modal.kind === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-yellow-600 hover:bg-yellow-700'}`}
              >
                {busy ? 'Saving…' : modal.kind === 'approve' ? 'Approve' : 'Request Revision'}
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

function SubmittalCard({
  submittal,
  onApprove,
  onRevise,
}: {
  submittal: Submittal;
  onApprove: (() => void) | null;
  onRevise: (() => void) | null;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-purple-100 rounded-lg shrink-0">
            <FileCheck2 className="w-5 h-5 text-purple-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900">
              {submittal.number} — {submittal.title}
            </p>
            {submittal.projectName && (
              <p className="text-sm text-gray-500">
                Project: {submittal.projectNumber ? `${submittal.projectNumber} · ` : ''}
                {submittal.projectName}
              </p>
            )}
            {submittal.specSection && <p className="text-xs text-gray-500 mt-1">Spec: {submittal.specSection}</p>}
            {submittal.description && <p className="text-sm text-gray-600 mt-1">{submittal.description}</p>}
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
              {submittal.dueDate && <span>Due {new Date(submittal.dueDate).toLocaleDateString()}</span>}
              {submittal.submittedDate && <span>Submitted {new Date(submittal.submittedDate).toLocaleDateString()}</span>}
              {submittal.approvedDate && <span>Approved {new Date(submittal.approvedDate).toLocaleDateString()}</span>}
            </div>
            {submittal.notes && <p className="text-xs text-gray-500 mt-2 italic whitespace-pre-wrap">{submittal.notes}</p>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[submittal.status] || 'bg-gray-100 text-gray-700'}`}>
            {submittal.status}
          </span>
          {(onApprove || onRevise) && (
            <div className="mt-2 flex flex-col gap-1.5">
              {onApprove && (
                <button onClick={onApprove} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                </button>
              )}
              {onRevise && (
                <button onClick={onRevise} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-yellow-600 text-white rounded-lg hover:bg-yellow-700">
                  <RotateCcw className="w-3.5 h-3.5" /> Revise
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
