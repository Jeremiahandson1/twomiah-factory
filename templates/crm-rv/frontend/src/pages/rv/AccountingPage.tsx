import { useEffect, useState } from 'react';
import { Receipt, Loader2, RefreshCw, CheckCircle2, Link2 } from 'lucide-react';
import api from '../../services/api';
import { formatDate } from '../../utils/date';
import { PageError, errorText, useMayWrite } from '../../shared';

/**
 * AN ACCOUNTING PAGE DOES NOT ROUND. (T41)
 *
 * This was `'$' + (Math.round(n) || 0).toLocaleString()` — the whole point of the page is what gets
 * posted to the books, and it was showing every figure rounded to the nearest dollar with no cents
 * at all. A $1,249.50 deal read $1,250 here and $1,249.50 in QuickBooks.
 *
 * (It also escaped the fleet money sweep, which looked for `$${…}` inside a template literal and
 * not for a '$' concatenated with +. The guard now covers both forms.)
 */
const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function AccountingPage() {
  const [data, setData] = useState<any>({ pending: [], connected: false, provider: 'QuickBooks Online', postedCount: 0 });
  const [syncing, setSyncing] = useState(false);
  const [done, setDone] = useState<any>(null);
  const [pageErr, setPageErr] = useState<string>('');
  /**
   * The buttons follow the routes they call. (T61, open since T42: "QuickBooks Connect and Sync still
   * show for the manager, but the server refuses them.") Connect is GET /api/quickbooks/auth-url, which
   * asks settings:update; Sync is POST /api/accounting/sync, which asks integrations:update. A manager
   * holds neither — the books are the owner's and the admins'. The page itself stays readable.
   */
  const mayConnect = useMayWrite('settings:update');
  const maySync = useMayWrite('integrations:update');

  function load() { api.get('/api/accounting/status').then(setData).catch(() => {}); }
  useEffect(() => { load(); }, []);

  async function sync() {
    setSyncing(true); setDone(null); setPageErr('');
    try {
      const r = await api.post('/api/accounting/sync', {});
      if (r?.result) { setDone(r.result); load(); }
      else setPageErr('The sync returned nothing to post. Reload and try again.');
    } catch (err) {
      // A posting run that fails silently is the worst case on this page — the books are the point.
      setPageErr(errorText(err, 'Could not post to your books. Nothing was sent.'));
    } finally {
      setSyncing(false);
    }
  }

  async function connect() {
    setPageErr('');
    const r = await api.get('/api/quickbooks/auth-url').catch(() => null);
    if (r?.url) { window.open(r.url, '_blank', 'width=600,height=720'); return; }
    /**
     * This named three environment variables in a pop-up. (T58d)
     *
     * QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI are OUR deployment's settings — a
     * dealership reading that has been handed a task they cannot do and a vocabulary that is not
     * theirs. It is also an unnecessary disclosure of how the service is wired. What they need is to
     * know it is not available yet and that it is on us.
     */
    setPageErr('QuickBooks isn’t connected for this account yet. Twomiah has to switch it on — contact support and we will set it up.');
  }

  const pending = data.pending || [];
  const pendingTotal = pending.reduce((s: number, e: any) => s + (e.amount || 0), 0);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-green-700 flex items-center justify-center text-white"><Receipt size={22} /></div>
        <div><h1 className="text-2xl font-bold">Accounting</h1><p className="text-sm text-gray-500 dark:text-slate-400">Post deals, F&I, parts, and service revenue to your books.</p></div>
      </div>

      <div className="mt-4"><PageError message={pageErr} onDismiss={() => setPageErr('')} /></div>

      <div className={`mt-4 rounded-xl border p-4 flex items-center gap-3 ${data.connected ? 'bg-green-50 border-green-200 dark:bg-green-950/40 dark:text-slate-100' : 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:text-slate-100'}`}>
        <Link2 size={18} className={data.connected ? 'text-green-700 dark:text-green-300' : 'text-amber-700 dark:text-amber-300'} />
        <div className="flex-1 text-sm">
          <span className="font-semibold">{data.provider}</span> — {data.connected ? 'Connected' : 'Not connected'}
          {!data.connected && <span className="block text-xs text-amber-700 dark:text-amber-300">Connect your books to post automatically. Demo — OAuth on integration; native GL is the upgrade path.</span>}
        </div>
        {!data.connected && !mayConnect && <span className="text-xs text-gray-600 dark:text-slate-400">An owner or admin connects the books.</span>}
        {!data.connected && mayConnect && <button onClick={connect} className="px-3 py-1.5 rounded-lg bg-white border text-sm font-medium hover:bg-gray-50 dark:bg-slate-900">Connect</button>}
      </div>

      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-x-auto dark:bg-slate-900">
        <div className="px-4 py-2.5 border-b flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm font-semibold text-gray-600 dark:text-slate-400">Ready to post · {pending.length} entr{pending.length === 1 ? 'y' : 'ies'} · {money(pendingTotal)}</span>
          {!maySync && <span className="text-xs text-gray-600 dark:text-slate-400">An owner or admin posts to the books.</span>}
          {maySync && <button onClick={sync} disabled={syncing || !pending.length} className="px-4 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50 inline-flex items-center gap-1.5">{syncing ? <Loader2 className="animate-spin" size={15} /> : <RefreshCw size={15} />}Sync to {String(data.provider || '').split(' ')[0]}</button>}
        </div>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-slate-400"><tr><th className="px-4 py-2 text-left font-semibold">Type</th><th className="px-4 py-2 text-left font-semibold">Ref</th><th className="px-4 py-2 text-left font-semibold">Customer</th><th className="px-4 py-2 text-left font-semibold">Date</th><th className="px-4 py-2 text-right font-semibold">Amount</th></tr></thead>
          <tbody>
            {pending.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">{done ? 'All entries posted ✓' : 'Nothing pending.'}</td></tr>}
            {pending.map((e: any, i: number) => (<tr key={i} className="border-t"><td className="px-4 py-2">{e.type}</td><td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-slate-400">{e.ref}</td><td className="px-4 py-2 text-gray-600 dark:text-slate-400">{e.customer}</td>{/* The entry's date, not the raw timestamp the API happens to send. (T41: "Accounting shows raw ISO dates") */}
              <td className="px-4 py-2 text-gray-500 text-xs dark:text-slate-400">{formatDate(e.date) || '—'}</td><td className="px-4 py-2 text-right font-medium">{money(e.amount)}</td></tr>))}
          </tbody>
        </table>
      </div>

      {done && <div className="mt-4 bg-white rounded-xl border shadow-sm p-4 flex items-center gap-2 text-sm dark:bg-slate-900"><CheckCircle2 className="text-green-700 dark:text-green-300" /><span>Posted <b>{done.posted}</b> entries ({money(done.total)}) to {done.provider} · batch {done.batch}</span></div>}
    </div>
  );
}
