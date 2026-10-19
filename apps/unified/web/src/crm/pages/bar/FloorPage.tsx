// Moved from templates/crm-bar/frontend/src/pages/bar/FloorPage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money, Dialog, useLive } from './registerUi';

/**
 * THE FLOOR — the room on a phone: every booth, table and bar seat, what is open on it, and when its food is up.
 * Tap a table to open its check on the register (or start one). Ordering by seat, holding the mains and firing
 * them later, and splitting by seat all happen on that check (routes/barRegister.ts). The room itself is set here
 * by a manager (bar:update) and kept on bar_settings.floor (services/barFloor.ts).
 */

interface OpenRow { id: string; number: number; label: string; spot: string | null; balanceCents: number; heldCount: number; foodUpAt: string | null; onGrill: number }
interface Table { id: string; name: string; kind: 'booth' | 'table' | 'bar'; seats: number; checks: OpenRow[] }

const GROUPS: Array<{ kind: Table['kind']; label: string }> = [{ kind: 'booth', label: 'Booths' }, { kind: 'table', label: 'Tables' }, { kind: 'bar', label: 'The bar' }];

export default function FloorPage() {
  const mayEdit = useMayWrite('bar:update');
  const navigate = useNavigate();
  const [tables, setTables] = useState<Table[] | null>(null);
  const [err, setErr] = useState('');
  const [pick, setPick] = useState<Table | null>(null);
  const [editing, setEditing] = useState(false);
  const [starter, setStarter] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get('/api/register/floor'); setTables(r.tables); setStarter(!!r.starter); setErr(''); } catch (e) { setErr(errorText(e, 'Could not load the floor.')); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLive('bar:register', load);

  const open = async (t: Table) => {
    if (t.checks.length === 1) { navigate(`/crm/register?check=${t.checks[0].id}`); return; }
    if (t.checks.length > 1) { setPick(t); return; }
    try {
      const r = await api.post('/api/register/check', { kind: t.kind === 'bar' ? 'tab' : 'table', spot: t.name, label: t.name });
      navigate(`/crm/register?check=${r.check.id}`);
    } catch (e) { setErr(errorText(e, 'Could not open a check there.')); }
  };

  if (!tables) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Floor</h1>
        <div className="flex gap-2">
          <Link to="/crm/register" className={`${BTN} ${OFF} inline-flex items-center`}>Register</Link>
          {mayEdit && <button className={`${BTN} ${OFF}`} onClick={() => setEditing(true)}>Edit the room</button>}
        </div>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {/* The starting layout until the bar saves its own (Bar Run 1: a new bar found 5 booths, 5 tables and 10 seats
          it never set up, with nothing saying they were a sample). */}
      {starter && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 p-4 text-sm">
          <p className="font-semibold">This is a starting layout, not your room yet.</p>
          <p className="mt-1">{mayEdit ? 'Use "Edit the room" to name your booths, tables and bar seats the way your staff say them. Checks opened on the register show on the table with the same name.' : 'A manager can set it up to match your room under "Edit the room".'}</p>
        </div>
      )}
      {GROUPS.map((g) => {
        const these = tables.filter((t) => t.kind === g.kind);
        if (!these.length) return null;
        return (
          <section key={g.kind} aria-label={g.label}>
            <p className={`${LABEL} mb-2`}>{g.label}</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
              {these.map((t) => {
                const busy = t.checks.length > 0;
                const up = t.checks.some((c) => c.foodUpAt);
                const owed = t.checks.reduce((s, c) => s + c.balanceCents, 0);
                return (
                  <button key={t.id} onClick={() => open(t)}
                    className={`rounded-2xl border-2 min-h-[88px] p-3 text-left ${up ? 'border-green-600 bg-green-50 text-gray-900 dark:border-green-400 dark:bg-green-950/40 dark:text-slate-100' : busy ? 'border-orange-500 bg-orange-50 text-gray-900 dark:border-orange-400 dark:bg-orange-950/40 dark:text-slate-100' : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'}`}>
                    <span className="block font-bold">{t.name}</span>
                    <span className={`block text-xs ${MUTED}`}>{t.seats} seat{t.seats === 1 ? '' : 's'}</span>
                    {busy
                      ? <span className="block text-sm mt-1 font-semibold">{up ? "Food's up · " : t.checks.some((c) => c.onGrill) ? 'On the grill · ' : ''}{money(owed)}{t.checks.length > 1 ? ` · ${t.checks.length} checks` : ''}</span>
                      : <span className={`block text-sm mt-1 ${MUTED}`}>Open</span>}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {pick && (
        <Dialog title={pick.name} onClose={() => setPick(null)}>
          <ul className="space-y-2">
            {pick.checks.map((c) => (
              <li key={c.id}><button className={`${BTN} ${OFF} w-full justify-between flex items-center`} onClick={() => navigate(`/crm/register?check=${c.id}`)}><span>#{c.number} {c.label}</span><span className="font-mono">{money(c.balanceCents)}</span></button></li>
            ))}
          </ul>
        </Dialog>
      )}
      {editing && <RoomDialog tables={tables} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}

function RoomDialog({ tables, onClose, onSaved }: { tables: Table[]; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(tables.map((t) => ({ id: t.id, name: t.name, kind: t.kind, seats: String(t.seats) })));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <Dialog title="The room" onClose={onClose} wide>
      <p className={`text-sm mb-3 ${MUTED}`}>Each table's name is what a check is opened on, so keep them the names your staff say out loud.</p>
      <ul className="space-y-2 max-h-[55vh] overflow-y-auto">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[1fr_120px_80px_auto] gap-2 items-center">
            <label className="sr-only" htmlFor={`rm-name-${i}`}>Name</label>
            <input id={`rm-name-${i}`} className={INPUT} value={r.name} onChange={(e) => set(i, { name: e.target.value })} maxLength={30} />
            <label className="sr-only" htmlFor={`rm-kind-${i}`}>Kind</label>
            <select id={`rm-kind-${i}`} className={INPUT} value={r.kind} onChange={(e) => set(i, { kind: e.target.value as Table['kind'] })}><option value="booth">Booth</option><option value="table">Table</option><option value="bar">Bar seat</option></select>
            <label className="sr-only" htmlFor={`rm-seats-${i}`}>Seats</label>
            <input id={`rm-seats-${i}`} className={INPUT} inputMode="numeric" value={r.seats} onChange={(e) => set(i, { seats: e.target.value.replace(/\D/g, '') })} />
            <button className={`${BTN} ${DANGER} px-3`} aria-label={`Remove ${r.name}`} onClick={() => setRows((x) => x.filter((_, n) => n !== i))}><Trash2 className="w-4 h-4" /></button>
          </li>
        ))}
      </ul>
      <button className={`${BTN} ${OFF} inline-flex items-center gap-2 mt-3`} onClick={() => setRows((r) => [...r, { id: '', name: '', kind: 'table', seats: '4' }])}><Plus className="w-4 h-4" />Add</button>
      <FormError message={err} className="mt-3" />
      <div className="flex justify-end gap-2 mt-4">
        <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
        <button className={`${BTN} ${ON}`} disabled={busy} onClick={async () => {
          setBusy(true); setErr('');
          try { await api.put('/api/register/floor', { tables: rows.map((r) => ({ id: r.id || undefined, name: r.name, kind: r.kind, seats: Number(r.seats) || 1 })) }); onSaved(); }
          catch (e) { setErr(errorText(e, 'The room did not save.')); } finally { setBusy(false); }
        }}>Save the room</button>
      </div>
    </Dialog>
  );
}
