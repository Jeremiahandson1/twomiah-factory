import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, FileUp, Loader2, Plus } from 'lucide-react';
import { api } from '../../../api';
import FormError, { errorText } from '../../ui/FormError';
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money, centsFrom } from './registerUi';
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock';

/**
 * INVOICE SCANNING (feature bar_invoice_scan; server: crm/bar/barInvoices.ts). A photo or PDF of a supplier invoice is read into lines,
 * matched to stock items, and shown here to be CHECKED. Nothing changes a count or a price until "Receive" is pressed, and that makes one
 * received order, the same thing "It came in" makes. A manager's (bar:update).
 */
interface Line { n: number; text: string; size: string | null; qty: number | null; packCostCents: number | null; lineTotalCents: number | null; stockItemId: string | null; matchedBy: 'saved' | 'name' | 'manual' | null; sure: boolean; skip: boolean; added?: boolean; stockName: string | null; packName: string | null; currentCostCents: number | null; warnings: string[] }
interface Scan {
  id: string; status: 'review' | 'confirmed'; vendorId: string | null; vendorName: string | null; supplierName: string | null; invoiceNumber: string | null; invoiceDate: string | null
  totalCents: number | null; linesTotalCents: number; differenceCents: number | null; notes: string | null; fileName: string | null; fileType: string | null; hasFile: boolean
  needsAttention: number; duplicateOf: { number: number | null; at: string | null } | null; lines: Line[]; confirmedAt: string | null; createdAt: string
  stock?: Array<{ id: string; name: string; packName: string; packCostCents: number | null }>
}
interface Row extends Omit<Scan, 'lines'> { lineCount: number }
interface Vendor { id: string; name: string }

const when = (iso: string | null) => (iso ? momentDate(iso, { month: 'short', day: 'numeric' }) : '');
const dollars = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2));

export default function InvoicesTab({ vendors }: { vendors: Vendor[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [reading, setReading] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const pick = useRef<HTMLInputElement>(null);
  const snap = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => { try { setRows((await api.get('/api/stock/invoices')).data); } catch (e) { setErr(errorText(e, 'Could not load the invoices.')); } }, []);
  useEffect(() => { load(); }, [load]);

  const send = async (file: File | undefined) => {
    if (!file) return;
    setErr(''); setReading(true);
    try {
      const fd = new FormData();
      fd.set('file', file);
      if (vendorId) fd.set('vendorId', vendorId);
      const r = await api.request('/api/stock/invoices', { method: 'POST', body: fd, timeoutMs: 150_000 });
      await load();
      setOpen(r.id);
    } catch (e) { setErr(errorText(e, 'That invoice could not be read.')); }
    finally { setReading(false); if (pick.current) pick.current.value = ''; if (snap.current) snap.current.value = ''; }
  };

  if (open) return <Review id={open} vendors={vendors} onBack={() => { setOpen(null); load(); }} />;
  if (!rows) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const waiting = rows.filter((r) => r.status === 'review'), done = rows.filter((r) => r.status === 'confirmed');
  return (
    <>
      <FormError message={err} onDismiss={() => setErr('')} />
      <div className={CARD}>
        <p className="text-sm text-gray-900 dark:text-slate-100 font-semibold">Receive an order from the supplier&rsquo;s invoice</p>
        <p className={`text-sm mt-1 ${MUTED}`}>Photograph or upload the invoice (a photo or a PDF). It is read into lines and matched to your stock items. Nothing changes your counts or your prices until you have checked the lines and pressed Receive.</p>
        <div className="flex flex-wrap items-end gap-2 mt-3">
          <label className="text-sm text-gray-900 dark:text-slate-100">
            <span className={`block ${LABEL} mb-1`}>Supplier (optional)</span>
            <select className={`${INPUT} min-w-[12rem]`} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">Work it out from the invoice</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <input ref={snap} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo of the invoice" tabIndex={-1} onChange={(e) => send(e.target.files?.[0])} />
          <input ref={pick} type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" className="sr-only" aria-label="Choose an invoice file" tabIndex={-1} onChange={(e) => send(e.target.files?.[0])} />
          <button className={`${BTN} ${ON} inline-flex items-center gap-2`} disabled={reading} onClick={() => snap.current?.click()}><Camera className="w-4 h-4" />Take a photo</button>
          <button className={`${BTN} ${OFF} inline-flex items-center gap-2`} disabled={reading} onClick={() => pick.current?.click()}><FileUp className="w-4 h-4" />Upload a photo or PDF</button>
        </div>
        {reading && <p role="status" className={`text-sm mt-3 inline-flex items-center gap-2 ${MUTED}`}><Loader2 className="w-4 h-4 animate-spin" />Reading the invoice. This can take up to a minute.</p>}
      </div>
      <div className={CARD}>
        <p className={`${LABEL} mb-2`}>Waiting for your check</p>
        {waiting.length === 0 && <p className={`text-sm ${MUTED}`}>Nothing waiting. A scanned invoice stays here until you receive it or throw it away.</p>}
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {waiting.map((r) => (
            <li key={r.id}>
              <button className="w-full text-left py-3 px-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 flex flex-wrap items-center justify-between gap-2" onClick={() => setOpen(r.id)}>
                <span className="text-gray-900 dark:text-slate-100"><span className="font-semibold">{r.supplierName || r.vendorName || 'Invoice'}{r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}</span><span className={`block text-xs ${MUTED}`}>{r.lineCount} lines · read {when(r.createdAt)}{r.needsAttention ? ` · ${r.needsAttention} to check` : ' · ready to receive'}</span></span>
                <span className="font-mono text-gray-900 dark:text-slate-100">{r.totalCents === null ? '' : money(r.totalCents)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {done.length > 0 && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Received from an invoice</p>
          <ul className="divide-y divide-gray-200 dark:divide-slate-800">
            {done.map((r) => (
              <li key={r.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-gray-900 dark:text-slate-100 text-sm">
                <span>{r.supplierName || r.vendorName || 'Invoice'}{r.invoiceNumber ? ` · ${r.invoiceNumber}` : ''}<span className={`block text-xs ${MUTED}`}>Received {when(r.confirmedAt)} · {r.lineCount} lines</span></span>
                <span className="font-mono">{r.totalCents === null ? '' : money(r.totalCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

interface Draft { vendorId: string; invoiceNumber: string; invoiceDate: string; lines: Array<{ n: number; stockItemId: string; qty: string; cost: string; skip: boolean }> }
const draftOf = (s: Scan): Draft => ({ vendorId: s.vendorId || '', invoiceNumber: s.invoiceNumber || '', invoiceDate: s.invoiceDate || '', lines: s.lines.map((l) => ({ n: l.n, stockItemId: l.stockItemId || '', qty: l.qty === null ? '' : String(l.qty), cost: dollars(l.packCostCents), skip: l.skip })) });

function Review({ id, vendors, onBack }: { id: string; vendors: Vendor[]; onBack: () => void }) {
  const [scan, setScan] = useState<Scan | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'edit' | 'receive' | 'discard'>('edit');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [photo, setPhoto] = useState<{ url: string; pdf: boolean } | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [added, setAdded] = useState('');
  const [result, setResult] = useState<any>(null);
  const take = (s: Scan) => { setScan(s); setDraft(draftOf(s)); };
  useEffect(() => { api.get(`/api/stock/invoices/${id}`).then((r: any) => take(r)).catch((e: unknown) => setErr(errorText(e, 'Could not open that invoice.'))); }, [id]);
  useEffect(() => {
    let url = '';
    if (!showPhoto || photo || !scan?.hasFile) return;
    api.raw(`/api/stock/invoices/${id}/file`).then(async (res: Response) => { if (!res.ok) throw new Error(); const b = await res.blob(); url = URL.createObjectURL(b); setPhoto({ url, pdf: b.type === 'application/pdf' }); }).catch(() => setErr('The invoice file could not be opened.'));
    return () => { /* the address is released when the screen closes */ };
  }, [showPhoto, photo, scan?.hasFile, id]);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);

  if (!scan || !draft) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const stock = scan.stock || [];
  const set = (n: number, patch: Partial<Draft['lines'][number]>) => setDraft((d) => d && ({ ...d, lines: d.lines.map((l) => (l.n === n ? { ...l, ...patch } : l)) }));
  const body = () => ({
    vendorId: draft.vendorId || null, invoiceNumber: draft.invoiceNumber, invoiceDate: draft.invoiceDate || null,
    lines: draft.lines.map((l) => ({ n: l.n, stockItemId: l.stockItemId || null, qty: l.qty.trim() === '' ? null : Number(l.qty), packCostCents: l.cost.trim() === '' ? null : centsFrom(l.cost), skip: l.skip })),
  });
  const bad = draft.lines.find((l) => (l.cost.trim() !== '' && centsFrom(l.cost) === null) || (l.qty.trim() !== '' && !(Number(l.qty) > 0)));
  const save = async (): Promise<Scan | null> => {
    if (bad) { setErr('Check the quantity and the price on each line: numbers only.'); return null; }
    setErr(''); setBusy(true);
    try { const r = await api.patch(`/api/stock/invoices/${id}`, body()); take(r); return r as Scan; }
    catch (e) { setErr(errorText(e, 'That did not save.')); return null; }
    finally { setBusy(false); }
  };
  const addLine = async () => {
    const text = added.trim(); if (!text) return;
    setBusy(true); setErr('');
    try { const saved = await api.patch(`/api/stock/invoices/${id}`, { ...body(), lines: [...body().lines, { text }] }); take(saved); setAdded(''); }
    catch (e) { setErr(errorText(e, 'That did not save.')); } finally { setBusy(false); }
  };
  const receive = async () => {
    const s = await save(); if (!s) return;
    if (s.needsAttention) { setStep('edit'); setErr(`${s.needsAttention} ${s.needsAttention === 1 ? 'line needs' : 'lines need'} a look first (marked below). Fix them, or skip them.`); return; }
    setStep('receive');
  };
  const confirm = async () => {
    setBusy(true); setErr('');
    try { const r = await api.post(`/api/stock/invoices/${id}/confirm`, { allowDuplicate }); setResult(r); }
    catch (e) { setErr(errorText(e, 'That did not go through. Nothing was received.')); setStep('edit'); } finally { setBusy(false); }
  };
  const discard = async () => { setBusy(true); try { await api.post(`/api/stock/invoices/${id}/discard`, {}); onBack(); } catch (e) { setErr(errorText(e, 'That did not go through.')); } finally { setBusy(false); } };

  if (result) {
    return (
      <div className={CARD}>
        <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">Received as order #{result.orderNumber}</p>
        <p className={`text-sm mt-1 ${MUTED}`}>{result.lines} lines, {money(result.totalCents)}. What is on hand now includes them.</p>
        {result.costChanges.length > 0 && (
          <div className="mt-3">
            <p className={LABEL}>Prices that changed</p>
            <ul className="text-sm text-gray-900 dark:text-slate-100 mt-1">{result.costChanges.map((c: any) => <li key={c.stockItemId}>{c.name}: {c.fromCents === null ? 'no price' : money(c.fromCents)} to {money(c.toCents)} a pack</li>)}</ul>
          </div>
        )}
        <button className={`${BTN} ${ON} mt-4`} onClick={onBack}>Done</button>
      </div>
    );
  }
  const closed = scan.status !== 'review';
  const live = draft.lines.filter((l) => !l.skip);
  const readyTotal = live.reduce((n, l) => n + Math.round((Number(l.qty) || 0) * (centsFrom(l.cost) ?? 0)), 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className={`${BTN} ${OFF}`} onClick={onBack}>Back to the invoices</button>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{scan.supplierName || 'Invoice'}{scan.invoiceNumber ? ` · ${scan.invoiceNumber}` : ''}</h2>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {closed && <div className={CARD}><p className="text-sm text-gray-900 dark:text-slate-100">This invoice was received {when(scan.confirmedAt)}. It can no longer be changed.</p></div>}
      {scan.duplicateOf && !closed && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 px-4 py-3 text-sm">
          Invoice {scan.invoiceNumber} from this supplier was already received{scan.duplicateOf.number ? ` as order #${scan.duplicateOf.number}` : ''}. Receive it again only if this is a different delivery.
          <label className="flex items-center gap-2 mt-2"><input type="checkbox" className="w-5 h-5" checked={allowDuplicate} onChange={(e) => setAllowDuplicate(e.target.checked)} />This is a different delivery</label>
        </div>
      )}
      {scan.notes && <div className={CARD}><p className={LABEL}>The reader said</p><p className="text-sm text-gray-900 dark:text-slate-100 mt-1">{scan.notes}</p></div>}
      <div className={`${CARD} grid gap-3 sm:grid-cols-3`}>
        <label className="text-sm text-gray-900 dark:text-slate-100"><span className={`block ${LABEL} mb-1`}>Supplier</span>
          <select className={INPUT} disabled={closed} value={draft.vendorId} onChange={(e) => setDraft({ ...draft, vendorId: e.target.value })}><option value="">None</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="text-sm text-gray-900 dark:text-slate-100"><span className={`block ${LABEL} mb-1`}>Invoice number</span><input className={INPUT} disabled={closed} value={draft.invoiceNumber} onChange={(e) => setDraft({ ...draft, invoiceNumber: e.target.value })} /></label>
        <label className="text-sm text-gray-900 dark:text-slate-100"><span className={`block ${LABEL} mb-1`}>Invoice date</span><input className={INPUT} disabled={closed} placeholder="2026-10-31" value={draft.invoiceDate} onChange={(e) => setDraft({ ...draft, invoiceDate: e.target.value })} /></label>
      </div>
      {scan.hasFile && (
        <div className={CARD}>
          <button className={`${BTN} ${OFF}`} onClick={() => setShowPhoto((v) => !v)}>{showPhoto ? 'Hide the invoice' : 'Show the invoice'}</button>
          {showPhoto && (photo
            ? (photo.pdf ? <object data={photo.url} type="application/pdf" className="w-full h-[28rem] mt-3 rounded-lg border border-gray-200 dark:border-slate-700" aria-label="The invoice">The invoice is a PDF. <a href={photo.url} target="_blank" rel="noreferrer" className="underline">Open it</a>.</object>
              : <img src={photo.url} alt="The scanned invoice" className="mt-3 max-h-[28rem] w-auto rounded-lg border border-gray-200 dark:border-slate-700" />)
            : <p className={`text-sm mt-3 ${MUTED}`}>Opening…</p>)}
        </div>
      )}
      <div className={CARD}>
        <p className={`${LABEL} mb-2`}>Lines</p>
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {scan.lines.map((l) => {
            const d = draft.lines.find((x) => x.n === l.n)!;
            return (
              <li key={l.n} className={`py-3 ${d.skip ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm text-gray-900 dark:text-slate-100 min-w-0"><span className="font-semibold">{l.text}</span>{l.size ? <span className={`ml-2 text-xs ${MUTED}`}>{l.size}</span> : null}{l.added ? <span className={`ml-2 text-xs ${MUTED}`}>added by you</span> : null}</p>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" className="w-5 h-5" disabled={closed} checked={d.skip} onChange={(e) => set(l.n, { skip: e.target.checked })} />Skip this line</label>
                </div>
                {!d.skip && (
                  <div className="grid gap-2 mt-2 sm:grid-cols-[1fr_6rem_8rem]">
                    <label className="text-sm text-gray-900 dark:text-slate-100"><span className="sr-only">Stock item for {l.text}</span>
                      <select className={INPUT} disabled={closed} value={d.stockItemId} onChange={(e) => set(l.n, { stockItemId: e.target.value })}>
                        <option value="">Not matched: choose the item</option>
                        {stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.packName})</option>)}
                      </select></label>
                    <input aria-label={`${l.text} how many came`} className={INPUT} disabled={closed} inputMode="decimal" placeholder="How many" value={d.qty} onChange={(e) => set(l.n, { qty: e.target.value })} />
                    <input aria-label={`${l.text} price of one`} className={INPUT} disabled={closed} inputMode="decimal" placeholder="$ each" value={d.cost} onChange={(e) => set(l.n, { cost: e.target.value })} />
                  </div>
                )}
                {!d.skip && l.stockName && <p className={`text-xs mt-1 ${MUTED}`}>{l.matchedBy === 'saved' ? 'Matched the way you matched it before' : l.matchedBy === 'manual' ? 'Matched by you' : l.sure ? 'Matched by name' : 'A guess'}{l.currentCostCents !== null ? ` · last price ${money(l.currentCostCents)} a ${l.packName}` : ' · no price on file yet'}</p>}
                {!d.skip && l.warnings.map((w) => <p key={w} className="text-xs mt-1 font-semibold text-amber-800 dark:text-amber-200">{w}</p>)}
              </li>
            );
          })}
        </ul>
        {!closed && (
          <div className="flex flex-wrap gap-2 mt-3">
            <input aria-label="A line the reader missed" className={`${INPUT} flex-1 min-w-[12rem]`} placeholder="A line the reader missed (what it is)" value={added} onChange={(e) => setAdded(e.target.value)} />
            <button className={`${BTN} ${OFF} inline-flex items-center gap-2`} disabled={busy || !added.trim()} onClick={addLine}><Plus className="w-4 h-4" />Add the line</button>
          </div>
        )}
      </div>
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-2`}>
        <p className="text-sm text-gray-900 dark:text-slate-100">Lines to receive: <span className="font-mono font-bold">{money(readyTotal)}</span>{scan.totalCents !== null ? <span className={MUTED}> · the invoice says <span className="font-mono">{money(scan.totalCents)}</span>{scan.totalCents !== readyTotal ? ' (tax, delivery or a skipped line may account for the difference)' : ''}</span> : null}</p>
      </div>
      {!closed && step === 'edit' && (
        <div className="flex flex-wrap gap-2">
          <button className={`${BTN} ${ON}`} disabled={busy} onClick={receive}>Receive into stock</button>
          <button className={`${BTN} ${OFF}`} disabled={busy} onClick={save}>Save my changes</button>
          <button className={`${BTN} ${DANGER}`} disabled={busy} onClick={() => setStep('discard')}>Throw it away</button>
        </div>
      )}
      {!closed && step === 'receive' && (
        <div className={CARD} role="alertdialog" aria-label="Receive this invoice">
          <p className="text-sm text-gray-900 dark:text-slate-100 font-semibold">Receive {live.length} {live.length === 1 ? 'line' : 'lines'} ({money(readyTotal)})?</p>
          <p className={`text-sm mt-1 ${MUTED}`}>The counts and the prices of these items change now, the same as marking an order as arrived. This makes one received order and cannot be done twice.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className={`${BTN} ${ON}`} disabled={busy} onClick={confirm}>Yes, receive them</button>
            <button className={`${BTN} ${OFF}`} disabled={busy} onClick={() => setStep('edit')}>Go back</button>
          </div>
        </div>
      )}
      {!closed && step === 'discard' && (
        <div className={CARD} role="alertdialog" aria-label="Throw this invoice away">
          <p className="text-sm text-gray-900 dark:text-slate-100 font-semibold">Throw this scan away?</p>
          <p className={`text-sm mt-1 ${MUTED}`}>Nothing was received from it, so no count or price changes. The photo is deleted.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button className={`${BTN} ${DANGER}`} disabled={busy} onClick={discard}>Throw it away</button>
            <button className={`${BTN} ${OFF}`} disabled={busy} onClick={() => setStep('edit')}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}
