// Moved from templates/crm-store/frontend/src/pages/LoyaltyPage.tsx. The store's loyalty programme at
// /api/admin/loyalty (server/crm/store/catalog/loyalty.ts): the settings (company.settings.loyalty, the shared
// programme's), who is on it, and what they can spend points on. Reading is loyalty:read (everyone — looking up a
// shopper's balance is desk work); the reward list and the earn rate are loyalty:configure (the manager and the owner).
// Points move when an order is paid, never here.
//
// Changes from the template:
//   · at /crm/store-loyalty, not /crm/loyalty: the salon's Loyalty screen is registered at /crm/loyalty for every
//     vertical (crm/verticals/salon.tsx) and calls the salon's API, so the address must name one page;
//   · members are contacts (decision 2): each row shows the shopper's name, email and phone (the template showed the
//     email alone), and the name opens their contact for a seat that may read contacts; the search matches the name or
//     the email (the server's); the orders count is qualifyingVisits (was qualifyingOrders); the search waits for the
//     typing to stop (it asked the server on every keystroke);
//   · rewards' use count is usageCount (was usedCount); lists are the reply's `data` (were `members` / `rewards`);
//   · the points rate, welcome points and punch card save with a Save button that sends only what changed (the
//     template saved each box when the cursor left it, through uncontrolled inputs that kept showing the old value
//     after a refused save — the same blur-to-save the product page had already dropped for losing edits); the on/off
//     switch still saves at once; every number is checked on the form, naming the box;
//   · money is typed in the store's currency and read from the digits; a refusal names the box (`fields`);
//   · the app's API client, toasts and the shared confirm dialog (the template used window.confirm);
//   · the tabs' active ink in dark mode (the template's class list ended in dark:text-slate-200 for every tab, which
//     overrode the active tab's colour); every table ink has its dark partner; the tables scroll at phone width.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../../../api'
import { PageError, errorText, useConfirm, useMayWrite, usePermissions, useToast } from '../../../../shared'
import { useDebounce } from '../../../useDebounce'
import { formatMoney, fromHundredths, listOf, refusalOf, toHundredths, toWhole, useStoreCurrency } from './lib'

interface PunchCardConfig { visitsRequired: number; rewardName: string; qualifyingServiceIds?: string[] }
interface LoyaltyConfig {
  loyaltyEnabled: boolean; loyaltyPointsPerDollar: number; loyaltyWelcomePoints: number; loyaltyBirthdayBonus: number
  loyaltyPunchCard: PunchCardConfig
}
interface PunchCardProgress { enabled: boolean; visitsRequired: number; progress: number; remaining: number; unclaimed: number }
interface LoyaltyMember {
  id: string; contactId: string; name: string | null; email: string | null; phone: string | null
  pointsBalance: number; lifetimePoints: number; qualifyingVisits: number; punchRewardsEarned: number
  lastActivityAt: string | null; punchCard: PunchCardProgress
}
interface LoyaltyReward {
  id: string; name: string; description: string | null; pointsCost: number; type: 'fixed' | 'percent' | string
  valueCents: number; minSubtotalCents: number; active: boolean; usageCount: number
}

const BLANK_REWARD = { name: '', description: '', pointsCost: '', type: 'fixed' as 'fixed' | 'percent', value: '', minSubtotal: '', active: true }
type Tab = 'members' | 'rewards' | 'settings'

function Card({ card }: { card: PunchCardProgress }) {
  if (!card?.enabled) return <span className="text-gray-600 dark:text-slate-400">—</span>
  const filled = card.unclaimed > 0 ? card.visitsRequired : card.progress
  return (
    <span className="inline-flex items-center gap-1" title={`${card.progress} of ${card.visitsRequired} orders`}>
      {Array.from({ length: card.visitsRequired }).map((_, i) => (
        <span key={i} className={`inline-block w-2.5 h-2.5 rounded-full ${i < filled ? 'bg-indigo-500 dark:bg-indigo-400' : 'bg-gray-200 dark:bg-slate-700'}`} />
      ))}
      {card.unclaimed > 0 && <span className="ml-1 text-xs font-medium text-indigo-700 dark:text-indigo-300">Reward ready</span>}
    </span>
  )
}

export default function LoyaltyPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const currency = useStoreCurrency()
  const { can } = usePermissions()
  const [tab, setTab] = useState<Tab>('members')
  const [config, setConfig] = useState<LoyaltyConfig | null>(null)
  const [members, setMembers] = useState<LoyaltyMember[]>([])
  const [rewards, setRewards] = useState<LoyaltyReward[]>([])
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({ ...BLANK_REWARD })
  const [rewardError, setRewardError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  // The reward list and the earn rate are the programme's price list — loyalty:configure, the manager's and the
  // owner's. Staff look shoppers up and read what the programme offers.
  const mayConfigure = useMayWrite('loyalty:configure')
  const mayOpenContact = can('contacts:read')

  const loadProgramme = useCallback(async () => {
    try {
      const [cfg, rew] = await Promise.all([api.get('/api/admin/loyalty/config'), api.get('/api/admin/loyalty/rewards')])
      setConfig(cfg as LoyaltyConfig); setRewards(listOf<LoyaltyReward>(rew)); setError(null)
    } catch (e) { setError(errorText(e, 'Could not load the loyalty programme')) }
  }, [])
  const loadMembers = useCallback(async (q: string) => {
    try { setMembers(listOf<LoyaltyMember>(await api.get('/api/admin/loyalty/members', { search: q || undefined }))) }
    catch (e) { setError(errorText(e, 'Could not load the members')) }
  }, [])

  useEffect(() => { void loadProgramme().finally(() => setLoading(false)) }, [loadProgramme])
  useEffect(() => { void loadMembers(debounced) }, [debounced, loadMembers])

  const saveConfig = async (patch: Partial<LoyaltyConfig>, said = 'Loyalty settings saved'): Promise<boolean> => {
    setSaving(true)
    try { setConfig(await api.put('/api/admin/loyalty/config', patch)); toast.success(said); return true }
    catch (e) { toast.error(errorText(e, 'Could not save')); return false }
    finally { setSaving(false) }
  }

  const saveReward = async () => {
    setRewardError(null)
    if (!form.name.trim()) { setRewardError('Give the reward a name shoppers will recognise.'); return }
    const value = form.type === 'percent' ? toWhole(form.value) : toHundredths(form.value)
    if (value === null || Number.isNaN(value) || value <= 0) {
      setRewardError(form.type === 'percent' ? 'Percent off is a whole number from 1 to 100.' : 'A reward worth nothing takes nothing off — enter the amount, like 5.00.'); return
    }
    if (form.type === 'percent' && value > 100) { setRewardError('A percentage reward cannot exceed 100%.'); return }
    const points = form.pointsCost.trim() ? toWhole(form.pointsCost) : 0
    if (points === null || Number.isNaN(points)) { setRewardError('Points to redeem is a whole number (0 for a punch-card reward).'); return }
    const min = form.minSubtotal.trim() ? toHundredths(form.minSubtotal) : 0
    if (min === null) { setRewardError('Enter the minimum spend as a number, or leave it blank.'); return }
    setSaving(true)
    try {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        pointsCost: points,
        type: form.type,
        // Cents for money off, a whole percent for a percentage — the column holds both.
        valueCents: value,
        minSubtotalCents: min,
        active: form.active,
      }
      if (editingId) await api.put(`/api/admin/loyalty/rewards/${editingId}`, body)
      else await api.post('/api/admin/loyalty/rewards', body)
      toast.success(editingId ? 'Reward updated' : 'Reward created')
      setForm({ ...BLANK_REWARD }); setEditingId(null); void loadProgramme()
    } catch (e) {
      const named = Object.entries(refusalOf(e).fields).map(([k, v]) => `${k}: ${v}`).join('; ')
      setRewardError(named ? `${errorText(e, 'Could not save the reward')} (${named})` : errorText(e, 'Could not save the reward'))
    } finally { setSaving(false) }
  }

  const removeReward = async (r: LoyaltyReward) => {
    if (!(await confirm(`Delete "${r.name}"? Shoppers will no longer be able to redeem it.`, { title: 'Delete reward', confirmText: 'Delete' }))) return
    try { await api.delete(`/api/admin/loyalty/rewards/${r.id}`); toast.success('Reward deleted'); void loadProgramme() }
    catch (e) { toast.error(errorText(e, 'Could not delete the reward')) }
  }

  const describe = (r: LoyaltyReward) => (r.type === 'percent' ? `${r.valueCents}% off` : `${formatMoney(r.valueCents, currency)} off`)

  if (loading) return <div className="p-8 text-gray-600 dark:text-slate-300">Loading…</div>

  const card = config?.loyaltyPunchCard

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Loyalty</h1>
        {config && (
          <p className="text-gray-700 dark:text-slate-300">
            {config.loyaltyEnabled === false
              ? 'The programme is switched off — shoppers are not earning.'
              : <>Shoppers earn {config.loyaltyPointsPerDollar ?? 1} {config.loyaltyPointsPerDollar === 1 ? 'point' : 'points'} per {formatMoney(100, currency)} spent on goods
                {card && card.visitsRequired > 0 ? `, and every ${card.visitsRequired} orders earns ${card.rewardName || 'a reward'}.` : '.'}</>}
          </p>
        )}
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
          Shoppers are recognised by their email address at checkout — this store has no customer login.
        </p>
      </div>

      <PageError message={error} onDismiss={() => setError(null)} />

      <div className="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-slate-700" role="tablist">
        {(['members', 'rewards', 'settings'] as const).map((t) => (
          <button
            key={t} type="button" role="tab" aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`-mb-px px-4 py-2.5 text-sm font-medium border-b-2 capitalize whitespace-nowrap ${
              tab === t
                ? 'border-indigo-500 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
                : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-100'
            }`}
          >{t}</button>
        ))}
      </div>

      {tab === 'members' && (
        <div className="space-y-3">
          <label className="sr-only" htmlFor="ly-search">Search members</label>
          <input
            id="ly-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…" className="input max-w-sm"
          />
          {members.length === 0 ? (
            <p className="card p-8 text-center text-gray-700 dark:text-slate-300">
              {debounced ? 'Nobody on the programme matches that.' : 'Nobody is on the programme yet. Shoppers join automatically the first time an order is paid.'}
            </p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-gray-50 text-left text-gray-700 dark:bg-slate-800 dark:text-slate-300">
                  <tr>{['Shopper', 'Points', 'Earned to date', 'Orders', 'Punch card'].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-medium">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td className="px-4 py-2.5">
                        {mayOpenContact
                          ? <Link to={`/crm/contacts/${m.contactId}`} className="font-medium text-gray-900 hover:underline dark:text-slate-100">{m.name || m.email || 'Shopper'}</Link>
                          : <span className="font-medium text-gray-900 dark:text-slate-100">{m.name || m.email || 'Shopper'}</span>}
                        <div className="text-xs text-gray-600 dark:text-slate-400">{[m.name ? m.email : null, m.phone].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums font-medium text-gray-900 dark:text-slate-100">{m.pointsBalance}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-700 dark:text-slate-300">{m.lifetimePoints}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-700 dark:text-slate-300">{m.qualifyingVisits}</td>
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
          <div className="lg:col-span-2 card overflow-x-auto">
            {rewards.length === 0 ? (
              <p className="p-8 text-center text-gray-700 dark:text-slate-300">No rewards yet. Add one so points are worth something.</p>
            ) : (
              <table className="w-full min-w-[600px] text-sm">
                <thead className="bg-gray-50 text-left text-gray-700 dark:bg-slate-800 dark:text-slate-300">
                  <tr>{['Reward', 'Costs', 'Gives', 'Min spend', 'Used', ''].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 font-medium">{h || <span className="sr-only">Actions</span>}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {rewards.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900 dark:text-slate-100">{r.name}</div>
                        {r.description && <div className="text-gray-600 dark:text-slate-400">{r.description}</div>}
                        {!r.active && <div className="text-xs text-gray-600 dark:text-slate-400">Not currently available</div>}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-900 dark:text-slate-100">
                        {r.pointsCost > 0 ? `${r.pointsCost} pts` : <span className="text-indigo-700 dark:text-indigo-300">A full card</span>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-900 dark:text-slate-100">{describe(r)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-700 dark:text-slate-300">{r.minSubtotalCents > 0 ? formatMoney(r.minSubtotalCents, currency) : '—'}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-700 dark:text-slate-300">{r.usageCount}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap text-right">
                        {mayConfigure && <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(r.id); setRewardError(null)
                              setForm({
                                name: r.name, description: r.description || '', pointsCost: String(r.pointsCost),
                                type: r.type === 'percent' ? 'percent' : 'fixed',
                                value: r.type === 'percent' ? String(r.valueCents) : fromHundredths(r.valueCents),
                                minSubtotal: r.minSubtotalCents ? fromHundredths(r.minSubtotalCents) : '',
                                active: r.active,
                              })
                            }}
                            className="px-2 py-1 text-indigo-700 hover:underline dark:text-indigo-300"
                          >Edit</button>
                          <button type="button" onClick={() => removeReward(r)} className="px-2 py-1 text-red-700 hover:underline dark:text-red-300">Delete</button>
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!mayConfigure && <p className="h-fit text-sm text-gray-600 dark:text-slate-400">Rewards are set by a manager or the owner.</p>}
          {mayConfigure && (
            <div className="card h-fit space-y-3 p-5">
              <h2 className="font-semibold text-gray-900 dark:text-slate-100">{editingId ? 'Edit reward' : 'Add a reward'}</h2>
              <PageError message={rewardError} />

              <label className="block text-sm text-gray-700 dark:text-slate-300">Name
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input mt-1" />
              </label>

              <label className="block text-sm text-gray-700 dark:text-slate-300">Description (optional)
                <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input mt-1" />
              </label>

              <label className="block text-sm text-gray-700 dark:text-slate-300">What it gives
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'fixed' | 'percent' })} className="input mt-1">
                  <option value="fixed">Money off</option>
                  <option value="percent">Percentage off</option>
                </select>
                <span className="mt-1 block text-xs text-gray-600 dark:text-slate-400">
                  Money off only — with no customer login, anyone who knows the email could spend the balance.
                </span>
              </label>

              <label className="block text-sm text-gray-700 dark:text-slate-300">{form.type === 'percent' ? 'Percent off' : `Amount off (${currency.toUpperCase()})`}
                <input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="input mt-1" />
              </label>

              <label className="block text-sm text-gray-700 dark:text-slate-300">Points to redeem
                <input inputMode="numeric" value={form.pointsCost} onChange={(e) => setForm({ ...form, pointsCost: e.target.value })} className="input mt-1" />
                <span className="mt-1 block text-xs text-gray-600 dark:text-slate-400">Leave at 0 for a punch-card reward — a full card pays for it instead of points.</span>
              </label>

              <label className="block text-sm text-gray-700 dark:text-slate-300">Minimum spend (optional)
                <input inputMode="decimal" value={form.minSubtotal} onChange={(e) => setForm({ ...form, minSubtotal: e.target.value })} className="input mt-1" />
              </label>

              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Available to shoppers
              </label>

              <div className="flex flex-wrap gap-2 pt-1">
                <button type="button" onClick={saveReward} disabled={saving} className="btn btn-primary">{editingId ? 'Save changes' : 'Add reward'}</button>
                {editingId && (
                  <button type="button" onClick={() => { setEditingId(null); setForm({ ...BLANK_REWARD }); setRewardError(null) }} className="btn btn-ghost">Cancel</button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && config && <SettingsTab config={config} mayConfigure={mayConfigure} saving={saving} onSave={saveConfig} />}
    </div>
  )
}

function SettingsTab({ config, mayConfigure, saving, onSave }: {
  config: LoyaltyConfig; mayConfigure: boolean; saving: boolean
  onSave: (patch: Partial<LoyaltyConfig>, said?: string) => Promise<boolean>
}) {
  const fromConfig = (c: LoyaltyConfig) => ({
    rate: String(c.loyaltyPointsPerDollar ?? 0), welcome: String(c.loyaltyWelcomePoints ?? 0),
    visits: String(c.loyaltyPunchCard?.visitsRequired ?? 0), rewardName: c.loyaltyPunchCard?.rewardName ?? '',
  })
  const [f, setF] = useState(() => fromConfig(config))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setF(fromConfig(config)) }, [config])
  const base = fromConfig(config)
  const dirty = f.rate !== base.rate || f.welcome !== base.welcome || f.visits !== base.visits || f.rewardName.trim() !== base.rewardName

  const save = async () => {
    setError(null)
    const rate = Number(f.rate)
    if (!f.rate.trim() || !Number.isFinite(rate) || rate < 0 || rate > 1000) { setError('Points per dollar is a number from 0 to 1000.'); return }
    const welcome = toWhole(f.welcome)
    if (welcome === null || Number.isNaN(welcome)) { setError('Welcome points is a whole number (0 for none).'); return }
    const visits = toWhole(f.visits)
    if (visits === null || Number.isNaN(visits) || visits > 100) { setError('Orders for a reward is a whole number from 0 to 100 (0 switches the card off).'); return }
    if (f.rewardName.trim().length > 120) { setError('Keep the punch-card reward under 120 characters.'); return }
    // Only what changed: the server merges each setting into the programme, so two people saving two settings keep both.
    const patch: Partial<LoyaltyConfig> = {}
    if (f.rate !== base.rate) patch.loyaltyPointsPerDollar = rate
    if (f.welcome !== base.welcome) patch.loyaltyWelcomePoints = welcome
    if (f.visits !== base.visits || f.rewardName.trim() !== base.rewardName) {
      patch.loyaltyPunchCard = { visitsRequired: visits, rewardName: f.rewardName.trim() }
    }
    await onSave(patch)
  }

  return (
    <fieldset disabled={!mayConfigure || saving} className="card max-w-xl space-y-4 p-5 min-w-0">
      {!mayConfigure && <p className="text-sm text-gray-600 dark:text-slate-400">The programme is set by a manager or the owner.</p>}
      <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200">
        <input type="checkbox" checked={config.loyaltyEnabled}
          onChange={(e) => void onSave({ loyaltyEnabled: e.target.checked }, e.target.checked ? 'Loyalty programme switched on' : 'Loyalty programme switched off')} />
        Run a loyalty programme
      </label>

      <PageError message={error} />

      <label className="block text-sm text-gray-700 dark:text-slate-300">Points per dollar spent
        <input inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} className="input mt-1" />
        <span className="mt-1 block text-xs text-gray-600 dark:text-slate-400">Earned on goods after discounts — not on shipping or tax.</span>
      </label>

      <label className="block text-sm text-gray-700 dark:text-slate-300">Welcome points
        <input inputMode="numeric" value={f.welcome} onChange={(e) => setF({ ...f, welcome: e.target.value })} className="input mt-1" />
      </label>

      <fieldset className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
        <legend className="px-1 text-sm font-medium text-gray-700 dark:text-slate-200">Punch card</legend>
        <label className="block text-sm text-gray-700 dark:text-slate-300">Orders needed for a free reward
          <input inputMode="numeric" value={f.visits} onChange={(e) => setF({ ...f, visits: e.target.value })} className="input mt-1" />
          <span className="mt-1 block text-xs text-gray-600 dark:text-slate-400">0 switches the card off.</span>
        </label>
        <label className="block text-sm text-gray-700 dark:text-slate-300">What they get
          <input value={f.rewardName} onChange={(e) => setF({ ...f, rewardName: e.target.value })} className="input mt-1" />
          <span className="mt-1 block text-xs text-gray-600 dark:text-slate-400">Add a reward costing 0 points on the Rewards tab — a full card pays for it.</span>
        </label>
      </fieldset>

      {mayConfigure && <button type="button" onClick={save} disabled={!dirty || saving} className="btn btn-primary">{saving ? 'Saving…' : 'Save settings'}</button>}
    </fieldset>
  )
}
