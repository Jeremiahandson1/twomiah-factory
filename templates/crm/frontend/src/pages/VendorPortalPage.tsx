import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';

/**
 * Vendor / subcontractor portal — reached only through the private link the
 * company sends. No login, no app chrome: the token in the URL is the
 * credential, same model as the customer portal. Self-contained on purpose
 * (no auth context, no api client) so it renders even with a cold cache.
 */

const API = import.meta.env.VITE_API_URL || '';

interface PoLine { id: string; description: string; quantity: string; unitCost: string; total: string }

export default function VendorPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState('');
  const [openPo, setOpenPo] = useState<Record<string, any> | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);
  const [invoice, setInvoice] = useState({ number: '', amount: '', dueDate: '', purchaseOrderId: '' });
  const [invoiceMsg, setInvoiceMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, init?: RequestInit) => {
    const res = await fetch(`${API}/api/vendor-portal/v/${token}${path}`, init);
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error || 'Request failed');
    return json;
  }, [token]);

  const load = useCallback(async () => {
    try { setData(await call('')); setError(''); }
    catch (err) { setError((err as Error).message); }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  const money = (v: unknown) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  const statusChip = (s: string) => {
    const styles: Record<string, string> = {
      sent: 'bg-blue-100 text-blue-700', acknowledged: 'bg-teal-100 text-teal-700',
      declined: 'bg-red-100 text-red-700', received: 'bg-amber-100 text-amber-700',
      billed: 'bg-green-100 text-green-700', open: 'bg-blue-100 text-blue-700',
      partial: 'bg-amber-100 text-amber-700', paid: 'bg-green-100 text-green-700',
    };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${styles[s] || 'bg-gray-100 text-gray-600'}`}>{s}</span>;
  };

  const viewPo = async (id: string) => {
    try { setOpenPo(await call(`/pos/${id}`)); setDeclineReason(''); setDeclining(false); }
    catch (err) { setError((err as Error).message); }
  };

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await call(path, body !== undefined
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'POST' });
      setOpenPo(null); await load();
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const submitInvoice = async () => {
    if (!invoice.number || !invoice.amount) { setInvoiceMsg('Invoice number and amount are required.'); return; }
    setBusy(true); setInvoiceMsg('');
    try {
      await call('/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        number: invoice.number, amount: Number(invoice.amount),
        dueDate: invoice.dueDate || undefined, purchaseOrderId: invoice.purchaseOrderId || undefined,
      }) });
      setInvoice({ number: '', amount: '', dueDate: '', purchaseOrderId: '' });
      setInvoiceMsg('Invoice submitted — the office will review and schedule payment.');
      await load();
    } catch (err) { setInvoiceMsg((err as Error).message); }
    finally { setBusy(false); }
  };

  if (error && !data) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-red-600 dark:bg-slate-900">{error}</div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400 dark:bg-slate-900">Loading…</div>;

  const accent = data.company?.primaryColor || '#2563eb';

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      <header className="bg-white border-b px-6 py-4 dark:bg-slate-900">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <div className="font-bold text-gray-900 dark:text-slate-100">{data.company?.name}</div>
            <div className="text-sm text-gray-500 dark:text-slate-400">Vendor portal — {data.vendor?.name}</div>
          </div>
          <div className="text-sm text-gray-500 dark:text-slate-400">{data.company?.phone}</div>
        </div>
      </header>
      {error && <div className="max-w-4xl mx-auto mt-4 px-6"><div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2 text-sm">{error}</div></div>}

      <main className="max-w-4xl mx-auto p-6 space-y-8">
        <section>
          <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">Purchase orders</h2>
          {(data.purchaseOrders || []).length === 0 && <p className="text-sm text-gray-400">Nothing yet — POs sent to you show up here.</p>}
          <div className="space-y-2">
            {(data.purchaseOrders || []).map((po: Record<string, any>) => (
              <button key={po.id} onClick={() => viewPo(po.id)} className="w-full bg-white border rounded-lg px-4 py-3 flex items-center justify-between hover:border-gray-400 text-left dark:bg-slate-900">
                <div>
                  <span className="font-medium text-gray-900 mr-3 dark:text-slate-100">{po.number}</span>
                  {statusChip(po.status)}
                </div>
                <div className="text-sm text-gray-600 dark:text-slate-400">{money(po.total)}</div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">Submit an invoice</h2>
          <div className="bg-white border rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 dark:bg-slate-900">
            <div><label className="block text-sm font-medium mb-1">Your invoice #</label>
              <input value={invoice.number} onChange={e => setInvoice({ ...invoice, number: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Amount</label>
              <input type="number" value={invoice.amount} onChange={e => setInvoice({ ...invoice, amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Due date</label>
              <input type="date" value={invoice.dueDate} onChange={e => setInvoice({ ...invoice, dueDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Against PO</label>
              <select value={invoice.purchaseOrderId} onChange={e => setInvoice({ ...invoice, purchaseOrderId: e.target.value })} className="w-full px-3 py-2 border rounded-lg">
                <option value="">None</option>
                {(data.purchaseOrders || []).map((po: Record<string, any>) => <option key={po.id} value={po.id}>{po.number}</option>)}
              </select></div>
            <div className="sm:col-span-2 flex items-center gap-3">
              <button onClick={submitInvoice} disabled={busy} style={{ backgroundColor: accent }} className="px-4 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Submit invoice</button>
              {invoiceMsg && <span className="text-sm text-gray-600 dark:text-slate-400">{invoiceMsg}</span>}
            </div>
          </div>
        </section>

        <section>
          <h2 className="font-semibold text-gray-900 mb-3 dark:text-slate-100">Your invoices</h2>
          {(data.bills || []).length === 0 && <p className="text-sm text-gray-400">No invoices on file.</p>}
          <div className="space-y-2">
            {(data.bills || []).map((b: Record<string, any>) => (
              <div key={b.id} className="bg-white border rounded-lg px-4 py-3 flex items-center justify-between dark:bg-slate-900">
                <div><span className="font-medium text-gray-900 mr-3 dark:text-slate-100">{b.number || '(no number)'}</span>{statusChip(b.status)}</div>
                <div className="text-sm text-gray-600 dark:text-slate-400">{money(b.amount)} <span className="text-gray-400">/ paid {money(b.amountPaid)}</span></div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {openPo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setOpenPo(null)}>
          <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto dark:bg-slate-900" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-bold text-gray-900 dark:text-slate-100">{openPo.number}</h3>
              {statusChip(openPo.status)}
            </div>
            {openPo.jobTitle && <p className="text-sm text-gray-500 mb-2 dark:text-slate-400">Job: {openPo.jobTitle}</p>}
            {openPo.shipTo && <p className="text-sm text-gray-500 mb-2 dark:text-slate-400">Ship to: {openPo.shipTo}</p>}
            <table className="w-full text-sm my-3">
              <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-1">Item</th><th className="py-1 text-right">Qty</th><th className="py-1 text-right">Unit</th><th className="py-1 text-right">Total</th></tr></thead>
              <tbody>
                {(openPo.lines || []).map((l: PoLine) => (
                  <tr key={l.id} className="border-t"><td className="py-1.5">{l.description}</td><td className="py-1.5 text-right">{Number(l.quantity)}</td><td className="py-1.5 text-right">{money(l.unitCost)}</td><td className="py-1.5 text-right">{money(l.total)}</td></tr>
                ))}
              </tbody>
            </table>
            <div className="text-right text-sm text-gray-900 font-semibold mb-4 dark:text-slate-100">Total {money(openPo.total)}</div>
            {openPo.status === 'sent' && !declining && (
              <div className="flex gap-3">
                <button onClick={() => act(`/pos/${openPo.id}/acknowledge`)} disabled={busy} style={{ backgroundColor: accent }} className="flex-1 px-4 py-2 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Acknowledge</button>
                <button onClick={() => setDeclining(true)} disabled={busy} className="flex-1 px-4 py-2 border rounded-lg text-sm text-red-600 hover:bg-red-50">Decline…</button>
              </div>
            )}
            {declining && (
              <div className="space-y-2">
                <input value={declineReason} onChange={e => setDeclineReason(e.target.value)} placeholder="Why can't you fulfill this PO?" className="w-full px-3 py-2 border rounded-lg text-sm" />
                <div className="flex gap-3">
                  <button onClick={() => declineReason.trim() && act(`/pos/${openPo.id}/decline`, { reason: declineReason.trim() })} disabled={busy || !declineReason.trim()} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">Decline PO</button>
                  <button onClick={() => setDeclining(false)} className="px-4 py-2 border rounded-lg text-sm">Back</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
