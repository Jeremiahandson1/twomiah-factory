import { useState, useEffect, useCallback } from 'react';
import { Gift, Loader2, Plus, Edit2, Trash2, Stamp, Coins } from 'lucide-react';
import api from '../../services/api';
import { money as fmtMoney } from '../../shared';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../shared';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Loyalty — who is on the programme, and what they can spend it on.
 *
 * Two ways to earn, and a salon usually runs both:
 *   points      on what a client spends, redeemed for money off or a named free service
 *   punch card  on how often they come — "6 cuts, 7th free"
 *
 * Both are read straight off the server; the arithmetic lives in the shared engine
 * (packages/tenant-backend/src/loyalty) so it cannot drift from what the till actually does.
 */

interface Member {
  id: string;
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

const emptyReward = { name: '', description: '', pointsCost: 0, type: 'fixed' as const, value: 0, serviceId: '', active: true };

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

export default function LoyaltyPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { isAdmin } = useAuth();

  const [tab, setTab] = useState<'members' | 'rewards'>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [editing, setEditing] = useState<Reward | null>(null);
  const [form, setForm] = useState<any>(emptyReward);
  const [saving, setSaving] = useState(false);

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
    if (!(await confirm({ title: `Delete "${r.name}"?`, body: 'Clients will no longer be able to redeem it.' }))) return;
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
        {([['members', 'Members', Coins], ['rewards', 'Rewards', Stamp]] as const).map(([id, label, Icon]) => (
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
                    {['Client', 'Points', 'Earned to date', 'Punch card'].map((h) => (
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
                        {isAdmin && (
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

          {isAdmin && (
            <div className="bg-white dark:bg-slate-900 rounded-lg border border-gray-200 dark:border-slate-700 p-5 space-y-3 h-fit">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">{editing ? 'Edit reward' : 'Add a reward'}</h2>

              <label className="block text-sm text-gray-600 dark:text-slate-400">Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
              </label>

              <label className="block text-sm text-gray-600 dark:text-slate-400">What it gives
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                  <option value="fixed">Money off</option>
                  <option value="percent">Percentage off</option>
                  <option value="free_item">A free service</option>
                </select>
              </label>

              {form.type === 'free_item' ? (
                <label className="block text-sm text-gray-600 dark:text-slate-400">Which service
                  <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                    <option value="">Choose a service…</option>
                    {services.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </label>
              ) : (
                <label className="block text-sm text-gray-600 dark:text-slate-400">
                  {form.type === 'percent' ? 'Percent off' : 'Amount off'}
                  <input type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
                </label>
              )}

              <label className="block text-sm text-gray-600 dark:text-slate-400">Points to redeem
                <input type="number" min="0" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })}
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" />
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
    </div>
  );
}
