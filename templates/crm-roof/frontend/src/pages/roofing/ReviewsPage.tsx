/**
 * Reviews Page — Pro tier (Roof)
 * Review requests (ask customers) + received reviews.
 */
import { useState, useEffect } from 'react';
import { Star, Send, Plus } from 'lucide-react';
import api from '../../api/client';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  clicked: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

export default function ReviewsPage() {
  const [tab, setTab] = useState<'received' | 'requests'>('received');
  const [reviews, setReviews] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [showRequest, setShowRequest] = useState(false);
  const [form, setForm] = useState({ contactId: '', jobId: '', channel: 'both' as 'sms' | 'email' | 'both', reviewLink: '', message: '' });

  useEffect(() => { load(); }, []);
  const load = async () => {
    try {
      const [r1, r2, r3] = await Promise.all([api.get('/api/reviews'), api.get('/api/reviews/requests'), api.get('/api/reviews/summary')]);
      setReviews(r1.data || []); setRequests(r2.data || []); setSummary(r3);
    } catch (e) { console.error(e); }
  };

  const createRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/api/reviews/requests', form);
    setShowRequest(false);
    setForm({ contactId: '', jobId: '', channel: 'both', reviewLink: '', message: '' });
    load();
  };

  const markSent = async (id: string) => { await api.post(`/api/reviews/requests/${id}/mark-sent`, {}); load(); };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Star className="w-6 h-6 text-orange-500" />Reviews</h1>
          {summary && <p className="text-sm text-gray-500 mt-1">{Number(summary.averageRating || 0).toFixed(1)} ★ average · {summary.totalReviews} reviews</p>}
        </div>
        {tab === 'requests' && <button onClick={() => setShowRequest(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />Request Review</button>}
      </div>

      <div className="flex gap-2 mb-4 border-b">
        <button onClick={() => setTab('received')} className={`px-4 py-2 border-b-2 ${tab === 'received' ? 'border-orange-500 text-orange-600 font-semibold' : 'border-transparent text-gray-500'}`}>Received ({reviews.length})</button>
        <button onClick={() => setTab('requests')} className={`px-4 py-2 border-b-2 ${tab === 'requests' ? 'border-orange-500 text-orange-600 font-semibold' : 'border-transparent text-gray-500'}`}>Requests ({requests.length})</button>
      </div>

      {tab === 'received' ? (
        <div className="space-y-3">
          {reviews.length === 0 ? <div className="bg-white rounded-lg border p-12 text-center text-gray-400">No reviews yet. Send review requests to start collecting.</div> :
            reviews.map((r) => (
              <div key={r.id} className="bg-white rounded-lg border p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1">{[1,2,3,4,5].map((s) => <Star key={s} className={`w-4 h-4 ${s <= r.rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />)}</div>
                    <div className="text-xs text-gray-500 mt-1">{r.reviewerName || 'Anonymous'} · {r.platform} · {new Date(r.receivedAt).toLocaleDateString()}</div>
                  </div>
                  {r.verified && <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Verified</span>}
                </div>
                {r.comment && <p className="mt-3 text-sm text-gray-700">{r.comment}</p>}
              </div>
            ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Sent</th><th className="px-4 py-3"></th></tr></thead>
            <tbody>
              {requests.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No review requests yet.</td></tr> :
                requests.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-4 py-3 font-mono text-xs">{r.contactId.substring(0, 8)}…</td>
                    <td className="px-4 py-3 text-sm">{r.channel}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>{r.status}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-500">{r.sentAt ? new Date(r.sentAt).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">{r.status === 'pending' && <button onClick={() => markSent(r.id)} className="text-blue-600 text-xs hover:underline flex items-center gap-1"><Send className="w-3 h-3" />Mark Sent</button>}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {showRequest && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-md p-6">
            <h2 className="text-xl font-bold mb-4">Request Review</h2>
            <form onSubmit={createRequest} className="space-y-3">
              <input required placeholder="Contact ID" value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input placeholder="Job ID (optional)" value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value as any })} className="w-full border rounded-lg px-3 py-2">
                <option value="both">SMS + Email</option><option value="sms">SMS only</option><option value="email">Email only</option>
              </select>
              <input placeholder="Review link (Google Business URL)" value={form.reviewLink} onChange={(e) => setForm({ ...form, reviewLink: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <textarea placeholder="Custom message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={3} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowRequest(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-orange-500 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
