import { useEffect, useState } from 'react';
import { HelpCircle, Loader2, CheckCircle2, Clock } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';

interface AssignedRfi {
  id: string;
  number: string;
  subject: string;
  question: string;
  status: string;
  priority: string;
  dueDate?: string | null;
  response?: string | null;
  respondedAt?: string | null;
  createdAt: string;
  projectName?: string | null;
  projectNumber?: string | null;
}

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  answered: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
};

export default function PortalAssignedRfis() {
  const { fetch: portalFetch } = usePortal();
  const [rfis, setRfis] = useState<AssignedRfi[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<AssignedRfi | null>(null);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    setLoading(true);
    portalFetch('/rfis-assigned')
      .then((data) => setRfis(Array.isArray(data) ? data : []))
      .catch((err) => console.error('Failed to load RFIs:', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!responding || !response.trim()) return;
    setBusy(true);
    try {
      await portalFetch(`/rfis-assigned/${responding.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ response: response.trim() }),
      });
      setResponding(null);
      setResponse('');
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

  const open = rfis.filter((r) => r.status === 'open');
  const answered = rfis.filter((r) => r.status !== 'open');

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">RFIs</h1>
        <p className="text-gray-600">Requests for information assigned to you.</p>
      </div>

      {rfis.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <HelpCircle className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No RFIs assigned to you yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <Section title={<><Clock className="w-5 h-5 text-orange-500" /> Awaiting Response ({open.length})</>}>
              {open.map((r) => (
                <RfiCard key={r.id} rfi={r} onRespond={() => { setResponding(r); setResponse(''); }} />
              ))}
            </Section>
          )}
          {answered.length > 0 && (
            <Section title={<><CheckCircle2 className="w-5 h-5 text-green-500" /> Answered ({answered.length})</>}>
              {answered.map((r) => (
                <RfiCard key={r.id} rfi={r} onRespond={null} />
              ))}
            </Section>
          )}
        </div>
      )}

      {responding && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Respond to RFI</h2>
            <p className="text-sm text-gray-600 mb-4">
              {responding.number} — {responding.subject}
            </p>
            <div className="bg-gray-50 rounded-lg p-3 mb-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Question</p>
              <p className="text-sm text-gray-900 whitespace-pre-wrap">{responding.question}</p>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Your Response</label>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setResponding(null)} disabled={busy} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={busy || !response.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Sending…' : 'Send Response'}
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

function RfiCard({ rfi, onRespond }: { rfi: AssignedRfi; onRespond: (() => void) | null }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="p-2 bg-indigo-100 rounded-lg shrink-0">
            <HelpCircle className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-gray-900">
              {rfi.number} — {rfi.subject}
            </p>
            {rfi.projectName && (
              <p className="text-sm text-gray-500">
                Project: {rfi.projectNumber ? `${rfi.projectNumber} · ` : ''}
                {rfi.projectName}
              </p>
            )}
            <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{rfi.question}</p>
            {rfi.response && (
              <div className="bg-green-50 rounded-lg p-2 mt-2">
                <p className="text-xs font-medium text-green-700">Response</p>
                <p className="text-sm text-gray-900 whitespace-pre-wrap">{rfi.response}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
              {rfi.dueDate && <span>Due {new Date(rfi.dueDate).toLocaleDateString()}</span>}
              <span>Opened {new Date(rfi.createdAt).toLocaleDateString()}</span>
              {rfi.respondedAt && <span>Answered {new Date(rfi.respondedAt).toLocaleDateString()}</span>}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[rfi.status] || 'bg-gray-100 text-gray-700'}`}>
            {rfi.status}
          </span>
          {onRespond && (
            <div className="mt-2">
              <button onClick={onRespond} className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                Respond
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
