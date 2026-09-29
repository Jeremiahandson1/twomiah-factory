import { useState, useEffect, useCallback } from 'react';
import { Gift, Loader2, Plus, Edit2, Trash2, Stamp, Coins, Settings2, X, Minus } from 'lucide-react';
import api from '../../services/api';
import { money as fmtMoney } from '../../shared';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../shared';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Loyalty — who is on the programme, what they can spend it on, and how the programme is set up.
 *
 * Two ways to earn, and a salon usually runs both:
 *   points      on what a client spends, redeemed for money off or a named free service
 *   punch card  on how often they come — "6 cuts, 7th free"
 *
 * Both are read straight off the server; the arithmetic lives in the shared engine
 * (packages/tenant-backend/src/loyalty) so it cannot drift from what the till actually does.
 *
 * Run LY0928 B3 found this page half-built: two read-only tabs, and the endpoints that actually RUN a
 * programme reachable only over the API. There was no settings panel, so the punch card sat at 0
 * visits — off — forever and the setup step in the QA brief could not be done at all; no way to
 * redeem, so points accumulated with nothing to spend them on; and no way to correct a balance or
 * see where one came from. A refusal even pointed at a Settings screen that did not exist. All three
 * are here now, and each is gated on the permission the server itself checks, so a button is never
 * offered to someone the API will refuse.
 */

interface Member {
  id: string;
  contactId?: string;
  clientName?: string;
  clientPhone?: string;
  pointsBalance?: number;
  lifetimePoints?: number;
  qualifyingVisits?: number;
  punchCard?: { enabled: boolean; visitsRequired: number; progress: number; remaining: number; unclaimed: number };
}

interface Reward {
  id: string;
  name: string;
  description?: string;
  pointsCost: number;
  type: 'fixed' | 'percent' | 'free_item';
  value: number;
  serviceId?: string | null;
  active: boolean;
}

interface LedgerRow {
  id: string;
  type: string;
  points: number;
  balanceAfter?: number | null;
  description?: string | null;
  createdAt: string;
}

interface VisitRow {
  appointmentId: string;
  startTime: string;
  serviceName?: string | null;
  invoiceId: string;
  invoiceNumber: string;
  remaining: number;
  rewardUsed: boolean;
  /**
   * The client has already paid this one. A reward applied after the money is in drops the total
   * below what they handed over, so the server refuses it — and a refusal the screen could have
   * predicted belongs on the screen, not at the end of a click. (LYR N2)
   */
  settled?: boolean;
}

const emptyReward = { name: '', description: '', pointsCost: 0, type: 'fixed' as const, value: 0, serviceId: '', active: true };

/** What the ledger calls each kind of movement, in words a salon uses. */
const LEDGER_LABEL: Record<string, string> = {
  earn: 'Visit',
  redeem: 'Reward redeemed',
  punch_reward: 'Punch card',
  bonus: 'Bonus',
  adjustment_add: 'Correction',
  adjustment_subtract: 'Correction',
  reversal: 'Visit cancelled',
};

/** The card, drawn as the stamps a client would recognise rather than a number. */
function PunchCard({ card }: { card: Member['punchCard'] }) {
  // gray-500/slate-400, not gray-400/slate-500: the lighter pair reads 2.54:1 on white and the
  // guard fails the build for it, because "muted" still has to be legible.
  if (!card?.enabled) return <span className="text-gray-500 dark:text-slate-400">—</span>;
  const filled = card.unclaimed > 0 ? card.visitsRequired : card.progress;
  return (
    <div className="flex items-center gap-1" title={`${card.progress} of ${card.visitsRequired} visits`}>
      {Array.from({ length: card.visitsRequired }).map((_, i) => (
        <span
          key={i}
          className={`inline-block w-2.5 h-2.5 rounded-full ${i < filled ? 'bg-pink-500' : 'bg-gray-200 dark:bg-slate-700'}`}
        />
      ))}
      {card.unclaimed > 0 && (
        <span className="ml-2 text-xs font-medium text-pink-700 dark:text-pink-300">Free one ready</span>
      )}
    </div>
  );
}

const fieldClass =
  'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';
const labelClass = 'block text-sm text-gray-600 dark:text-slate-400';

export default function LoyaltyPage() {
  const toast = useToast();
  const confirm = useConfirm();
  // `can` asks the server's own permission list, so every control below appears exactly when the
  // endpoint behind it would answer. `isAdmin` would have been close, and close is how a Front Desk
  // gets a button that 403s. (LY0928 H3/M4)
  const { can } = useAuth();
  const mayConfigure = can('loyalty:configure');
  const mayAdjust = can('loyalty:adjust');
  const mayRedeem = can('loyalty:redeem');

  const [tab, setTab] = useState<'members' | 'rewards' | 'settings'>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Reward | null>(null);
  const [form, setForm] = useState<any>(emptyReward);
  const [saving, setSaving] = useState(false);

  const [open, setOpen] = useState<Member | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, r, cfg, svc] = await Promise.all([
        api.get('/api/loyalty/members', search ? { search } : {}),
        api.get('/api/loyalty/rewards'),
        api.get('/api/loyalty/config'),
        api.get('/api/service-menu').catch(() => ({ data: [] })),
      ]);
      setMembers(m?.data || []);
      setRewards(r?.data || []);
      setConfig(cfg || null);
      setServices(Array.isArray(svc) ? svc : svc?.data || []);
    } catch (err: any) {
      toast.error(err?.message || 'Could not load the loyalty programme');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const saveReward = async () => {
    if (!form.name.trim()) { toast.error('Give the reward a name clients will recognise'); return; }
    if (form.type === 'free_item' && !form.serviceId) { toast.error('Choose which service this reward pays for'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description?.trim() || undefined,
        pointsCost: Number(form.pointsCost) || 0,
        type: form.type,
        value: Number(form.value) || 0,
        serviceId: form.type === 'free_item' ? form.serviceId : null,
        active: !!form.active,
      };
      if (editing) await api.put(`/api/loyalty/rewards/${editing.id}`, payload);
      else await api.post('/api/loyalty/rewards', payload);
      toast.success(editing ? 'Reward updated' : 'Reward added');
      setEditing(null); setForm(emptyReward);
      load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the reward');
    } finally {
      setSaving(false);
    }
  };

  const removeReward = async (r: Reward) => {
    // confirm() takes the message first and its options second — it is shaped like window.confirm.
    // Passing one object made `message` an object, which React refuses to render, so Delete on a
    // reward threw instead of asking. Found by the salon frontend's own typechecker, which nothing
    // in CI runs. (LYR, unreported)
    if (!(await confirm('Clients will no longer be able to redeem it.', { title: `Delete "${r.name}"?` }))) return;
    try { await api.delete(`/api/loyalty/rewards/${r.id}`); toast.success('Reward deleted'); load(); }
    catch (err: any) { toast.error(err?.message || 'Could not delete the reward'); }
  };

  const describeReward = (r: Reward) =>
    r.type === 'percent' ? `${r.value}% off`
      : r.type === 'free_item' ? (services.find((s) => s.id === r.serviceId)?.name || 'Free service')
        : `${fmtMoney(r.value)} off`;

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-pink-500" /></div>;
  }

  const tabs: [typeof tab, string, any][] = [
    ['members', 'Members', Coins],
    ['rewards', 'Rewards', Stamp],
    ...(mayConfigure ? ([['settings', 'Settings', Settings2]] as [typeof tab, string, any][]) : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
            <Gift className="w-6 h-6 text-pink-500" />
            Loyalty
          </h1>
          <p className="text-gray-600 dark:text-slate-400">
            {config?.loyaltyEnabled === false
              ? 'The programme is switched off — clients are not earning.'
              : <>Clients earn {config?.loyaltyPointsPerDollar ?? 1} point per {fmtMoney(1)} spent
                {config?.loyaltyPunchCard?.visitsRequired > 0
                  ? `, and every ${config.loyaltyPunchCard.visitsRequired} visits earns ${config.loyaltyPunchCard.rewardName || 'a free service'}.`
                  : '.'}</>}
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === id
                ? 'border-pink-500 text-pink-700 dark:text-pink-300'
                : 'border-transparent text-gray-500 dark:text-slate-300 hover:text-gray-700 dark:hover:text-slate-200'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'members' && (
        <div className="space-y-4">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="w-full max-w-sm px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />

          {members.length === 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-8 text-center">
              <p className="text-gray-600 dark:text-slate-400">
                Nobody is on the programme yet. Clients join automatically the first time a visit is completed.
              </p>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    {['Client', 'Points', 'Earned to date', 'Punch card', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-slate-100">{m.clientName}</div>
                        {m.clientPhone && <div className="text-sm text-gray-500 dark:text-slate-400">{m.clientPhone}</div>}
                      </td>
                      <td className="px-4 py-3 tabular-nums font-medium text-gray-900 dark:text-slate-100">{m.pointsBalance ?? 0}</td>
                      <td className="px-4 py-3 tabular-nums text-gray-600 dark:text-slate-400">{m.lifetimePoints ?? 0}</td>
                      <td className="px-4 py-3"><PunchCard card={m.punchCard} /></td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => setOpen(m)}
                          className="px-3 py-1.5 text-sm font-medium text-pink-700 dark:text-pink-300 hover:underline"
                        >
                          {mayRedeem ? 'Open' : 'History'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'rewards' && (
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 overflow-x-auto">
            {rewards.length === 0 ? (
              <p className="p-8 text-center text-gray-600 dark:text-slate-400">
                No rewards yet. Add one so clients have something to spend their points on.
              </p>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-slate-800">
                  <tr>
                    {['Reward', 'Costs', 'Gives', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-400 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {rewards.map((r) => (
                    <tr key={r.id} className={r.active ? '' : 'opacity-60'}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 dark:text-slate-100">{r.name}</div>
                        {r.description && <div className="text-sm text-gray-500 dark:text-slate-400">{r.description}</div>}
                        {!r.active && <div className="text-xs text-gray-500 dark:text-slate-400">Not currently available</div>}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-900 dark:text-slate-100">
                        {r.pointsCost > 0 ? `${r.pointsCost} pts` : <span className="text-pink-700 dark:text-pink-300">A full card</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{describeReward(r)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {mayConfigure && (
                          <>
                            <button
                              onClick={() => { setEditing(r); setForm({ ...r, serviceId: r.serviceId || '', description: r.description || '' }); }}
                              className="p-2 text-gray-500 hover:text-gray-700 dark:text-slate-400"
                              aria-label={`Edit ${r.name}`}
                            ><Edit2 className="w-4 h-4" /></button>
                            <button
                              onClick={() => removeReward(r)}
                              className="p-2 text-red-600 hover:text-red-700"
                              aria-label={`Delete ${r.name}`}
                            ><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {mayConfigure && (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-5 space-y-3 h-fit">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">{editing ? 'Edit reward' : 'Add a reward'}</h2>

              <label className={labelClass}>Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldClass} />
              </label>

              <label className={labelClass}>What it gives
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={fieldClass}>
                  <option value="fixed">Money off</option>
                  <option value="percent">Percentage off</option>
                  <option value="free_item">A free service</option>
                </select>
              </label>

              {form.type === 'free_item' ? (
                <label className={labelClass}>Which service
                  <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })} className={fieldClass}>
                    <option value="">Choose a service…</option>
                    {services.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ) : (
                <label className={labelClass}>
                  {form.type === 'percent' ? 'Percent off' : 'Amount off'}
                  <input type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={fieldClass} />
                </label>
              )}

              <label className={labelClass}>Points to redeem
                <input type="number" min="0" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })} className={fieldClass} />
                <span className="block mt-1 text-xs text-gray-500 dark:text-slate-400">
                  Leave at 0 for a punch-card reward — a full card pays for it instead of points.
                </span>
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={!!form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Available to clients
              </label>

              <div className="flex gap-2 pt-1">
                <button onClick={saveReward} disabled={saving}
                  className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 disabled:opacity-60 flex items-center gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {editing ? 'Save changes' : 'Add reward'}
                </button>
                {editing && (
                  <button onClick={() => { setEditing(null); setForm(emptyReward); }}
                    className="px-4 py-2 text-gray-700 dark:text-slate-300 hover:underline">Cancel</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && mayConfigure && (
        <SettingsPanel config={config} services={services} onSaved={(next) => { setConfig(next); load(); }} />
      )}

      {open && (
        <MemberPanel
          member={open}
          rewards={rewards}
          mayAdjust={mayAdjust}
          mayRedeem={mayRedeem}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/**
 * How the programme is set up. Every field here is one the engine actually reads, so nothing on this
 * screen is a promise the till does not keep. (LY0928 B3, L4)
 */
function SettingsPanel({ config, services, onSaved }: { config: any; services: any[]; onSaved: (next: any) => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    enabled: config?.loyaltyEnabled !== false,
    pointsPerDollar: config?.loyaltyPointsPerDollar ?? 1,
    welcomePoints: config?.loyaltyWelcomePoints ?? 0,
    birthdayBonus: config?.loyaltyBirthdayBonus ?? 0,
    visitsRequired: config?.loyaltyPunchCard?.visitsRequired ?? 0,
    rewardName: config?.loyaltyPunchCard?.rewardName || 'Free service',
    qualifyingServiceIds: (config?.loyaltyPunchCard?.qualifyingServiceIds || []) as string[],
  });

  const toggleService = (id: string) => setF((prev) => ({
    ...prev,
    qualifyingServiceIds: prev.qualifyingServiceIds.includes(id)
      ? prev.qualifyingServiceIds.filter((x) => x !== id)
      : [...prev.qualifyingServiceIds, id],
  }));

  const save = async () => {
    setSaving(true);
    try {
      const next = await api.put('/api/loyalty/config', {
        loyaltyEnabled: !!f.enabled,
        loyaltyPointsPerDollar: Number(f.pointsPerDollar) || 0,
        loyaltyWelcomePoints: Math.max(0, Math.floor(Number(f.welcomePoints) || 0)),
        loyaltyBirthdayBonus: Math.max(0, Math.floor(Number(f.birthdayBonus) || 0)),
        loyaltyPunchCard: {
          visitsRequired: Math.max(0, Math.floor(Number(f.visitsRequired) || 0)),
          rewardName: f.rewardName.trim() || 'Free service',
          qualifyingServiceIds: f.qualifyingServiceIds,
        },
      });
      toast.success('Loyalty settings saved');
      onSaved(next);
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the loyalty settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Earning</h2>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
          <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          Run the loyalty programme
        </label>
        <p className="text-xs text-gray-500 dark:text-slate-400">
          Switched off, completed visits stop earning. Balances already earned stay where they are, and a
          manager can still correct one.
        </p>

        <label className={labelClass}>Points per {fmtMoney(1)} spent
          <input type="number" min="0" step="0.1" value={f.pointsPerDollar}
            onChange={(e) => setF({ ...f, pointsPerDollar: e.target.value as any })} className={fieldClass} />
        </label>

        <label className={labelClass}>Welcome bonus
          <input type="number" min="0" value={f.welcomePoints}
            onChange={(e) => setF({ ...f, welcomePoints: e.target.value as any })} className={fieldClass} />
          <span className="block mt-1 text-xs text-gray-500 dark:text-slate-400">
            Points a client gets when they join. 0 for none.
          </span>
        </label>

        <label className={labelClass}>Birthday bonus
          <input type="number" min="0" value={f.birthdayBonus}
            onChange={(e) => setF({ ...f, birthdayBonus: e.target.value as any })} className={fieldClass} />
        </label>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Punch card</h2>

        <label className={labelClass}>Visits for a free one
          <input type="number" min="0" max="100" value={f.visitsRequired}
            onChange={(e) => setF({ ...f, visitsRequired: e.target.value as any })} className={fieldClass} />
          <span className="block mt-1 text-xs text-gray-500 dark:text-slate-400">
            0 switches the card off. 6 means the seventh visit is free.
          </span>
        </label>

        <label className={labelClass}>What a full card gives
          <input value={f.rewardName} onChange={(e) => setF({ ...f, rewardName: e.target.value })} className={fieldClass} />
        </label>

        <div>
          <span className={labelClass}>Which services fill the card</span>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            Choose none for "any appointment counts". Naming services is how "6 cuts, 7th free" works —
            so a fringe trim does not fill the same card as a full colour.
          </p>
          <div className="mt-2 max-h-56 overflow-y-auto space-y-1 pr-1">
            {services.length === 0 && (
              <p className="text-sm text-gray-500 dark:text-slate-400">The service menu is empty.</p>
            )}
            {services.map((s: any) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={f.qualifyingServiceIds.includes(s.id)} onChange={() => toggleService(s.id)} />
                {s.name}
              </label>
            ))}
          </div>
        </div>

        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 disabled:opacity-60 flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save settings
        </button>
      </div>
    </div>
  );
}

/**
 * One client: what they have, where it came from, and the two things a desk does with it — take a
 * reward against a visit, and correct a balance. The redeem control picks the VISIT rather than
 * asking anyone to describe a basket: the bill already says what the client is buying. (LY0928 B3/H2)
 */
function MemberPanel({
  member, rewards, mayAdjust, mayRedeem, onClose, onChanged,
}: {
  member: Member;
  rewards: Reward[];
  mayAdjust: boolean;
  mayRedeem: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [detail, setDetail] = useState<any>(null);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [busy, setBusy] = useState(false);

  const [rewardId, setRewardId] = useState('');
  const [appointmentId, setAppointmentId] = useState('');
  const [quote, setQuote] = useState<{ discount: number; pointsCost: number; onTheHouse: boolean } | null>(null);

  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([
        api.get(`/api/loyalty/members/${member.id}`),
        api.get(`/api/loyalty/members/${member.id}/visits`).catch(() => ({ data: [] })),
      ]);
      setDetail(d);
      setVisits(v?.data || []);
    } catch (err: any) {
      toast.error(err?.message || 'Could not load this client');
    }
  }, [member.id]);

  useEffect(() => { refresh(); }, [refresh]);

  // A preview asks the server what it WOULD do, so the desk sees the real figure before spending
  // anything — and sees the refusal, in full, when there is one.
  useEffect(() => {
    setQuote(null);
    if (!rewardId || !appointmentId) return;
    let cancelled = false;
    api.post(`/api/loyalty/members/${member.id}/redeem`, { rewardId, appointmentId, preview: true })
      .then((r: any) => { if (!cancelled) setQuote(r); })
      .catch((err: any) => { if (!cancelled) toast.error(err?.message || 'That reward cannot be used on this visit'); });
    return () => { cancelled = true; };
  }, [rewardId, appointmentId, member.id]);

  const redeem = async () => {
    setBusy(true);
    try {
      const r: any = await api.post(`/api/loyalty/members/${member.id}/redeem`, { rewardId, appointmentId });
      toast.success(
        r.onTheHouse
          ? `On the house — ${fmtMoney(r.discount)} off, card used`
          : `${fmtMoney(r.discount)} off for ${r.pointsSpent} points`,
      );
      setRewardId(''); setAppointmentId(''); setQuote(null);
      await refresh(); onChanged();
    } catch (err: any) {
      toast.error(err?.message || 'Could not redeem that reward');
    } finally {
      setBusy(false);
    }
  };

  const adjust = async () => {
    const n = Math.trunc(Number(points));
    if (!Number.isFinite(n) || n === 0) { toast.error('Say how many points to add or take off'); return; }
    if (!reason.trim()) { toast.error('Give a reason — it goes on the client’s history'); return; }
    setBusy(true);
    try {
      const r: any = await api.post(`/api/loyalty/members/${member.id}/adjust`, { points: n, reason: reason.trim() });
      toast.success(
        r.programmeOff
          ? `Balance is now ${r.pointsBalance}. The programme is switched off, so clients are not earning.`
          : `Balance is now ${r.pointsBalance}`,
      );
      setPoints(''); setReason('');
      await refresh(); onChanged();
    } catch (err: any) {
      toast.error(err?.message || 'Could not correct the balance');
    } finally {
      setBusy(false);
    }
  };

  const usable = visits.filter((v) => !v.rewardUsed && !v.settled && v.remaining > 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md h-full overflow-y-auto bg-white dark:bg-slate-900 border-l border-gray-200 dark:border-slate-700 p-5 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{member.clientName}</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {detail?.pointsBalance ?? member.pointsBalance ?? 0} points · {detail?.lifetimePoints ?? member.lifetimePoints ?? 0} earned to date
            </p>
          </div>
          <button onClick={onClose} className="p-2 text-gray-500 hover:text-gray-700 dark:text-slate-400" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div><PunchCard card={detail?.punchCard ?? member.punchCard} /></div>

        {mayRedeem && (
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-3">
            <h3 className="font-medium text-gray-900 dark:text-slate-100">Use a reward</h3>

            <label className={labelClass}>Reward
              <select value={rewardId} onChange={(e) => setRewardId(e.target.value)} className={fieldClass}>
                <option value="">Choose a reward…</option>
                {rewards.filter((r) => r.active).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.pointsCost > 0 ? `${r.pointsCost} pts` : 'a full card'}
                  </option>
                ))}
              </select>
            </label>

            <label className={labelClass}>Against which visit
              <select value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)} className={fieldClass}>
                <option value="">Choose a visit…</option>
                {usable.map((v) => (
                  <option key={v.appointmentId} value={v.appointmentId}>
                    {new Date(v.startTime).toLocaleDateString()} · {v.serviceName || 'Visit'} · {v.invoiceNumber} · {fmtMoney(v.remaining)} left
                  </option>
                ))}
              </select>
            </label>

            {visits.length > 0 && usable.length === 0 && (
              <p className="text-sm text-gray-600 dark:text-slate-400">
                Every recent visit is either already paid, already carries a reward, or is paid down to nothing.
                One reward per visit, and a settled bill takes a refund or a credit instead.
              </p>
            )}
            {visits.length === 0 && (
              <p className="text-sm text-gray-600 dark:text-slate-400">
                No completed visit with a bill yet. Complete the appointment first, then apply the reward.
              </p>
            )}

            {quote && (
              <p className="text-sm text-gray-700 dark:text-slate-300">
                Takes {fmtMoney(quote.discount)} off{quote.onTheHouse ? ' — on the house, the card pays for it' : ` for ${quote.pointsCost} points`}.
              </p>
            )}

            <button
              onClick={redeem}
              disabled={busy || !rewardId || !appointmentId}
              className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 disabled:opacity-60 flex items-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Redeem
            </button>
          </div>
        )}

        {mayAdjust && (
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-4 space-y-3">
            <h3 className="font-medium text-gray-900 dark:text-slate-100">Correct the balance</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setPoints((p) => String(-Math.abs(Math.trunc(Number(p) || 0)) || -1))}
                className="p-2 rounded-lg border border-gray-300 text-gray-700 dark:border-slate-700 dark:text-slate-300"
                aria-label="Make it a deduction"
              ><Minus className="w-4 h-4" /></button>
              <input
                type="number" value={points} onChange={(e) => setPoints(e.target.value)}
                placeholder="Points, or -points to take off"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            <input
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Why — this shows on the client’s history"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <button onClick={adjust} disabled={busy}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-60">
              Apply correction
            </button>
          </div>
        )}

        <div>
          <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-2">History</h3>
          {!detail?.transactions?.length ? (
            <p className="text-sm text-gray-600 dark:text-slate-400">Nothing on the ledger yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-slate-800">
              {detail.transactions.map((t: LedgerRow) => (
                <li key={t.id} className="py-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-900 dark:text-slate-100">{LEDGER_LABEL[t.type] || t.type}</div>
                    {t.description && <div className="text-xs text-gray-500 dark:text-slate-400">{t.description}</div>}
                    <div className="text-xs text-gray-500 dark:text-slate-400">{new Date(t.createdAt).toLocaleString()}</div>
                  </div>
                  <div className={`tabular-nums text-sm font-medium ${t.points < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}>
                    {t.points > 0 ? `+${t.points}` : t.points}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
