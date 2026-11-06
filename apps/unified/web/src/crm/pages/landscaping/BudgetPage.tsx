// Budget (landscaping parity row 27; LMN's budget → overhead recovery → markup; feature company_budget, not ready). Server:
// crm/landscaping/companyBudget.ts (/api/budgets), arithmetic in data/companyBudget.ts.
//   · the budgets by year — draft, active (locked) or archived; a new one, or a copy of one;
//   · a draft's settings (recovery method, profit, burdens, overtime, unbillable time, MORS markups) and its lines by section;
//   · what it gives: direct cost, overhead and its ratio, net profit, the cost of a field hour, revenue per man-hour, the
//     overhead markup per kind of cost, and the markup each kind of quote line gets;
//   · Make active (locks it) and Use for quotes (fills the quote form's markup defaults).
// Reading asks margin:read (the owner's figures); changing asks company:update.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Calculator, Loader2, Lock, Plus, Trash2, Copy } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite, useAuth } from '../../../shared'
import { companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock'

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const money = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }))
const money2 = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }))
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n}%`)

const SECTIONS: Array<{ id: string; label: string; hint: string; labor?: boolean }> = [
  { id: 'sales', label: 'Sales', hint: 'Expected sales by division (maintenance, design/build, irrigation, snow…).' },
  { id: 'labor', label: 'Field labour', hint: 'Each crew role: how many people, hours each in the year, and the hourly wage.', labor: true },
  { id: 'equipment', label: 'Equipment', hint: 'Owned, leased or rented equipment for the field: the year’s cost.' },
  { id: 'materials', label: 'Materials', hint: 'What you buy to install: the year’s cost.' },
  { id: 'subs', label: 'Subcontractors', hint: 'Work you pay others to do.' },
  { id: 'overhead', label: 'Overhead', hint: 'Rent, insurance, phones, software, office supplies…' },
  { id: 'overhead_wage', label: 'Overhead wages', hint: 'Office and management salaries — your own salary too.' },
]
const STATUS: Record<string, string> = { draft: 'Draft', active: 'Active', archived: 'Archived' }
const METHODS: Record<string, string> = {
  mors: 'MORS — fixed markups on materials, equipment and subs; the rest on labour',
  flh: 'FLH — a dollar amount added to every billable field hour',
  sors: 'SORS — one markup on every direct cost',
}
const KINDS: Array<[string, string]> = [['labor', 'Labour lines'], ['material', 'Material lines'], ['part', 'Part lines'], ['service', 'Service lines (subs)'], ['other', 'Other lines (equipment)']]

type Line = { section: string; name: string; amount?: number | null; count?: number | null; hours?: number | null; wage?: number | null; prevAmount?: number | null }
interface Budget {
  id: string; year: number; name: string; status: string; method: string; lines: Line[]
  profitPct: string; laborBurdenPct: string; overheadBurdenPct: string; overtimePct: string; overtimeMultiplier: string; unbillablePct: string
  materialsMarkupPct: string; equipmentMarkupPct: string; subsMarkupPct: string
  rates: {
    sales: number; fieldLabor: number; equipment: number; materials: number; subs: number; directCost: number; overhead: number; netProfit: number
    overheadRatio: number | null; revenuePerManHour: number | null; billableHours: number; avgLaborHour: number; flhPerHour: number | null; unrecovered: number
    overheadMarkup: { labor: number; materials: number; equipment: number; subs: number }; markupDefaults: Record<string, number>
  }
}
interface Row { id: string; year: number; name: string; status: string; method: string; sales: number; netProfit: number }

const NUMS = ['profitPct', 'laborBurdenPct', 'overheadBurdenPct', 'overtimePct', 'overtimeMultiplier', 'unbillablePct', 'materialsMarkupPct', 'equipmentMarkupPct', 'subsMarkupPct'] as const
const NUM_LABEL: Record<typeof NUMS[number], string> = {
  profitPct: 'Profit (% on cost and overhead)', laborBurdenPct: 'Field labour burden %', overheadBurdenPct: 'Overhead wage burden %',
  overtimePct: 'Hours at overtime %', overtimeMultiplier: 'Overtime multiplier', unbillablePct: 'Unbillable hours %',
  materialsMarkupPct: 'MORS: materials markup %', equipmentMarkupPct: 'MORS: equipment markup %', subsMarkupPct: 'MORS: subs markup %',
}
const toNum = (v: unknown) => (v === '' || v == null ? null : Number(v))

export default function BudgetPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const on = useAuth().hasFeature('company_budget')
  const mayEdit = useMayWrite('company:update')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [b, setB] = useState<Budget | null>(null)
  const [form, setForm] = useState<Record<string, any>>({})
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [newYear, setNewYear] = useState(String(Number(companyTodayKey().slice(0, 4)) + 1))

  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/budgets'); setRows(Array.isArray(r?.data) ? r.data : []) }
    catch (e) { toast.error(errorText(e, 'Could not load the budgets')); setRows([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const open = useCallback(async (id: string) => {
    try {
      const r = await api.get(`/api/budgets/${id}`) as Budget
      setB(r); setLines(Array.isArray(r.lines) ? r.lines : [])
      setForm({ name: r.name, method: r.method, ...Object.fromEntries(NUMS.map((k) => [k, String(Number(r[k]))])) })
    } catch (e) { toast.error(errorText(e, 'Could not open the budget')) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (on) load() }, [on, load])
  const draft = b?.status === 'draft' && mayEdit
  const bySection = useMemo(() => Object.fromEntries(SECTIONS.map((s) => [s.id, lines.map((l, i) => ({ l, i })).filter((x) => x.l.section === s.id)])), [lines])
  if (!on) return <div className="p-6 text-gray-600 dark:text-slate-300">The budget is not turned on for this business.</div>

  const create = async (copyFrom?: string) => {
    setBusy(true)
    try {
      const r = await api.post('/api/budgets', { year: Number(newYear), ...(copyFrom ? { copyFrom } : {}) }) as Budget
      toast.success(copyFrom ? 'Copied to a new draft' : 'Draft budget made'); await load(); await open(r.id)
    } catch (e) { toast.error(errorText(e, 'Could not make the budget')) }
    finally { setBusy(false) }
  }
  const save = async () => {
    if (!b) return
    setBusy(true)
    try {
      const body: Record<string, unknown> = { name: form.name, method: form.method, lines: lines.map((l) => ({ ...l, amount: toNum(l.amount), count: toNum(l.count), hours: toNum(l.hours), wage: toNum(l.wage), prevAmount: toNum(l.prevAmount) })) }
      for (const k of NUMS) body[k] = Number(form[k])
      const r = await api.put(`/api/budgets/${b.id}`, body) as Budget
      setB(r); toast.success('Budget saved'); await load()
    } catch (e) { toast.error(errorText(e, 'Could not save the budget')) }
    finally { setBusy(false) }
  }
  const activate = async () => {
    if (!b || !(await confirm(`It becomes ${b.year}’s budget and is locked — to change it later, copy it to a new draft. Any other active ${b.year} budget is archived.`, { title: 'Make this budget active?', confirmText: 'Make active' }))) return
    setBusy(true)
    try { const r = await api.post(`/api/budgets/${b.id}/activate`, {}) as Budget; setB(r); toast.success('Active and locked'); await load() }
    catch (e) { toast.error(errorText(e, 'Could not make it active')) }
    finally { setBusy(false) }
  }
  const applyMarkups = async () => {
    if (!b || !(await confirm('Your markup defaults change to the ones below. New quote lines with a cost fill them in; saved quotes do not change.', { title: 'Price quotes from this budget?', confirmText: 'Use for quotes' }))) return
    setBusy(true)
    try {
      const r: any = await api.post(`/api/budgets/${b.id}/apply-markups`, {})
      toast.success(r?.markupDefaultsOn ? 'Markup defaults updated — new quote lines use them' : 'Markup defaults saved — they fill quote lines once Markup Defaults is turned on')
    } catch (e) { toast.error(errorText(e, 'Could not set the markups')) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!b || !(await confirm('The draft and its lines are deleted.', { title: `Delete “${b.name}”?`, confirmText: 'Delete draft' }))) return
    try { await api.delete(`/api/budgets/${b.id}`); setB(null); toast.success('Draft deleted'); await load() }
    catch (e) { toast.error(errorText(e, 'Could not delete the draft')) }
  }
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const numInput = (i: number, l: Line, k: 'amount' | 'count' | 'hours' | 'wage' | 'prevAmount', label: string) => (
    <input className="input w-28" type="number" min={0} step="any" aria-label={`${l.name || 'Line'} ${label}`} placeholder={label} disabled={!draft}
      value={l[k] == null ? '' : String(l[k])} onChange={(e) => setLine(i, { [k]: e.target.value === '' ? null : Number(e.target.value) } as Partial<Line>)} />
  )
  const r = b?.rates

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1"><Calculator className="w-6 h-6" /> Budget</h1>
      <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">The year’s plan: what you expect to sell and spend, how overhead is recovered, and the markups your quotes need to hit it.</p>

      <div className="flex flex-wrap items-end gap-2 mb-4">
        {(rows || []).map((x) => (
          <button key={x.id} className={`btn ${b?.id === x.id ? 'btn-primary' : 'btn-secondary'}`} onClick={() => open(x.id)}>
            {x.status === 'active' && <Lock className="inline w-3.5 h-3.5 mr-1" />}{x.year} · {x.name} · {STATUS[x.status] || 'Draft'}
          </button>
        ))}
        {rows === null && <Loader2 className="w-4 h-4 animate-spin" />}
        {mayEdit && (
          <span className="flex items-end gap-2">
            <input className="input w-24" type="number" aria-label="Year" value={newYear} onChange={(e) => setNewYear(e.target.value)} />
            <button className="btn-secondary flex items-center gap-1" disabled={busy} onClick={() => create()}><Plus className="w-4 h-4" /> New budget</button>
          </span>
        )}
      </div>
      {rows?.length === 0 && <p className="text-gray-500 dark:text-slate-400 mb-4">No budget yet. Pick the year and start one.</p>}

      {b && r && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{b.year} · {STATUS[b.status] || 'Draft'}</span>
            {b.status !== 'draft' && <span className="text-xs text-gray-500 dark:text-slate-400">Locked — copy it to change it.</span>}
            {draft && <button className="btn-primary" disabled={busy} onClick={save}>Save</button>}
            {draft && <button className="btn-secondary" disabled={busy} onClick={activate}><Lock className="inline w-4 h-4 mr-1" />Make active</button>}
            {mayEdit && <button className="btn-secondary" disabled={busy} onClick={() => create(b.id)}><Copy className="inline w-4 h-4 mr-1" />Copy to a new draft for {newYear}</button>}
            {mayEdit && b.status === 'active' && <button className="btn-primary" disabled={busy} onClick={applyMarkups}>Use for quotes</button>}
            {draft && <button className="text-red-600 dark:text-red-400 text-sm" onClick={remove}><Trash2 className="inline w-4 h-4" /> Delete draft</button>}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">Name<input className="input w-full mt-1" disabled={!draft} value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="text-sm md:col-span-2">How overhead is recovered
              <select className="input w-full mt-1" disabled={!draft} value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            {NUMS.filter((k) => form.method === 'mors' || !k.endsWith('MarkupPct')).map((k) => (
              <label key={k} className="text-sm">{NUM_LABEL[k]}
                <input className="input w-full mt-1" type="number" min={0} step="any" disabled={!draft} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
          </div>

          {SECTIONS.map((s) => (
            <div key={s.id} className="rounded border p-3 dark:border-slate-700">
              <p className="font-medium">{s.label}</p>
              <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">{s.hint}</p>
              <div className="space-y-2">
                {bySection[s.id].map(({ l, i }) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input className="input flex-1 min-w-[10rem]" aria-label={`${s.label} line name`} placeholder="Name" disabled={!draft} value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} />
                    {s.labor ? <>{numInput(i, l, 'count', 'People')}{numInput(i, l, 'hours', 'Hours each')}{numInput(i, l, 'wage', 'Wage $/h')}</> : <>{numInput(i, l, 'amount', 'This year $')}{numInput(i, l, 'prevAmount', 'Last year $')}</>}
                    {draft && <button aria-label={`Remove ${l.name || 'line'}`} className="text-red-600 dark:text-red-400" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                ))}
                {draft && <button className="text-sm text-blue-700 dark:text-blue-300" onClick={() => setLines((ls) => [...ls, { section: s.id, name: '' }])}><Plus className="inline w-4 h-4" /> Add a line</button>}
              </div>
            </div>
          ))}

          <div className="rounded border p-4 dark:border-slate-700">
            <p className="font-medium mb-2">What it gives{draft ? ' (as last saved)' : ''}</p>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 md:grid-cols-3">
              <div><dt className="text-gray-500 dark:text-slate-400">Sales</dt><dd>{money(r.sales)}</dd></div>
              <div><dt className="text-gray-500 dark:text-slate-400">Direct cost (labour with burden, equipment, materials, subs)</dt><dd>{money(r.directCost)}</dd></div>
              <div><dt className="text-gray-500 dark:text-slate-400">Overhead</dt><dd>{money(r.overhead)}{r.overheadRatio != null ? ` · ${r.overheadRatio}% of sales` : ''}</dd></div>
              <div><dt className="text-gray-500 dark:text-slate-400">Net profit at these figures</dt><dd className={r.netProfit < 0 ? 'text-red-700 dark:text-red-400' : ''}>{money(r.netProfit)}</dd></div>
              <div><dt className="text-gray-500 dark:text-slate-400">A billable field hour costs (average)</dt><dd>{money2(r.avgLaborHour)}</dd></div>
              <div><dt className="text-gray-500 dark:text-slate-400">Revenue needed per billable hour</dt><dd>{money2(r.revenuePerManHour)}</dd></div>
              {r.flhPerHour != null && <div><dt className="text-gray-500 dark:text-slate-400">Overhead per billable hour (FLH)</dt><dd>{money2(r.flhPerHour)}</dd></div>}
              <div><dt className="text-gray-500 dark:text-slate-400">Overhead markup: labour · materials · equipment · subs</dt><dd>{pct(r.overheadMarkup.labor)} · {pct(r.overheadMarkup.materials)} · {pct(r.overheadMarkup.equipment)} · {pct(r.overheadMarkup.subs)}</dd></div>
            </dl>
            {r.unrecovered > 0 && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300" role="status">{money(r.unrecovered)} of overhead is not recovered: there is no field labour to carry it.</p>}
            <p className="font-medium mt-4 mb-1">Markup each kind of quote line gets (overhead, then profit)</p>
            <ul className="text-sm grid sm:grid-cols-2 md:grid-cols-5 gap-1">
              {KINDS.map(([k, label]) => <li key={k}><span className="text-gray-500 dark:text-slate-400">{label}:</span> {pct(r.markupDefaults[k])}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
