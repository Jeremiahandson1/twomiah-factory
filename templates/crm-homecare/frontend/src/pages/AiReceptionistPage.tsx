/**
 * AI Receptionist Page — Care Agency tier
 * Config + call log view for the AI voice receptionist.
 */
import { useState, useEffect } from 'react';
import { Bot, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';

export default function AiReceptionistPage() {
  const [config, setConfig] = useState<any>(null);
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [greeting, setGreeting] = useState('');

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const token = localStorage.getItem('token');
      const h = { Authorization: `Bearer ${token}` };
      const [cfgRes, callsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/ai-receptionist/config`, { headers: h }).then((r) => r.json()).catch(() => null),
        fetch(`${API_BASE_URL}/api/ai-receptionist/calls`, { headers: h }).then((r) => r.json()).catch(() => ({ data: [] })),
      ]);
      if (cfgRes) { setConfig(cfgRes); setEnabled(!!cfgRes.enabled); setGreeting(cfgRes.greeting || ''); }
      setCalls(Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const save = async () => {
    const token = localStorage.getItem('token');
    await fetch(`${API_BASE_URL}/api/ai-receptionist/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ enabled, greeting }),
    });
    load();
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-teal-600" /></div>;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="w-6 h-6 text-teal-600" />AI Receptionist</h1>
        <p className="text-sm text-gray-500 mt-1">Automated voice receptionist for after-hours, overflow, and intake</p>
      </div>

      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div><div className="font-semibold">Enable AI Receptionist</div><div className="text-sm text-gray-500">Answer calls automatically when you can't</div></div>
          <button onClick={() => setEnabled(!enabled)} className={`relative w-12 h-6 rounded-full transition ${enabled ? 'bg-teal-500' : 'bg-gray-300'}`}>
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition ${enabled ? 'translate-x-6' : ''}`} />
          </button>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Greeting</label>
          <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={3} className="w-full border rounded-lg px-3 py-2" placeholder="Thank you for calling [Agency]. How can we help?" />
        </div>
        <button onClick={save} className="mt-3 bg-teal-500 text-white px-4 py-2 rounded-lg hover:bg-teal-600">Save Settings</button>
      </div>

      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="p-4 border-b font-semibold">Recent Calls</div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">From</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Time</th></tr></thead>
          <tbody>
            {calls.length === 0 ? <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-400">No calls logged yet.</td></tr> :
              calls.map((c: any) => (
                <tr key={c.id} className="border-b">
                  <td className="px-4 py-3 font-mono text-sm">{c.fromNumber || c.caller || '—'}</td>
                  <td className="px-4 py-3 text-sm">{c.duration || 0}s</td>
                  <td className="px-4 py-3 text-sm">{c.outcome || c.status || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{c.createdAt ? new Date(c.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
