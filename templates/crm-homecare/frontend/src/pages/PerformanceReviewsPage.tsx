/**
 * Performance Reviews Page — Care Agency tier
 * Caregiver performance reviews with ratings and notes.
 */
import { useState, useEffect } from 'react';
import { Award, Plus, Star, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';

export default function PerformanceReviewsPage() {
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ caregiverId: '', rating: 5, reviewDate: '', reviewer: '', strengths: '', improvements: '', goals: '', notes: '' });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/performance-reviews`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setReviews(json.data || json || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    await fetch(`${API_BASE_URL}/api/performance-reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...form, rating: Number(form.rating) }),
    });
    setShowCreate(false);
    setForm({ caregiverId: '', rating: 5, reviewDate: '', reviewer: '', strengths: '', improvements: '', goals: '', notes: '' });
    load();
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><Award className="w-6 h-6 text-teal-600" />Performance Reviews</h1><p className="text-sm text-gray-500 mt-1">Quarterly and annual caregiver performance tracking</p></div>
        <button onClick={() => setShowCreate(true)} className="bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />New Review</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reviews.length === 0 ? <div className="col-span-full bg-white rounded-lg border p-12 text-center text-gray-400">No performance reviews yet.</div> :
          reviews.map((r: any) => (
            <div key={r.id} className="bg-white rounded-lg border p-5">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold">{r.caregiverName || r.caregiverId}</div>
                  <div className="text-xs text-gray-500">{r.reviewDate ? new Date(r.reviewDate).toLocaleDateString() : '—'} · by {r.reviewer || '—'}</div>
                </div>
                <div className="flex items-center gap-0.5">{[1,2,3,4,5].map((s) => <Star key={s} className={`w-4 h-4 ${s <= (r.rating || 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`} />)}</div>
              </div>
              {r.strengths && <div className="text-sm mb-2"><span className="font-semibold text-green-600">Strengths:</span> {r.strengths}</div>}
              {r.improvements && <div className="text-sm mb-2"><span className="font-semibold text-yellow-600">Improvements:</span> {r.improvements}</div>}
              {r.goals && <div className="text-sm"><span className="font-semibold text-blue-600">Goals:</span> {r.goals}</div>}
            </div>
          ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-bold mb-4">New Performance Review</h2>
            <form onSubmit={create} className="space-y-3">
              <input required placeholder="Caregiver ID" value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <div className="grid grid-cols-2 gap-3">
                <input type="date" value={form.reviewDate} onChange={(e) => setForm({ ...form, reviewDate: e.target.value })} className="border rounded-lg px-3 py-2" />
                <select value={form.rating} onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })} className="border rounded-lg px-3 py-2">{[1,2,3,4,5].map((r) => <option key={r} value={r}>{r} star{r !== 1 ? 's' : ''}</option>)}</select>
              </div>
              <input placeholder="Reviewer name" value={form.reviewer} onChange={(e) => setForm({ ...form, reviewer: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <textarea placeholder="Strengths" value={form.strengths} onChange={(e) => setForm({ ...form, strengths: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <textarea placeholder="Areas for improvement" value={form.improvements} onChange={(e) => setForm({ ...form, improvements: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <textarea placeholder="Goals" value={form.goals} onChange={(e) => setForm({ ...form, goals: e.target.value })} rows={2} className="w-full border rounded-lg px-3 py-2" />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg">Cancel</button><button type="submit" className="px-4 py-2 bg-teal-500 text-white rounded-lg">Create</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
