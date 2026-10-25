// Loyalty tiers on the salon's screens (server crm/salon/loyalty.ts; the rule is the shared engine's tierFor): the
// tier badge, a client's standing on their chart and on the sale at checkout, and the tier editor in Loyalty › Settings.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Award, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useAuth, usePermissions } from '../../../shared'

export interface Tier { name: string; minPoints: number; multiplier: number; perk?: string }
export interface Standing { tier: Tier | null; next: Tier | null; pointsToNext: number | null; multiplier: number }
interface ClientLoyalty {
  enabled: boolean
  tiers: Tier[]
  member: null | { id: string; pointsBalance: number; lifetimePoints: number; tier: Standing }
}

const fieldClass = 'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

/** "Gold · 2× points" — the tier and what it earns at; "Member" below the first tier. */
export function TierBadge({ standing }: { standing?: Standing | null }) {
  const t = standing?.tier
  if (!t) return <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-slate-800 dark:text-slate-200">Member</span>
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" data-testid="tier-badge">
      <Award className="h-3 w-3" aria-hidden="true" />{t.name}{t.multiplier > 1 ? ` · ${t.multiplier}× points` : ''}
    </span>
  )
}

/** The words under a standing: the perk, and how far to the next tier. */
export function TierNote({ standing }: { standing?: Standing | null }) {
  if (!standing) return null
  const parts: string[] = []
  if (standing.tier?.perk) parts.push(`Perk: ${standing.tier.perk}`)
  if (standing.next && standing.pointsToNext != null) parts.push(`${standing.pointsToNext.toLocaleString()} more points to ${standing.next.name}`)
  return parts.length ? <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">{parts.join(' · ')}</p> : null
}

/**
 * A client's loyalty standing (GET /api/loyalty/contacts/:id): on their chart, and on a salon sale at checkout. Shown
 * only with the Loyalty Program on and loyalty:read held — the API's own door.
 */
export function ClientLoyaltyCard({ contactId, compact = false }: { contactId?: string | null; compact?: boolean }) {
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const [data, setData] = useState<ClientLoyalty | null>(null)
  const show = !!contactId && hasFeature('loyalty_rewards') && known && can('loyalty:read')
  useEffect(() => {
    if (!show) return
    let live = true
    api.get(`/api/loyalty/contacts/${contactId}`).then((d: ClientLoyalty) => { if (live) setData(d) }).catch(() => { if (live) setData(null) })
    return () => { live = false }
  }, [contactId, show])
  if (!show || !data || data.enabled === false) return null
  const m = data.member
  return (
    <section aria-label="Loyalty" className={`rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900 ${compact ? 'p-4' : 'p-4 mt-4'}`} data-testid="client-loyalty">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Loyalty</h2>
        {m && <TierBadge standing={m.tier} />}
      </div>
      {m ? (
        <>
          <p className="mt-2 text-sm text-gray-700 dark:text-slate-200"><span className="font-semibold tabular-nums">{m.pointsBalance.toLocaleString()}</span> points to spend · {m.lifetimePoints.toLocaleString()} earned to date</p>
          <TierNote standing={m.tier} />
        </>
      ) : (
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Not on the program yet — they join the first time a visit is completed.</p>
      )}
      {!compact && <Link to="/crm/loyalty" className="mt-2 inline-block text-sm font-medium text-pink-700 hover:underline dark:text-pink-300">Open Loyalty</Link>}
    </section>
  )
}

export type TierRow = { name: string; minPoints: string; multiplier: string; perk: string }
export const tierRowsFrom = (tiers?: Tier[] | null): TierRow[] => (tiers || []).map((t) => ({ name: t.name, minPoints: String(t.minPoints), multiplier: String(t.multiplier), perk: t.perk || '' }))
export const tiersFromRows = (rows: TierRow[]) => rows.filter((r) => r.name.trim() || r.minPoints.trim()).map((r) => ({
  name: r.name.trim(), minPoints: Math.floor(Number(r.minPoints)), multiplier: Number(r.multiplier || 1), perk: r.perk.trim(),
}))

/** Loyalty › Settings: up to five tiers, each a name, the lifetime points that reach it, its multiplier and a perk. */
export function TierEditor({ rows, onChange }: { rows: TierRow[]; onChange: (rows: TierRow[]) => void }) {
  const set = (i: number, k: keyof TierRow, v: string) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))
  return (
    <div className="space-y-3" data-testid="tier-editor">
      {rows.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-300">No tiers — every member earns at the same rate.</p>}
      {rows.map((r, i) => (
        <fieldset key={i} className="rounded-lg border border-gray-200 p-3 dark:border-slate-700">
          <legend className="px-1 text-xs font-medium text-gray-600 dark:text-slate-300">Tier {i + 1}</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-sm text-gray-700 dark:text-slate-300">Name
              <input value={r.name} onChange={(e) => set(i, 'name', e.target.value)} placeholder={i === 0 ? 'Silver' : 'Gold'} className={fieldClass} />
            </label>
            <label className="text-sm text-gray-700 dark:text-slate-300">From (points earned to date)
              <input type="number" min="1" inputMode="numeric" value={r.minPoints} onChange={(e) => set(i, 'minPoints', e.target.value)} placeholder={i === 0 ? '500' : '1500'} className={fieldClass} />
            </label>
            <label className="text-sm text-gray-700 dark:text-slate-300">Points multiplier
              <input type="number" min="1" max="5" step="0.25" inputMode="decimal" value={r.multiplier} onChange={(e) => set(i, 'multiplier', e.target.value)} placeholder="1.5" className={fieldClass} />
            </label>
          </div>
          <label className="mt-2 block text-sm text-gray-700 dark:text-slate-300">Perk (optional)
            <input value={r.perk} onChange={(e) => set(i, 'perk', e.target.value)} placeholder="Free deep-conditioning with every colour" className={fieldClass} />
          </label>
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="mt-2 inline-flex items-center gap-1 text-sm text-red-700 hover:underline dark:text-red-300">
            <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove tier
          </button>
        </fieldset>
      ))}
      {rows.length < 5 && (
        <button type="button" onClick={() => onChange([...rows, { name: '', minPoints: '', multiplier: '1', perk: '' }])} className="inline-flex items-center gap-1 text-sm font-medium text-pink-700 hover:underline dark:text-pink-300">
          <Plus className="h-4 w-4" aria-hidden="true" /> Add a tier
        </button>
      )}
    </div>
  )
}
