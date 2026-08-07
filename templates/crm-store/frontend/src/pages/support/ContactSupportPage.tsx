import { useState, useEffect } from 'react';
import { LifeBuoy, Send, CheckCircle2 } from 'lucide-react';
import api, { type VendorTicket } from '../../services/api';

// Reaching Twomiah about the software itself. The tenant's own customer
// helpdesk lives under Support/Help — this is deliberately a separate place.

const TICKET_STATUS_STYLE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  waiting_customer: 'bg-purple-100 text-purple-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
};

export default function ContactSupportPage() {
  const [tickets, setTickets] = useState<VendorTicket[]>([]);
  const [unavailable, setUnavailable] = useState(false);
  const [statusUrl, setStatusUrl] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [sending, setSending] = useState(false);
  const [sentNumber, setSentNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTickets = async () => {
    try {
      const res = await api.getPlatformTickets();
      setTickets(Array.isArray(res?.data) ? res.data : []);
      setUnavailable(!!res?.unavailable);
      setStatusUrl(res?.statusUrl || null);
    } catch {
      setUnavailable(true);
    }
  };

  useEffect(() => { loadTickets(); }, []);

  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!subject.trim()) return;
    setSending(true);
    setError(null);
    try {
      const created = await api.createPlatformTicket({ subject, description, priority });
      setSentNumber(created?.number || 'your request');
      setSubject('');
      setDescription('');
      loadTickets();
    } catch (err: any) {
      setError(err?.message || 'Could not send that to Twomiah support');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <LifeBuoy className="w-6 h-6" /> Contact Twomiah
        </h1>
        <p className="text-gray-500 mt-1">
          Something wrong with the software itself? Tell us here — it goes straight to our team.
        </p>
        {statusUrl && (
          <p className="text-sm mt-2">
            Before you write: <a href={statusUrl} target="_blank" rel="noreferrer"
              className="text-blue-600 underline">check whether we already know about an outage</a>.
          </p>
        )}
      </div>

      {sentNumber && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Sent — {sentNumber}. We reply to the email on your account.</span>
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}
      {unavailable && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          In-app messaging is not connected for this account yet — email support@twomiah.com and we will pick it up.
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">What is happening?</label>
          <input
            value={subject}
            onChange={(e: any) => setSubject(e.target.value)}
            required
            placeholder="Invoices are not emailing to my customers"
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Any detail that helps</label>
          <textarea
            value={description}
            onChange={(e: any) => setDescription(e.target.value)}
            rows={5}
            placeholder="What you did, what you expected, what happened instead."
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">How urgent is it?</label>
          <select
            value={priority}
            onChange={(e: any) => setPriority(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="low">Low — just a question</option>
            <option value="normal">Normal — something is awkward</option>
            <option value="high">High — part of the app is unusable</option>
            <option value="urgent">Urgent — it is costing me money right now</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={sending || !subject.trim()}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send to Twomiah'}
        </button>
      </form>

      <div className="mt-8">
        <h2 className="font-semibold text-gray-900 mb-3">Your requests to Twomiah</h2>
        {tickets.length === 0 ? (
          <p className="text-gray-500 text-sm">Nothing yet.</p>
        ) : (
          <div className="bg-white rounded-xl border divide-y">
            {tickets.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-medium text-gray-900">{t.subject}</p>
                  <p className="text-xs text-gray-500">
                    {t.number} - {new Date(t.created_at).toLocaleDateString()}
                  </p>
                </div>
                <span className={'text-xs font-medium px-2 py-0.5 rounded ' + (TICKET_STATUS_STYLE[t.status] || 'bg-gray-100 text-gray-600')}>
                  {String(t.status).replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
