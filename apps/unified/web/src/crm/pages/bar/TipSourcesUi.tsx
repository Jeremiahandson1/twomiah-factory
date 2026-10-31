import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../../api';
import { useConfirm, useMayWrite } from '../../../shared';
import FormError, { errorText } from '../../ui/FormError';
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED } from './registerUi';

/**
 * Tips from another register (feature bar_tip_import; server crm/bar/barTipSources.ts, barTipSourceRoutes.ts). A venue whose
 * register is Toast or Square connects that account here; the tips it took join the same tip pool and tip-out. Square is
 * allowed on Square's own page; Toast is connected with read-only credentials the venue makes in Toast Web. The secret is
 * sent once and never shown again. A manager's (bar:manage).
 */
interface Source { id: string; provider: 'toast' | 'square'; providerName: string; label: string | null; status: string; lastError: string | null; lastImportAt: string | null; connectedByName: string | null; locationId: string | null; restaurantGuid: string | null }
interface StaffRow { externalStaffId: string; name: string; email: string | null; userId: string | null; matchedBy: string | null }
interface StaffSource extends Source { staff: StaffRow[] }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'not yet');

export default function TipSourcesView() {
  const may = useMayWrite('bar:manage');
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ sources: Source[]; available: { square: boolean; toast: boolean }; squareRedirectUri: string } | null>(null);
  const [staff, setStaff] = useState<{ sources: StaffSource[]; people: Array<{ id: string; name: string }> } | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(params.get('register') === 'square-connected' ? 'Square is connected.' : '');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState({ host: '', clientId: '', clientSecret: '', restaurantGuid: '', label: '' });
  const [loc, setLoc] = useState('');
  const failed = params.get('register') === 'square-failed' ? params.get('why') || 'Square did not finish connecting.' : '';
  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([api.get('/api/tip-sources'), api.get('/api/tip-sources/staff')]);
      setData(a); setStaff(b); setErr('');
      setLoc(a.sources.find((s: Source) => s.provider === 'square')?.locationId ?? '');
    } catch (e) { setErr(errorText(e, 'Could not read the connections.')); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (params.get('register')) setParams((p) => { p.delete('register'); p.delete('why'); return p; }, { replace: true }); }, [params, setParams]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); setMsg(ok); await load(); } catch (e) { setErr(errorText(e, 'That did not work.')); } finally { setBusy(false); }
  };
  if (!data) return err ? <FormError message={err} /> : <p className={MUTED}>Loading…</p>;
  const sq = data.sources.find((s) => s.provider === 'square');
  const ts = data.sources.find((s) => s.provider === 'toast');
  const connectSquare = () => act(async () => { const r = await api.get('/api/tip-sources/square/auth-url'); window.location.assign(r.url); }, '');
  const connectToast = () => act(async () => { await api.post('/api/tip-sources/toast', toast); setToast({ host: '', clientId: '', clientSecret: '', restaurantGuid: '', label: '' }); }, 'Toast is connected.');
  const disconnect = async (s: Source) => {
    if (!(await confirm(`Tips already counted on nights you have closed stay as they are. Open nights lose the tips ${s.providerName} brought in until you connect it again. Also remove the connection inside ${s.providerName} so it cannot be used.`, { title: `Disconnect ${s.providerName}?`, confirmText: 'Disconnect' }))) return;
    await act(() => api.delete(`/api/tip-sources/${s.provider}`), `${s.providerName} is disconnected.`);
  };
  const Status = ({ s }: { s: Source }) => (
    <div className="mt-2 text-sm text-gray-900 dark:text-slate-100">
      <p>{s.status === 'connected' ? 'Connected' : 'Needs your attention'}{s.label ? ` · ${s.label}` : ''}{s.connectedByName ? ` · by ${s.connectedByName}` : ''}</p>
      <p className={MUTED}>Last read: {when(s.lastImportAt)}</p>
      {s.lastError && <p role="alert" className="text-red-700 dark:text-red-300">{s.lastError}</p>}
    </div>
  );
  return (
    <div className="space-y-4">
      <p className={`text-sm ${MUTED}`}>If your register is Toast or Square, connect it and the tips it took go into the same tip pool and tip-out as tips rung here. Each night is read when you look at it, when you close it, and once an hour.</p>
      {failed && <FormError message={failed} />}
      {msg && <p role="status" className="text-sm text-green-800 dark:text-green-300">{msg}</p>}
      <FormError message={err} />

      <div className={CARD}>
        <p className={LABEL}>Square</p>
        {sq ? (
          <>
            <Status s={sq} />
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div><label className={LABEL} htmlFor="sq-loc">Location ID (leave blank for your main location)</label><input id="sq-loc" className={`${INPUT} max-w-[18rem]`} value={loc} onChange={(e) => setLoc(e.target.value)} disabled={!may} /></div>
              <button className={`${BTN} ${OFF}`} disabled={!may || busy} onClick={() => act(() => api.put('/api/tip-sources/square/location', { locationId: loc }), 'Location saved.')}>Save location</button>
              {sq.status !== 'connected' && <button className={`${BTN} ${ON}`} disabled={!may || busy} onClick={connectSquare}>Connect again</button>}
              <button className={`${BTN} ${DANGER}`} disabled={!may || busy} onClick={() => disconnect(sq)}>Disconnect</button>
            </div>
          </>
        ) : data.available.square ? (
          <div className="mt-2">
            <p className={`text-sm ${MUTED}`}>You will sign in on Square’s own page and allow us to read payments and team members. We cannot change anything in your Square account.</p>
            <button className={`${BTN} ${ON} mt-2`} disabled={!may || busy} onClick={connectSquare}>Connect Square</button>
          </div>
        ) : <p className={`mt-2 text-sm ${MUTED}`}>Square isn’t switched on for your account yet. Email support@twomiah.com and we will turn it on.</p>}
      </div>

      <div className={CARD}>
        <p className={LABEL}>Toast</p>
        {ts ? (
          <>
            <Status s={ts} />
            <div className="mt-3 flex gap-2">
              <button className={`${BTN} ${DANGER}`} disabled={!may || busy} onClick={() => disconnect(ts)}>Disconnect</button>
            </div>
          </>
        ) : null}
        <div className="mt-2">
          <p className={`text-sm ${MUTED}`}>{ts ? 'To change the keys, type them again below.' : 'In Toast Web, open Integrations, then Toast API access, then Manage credentials, and create new credentials of the Standard API kind (read-only; allow orders and employees). Toast sends you the restaurant ID by email. Type them here. The secret is kept scrambled and is never shown again.'}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {([['host', 'Toast API address (ends in toasttab.com)', 'text'], ['restaurantGuid', 'Restaurant ID', 'text'], ['clientId', 'Client ID', 'text'], ['clientSecret', 'Client secret', 'password'], ['label', 'What you call it (optional)', 'text']] as const).map(([k, l, type]) => (
              <div key={k}><label className={LABEL} htmlFor={`toast-${k}`}>{l}</label><input id={`toast-${k}`} type={type} autoComplete="off" className={INPUT} value={toast[k]} onChange={(e) => setToast({ ...toast, [k]: e.target.value })} disabled={!may} /></div>
            ))}
          </div>
          <button className={`${BTN} ${ON} mt-2`} disabled={!may || busy || !toast.host || !toast.clientId || !toast.clientSecret || !toast.restaurantGuid} onClick={connectToast}>{busy ? 'Checking…' : ts ? 'Save new keys' : 'Connect Toast'}</button>
        </div>
      </div>

      {staff && staff.sources.length > 0 && (
        <div className={CARD}>
          <p className={LABEL}>Who is who</p>
          <p className={`mt-1 text-sm ${MUTED}`}>Tips are shared only with staff matched to one of your people. We match by email; pick anyone left over. Tips from staff nobody matched are shown on the night and not shared.</p>
          {staff.sources.map((s) => (
            <div key={s.id} className="mt-3">
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">{s.providerName}</p>
              {s.staff.length === 0 && <p className={`text-sm ${MUTED}`}>No staff read yet.</p>}
              <ul className="mt-1 divide-y divide-gray-100 dark:divide-slate-800">
                {s.staff.map((m) => (
                  <li key={m.externalStaffId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-sm text-gray-900 dark:text-slate-100">{m.name}{m.email ? <span className={`block text-xs ${MUTED}`}>{m.email}</span> : null}</span>
                    <span className="flex items-center gap-2">
                      {m.matchedBy && <span className={`text-xs ${MUTED}`}>{m.matchedBy === 'email' ? 'Matched by email' : 'Matched by hand'}</span>}
                      <select aria-label={`Match ${m.name}`} className={INPUT} value={m.userId ?? ''} disabled={!may || busy}
                        onChange={(e) => act(() => api.put('/api/tip-sources/staff', { sourceId: s.id, externalStaffId: m.externalStaffId, userId: e.target.value || null }), 'Saved.')}>
                        <option value="">Not matched</option>
                        {staff.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {may && data.available.square && <p className={`text-xs ${MUTED}`}>For Twomiah’s Square app, this address is the one registered with Square: {data.squareRedirectUri}</p>}
    </div>
  );
}
