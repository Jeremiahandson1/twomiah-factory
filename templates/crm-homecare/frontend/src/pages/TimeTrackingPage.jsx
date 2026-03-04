import { useState, useEffect } from 'react';
import api from '../services/api.js';
import { MapPin, CheckCircle, XCircle } from 'lucide-react';

export default function TimeTrackingPage() {
  const [entries, setEntries] = useState([]);
  const [active, setActive] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0];
    Promise.all([
      api.get(`/time-tracking?startDate=${today}&limit=100`),
      api.get('/time-tracking/active'),
    ])
      .then(([e, a]) => { setEntries(e?.entries || []); setActive(a || []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fmt = (dt) => dt ? new Date(dt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
  const dur = (start, end) => {
    if (!end) return 'Active';
    const m = Math.round((new Date(end) - new Date(start)) / 60000);
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  if (loading) return <div className="p-6 text-gray-400">Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold text-gray-900">Time Tracking & GPS</h1>
      {active.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
          <h2 className="font-semibold mb-3 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Currently Clocked In ({active.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {active.map(e => (
              <div key={e.id} className="border border-green-100 bg-green-50 rounded-lg p-3 text-sm">
                <p className="font-medium">{e.caregiver?.firstName} {e.caregiver?.lastName}</p>
                <p className="text-gray-600">{e.client?.firstName} {e.client?.lastName}</p>
                <p className="text-xs text-gray-400 mt-1">Since {fmt(e.startTime)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b"><h2 className="font-semibold">Today's Entries</h2></div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50"><tr>
            {['Caregiver','Client','In','Out','Duration','EVV'].map(h => (
              <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">{h}</th>
            ))}
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {entries.map(e => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{e.caregiver?.firstName} {e.caregiver?.lastName}</td>
                <td className="px-4 py-3 text-gray-600">{e.client?.firstName} {e.client?.lastName}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(e.startTime)}</td>
                <td className="px-4 py-3 text-gray-600">{fmt(e.endTime)}</td>
                <td className="px-4 py-3 text-gray-600">{dur(e.startTime, e.endTime)}</td>
                <td className="px-4 py-3">
                  {e.evvVisit ? (
                    <span className={`flex items-center gap-1 text-xs ${e.evvVisit.isVerified ? 'text-green-600' : 'text-yellow-600'}`}>
                      {e.evvVisit.isVerified ? <CheckCircle size={12} /> : <XCircle size={12} />} {e.evvVisit.sandataStatus}
                    </span>
                  ) : <span className="text-xs text-gray-400">Pending</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <p className="text-center text-gray-400 py-8">No entries today</p>}
      </div>
    </div>
  );
}
