// Moved from templates/crm-landscaping/frontend/src/pages/landscaping/SnowBillingPage.tsx.
import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { formatDate } from '../../date'
import { Plus, Trash2, Snowflake, Loader2, CloudSnow } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, useMayWrite } from '../../../shared'
import { SitePicker, useSites } from './SitePicker'
import { money } from '@twomiah/tenant-ui/src/money'

const MODES = [
  { value: 'per_push', label: 'Per Push' },
  { value: 'per_event', label: 'Per Event' },
  { value: 'per_inch', label: 'Per Inch' },
  { value: 'seasonal', label: 'Seasonal' },
]

type RateField = 'perPushRate' | 'perEventRate' | 'perInchRate' | 'seasonalRate'

/**
 * Which rate the contract is actually billed by (T41). Mirrors MODE_RATE in server/crm/landscaping/snowBilling.ts, which
 * refuses a contract whose own rate is blank or zero; the form says WHICH box matters and catches it here first.
 */
const MODE_RATE: Record<string, { field: RateField; label: string }> = {
  per_push: { field: 'perPushRate', label: 'Per push' },
  per_event: { field: 'perEventRate', label: 'Per event' },
  per_inch: { field: 'perInchRate', label: 'Per inch' },
  seasonal: { field: 'seasonalRate', label: 'Seasonal' },
}

type ContractForm = Record<RateField, string> & { siteId: string; billingMode: string; triggerDepthInches: string; saltRate: string; notes: string }

const EMPTY_CONTRACT: ContractForm = {
  siteId: '', billingMode: 'per_push', perPushRate: '', perEventRate: '', perInchRate: '',
  seasonalRate: '', triggerDepthInches: '2', saltRate: '', notes: '',
}

type EventForm = { pushes: string; snowfallInches: string; saltApplied: boolean; billBelowTrigger: boolean; notes: string }
const EMPTY_EVENT: EventForm = { pushes: '1', snowfallInches: '', saltApplied: false, billBelowTrigger: false, notes: '' }

/** A row of GET /api/snow/contracts: the contract and the site it covers. Rates are decimal strings. */
interface Contract {
  id: string;
  siteId: string;
  siteName?: string | null;
  siteAddress?: string | null;
  billingMode: string;
  triggerDepthInches: string | number;
}

/** A row of GET /api/snow/summary. */
interface ContractSummary { contractId: string; events: number; unbilledTotal: number }

/** A row of GET /api/snow/events: the visit, and whether it fell below its contract's trigger in force now. */
interface SnowEvent {
  id: string;
  servicedAt: string;
  pushes: number;
  snowfallInches: string | number;
  saltApplied: boolean;
  billBelowTrigger: boolean;
  billableAmount: string | number;
  belowTrigger?: boolean;
  triggerDepthInches?: string | number | null;
}

/** The server's own words when it refused (the API client puts its `error` on `.message`), else the fallback. */
const serverMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback

const dollars = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Every field keeps its name visible next to the box — a placeholder disappears as soon as the operator types.
// (Landscaping T14 M8)
function Field({ id, label, children, className = '' }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

export default function SnowBillingPage() {
  const toast = useToast()
  const confirm = useConfirm()
  /**
   * The menu keeps a seat without invoices:read off this page. These are for the seat that gets in and still cannot do
   * everything — the manager holds invoices:read/create/update and not invoices:delete (T41):
   *   New Contract, Log Event, Bill   invoices:create
   *   Delete                           invoices:delete
   * Logging a storm visit stays an office act, deliberately: logging a push stores a billable amount from the shop's
   * rates. (T41)
   */
  const mayBill = useMayWrite('invoices:create')
  const mayDelete = useMayWrite('invoices:delete')
  const [contracts, setContracts] = useState<Contract[]>([])
  const [summary, setSummary] = useState<ContractSummary[]>([])
  const [events, setEvents] = useState<SnowEvent[]>([])
  const [selected, setSelected] = useState<Contract | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ContractForm>(EMPTY_CONTRACT)
  const [evForm, setEvForm] = useState<EventForm>(EMPTY_EVENT)
  const [billing, setBilling] = useState<string | null>(null)
  const { sites, reloadSites } = useSites()

  const load = async () => {
    try {
      // Both are list replies ({ data, pagination }), every row in one page.
      const [c, s] = await Promise.all([api.get('/api/snow/contracts'), api.get('/api/snow/summary')])
      setContracts(Array.isArray(c?.data) ? (c.data as Contract[]) : [])
      setSummary(Array.isArray(s?.data) ? (s.data as ContractSummary[]) : [])
    } catch (error) { toast.error(serverMessage(error, 'Failed to load snow contracts')) }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const openContract = async (ct: Contract) => {
    setSelected(ct)
    try {
      const res = await api.get('/api/snow/events', { contractId: ct.id })
      setEvents(Array.isArray(res?.data) ? (res.data as SnowEvent[]) : [])
    } catch { setEvents([]) }
  }

  const needed = MODE_RATE[form.billingMode]

  const createContract = async () => {
    if (!form.siteId) { toast.error('Pick the property this contract covers'); return }
    if (needed && !(Number(form[needed.field]) > 0)) {
      toast.error(`This contract is billed ${needed.label.toLowerCase()}, so set the "${needed.label} ($)" rate above zero.`)
      return
    }
    try {
      await api.post('/api/snow/contracts', form)
      toast.success('Contract created')
      setShowForm(false); setForm(EMPTY_CONTRACT); load()
    } catch (error) { toast.error(serverMessage(error, 'Failed to create contract')) }
  }

  const removeContract = async (id: string) => {
    if (!(await confirm('Its logged visits go with it.', { title: 'Delete this contract?', confirmText: 'Delete contract' }))) return
    try { await api.delete(`/api/snow/contracts/${id}`); toast.success('Deleted'); setSelected(null); load() }
    catch (error) { toast.error(serverMessage(error, 'Failed to delete')) }
  }

  /**
   * Is the visit being typed RIGHT NOW below this contract's trigger depth? (T58d) Only once a depth is entered: an
   * empty box means "not measured", and the server treats that the same way.
   */
  const triggerIn = Number(selected?.triggerDepthInches)
  const typedIn = Number(evForm.snowfallInches)
  const belowTriggerNow = Number.isFinite(triggerIn) && triggerIn > 0 && Number.isFinite(typedIn) && typedIn > 0 && typedIn < triggerIn

  const logEvent = async () => {
    if (!selected) return
    // The measure this contract's charge is calculated from; without it the server refuses the visit. (T41)
    if (!evForm.saltApplied) {
      if (selected.billingMode === 'per_push' && !(Number(evForm.pushes) > 0)) {
        toast.error('This contract is billed per push — enter how many pushes, or tick Salt applied if that is all that was done.')
        return
      }
      if (selected.billingMode === 'per_inch' && !(Number(evForm.snowfallInches) > 0)) {
        toast.error('This contract is billed per inch — enter the snowfall, or tick Salt applied if that is all that was done.')
        return
      }
    }
    try {
      const res = await api.post('/api/snow/events', { snowContractId: selected.id, ...evForm }) as { billableAmount: string | number }
      toast.success(`Logged — billed ${money(Number(res.billableAmount))}`)
      setEvForm(EMPTY_EVENT)
      openContract(selected); load()
    } catch (error) { toast.error(serverMessage(error, 'Failed to log event')) }
  }

  // Unbilled visits → one draft invoice to the site's customer (T14 H5: the charge had no way to be billed).
  const billContract = async (ct: Contract, amount: number) => {
    const ok = await confirm(`A draft invoice for the ${money(amount)} of unbilled snow visits at ${ct.siteName || 'this site'}. Review and send it from Invoices.`,
      { title: 'Bill these visits?', confirmText: 'Create draft invoice', danger: false })
    if (!ok) return
    setBilling(ct.id)
    try {
      const res = await api.post(`/api/snow/contracts/${ct.id}/bill`, {}) as { invoice?: { number?: string }; billedVisits: number }
      toast.success(`Draft invoice ${res.invoice?.number} created for ${res.billedVisits} visit${res.billedVisits === 1 ? '' : 's'} — review and send it from Invoices`)
      if (selected?.id === ct.id) openContract(ct)
      load()
    } catch (error) { toast.error(serverMessage(error, 'Failed to bill this contract')) }
    finally { setBilling(null) }
  }

  const sumFor = (id: string): Partial<ContractSummary> => summary.find((s) => s.contractId === id) || {}

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Snowflake className="w-6 h-6" /> Snow &amp; Ice Billing</h1>
          <p className="text-gray-500 text-sm dark:text-slate-400">Per-push, per-event, per-inch, or seasonal — log storms and the charge is computed automatically.</p>
        </div>
        {mayBill && <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2"><Plus className="w-4 h-4" /> New Contract</button>}
      </div>

      {showForm && (
        <div className="bg-white border dark:border-slate-700 rounded-lg p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 dark:bg-slate-900">
          <Field id="snow-site" label="Property" className="col-span-2">
            <SitePicker id="snow-site" value={form.siteId} sites={sites} onAdded={reloadSites} onChange={(siteId) => setForm({ ...form, siteId })} />
          </Field>
          <Field id="snow-mode" label="Billing mode">
            <select id="snow-mode" className="input w-full" value={form.billingMode} onChange={(e) => setForm({ ...form, billingMode: e.target.value })}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field id="snow-per-push" label="Per push ($)">
            <input id="snow-per-push" className="input w-full" type="number" placeholder="Per-push $" value={form.perPushRate} onChange={(e) => setForm({ ...form, perPushRate: e.target.value })} />
          </Field>
          <Field id="snow-per-event" label="Per event ($)">
            <input id="snow-per-event" className="input w-full" type="number" placeholder="Per-event $" value={form.perEventRate} onChange={(e) => setForm({ ...form, perEventRate: e.target.value })} />
          </Field>
          <Field id="snow-per-inch" label="Per inch ($)">
            <input id="snow-per-inch" className="input w-full" type="number" placeholder="Per-inch $" value={form.perInchRate} onChange={(e) => setForm({ ...form, perInchRate: e.target.value })} />
          </Field>
          <Field id="snow-seasonal" label="Seasonal ($)">
            <input id="snow-seasonal" className="input w-full" type="number" placeholder="Seasonal $" value={form.seasonalRate} onChange={(e) => setForm({ ...form, seasonalRate: e.target.value })} />
          </Field>
          <Field id="snow-trigger" label="Trigger depth (in)">
            <input id="snow-trigger" className="input w-full" type="number" placeholder="Trigger depth in" value={form.triggerDepthInches} onChange={(e) => setForm({ ...form, triggerDepthInches: e.target.value })} />
          </Field>
          <Field id="snow-salt" label="Salt ($)">
            <input id="snow-salt" className="input w-full" type="number" placeholder="Salt $" value={form.saltRate} onChange={(e) => setForm({ ...form, saltRate: e.target.value })} />
          </Field>
          {/* Four rate boxes, one of which the invoice is actually calculated from. Say which. (T41) */}
          {needed && (
            <p className="col-span-2 md:col-span-4 text-xs text-gray-600 dark:text-slate-400">
              Billed <strong>{needed.label.toLowerCase()}</strong>, so <strong>{needed.label} ($)</strong> is required — the other rates can stay blank.
              Salt is charged on top in every mode.
            </p>
          )}
          <button onClick={createContract} className="btn-primary col-span-2">Create Contract</button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3 min-w-0">
          <h2 className="font-semibold">Contracts</h2>
          {contracts.map((ct) => {
            const sm = sumFor(ct.id)
            const unbilled = Number(sm.unbilledTotal || 0)
            return (
              <div key={ct.id} role="button" tabIndex={0} onClick={() => openContract(ct)} onKeyDown={(e) => { if (e.key === 'Enter') openContract(ct) }}
                className={`border dark:border-slate-700 rounded-lg p-4 bg-white cursor-pointer hover:shadow ${selected?.id === ct.id ? 'ring-2 ring-orange-500' : ''} dark:bg-slate-900`}>
                <div className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{ct.siteName || ct.siteId}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{ct.siteAddress}</div>
                    <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded dark:text-blue-300 dark:bg-blue-950/40">{MODES.find((m) => m.value === ct.billingMode)?.label}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-green-700 dark:text-green-300">{money(unbilled)}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">unbilled • {sm.events || 0} events</div>
                    {unbilled > 0 && mayBill && (
                      <button onClick={(e) => { e.stopPropagation(); billContract(ct, unbilled) }} disabled={billing === ct.id}
                        className="btn-primary btn-sm mt-1 mr-2 disabled:opacity-50">
                        {billing === ct.id ? 'Billing…' : `Bill ${money(unbilled)}`}
                      </button>
                    )}
                    {mayDelete && <button onClick={(e) => { e.stopPropagation(); removeContract(ct.id) }} className="text-red-500 mt-1 dark:text-red-400" aria-label="Delete contract"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
              </div>
            )
          })}
          {contracts.length === 0 && <p className="text-gray-500 dark:text-slate-400 text-sm">No snow contracts yet.</p>}
        </div>

        <div className="min-w-0">
          {selected ? (
            <div className="bg-white border dark:border-slate-700 rounded-lg p-5 dark:bg-slate-900">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><CloudSnow className="w-5 h-5" /> Log Storm Visit</h2>
              <div className="grid grid-cols-2 gap-2">
                <Field id="snow-pushes" label="Pushes">
                  <input id="snow-pushes" className="input w-full" type="number" placeholder="Pushes" value={evForm.pushes} onChange={(e) => setEvForm({ ...evForm, pushes: e.target.value })} />
                </Field>
                <Field id="snow-inches" label="Snowfall (in)">
                  <input id="snow-inches" className="input w-full" type="number" placeholder="Snowfall in." value={evForm.snowfallInches} onChange={(e) => setEvForm({ ...evForm, snowfallInches: e.target.value })} />
                </Field>
                <label className="flex items-center gap-2 text-sm col-span-2">
                  <input type="checkbox" checked={evForm.saltApplied} onChange={(e) => setEvForm({ ...evForm, saltApplied: e.target.checked })} /> Salt applied
                </label>
                {/* Shown only when this visit IS below the trigger: below it, ploughing is not charged unless the customer
                    asked for the push. Salt is charged either way. (T58d) */}
                {belowTriggerNow && (
                  <label className="flex items-start gap-2 text-sm col-span-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
                    <input type="checkbox" className="mt-0.5" checked={evForm.billBelowTrigger} onChange={(e) => setEvForm({ ...evForm, billBelowTrigger: e.target.checked })} />
                    <span className="text-amber-900 dark:text-amber-200">
                      <strong>{Number(evForm.snowfallInches)}&quot; is below this contract&apos;s {Number(selected.triggerDepthInches)}&quot; trigger.</strong>{' '}
                      Ploughing is not charged below the trigger. Tick to bill it anyway — a push the customer asked for.
                      {evForm.saltApplied ? ' Salt is charged either way.' : ''}
                    </span>
                  </label>
                )}
                <Field id="snow-notes" label="Notes" className="col-span-2">
                  <input id="snow-notes" className="input w-full" placeholder="Notes" value={evForm.notes} onChange={(e) => setEvForm({ ...evForm, notes: e.target.value })} />
                </Field>
              </div>
              {mayBill && <button onClick={logEvent} className="btn-primary mt-3 w-full">Log Event</button>}

              <h3 className="font-semibold mt-5 mb-2 text-sm">Recent Events</h3>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {events.map((ev) => (
                  <div key={ev.id} className="flex justify-between gap-2 text-sm border-b dark:border-slate-700 py-1.5">
                    {/* A salt-only run has no pushes and no snowfall; it reads "salt", not "0 push · 0"". */}
                    <span>{[
                      formatDate(ev.servicedAt),
                      Number(ev.pushes) > 0 ? `${ev.pushes} push` : '',
                      Number(ev.snowfallInches) > 0 ? `${Number(ev.snowfallInches)}"` : '',
                      ev.saltApplied ? 'salt' : '',
                    ].filter(Boolean).join(' · ')}</span>
                    <span className="font-semibold flex items-center gap-2">
                      {/* Say WHICH $0 this is. (T58d) */}
                      {ev.belowTrigger && !ev.billBelowTrigger && (
                        <span className="font-normal text-xs text-amber-700 dark:text-amber-300">below {Number(ev.triggerDepthInches)}&quot; trigger</span>
                      )}
                      {ev.belowTrigger && ev.billBelowTrigger && (
                        <span className="font-normal text-xs text-gray-500 dark:text-slate-400">below trigger · billed on request</span>
                      )}
                      {money(Number(ev.billableAmount))}
                    </span>
                  </div>
                ))}
                {events.length === 0 && <p className="text-gray-500 dark:text-slate-400 text-sm">No events logged.</p>}
              </div>
            </div>
          ) : (
            <div className="border border-dashed dark:border-slate-700 rounded-lg p-8 text-center text-gray-500 dark:text-slate-400">Select a contract to log storm visits.</div>
          )}
        </div>
      </div>
    </div>
  )
}
