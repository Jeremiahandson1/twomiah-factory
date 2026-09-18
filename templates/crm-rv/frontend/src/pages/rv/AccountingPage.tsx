import { useEffect, useState } from 'react';
import { Receipt, Loader2, RefreshCw, CheckCircle2, Link2 } from 'lucide-react';
import api from '../../services/api';

const money = (n?: number | string | null) => '$' + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CAT_LABEL: Record<string, string> = { parts: 'Parts counter', service: 'Service (RO parts)', unit: 'Unit sales', fi: 'F&I', other: 'Other' };

export default function AccountingPage() {
  const [data, setData] = useState<any>({ connected: false, provider: 'QuickBooks Online', totals: { revenue: 0, cost: 0, grossProfit: 0, count: 0 }, byCategory: [], pending: 0 });
  const [entries, setEntries] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState<any>(null);

  function load() {
    api.get('/api/accounting/status').then(setData).catch(() => {});
    api.get('/api/accounting/entries', { limit: 100 }).then((r: any) => setEntries(Array.isArray(r) ? r : [])).catch(() => {});
  }
  useEffect(() => { load(); }, []);

  async function sync() {
    setSyncing(true); setDone(null);
    const r = await api.post('/api/accounting/sync', {}).catch(() => null);
    if (r?.result) { setDone(r.result); load(); }
    setSyncing(false);
  }

  async function connect() {
    const r = await api.get('/api/quickbooks/auth-url').catch(() => null);
    if (r?.url) window.open(r.url, '_blank', 'width=600,height=720');
    else alert('QuickBooks isn’t configured yet. Add QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI to enable Connect.');
  }

  const t = data.totals || { revenue: 0, cost: 0, grossProfit: 0 };
  const margin = t.revenue ? Math.round((t.grossProfit / t.revenue) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-green-700 flex items-center justify-center text-white"><Receipt size={22} /></div>
        <div><h1 className="text-2xl font-bold">Accounting</h1><p className="text-sm text-gray-500">Live gross ledger — parts & service revenue, cost, and profit post automatically.</p></div>
      </div>

      {/* Gross summary */}
      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Revenue" value={money(t.revenue)} />
        <Stat label="Cost (COGS)" value={money(t.cost)} />
        <Stat label="Gross profit" value={money(t.grossProfit)} accent />
        <Stat label="Gross margin" value={margin + '%'} />
      </div>

      {/* By department */}
      {(data.byCategory || []).length > 0 && (
        <div className="mt-3 bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-4 py-2 border-b text-sm font-semibold text-gray-600">By department</div>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-2 text-left font-semibold">Department</th><th className="px-4 py-2 text-right font-semibold">Revenue</th><th className="px-4 py-2 text-right font-semibold">Cost</th><th className="px-4 py-2 text-right font-semibold">Gross</th></tr></thead>
            <tbody>
              {data.byCategory.map((r: any) => (
                <tr key={r.category} className="border-t">
                  <td className="px-4 py-2">{CAT_LABEL[r.category] || r.category}</td>
                  <td className="px-4 py-2 text-right">{money(r.revenue)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{money(r.cost)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-green-700">{money(r.grossProfit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* QuickBooks connection + sync */}
      <div className={`mt-4 rounded-xl border p-4 flex items-center gap-3 ${data.connected ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <Link2 size={18} className={data.connected ? 'text-green-600' : 'text-amber-600'} />
        <div className="flex-1 text-sm">
          <span className="font-semibold">{data.provider}</span> — {data.connected ? 'Connected' : 'Not connected'}
          <span className="block text-xs text-gray-500">{data.pending || 0} entr{data.pending === 1 ? 'y' : 'ies'} not yet pushed to QuickBooks. Books post natively regardless; QuickBooks sync is optional.</span>
        </div>
        {!data.connected && <button onClick={connect} className="px-3 py-1.5 rounded-lg bg-white border text-sm font-medium hover:bg-gray-50">Connect</button>}
        <button onClick={sync} disabled={syncing || !data.pending} className="px-3 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50 inline-flex items-center gap-1.5">{syncing ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}Sync</button>
      </div>
      {done && <div className="mt-2 text-sm text-green-700 flex items-center gap-1.5"><CheckCircle2 size={15} /> Pushed {done.posted} entries ({money(done.total)}) to QuickBooks.</div>}

      {/* Entries ledger */}
      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-600">Ledger · {entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="px-4 py-2 text-left font-semibold">Date</th>
              <th className="px-4 py-2 text-left font-semibold">Dept</th>
              <th className="px-4 py-2 text-left font-semibold">Ref</th>
              <th className="px-4 py-2 text-right font-semibold">Revenue</th>
              <th className="px-4 py-2 text-right font-semibold">Cost</th>
              <th className="px-4 py-2 text-right font-semibold">Gross</th>
              <th className="px-4 py-2 text-center font-semibold">QB</th>
            </tr></thead>
            <tbody>
              {entries.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No entries yet — complete a counter sale or close a repair order.</td></tr>}
              {entries.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">{e.entryDate ? new Date(e.entryDate).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-2">{CAT_LABEL[e.category] || e.category}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{e.ref || '—'}</td>
                  <td className="px-4 py-2 text-right">{money(e.revenue)}</td>
                  <td className="px-4 py-2 text-right text-gray-500">{money(e.cost)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-green-700">{money(e.grossProfit)}</td>
                  <td className="px-4 py-2 text-center">{e.postedToQb ? <CheckCircle2 size={14} className="inline text-green-600" /> : <span className="text-gray-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-white rounded-xl border shadow-sm p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${accent ? 'text-green-700' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
