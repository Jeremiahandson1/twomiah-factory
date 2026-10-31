// Split billing (care_split_billing): who pays what share of a client's visits — payers in priority order, each a percent
// of the visit or an amount per hour, the family paying the rest. Invoices made after saving are divided into one per
// payer and one for the family; an invoice already made is not changed.
//   GET|PUT /api/care-split/clients/:id (server/crm/homecare/billing/splitRoutes.ts), GET /api/payers, GET /api/clients
import { useEffect, useMemo, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useMay } from '../lib/useMay'
import { money } from '@twomiah/tenant-ui/src/money'

type Kind = 'percent' | 'per_hour'
interface Row { payerId: string; kind: Kind; value: string }
interface Payer { id: string; name: string; isActivePayer?: boolean }
interface Client { id: string; firstName: string; lastName: string }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const MAX = 4

/** What each party pays of one visit, by the same rule the server bills with (core/splitBilling.ts). */
function example(rowsIn: Row[], amount: number, hours: number) {
  let left = Math.round(amount * 100)
  const out = rowsIn.map((r) => {
    const v = Number(r.value) || 0
    const want = r.kind === 'percent' ? Math.round(amount * 100 * v / 100) : Math.round(hours * v * 100)
    const take = Math.max(0, Math.min(want, left))
    left -= take
    return take / 100
  })
  return { shares: out, family: left / 100 }
}

export default function SplitBilling() {
  const may = useMay('care-billing')
  const toast = useToast()
  const [clients, setClients] = useState<Client[]>([])
  const [payers, setPayers] = useState<Payer[]>([])
  const [clientId, setClientId] = useState('')
  const [list, setList] = useState<Row[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    listAll('/api/clients').then((r) => setClients(rows<Client>(r))).catch((e) => toast.error(errorMessage(e, 'Could not load clients')))
    listAll('/api/payers').then((r) => setPayers(rows<Payer>(r).filter((p) => p.isActivePayer))).catch((e) => toast.error(errorMessage(e, 'Could not load payers')))
  }, [toast])
  useEffect(() => {
    if (!clientId) { setList(null); return }
    api.get(`/api/care-split/clients/${clientId}`)
      .then((r: any) => setList((r?.payers || []).map((p: any) => ({ payerId: p.payerId, kind: p.kind, value: String(p.value) }))))
      .catch((e) => toast.error(errorMessage(e)))
  }, [clientId, toast])

  const preview = useMemo(() => (list ? example(list, 100, 4) : null), [list])
  const nameOf = (id: string) => payers.find((p) => p.id === id)?.name || 'Payer'
  const set = (i: number, patch: Partial<Row>) => list && setList(list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, by: number) => {
    if (!list) return
    const j = i + by
    if (j < 0 || j >= list.length) return
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; setList(next)
  }
  const save = async () => {
    if (!list) return
    setSaving(true)
    try {
      await api.put(`/api/care-split/clients/${clientId}`, { payers: list.map((r) => ({ payerId: r.payerId, kind: r.kind, value: Number(r.value) })) })
      toast.success(list.length ? 'Split saved — the next invoices are divided this way' : 'Split removed')
    } catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <div className="p-4 max-w-3xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Split billing</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">When more than one party pays for a client&apos;s care: list the payers in the order they pay. Each pays a percent of every visit or a set amount per hour, never more than what is left of the visit, and the family pays the rest. Invoices made after you save are divided into one for each payer and one for the family. Invoices already made are not changed.</p>
      <select className={inp} aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
        <option value="">Choose a client…</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
      </select>

      {list && (
        <div className="mt-4 space-y-3">
          {list.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400">Not split: each invoice goes to the client&apos;s payer as usual.</p>}
          {list.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-lg border p-3 border-gray-200 dark:border-slate-700">
              <span className="text-sm font-semibold w-6">{i + 1}.</span>
              <label className="text-sm">Payer<br />
                <select className={inp} value={r.payerId} disabled={!may.update} onChange={(e) => set(i, { payerId: e.target.value })} aria-label={`Payer ${i + 1}`}>
                  <option value="">Choose…</option>
                  {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label className="text-sm">Pays<br />
                <select className={inp} value={r.kind} disabled={!may.update} onChange={(e) => set(i, { kind: e.target.value as Kind })} aria-label={`How payer ${i + 1} pays`}>
                  <option value="percent">a percent of each visit</option>
                  <option value="per_hour">an amount per hour</option>
                </select>
              </label>
              <label className="text-sm">{r.kind === 'percent' ? 'Percent' : 'Dollars per hour'}<br />
                <input type="number" min="0" step="0.01" max={r.kind === 'percent' ? 100 : undefined} className={`${inp} w-28`} value={r.value} disabled={!may.update}
                  onChange={(e) => set(i, { value: e.target.value })} aria-label={r.kind === 'percent' ? `Payer ${i + 1} percent` : `Payer ${i + 1} dollars per hour`} />
              </label>
              {may.update && (
                <div className="flex gap-1 ml-auto">
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move payer ${i + 1} up`}>↑</button>
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move payer ${i + 1} down`}>↓</button>
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setList(list.filter((_, j) => j !== i))}>Remove</button>
                </div>
              )}
            </div>
          ))}
          {may.update && list.length < MAX && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setList([...list, { payerId: '', kind: 'percent', value: '' }])}>Add a payer</button>}
          {preview && list.length > 0 && (
            <div className="rounded-lg p-3 text-sm bg-gray-50 dark:bg-slate-800/60" data-testid="split-example">
              <p className="font-semibold mb-1">On a 4-hour, {money(100)} visit</p>
              <ul className="list-disc pl-5">
                {list.map((r, i) => <li key={i}>{r.payerId ? nameOf(r.payerId) : `Payer ${i + 1}`}: {money(preview.shares[i])}</li>)}
                <li>The family: {money(preview.family)}</li>
              </ul>
            </div>
          )}
          {may.update && <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" onClick={save} disabled={saving}>Save split</button>}
        </div>
      )}
    </div>
  )
}
