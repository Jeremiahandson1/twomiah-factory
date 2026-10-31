// The store's customer segments at /crm/segments (parity row 2 against Shopify, 2026-10-31): save a group of customers by
// what they spent, how many orders they made and what they bought (or did not buy), over a period, then send a campaign
// (Marketing › New campaign › Who gets it) or a follow-up email to it.
//
// GET/POST/PUT/DELETE /api/admin/segments (server/crm/store/segments/routes.ts) — behind the store_segments feature and
// marketing:read, as this page's menu row is; saving is marketing:create / marketing:update and removing is
// marketing:delete (the page asks the same, and the server refuses a seat without it).
//   · a failed read or save says so in words — never a list that looks empty;
//   · the counts come from the server, from the same query a campaign's audience uses;
//   · deleting asks twice on the page (no native dialog); money is typed in dollars and sent as cents.
import { useCallback, useEffect, useState } from 'react'
import { Filter } from 'lucide-react'
import { api } from '../../../../api'
import { PageError, errorText, useMayWrite } from '../../../../shared'

type Period = { days: number } | { from: string; to?: string }
interface Pick { productIds?: string[]; categories?: string[] }
interface Definition { spend?: { minCents?: number; maxCents?: number }; orders?: { min?: number; max?: number }; period?: Period; bought?: Pick; notBought?: Pick }
interface Segment { id: string; name: string; definition: Definition; matching: number; emailable: number }
interface Choices { categories: string[]; products: { id: string; name: string }[] }
interface Preview { matching: number; emailable: number; sample: { id: string; name: string | null; email: string | null }[] }

const PERIODS = [{ key: 'all', label: 'All time' }, { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }, { key: '365', label: 'Last 12 months' }, { key: 'dates', label: 'Between two dates' }] as const
const toCents = (v: string) => (v.trim() === '' ? undefined : Math.round(Number(v.replace(/[^0-9.]/g, '')) * 100))
const toInt = (v: string) => (v.trim() === '' ? undefined : Math.floor(Number(v.replace(/[^0-9]/g, ''))))
const fromCents = (c?: number) => (c == null ? '' : (c / 100).toFixed(2))

interface Form { name: string; period: string; from: string; to: string; spendMin: string; spendMax: string; ordersMin: string; ordersMax: string; bought: Pick; notBought: Pick }
const blank = (): Form => ({ name: '', period: 'all', from: '', to: '', spendMin: '', spendMax: '', ordersMin: '', ordersMax: '', bought: {}, notBought: {} })
function formOf(s: Segment): Form {
  const d = s.definition, p = d.period as any
  return {
    name: s.name, period: p?.days ? String(p.days) : p?.from ? 'dates' : 'all', from: p?.from ?? '', to: p?.to ?? '',
    spendMin: fromCents(d.spend?.minCents), spendMax: fromCents(d.spend?.maxCents), ordersMin: d.orders?.min == null ? '' : String(d.orders.min), ordersMax: d.orders?.max == null ? '' : String(d.orders.max),
    bought: d.bought ?? {}, notBought: d.notBought ?? {},
  }
}
function definitionOf(f: Form): Definition {
  const d: Definition = {}
  const spend = { minCents: toCents(f.spendMin), maxCents: toCents(f.spendMax) }
  if (spend.minCents != null || spend.maxCents != null) d.spend = Object.fromEntries(Object.entries(spend).filter(([, v]) => v != null))
  const orders = { min: toInt(f.ordersMin), max: toInt(f.ordersMax) }
  if (orders.min != null || orders.max != null) d.orders = Object.fromEntries(Object.entries(orders).filter(([, v]) => v != null))
  if (f.period === 'dates' && f.from) d.period = { from: f.from, ...(f.to ? { to: f.to } : {}) }
  else if (['30', '90', '365'].includes(f.period)) d.period = { days: Number(f.period) }
  const pick = (p: Pick): Pick | undefined => (p.productIds?.length || p.categories?.length ? { ...(p.productIds?.length ? { productIds: p.productIds } : {}), ...(p.categories?.length ? { categories: p.categories } : {}) } : undefined)
  if (pick(f.bought)) d.bought = pick(f.bought)
  if (pick(f.notBought)) d.notBought = pick(f.notBought)
  return d
}

/** In plain words, what a saved segment asks. */
function describe(d: Definition, choices: Choices | null): string {
  const bits: string[] = []
  const money = (c: number) => `$${(c / 100).toFixed(2)}`
  if (d.spend?.minCents != null && d.spend?.maxCents != null) bits.push(`spent ${money(d.spend.minCents)} to ${money(d.spend.maxCents)}`)
  else if (d.spend?.minCents != null) bits.push(`spent ${money(d.spend.minCents)} or more`)
  else if (d.spend?.maxCents != null) bits.push(`spent ${money(d.spend.maxCents)} or less`)
  if (d.orders?.min != null && d.orders?.max != null) bits.push(`${d.orders.min} to ${d.orders.max} orders`)
  else if (d.orders?.min != null) bits.push(`${d.orders.min} or more orders`)
  else if (d.orders?.max != null) bits.push(`${d.orders.max} or fewer orders`)
  const names = (p?: Pick) => [...(p?.productIds ?? []).map((id) => choices?.products.find((x) => x.id === id)?.name ?? 'a product that is gone'), ...(p?.categories ?? []).map((c) => `anything in ${c}`)].join(', ')
  if (d.bought && (d.bought.productIds?.length || d.bought.categories?.length)) bits.push(`bought ${names(d.bought)}`)
  if (d.notBought && (d.notBought.productIds?.length || d.notBought.categories?.length)) bits.push(`did not buy ${names(d.notBought)}`)
  const p = d.period as any
  const when = p?.days ? ` in the last ${p.days} days` : p?.from ? ` from ${p.from}${p.to ? ` to ${p.to}` : ''}` : ''
  return bits.length ? `Customers who ${bits.join(' and ')}${when}.` : 'Nothing chosen yet.'
}

function Chooser({ legend, value, onChange, choices }: { legend: string; value: Pick; onChange: (p: Pick) => void; choices: Choices }) {
  const toggle = (key: 'productIds' | 'categories', item: string) => {
    const cur = value[key] ?? []
    onChange({ ...value, [key]: cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item] })
  }
  return (
    <fieldset className="border border-gray-200 dark:border-slate-700 rounded-lg p-3">
      <legend className="px-1 text-sm font-medium text-gray-700 dark:text-slate-300">{legend}</legend>
      {choices.categories.length > 0 && <div className="flex flex-wrap gap-x-4 gap-y-1">{choices.categories.map((c) => (
        <label key={c} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300"><input type="checkbox" checked={(value.categories ?? []).includes(c)} onChange={() => toggle('categories', c)} /> Anything in {c}</label>
      ))}</div>}
      <div className="mt-2 max-h-40 overflow-y-auto grid gap-1 sm:grid-cols-2">{choices.products.map((p) => (
        <label key={p.id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300"><input type="checkbox" checked={(value.productIds ?? []).includes(p.id)} onChange={() => toggle('productIds', p.id)} /> {p.name}</label>
      ))}</div>
      {choices.categories.length === 0 && choices.products.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">Add products first.</p>}
    </fieldset>
  )
}

function Editor({ segment, choices, onSaved, onCancel, onError }: { segment: Segment | null; choices: Choices; onSaved: () => void; onCancel: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState<Form>(segment ? formOf(segment) : blank())
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<Form>) => { setForm((f) => ({ ...f, ...patch })); setPreview(null) }
  const field = 'input mt-1 w-full'
  const look = async () => {
    onError(''); setBusy(true)
    try { setPreview((await api.post('/api/admin/segments/preview', { definition: definitionOf(form) })) as Preview) } catch (e) { onError(errorText(e, "Couldn't work out who is in it")) } finally { setBusy(false) }
  }
  const save = async () => {
    onError(''); setBusy(true)
    try {
      const body = { name: form.name, definition: definitionOf(form) }
      if (segment) await api.put(`/api/admin/segments/${segment.id}`, body)
      else await api.post('/api/admin/segments', body)
      onSaved()
    } catch (e) { onError(errorText(e, "Couldn't save the segment")) } finally { setBusy(false) }
  }
  return (
    <section className="card p-4 sm:p-6 space-y-4" aria-label={segment ? `Change ${segment.name}` : 'New segment'}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{segment ? 'Change this segment' : 'New segment'}</h2>
      <label className="block text-sm text-gray-700 dark:text-slate-300">Name
        <input className={field} value={form.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Best customers" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm text-gray-700 dark:text-slate-300">Over which days
          <select className={field} value={form.period} onChange={(e) => set({ period: e.target.value })}>{PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select></label>
        {form.period === 'dates' && <div className="grid grid-cols-2 gap-3">
          <label className="text-sm text-gray-700 dark:text-slate-300">From<input type="date" className={field} value={form.from} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="text-sm text-gray-700 dark:text-slate-300">To<input type="date" className={field} value={form.to} onChange={(e) => set({ to: e.target.value })} /></label>
        </div>}
        <label className="text-sm text-gray-700 dark:text-slate-300">Spent at least ($)<input className={field} inputMode="decimal" value={form.spendMin} onChange={(e) => set({ spendMin: e.target.value })} /></label>
        <label className="text-sm text-gray-700 dark:text-slate-300">Spent at most ($)<input className={field} inputMode="decimal" value={form.spendMax} onChange={(e) => set({ spendMax: e.target.value })} /></label>
        <label className="text-sm text-gray-700 dark:text-slate-300">At least this many orders<input className={field} inputMode="numeric" value={form.ordersMin} onChange={(e) => set({ ordersMin: e.target.value })} /></label>
        <label className="text-sm text-gray-700 dark:text-slate-300">At most this many orders<input className={field} inputMode="numeric" value={form.ordersMax} onChange={(e) => set({ ordersMax: e.target.value })} /></label>
      </div>
      <p className="text-xs text-gray-500 dark:text-slate-400">What they spent is what they paid less what went back. Someone who never ordered has spent $0 and made 0 orders, so ask for at least 1 order to leave them out.</p>
      <Chooser legend="Bought any of these" value={form.bought} onChange={(p) => set({ bought: p })} choices={choices} />
      <Chooser legend="Did not buy any of these" value={form.notBought} onChange={(p) => set({ notBought: p })} choices={choices} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void look()}>See who is in it</button>
        <button type="button" className="btn-primary" disabled={busy || !form.name.trim()} onClick={() => void save()}>{segment ? 'Save changes' : 'Save segment'}</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
      {preview && (
        <div role="status" className="text-sm text-gray-900 dark:text-slate-100">
          <p><strong>{preview.matching}</strong> {preview.matching === 1 ? 'customer matches' : 'customers match'}; <strong>{preview.emailable}</strong> can be emailed (they have an address and have not unsubscribed).</p>
          {preview.sample.length > 0 && <p className="mt-1 text-gray-600 dark:text-slate-400">For example: {preview.sample.map((p) => p.name || p.email).join(', ')}.</p>}
        </div>
      )}
    </section>
  )
}

export default function SegmentsPage() {
  const mayCreate = useMayWrite('marketing:create')
  const mayChange = useMayWrite('marketing:update')
  const mayDelete = useMayWrite('marketing:delete')
  const [rows, setRows] = useState<Segment[] | null>(null)
  const [choices, setChoices] = useState<Choices | null>(null)
  const [editing, setEditing] = useState<Segment | 'new' | null>(null)
  const [sure, setSure] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    try {
      const [list, ch] = await Promise.all([api.get('/api/admin/segments'), api.get('/api/admin/segments/choices')])
      setRows((list as { data: Segment[] }).data); setChoices(ch as Choices); setLoadError('')
    } catch (e) { setLoadError(errorText(e, "Couldn't load your segments")) }
  }, [])
  useEffect(() => { void load() }, [load])
  const remove = async (s: Segment) => {
    setError('')
    try { await api.delete('/api/admin/segments', s.id); setSure(''); await load() } catch (e) { setError(errorText(e, "Couldn't remove it")); setSure('') }
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Filter className="h-6 w-6" aria-hidden="true" />Segments</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Save a group of customers by what they spent, how often they ordered and what they bought. Then choose it when you send a campaign or set up a follow-up email.</p>
        </div>
        {mayCreate && editing === null && choices && <button type="button" className="btn-primary" onClick={() => setEditing('new')}>New segment</button>}
      </div>
      {error && <PageError message={error} />}
      {editing !== null && choices && <Editor segment={editing === 'new' ? null : editing} choices={choices} onSaved={() => { setEditing(null); void load() }} onCancel={() => setEditing(null)} onError={setError} />}
      {loadError ? <PageError message={`${loadError} — refresh to try again.`} /> : rows === null ? <p className="text-gray-500 dark:text-slate-400">Loading…</p> : rows.length === 0 ? (
        <p className="text-gray-500 dark:text-slate-400">No segments yet. Try “customers who spent $200 or more” or “bought the feeder but never the seed”.</p>
      ) : (
        <ul className="space-y-3">{rows.map((s) => (
          <li key={s.id} className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{s.name}</h2>
              <p className="text-sm text-gray-700 dark:text-slate-300">{s.matching} {s.matching === 1 ? 'customer' : 'customers'} · {s.emailable} can be emailed</p>
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{describe(s.definition, choices)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {mayChange && choices && <button type="button" className="btn-secondary text-sm" onClick={() => setEditing(s)}>Change</button>}
              {mayDelete && (sure === s.id
                ? <><button type="button" className="btn-secondary text-sm" onClick={() => void remove(s)}>Yes, remove {s.name}</button><button type="button" className="btn-secondary text-sm" onClick={() => setSure('')}>Keep it</button></>
                : <button type="button" className="btn-secondary text-sm" onClick={() => setSure(s.id)}>Remove</button>)}
            </div>
          </li>
        ))}</ul>
      )}
    </div>
  )
}
