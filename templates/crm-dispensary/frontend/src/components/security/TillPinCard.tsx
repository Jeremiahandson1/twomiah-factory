/**
 * The till PIN: four to eight digits that sign you in at the counter without a password.
 *
 * MOVED OUT OF SettingsPage. (T41) It was defined inside the company Settings page, which is
 * admin-only — so the budtender it exists for could never reach it. It now lives here and is
 * rendered by MyAccountPage, which has no role gate, because a PIN belongs to a person rather than
 * to the shop. One component, one definition, so the two cannot drift.
 *
 * WHY THE STATE COMES FROM `pinSet` AND NOT FROM THE PIN. Nothing can read a PIN back — it is
 * bcrypt-hashed like a password — so GET /api/auth/me grew a `pinSet` boolean. Without it a screen
 * cannot tell "set a PIN" from "change your PIN".
 *
 * TWO REFUSALS THE SERVER MAKES THAT THIS SCREEN HAS TO SHOW PROPERLY:
 *   · 409 pin_in_use — somebody else in the shop already uses those digits. A PIN has to point at
 *     one person or the till cannot say who rang a sale. The message is the server's own; it
 *     explains the till, so it is shown rather than replaced.
 *   · a PIN is NOT a password — four digits on a shared screen. The copy says so, because somebody
 *     choosing one should know what it is for and what it is not.
 */
import { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import api from '../../services/api';
import { Button } from '../ui/DataTable';

export function TillPinCard({ user, toast }: { user: any; toast: any }) {
  const [pinSet, setPinSet] = useState<boolean>(!!user?.pinSet);
  const [editing, setEditing] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // `user` is refreshed by the auth context after a sign-in, so follow it rather than snapshotting
  // once — otherwise this card still says "not set" after the page has learned otherwise.
  useEffect(() => { setPinSet(!!user?.pinSet); }, [user?.pinSet]);

  const digits = (s: string) => s.replace(/\D/g, '').slice(0, 8);
  const reset = () => { setEditing(false); setPin(''); setConfirm(''); setErr(''); };

  const save = async () => {
    setErr('');
    // Digits only, 4–8. The server's schema is `string().min(4).max(8)` and T41 found it accepts
    // 'abcd'; the API is being tightened to match, and this keeps the screen from offering
    // something the server is about to refuse.
    if (!/^\d{4,8}$/.test(pin)) { setErr('A PIN is four to eight digits.'); return; }
    if (pin !== confirm) { setErr('Those two PINs are not the same.'); return; }
    setBusy(true);
    try {
      await api.pin.set(pin);
      setPinSet(true);
      reset();
      toast.success('Your till PIN is set.');
    } catch (e: any) {
      // The server's wording for a clash explains the till; keep it.
      setErr(e?.message || 'That PIN could not be saved.');
    } finally { setBusy(false); }
  };

  const clear = async () => {
    setBusy(true); setErr('');
    try {
      await api.pin.clear();
      setPinSet(false);
      reset();
      toast.success('Quick sign-in is off for your account.');
    } catch (e: any) {
      setErr(e?.message || 'That PIN could not be removed.');
    } finally { setBusy(false); }
  };

  const inputCls = 'w-full border rounded-lg px-3 py-2 tracking-[0.4em] text-center text-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100';

  return (
    <div className="bg-white rounded-lg border p-6 dark:bg-slate-900 dark:border-slate-700">
      <h2 className="text-lg font-semibold mb-1 flex items-center gap-2 text-gray-900 dark:text-slate-100">
        <KeyRound className="w-4 h-4 text-emerald-600" />Till PIN
      </h2>
      <p className="text-sm text-gray-600 mb-4 dark:text-slate-400">
        Four to eight digits to sign in at the counter without typing your password. It is for getting
        back to the till between customers — not a replacement for your password, and anyone watching
        the screen can see it.
      </p>

      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-500 dark:text-slate-400">Status</span>
        <span className={`text-sm font-medium ${pinSet ? 'text-green-600' : 'text-gray-500 dark:text-slate-400'}`}>
          {pinSet ? 'Set' : 'Not set'}
        </span>
      </div>

      {err && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800">{err}</p>
      )}

      {!editing ? (
        <div className="flex gap-2">
          <Button onClick={() => setEditing(true)}>{pinSet ? 'Change PIN' : 'Set a PIN'}</Button>
          {pinSet && (
            <button type="button" onClick={clear} disabled={busy}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-slate-700 dark:hover:bg-slate-800">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Turn quick sign-in off'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <label htmlFor="till-pin-new" className="block text-sm text-gray-500 mb-1 dark:text-slate-400">New PIN</label>
            <input id="till-pin-new" type="password" inputMode="numeric" autoComplete="new-password" value={pin}
              onChange={(e) => setPin(digits(e.target.value))} className={inputCls} placeholder="••••" />
          </div>
          <div>
            <label htmlFor="till-pin-confirm" className="block text-sm text-gray-500 mb-1 dark:text-slate-400">Confirm PIN</label>
            <input id="till-pin-confirm" type="password" inputMode="numeric" autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(digits(e.target.value))} className={inputCls} placeholder="••••" />
          </div>
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save PIN'}</Button>
            <button type="button" onClick={reset} disabled={busy}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
