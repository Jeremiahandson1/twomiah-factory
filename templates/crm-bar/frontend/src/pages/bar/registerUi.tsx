import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';
import FormError, { errorText } from '../../components/ui/FormError';

/**
 * What the register, the grill screen and the close-out share: the look (Tonight's — big targets, pressed with a
 * wet thumb in a dim bar), money printed with cents, one dialog, live refresh, and the manager's till PIN.
 *
 * Live refresh: the server tells the company's screens on every change (socket 'bar:register' / 'bar:kitchen',
 * routes/barRegister.ts) AND every screen re-reads on a timer, so a dropped socket costs seconds, never a ticket.
 */

export const BTN = 'min-h-[48px] px-4 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50';
export const ON = 'bg-orange-600 text-white border-orange-600 dark:bg-orange-600 dark:text-white dark:border-orange-500';
export const OFF = 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';
export const DANGER = 'bg-white text-red-700 border-red-300 hover:bg-red-50 dark:bg-slate-900 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-950/40';
export const CARD = 'bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-4';
export const LABEL = 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400';
export const INPUT = 'w-full min-h-[48px] px-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
export const MUTED = 'text-gray-600 dark:text-slate-300';

/** "$12.50", "−$3.00" — the same rule as the server's formatMoney (services/barCheckMoney.ts). */
export function money(cents: number | null | undefined): string {
  const c = Number(cents) || 0;
  const v = Math.abs(c);
  return (c < 0 ? '−' : '') + '$' + Math.floor(v / 100).toLocaleString('en-US') + '.' + String(v % 100).padStart(2, '0');
}

/** A typed dollar amount ("12", "12.5", "$12.50") as cents, or null when it is not one. */
export function centsFrom(typed: string): number | null {
  const s = String(typed || '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 100) : null;
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
      <div className="fixed inset-0 bg-black/60" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-md'} bg-white text-gray-900 dark:bg-slate-900 dark:text-slate-100 border border-gray-200 dark:border-slate-700 rounded-2xl shadow-2xl`}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-slate-700">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="p-2 rounded-lg text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-white" aria-label="Close"><X className="w-5 h-5" /></button>
          </div>
          <div className="px-5 py-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Re-read on the server's word and on a timer. */
export function useLive(event: 'bar:register' | 'bar:kitchen', reload: () => void, everyMs = 15000) {
  const { subscribe } = useSocket();
  const ref = useRef(reload);
  ref.current = reload;
  useEffect(() => subscribe(event, () => ref.current()), [subscribe, event]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') ref.current(); }, everyMs);
    const onShow = () => { if (document.visibilityState === 'visible') ref.current(); };
    document.addEventListener('visibilitychange', onShow);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow); };
  }, [everyMs]);
}

/**
 * A manager-only action (a void of something sent, a payment void, closing the night). The server answers 403
 * with needsManager when the person signed in may not do it; this asks for a manager's till PIN on the spot and
 * sends the same request again with it. Nothing here decides who may — the server does.
 */
export function useManagerPin() {
  const [ask, setAsk] = useState<{ message: string; run: (pin: string) => Promise<void> } | null>(null);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  /** Run `send(pin?)`; on needsManager, open the PIN dialog and run it again with what the manager types. */
  const guarded = useCallback(async (send: (managerPin?: string) => Promise<void>) => {
    try {
      await send();
    } catch (e: any) {
      if (e?.status === 403 && e?.data?.needsManager) {
        setPin(''); setErr('');
        setAsk({ message: e.data.error || 'A manager needs to OK that.', run: (p) => send(p) });
        return;
      }
      throw e;
    }
  }, []);

  const dialog = ask ? (
    <Dialog title="Manager's OK" onClose={() => setAsk(null)}>
      <form onSubmit={async (ev) => {
        ev.preventDefault(); setBusy(true); setErr('');
        try { await ask.run(pin); setAsk(null); } catch (e: any) { setErr(errorText(e, 'That did not save. Try again.')); } finally { setBusy(false); }
      }}>
        <p className={`text-sm mb-3 ${MUTED}`}>{ask.message}</p>
        <label className={LABEL} htmlFor="manager-pin">Manager's till PIN</label>
        <input id="manager-pin" className={`${INPUT} mt-1 text-2xl tracking-[0.4em]`} type="password" inputMode="numeric" autoComplete="off" autoFocus
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        <FormError message={err} className="mt-3" />
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={`${BTN} ${OFF}`} onClick={() => setAsk(null)}>Cancel</button>
          <button type="submit" className={`${BTN} ${ON}`} disabled={busy || pin.length < 4}>OK it</button>
        </div>
      </form>
    </Dialog>
  ) : null;

  return { guarded, dialog };
}

/** Set or change my own till PIN (what I type to OK someone else's void, if I am a manager). */
export function TillPinDialog({ hasPin, onClose, onSaved, save, clear }: { hasPin: boolean; onClose: () => void; onSaved: () => void; save: (pin: string) => Promise<void>; clear: () => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="My till PIN" onClose={onClose}>
      <form onSubmit={async (ev) => {
        ev.preventDefault(); setBusy(true); setErr('');
        try { await save(pin); onSaved(); } catch (e) { setErr(errorText(e, 'That did not save. Try again.')); } finally { setBusy(false); }
      }}>
        <p className={`text-sm mb-3 ${MUTED}`}>
          A manager types it on a bartender's register to OK a void or the close-out. It is never a sign-in by itself. 4 to 8 digits, and nobody else here may use the same one.
        </p>
        <label className={LABEL} htmlFor="own-pin">{hasPin ? 'New PIN' : 'PIN'}</label>
        <input id="own-pin" className={`${INPUT} mt-1 text-2xl tracking-[0.4em]`} type="password" inputMode="numeric" autoComplete="new-password" autoFocus
          value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        <FormError message={err} className="mt-3" />
        <div className="flex flex-wrap justify-end gap-2 mt-4">
          {hasPin && (
            <button type="button" className={`${BTN} ${DANGER}`} disabled={busy}
              onClick={async () => { setBusy(true); setErr(''); try { await clear(); onSaved(); } catch (e) { setErr(errorText(e, 'That did not save. Try again.')); } finally { setBusy(false); } }}>
              Remove my PIN
            </button>
          )}
          <button type="button" className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button type="submit" className={`${BTN} ${ON}`} disabled={busy || pin.length < 4}>Save</button>
        </div>
      </form>
    </Dialog>
  );
}
