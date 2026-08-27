import { useEffect, useState } from 'react';
import { Receipt, Loader2, RefreshCw, CheckCircle2, Link2 } from 'lucide-react';
import api from '../../services/api';

const money = (n: number) => '$' + (Math.round(n) || 0).toLocaleString();

export default function AccountingPage() {
  const [data, setData] = useState<any>({ pending: [], connected: false, provider: 'QuickBooks Online', postedCount: 0 });
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState<any>(null);

  function load() { api.get('/api/accounting/status').then(setData).catch(() => {}); }
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

  const pending = data.pending || [];
  const pendingTotal = pending.reduce((s: number, e: any) => s + (e.amount || 0), 0);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-green-700 flex items-center justify-center text-white"><Receipt size={22} /></div>
        <div><h1 className="text-2xl font-bold">Accounting</h1><p className="text-sm text-gray-500 dark:text-slate-400">Post deals, F&I, parts, and service revenue to your books.</p></div>
      </div>

      <div className={`mt-4 rounded-xl border p-4 flex items-center gap-3 ${data.connected ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
        <Link2 size={18} className={data.connected ? 'text-green-600' : 'text-amber-600'} />
        <div className="flex-1 text-sm">
          <span className="font-semibold">{data.provider}</span> — {data.connected ? 'Connected' : 'Not connected'}
          {!data.connected && <span className="block text-xs text-amber-700">Connect your books to post automatically. Demo — OAuth on integration; native GL is the upgrade path.</span>}
        </div>
        {!data.connected && <button onClick={connect} className="px-3 py-1.5 rounded-lg bg-white border text-sm font-medium hover:bg-gray-50 dark:bg-slate-900">Connect</button>}
      </div>

      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-hidden dark:bg-slate-900">
        <div className="px-4 py-2.5 border-b flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold text-gray-600 dark:text-slate-400">Ready to post · {pending.length} entr{pending.length === 1 ? 'y' : 'ies'} · {money(pendingTotal)}</span>
          <button onClick={sync} disabled={syncing || !pending.length} className="px-4 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50 inline-flex items-center gap-1.5">{syncing ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}Sync to {String(data.provider || '').split(' ')[0]}</button>
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-slate-400"><tr><th className="px-4 py-2 text-left font-semibold">Type</th><th className="px-4 py-2 text-left font-semibold">Ref</th><th className="px-4 py-2 text-left font-semibold">Customer</th><th className="px-4 py-2 text-left font-semibold">Date</th><th className="px-4 py-2 text-right font-semibold">Amount</th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">{done ? 'All entries posted ✓' : 'Nothing pending.'}</td></tr>}
            {pending.map((e: any, i: number) => (<tr key={i} className="border-t"><td className="px-4 py-2">{e.type}</td><td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{e.ref}</td><td className="px-4 py-2 text-gray-600 dark:text-slate-400">{e.customer}</td><td className="px-4 py-2 text-gray-500 text-xs dark:text-slate-400">{e.date}</td><td className="px-4 py-2 text-right font-medium">{money(e.amount)}</td></tr>))}
          </tbody>
        </table>
      </div>

      {done && <div className="mt-4 bg-white rounded-xl border shadow-sm p-4 flex items-center gap-2 text-sm dark:bg-slate-900"><CheckCircle2 className="text-green-600" /><span>Posted <b>{done.posted}</b> entries ({money(done.total)}) to {done.provider} · batch {done.batch}</span></div>}
    </div>
  );
}
