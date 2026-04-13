/**
 * Storm Radar Page — Storm tier
 * Weather event overlay + storm-generated leads for roofing contractors.
 *
 * Shows provider status at top: if not configured, displays setup
 * instructions pointing at services/stormRadar.ts. Once configured,
 * shows recent events + matched contacts.
 */
import { useState, useEffect } from 'react';
import { Radio, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../../api/client';

const SEVERITY_COLORS: Record<string, string> = {
  minor: 'bg-yellow-100 text-yellow-700',
  moderate: 'bg-orange-100 text-orange-700',
  severe: 'bg-red-100 text-red-700',
  extreme: 'bg-purple-100 text-purple-700',
};

const MATCH_STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-purple-100 text-purple-700',
  quoted: 'bg-yellow-100 text-yellow-700',
  booked: 'bg-green-100 text-green-700',
  not_interested: 'bg-gray-100 text-gray-400',
};

export default function StormRadarPage() {
  const [status, setStatus] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const [s, e, m] = await Promise.all([
        api.get('/api/storm-radar/status'),
        api.get('/api/storm-radar/events'),
        api.get('/api/storm-radar/matches'),
      ]);
      setStatus(s);
      setEvents(e.data || []);
      setMatches(m.data || []);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await api.post('/api/storm-radar/sync', {});
      alert(`Synced: ${res.fetchedCount} fetched, ${res.insertedCount} new events.`);
      load();
    } catch (err: any) {
      alert(`Sync failed: ${err.message || 'Unknown error'}`);
    } finally { setSyncing(false); }
  };

  const matchEvent = async (eventId: string) => {
    try {
      const res = await api.post(`/api/storm-radar/events/${eventId}/match`, {});
      alert(`Matched ${res.matchedCount} contacts.`);
      load();
    } catch (e) { console.error(e); }
  };

  const updateMatchStatus = async (id: string, newStatus: string) => {
    await api.post(`/api/storm-radar/matches/${id}/status`, { status: newStatus });
    load();
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Radio className="w-6 h-6 text-orange-500" />Storm Radar</h1>
          <p className="text-sm text-gray-500 mt-1">Weather events overlaid on your customer base — drive storm-season lead generation</p>
        </div>
        <button onClick={sync} disabled={syncing || !status?.configured} className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white px-4 py-2 rounded-lg flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Provider status banner */}
      {!status?.configured && (
        <div className="mb-6 bg-yellow-50 border border-yellow-300 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold text-yellow-900">Weather provider not configured</div>
            <div className="text-sm text-yellow-800 mt-1">{status?.message || 'Add API credentials to services/stormRadar.ts to activate.'}</div>
            <div className="text-xs text-yellow-700 mt-2">Current provider: <strong>{status?.provider}</strong>. Supported: NOAA (free), Tomorrow.io (paid, real-time), AccuWeather Enterprise.</div>
          </div>
        </div>
      )}

      {status?.configured && (
        <div className="mb-6 bg-green-50 border border-green-300 rounded-lg p-3 text-sm text-green-800">
          ✓ Storm Radar active using <strong>{status.provider}</strong>. Click "Sync Now" to pull the latest events.
        </div>
      )}

      {/* Recent events */}
      <div className="bg-white rounded-lg border overflow-hidden mb-6">
        <div className="p-4 border-b font-semibold">Recent Storm Events ({events.length})</div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">Type</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Hail</th><th className="px-4 py-3">Wind</th><th className="px-4 py-3">Started</th><th className="px-4 py-3"></th></tr></thead>
          <tbody>
            {events.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400">No storm events yet. {status?.configured ? 'Click "Sync Now" to pull events.' : 'Configure a weather provider to start pulling events.'}</td></tr> :
              events.map((e) => (
                <tr key={e.id} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-semibold">{(e.eventType || '').replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${SEVERITY_COLORS[e.severity] || 'bg-gray-100'}`}>{e.severity || '—'}</span></td>
                  <td className="px-4 py-3 text-sm">{e.city ? `${e.city}, ` : ''}{e.state || ''} {e.zip || ''}</td>
                  <td className="px-4 py-3 text-sm">{e.hailSizeInches ? `${e.hailSizeInches}"` : '—'}</td>
                  <td className="px-4 py-3 text-sm">{e.windSpeedMph ? `${e.windSpeedMph} mph` : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{e.startedAt ? new Date(e.startedAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3"><button onClick={() => matchEvent(e.id)} className="text-xs text-orange-600 hover:underline">Match Contacts</button></td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Storm leads (matches) */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="p-4 border-b font-semibold">Storm Leads from Matches ({matches.length})</div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b"><tr className="text-left text-xs font-semibold text-gray-500 uppercase"><th className="px-4 py-3">Contact</th><th className="px-4 py-3">Distance</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Matched</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {matches.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-400">No storm leads yet. Match a storm event to contacts to generate leads.</td></tr> :
              matches.map((m) => (
                <tr key={m.id} className="border-b">
                  <td className="px-4 py-3 font-mono text-xs">{(m.contactId || '').substring(0, 8)}…</td>
                  <td className="px-4 py-3 text-sm">{m.distanceMiles ? `${m.distanceMiles} mi` : '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${MATCH_STATUS_COLORS[m.status] || 'bg-gray-100'}`}>{(m.status || '').replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(m.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <select value={m.status} onChange={(e) => updateMatchStatus(m.id, e.target.value)} className="text-xs border rounded px-2 py-1">
                      <option value="new">New</option><option value="contacted">Contacted</option><option value="quoted">Quoted</option><option value="booked">Booked</option><option value="not_interested">Not Interested</option>
                    </select>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
