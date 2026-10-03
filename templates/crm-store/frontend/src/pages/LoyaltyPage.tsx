import { useEffect, useState } from 'react'
import api, { LoyaltyConfig, LoyaltyMember, LoyaltyReward, LoyaltyPunchCard } from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { centsToDollars, dollarsToCents } from '../lib/format'

/**
 * Loyalty — the programme's settings, who is on it, and what they can spend points on.
 *
 * Shoppers are identified by EMAIL: this storefront has guest checkout and no customer login, which
 * is also why rewards here are money off rather than free goods. Points move when an order is paid,
 * never at checkout, so nothing on this screen can change a balance.
 */

const BLANK_REWARD = {
  name: '', description: '', pointsCost: '', type: 'fixed' as 'fixed' | 'percent',
  value: '', minSubtotal: '', active: true,
}

function Card({ card }: { card: LoyaltyPunchCard }) {
  if (!card?.enabled) return <span className="text-gray-500 dark:text-slate-400">—</span>
  const filled = card.unclaimed > 0 ? card.visitsRequired : card.progress
  return (
    <span className="inline-flex items-center gap-1" title={`${card.progress} of ${card.visitsRequired} orders`}>
      {Array.from({ length: card.visitsRequired }).map((_, i) => (
        <span key={i} className={`inline-block w-2.5 h-2.5 rounded-full ${i < filled ? 'bg-indigo-500' : 'bg-gray-200'}`} />
      ))}
      {card.unclaimed > 0 && <span className="ml-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">Reward ready</span>}
    </span>
  )
}

export default function LoyaltyPage() {
  const { toast } = useToast()
  const [tab, setTab] = useState<'members' | 'rewards' | 'settings'>('members')
  const [config, setConfig] = useState<LoyaltyConfig | null>(null)
  const [members, setMembers] = useState<LoyaltyMember[]>([])
  const [rewards, setRewards] = useState<LoyaltyReward[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({ ...BLANK_REWARD })
  const [editingId, setEditingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [cfg, mem, rew] = await Promise.all([
        api.getLoyaltyConfig(), api.listLoyaltyMembers(search), api.listLoyaltyRewards(),
      ])
      setConfig(cfg); setMembers(mem); setRewards(rew)
    } catch (err: any) {
      toast(err?.message || 'Could not load the loyalty programme', 'error')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [search])

  const saveConfig = async (patch: Partial<LoyaltyConfig>) => {
    setSaving(true)
    try { setConfig(await api.updateLoyaltyConfig(patch)); toast('Loyalty settings saved') }
    catch (err: any) { toast(err?.message || 'Could not save', 'error') }
    finally { setSaving(false) }
  }

  const saveReward = async () => {
    if (!form.name.trim()) { toast('Give the reward a name shoppers will recognise', 'error'); return }
    if (!form.value) { toast('A reward worth nothing takes nothing off', 'error'); return }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        pointsCost: Math.max(0, Math.round(Number(form.pointsCost) || 0)),
        type: form.type,
        // Cents for money off, a whole percent for a percentage — the column holds both.
        valueCents: form.type === 'percent' ? Math.round(Number(form.value)) : dollarsToCents(form.value),
        minSubtotalCents: form.minSubtotal ? dollarsToCents(form.minSubtotal) : 0,
        active: form.active,
      }
      if (editingId) await api.updateLoyaltyReward(editingId, body)
      else await api.createLoyaltyReward(body)
      toast(editingId ? 'Reward updated' : 'Reward created')
      setForm({ ...BLANK_REWARD }); setEditingId(null); load()
    } catch (err: any) {
      toast(err?.message || 'Could not save the reward', 'error')
    } finally { setSaving(false) }
  }

  const removeReward = async (r: LoyaltyReward) => {
    if (!confirm(`Delete "${r.name}"? Shoppers will no longer be able to redeem it.`)) return
    try { await api.deleteLoyaltyReward(r.id); toast('Reward deleted'); load() }
    catch (err: any) { toast(err?.message || 'Could not delete', 'error') }
  }

  const describe = (r: LoyaltyReward) =>
    r.type === 'percent' ? `${r.valueCents}% off` : `$${centsToDollars(r.valueCents)} off`

  if (loading) return <div className="p-8 text-gray-600 dark:text-slate-300">Loading…</div>

  const card = config?.loyaltyPunchCard

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100">Loyalty</h1>
        <p className="text-gray-600 dark:text-slate-300">
          {config?.loyaltyEnabled === false
            ? 'The programme is switched off — shoppers are not earning.'
            : <>Shoppers earn {config?.loyaltyPointsPerDollar ?? 1} point per $1 spent on goods
              {card && card.visitsRequired > 0
                ? `, and every ${card.visitsRequired} orders earns ${card.rewardName || 'a reward'}.`
                : '.'}</>}
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          Shoppers are recognised by their email address at checkout — this store has no customer login.
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {(['members', 'rewards', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 capitalize ${
              tab === t ? 'border-indigo-500 text-indigo-700 dark:text-indigo-300' : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400'
            } dark:text-slate-200`}
          >{t}</button>
        ))}
      </div>

      {tab === 'members' && (
        <div className="space-y-3">
          <input
            type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by email…"
            className="w-full max-w-sm rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100"
          />
          {members.length === 0 ? (
            <p className="rounded border border-gray-200 bg-white p-8 text-center text-gray-600 dark:bg-slate-900 dark:text-slate-300">
              Nobody is on the programme yet. Shoppers join automatically the first time an order is paid.
            </p>
          ) : (
            <div className="overflow-x-auto rounded border border-gray-200 bg-white dark:bg-slate-900">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600 dark:text-slate-300 dark:bg-slate-800">
                  <tr>{['Email', 'Points', 'Earned to date', 'Orders', 'Punch card'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5 text-gray-900 dark:text-slate-100">{m.email}</td>
                      <td className="px-4 py-2.5 tabular-nums font-medium text-gray-900 dark:text-slate-100">{m.pointsBalance}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-slate-300">{m.lifetimePoints}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-slate-300">{m.qualifyingOrders}</td>
                      <td className="px-4 py-2.5"><Card card={m.punchCard} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'rewards' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 overflow-x-auto rounded border border-gray-200 bg-white dark:bg-slate-900">
            {rewards.length === 0 ? (
              <p className="p-8 text-center text-gray-600 dark:text-slate-300">No rewards yet. Add one so points are worth something.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600 dark:text-slate-300 dark:bg-slate-800">
                  <tr>{['Reward', 'Costs', 'Gives', 'Min spend', 'Used', ''].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rewards.map((r) => (
                    <tr key={r.id} className={r.active ? '' : 'opacity-60'}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900 dark:text-slate-100">{r.name}</div>
                        {r.description && <div className="text-gray-500 dark:text-slate-400">{r.description}</div>}
                        {!r.active && <div className="text-xs text-gray-500 dark:text-slate-400">Not currently available</div>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-900 dark:text-slate-100">
                        {r.pointsCost > 0 ? `${r.pointsCost} pts` : <span className="text-indigo-700 dark:text-indigo-300">A full card</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-900 dark:text-slate-100">{describe(r)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-slate-300">
                        {r.minSubtotalCents > 0 ? `$${centsToDollars(r.minSubtotalCents)}` : '—'}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-slate-300">{r.usedCount}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        <button
                          onClick={() => {
                            setEditingId(r.id)
                            setForm({
                              name: r.name, description: r.description || '',
                              pointsCost: String(r.pointsCost),
                              type: r.type,
                              value: r.type === 'percent' ? String(r.valueCents) : centsToDollars(r.valueCents),
                              minSubtotal: r.minSubtotalCents ? centsToDollars(r.minSubtotalCents) : '',
                              active: r.active,
                            })
                          }}
                          className="px-2 py-1 text-indigo-700 hover:underline dark:text-indigo-300"
                        >Edit</button>
                        <button onClick={() => removeReward(r)} className="px-2 py-1 text-red-600 hover:underline dark:text-red-400">Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="h-fit space-y-3 rounded border border-gray-200 bg-white p-5 dark:bg-slate-900">
            <h2 className="font-semibold text-gray-900 dark:text-slate-100">{editingId ? 'Edit reward' : 'Add a reward'}</h2>

            <label className="block text-sm text-gray-600 dark:text-slate-300">Name
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
            </label>

            <label className="block text-sm text-gray-600 dark:text-slate-300">What it gives
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100">
                <option value="fixed">Money off</option>
                <option value="percent">Percentage off</option>
              </select>
              <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">
                Money off only — with no customer login, anyone who knows the email could spend the balance.
              </span>
            </label>

            <label className="block text-sm text-gray-600 dark:text-slate-300">{form.type === 'percent' ? 'Percent off' : 'Amount off ($)'}
              <input type="number" min="0" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
            </label>

            <label className="block text-sm text-gray-600 dark:text-slate-300">Points to redeem
              <input type="number" min="0" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
              <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">
                Leave at 0 for a punch-card reward — a full card pays for it instead of points.
              </span>
            </label>

            <label className="block text-sm text-gray-600 dark:text-slate-300">Minimum spend ($, optional)
              <input type="number" min="0" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
            </label>

            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Available to shoppers
            </label>

            <div className="flex gap-2 pt-1">
              <button onClick={saveReward} disabled={saving}
                className="rounded bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:opacity-60">
                {editingId ? 'Save changes' : 'Add reward'}
              </button>
              {editingId && (
                <button onClick={() => { setEditingId(null); setForm({ ...BLANK_REWARD }) }}
                  className="px-3 py-2 text-gray-700 hover:underline dark:text-slate-200">Cancel</button>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'settings' && config && (
        <div className="max-w-xl space-y-4 rounded border border-gray-200 bg-white p-5 dark:bg-slate-900">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
            <input type="checkbox" checked={config.loyaltyEnabled}
              onChange={(e) => saveConfig({ loyaltyEnabled: e.target.checked })} />
            Run a loyalty programme
          </label>

          <label className="block text-sm text-gray-600 dark:text-slate-300">Points per $1 spent
            <input type="number" min="0" step="0.1" defaultValue={config.loyaltyPointsPerDollar}
              onBlur={(e) => saveConfig({ loyaltyPointsPerDollar: Number(e.target.value) || 0 })}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
            <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">Earned on goods after discounts — not on shipping or tax.</span>
          </label>

          <label className="block text-sm text-gray-600 dark:text-slate-300">Welcome points
            <input type="number" min="0" defaultValue={config.loyaltyWelcomePoints}
              onBlur={(e) => saveConfig({ loyaltyWelcomePoints: Math.round(Number(e.target.value)) || 0 })}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
          </label>

          <fieldset className="space-y-2 rounded border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium text-gray-700 dark:text-slate-200">Punch card</legend>
            <label className="block text-sm text-gray-600 dark:text-slate-300">Orders needed for a free reward
              <input type="number" min="0" defaultValue={config.loyaltyPunchCard?.visitsRequired ?? 0}
                onBlur={(e) => saveConfig({ loyaltyPunchCard: {
                  ...config.loyaltyPunchCard,
                  visitsRequired: Math.max(0, Math.round(Number(e.target.value)) || 0),
                } as any })}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
              <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">0 switches the card off.</span>
            </label>
            <label className="block text-sm text-gray-600 dark:text-slate-300">What they get
              <input defaultValue={config.loyaltyPunchCard?.rewardName ?? ''}
                onBlur={(e) => saveConfig({ loyaltyPunchCard: {
                  ...config.loyaltyPunchCard, rewardName: e.target.value.trim(),
                } as any })}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-gray-900 dark:text-slate-100" />
              <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">
                Add a reward costing 0 points on the Rewards tab — a full card pays for it.
              </span>
            </label>
          </fieldset>

          {saving && <p className="text-sm text-gray-500 dark:text-slate-400">Saving…</p>}
        </div>
      )}
    </div>
  )
}
