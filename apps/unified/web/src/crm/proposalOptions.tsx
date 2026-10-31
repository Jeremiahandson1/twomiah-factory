// Good / Better / Best beside a quote (server: packages/tenant-backend invoicing/quoteOptions.ts, quotes.ts /:id/proposal).
// The office builds two to six options — lines, a brand, a warranty, photos — the homeowner picks one on the quote's link
// and signs, and the quote's price becomes that option's. Here: what the options are and which is chosen, "Choose for the
// customer" (a yes by phone), the editor, and building the options from a pricebook item's Good / Better / Best tiers.
import { useEffect, useState } from 'react'
import { Layers, Loader2 } from 'lucide-react'
import { api } from '../api'
import { useAuth, useToast } from '../shared'
import { money } from '@twomiah/tenant-ui/src/money'
import { Button, Field, LineItemsEditor, Modal, errMsg, inputCls, selectCls } from '@twomiah/tenant-ui/src/invoicing/ui'
import type { LineItemInput } from '@twomiah/tenant-ui/src/invoicing/types'

const client = api as any
const OPEN = ['draft', 'sent', 'viewed']
const MAX_OPTIONS = 6
const MAX_PHOTOS = 6

interface OptionView {
  id: string; name: string; tier: string | null; brand: string | null; warranty: string | null; description: string | null
  photos: string[]; recommended: boolean; chosen: boolean; price: string; lines: Array<LineItemInput & { id?: string; total?: string }>
  upgrades?: Array<LineItemInput & { id?: string; total?: string; selected?: boolean }>
  discount?: string; discountCents?: number; discountPercent?: number
}
/** One discount per option: nothing, a dollar amount (kept as cents when saved) or a percent of the option's price before upgrades. */
interface Draft { name: string; tier: string; brand: string; warranty: string; description: string; photos: string[]; recommended: boolean; lines: LineItemInput[]; upgrades: LineItemInput[]; discountType: '' | 'amount' | 'percent'; discountValue: string }

const blank = (tier = ''): Draft => ({ name: tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '', tier, brand: '', warranty: '', description: '', photos: [], recommended: false, lines: [{ description: '', quantity: 1, unitPrice: 0 }], upgrades: [], discountType: '', discountValue: '' })
const cleanLine = (l: LineItemInput & { id?: string }): LineItemInput => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), ...(l.type ? { type: l.type } : {}), ...(l.unitCost !== undefined && l.unitCost !== null ? { unitCost: Number(l.unitCost) } : {}), ...(l.pricebookItemId ? { pricebookItemId: l.pricebookItemId } : {}) })
const fromView = (o: OptionView): Draft => ({
  upgrades: (o.upgrades || []).map(cleanLine),
  discountType: o.discountCents ? 'amount' : o.discountPercent ? 'percent' : '',
  discountValue: o.discountCents ? (o.discountCents / 100).toFixed(2) : o.discountPercent ? String(o.discountPercent) : '',
  name: o.name, tier: o.tier || '', brand: o.brand || '', warranty: o.warranty || '', description: o.description || '', photos: o.photos || [], recommended: o.recommended,
  lines: o.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), ...(l.type ? { type: l.type } : {}), ...(l.unitCost !== undefined && l.unitCost !== null ? { unitCost: Number(l.unitCost) } : {}), ...(l.pricebookItemId ? { pricebookItemId: l.pricebookItemId } : {}) })),
})

/** The side panel of a quote. Nothing for a seat that cannot read quotes, a business without the feature that has no options yet, or another document. */
export function ProposalPanel({ record }: { record: Record<string, any> }) {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const options: OptionView[] = record.proposal?.options || []
  const mayEdit = hasFeature('quote_proposals') && can('quotes:update') && OPEN.includes(record.status)
  const mayChoose = can('quotes:update') && OPEN.includes(record.status)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!can('quotes:read') || (!options.length && !hasFeature('quote_proposals'))) return null

  // The page reads the quote when it opens; a change here reloads it, so the total and the lines follow.
  const reload = () => window.location.reload()
  const choose = async (optionId: string) => {
    setBusy(true)
    try { await client.post(`/api/quotes/${record.id}/proposal/choose`, { optionId }); toast.success('Option chosen'); reload() }
    catch (e) { toast.error(errMsg(e, 'Could not choose that option')); setBusy(false) }
  }
  // The office ticks an upgrade of the chosen option for a customer who asked by phone.
  const upgrade = async (lineItemId: string, selected: boolean) => {
    setBusy(true)
    try { await client.post(`/api/quotes/${record.id}/proposal/upgrade`, { lineItemId, selected }); reload() }
    catch (e) { toast.error(errMsg(e, 'Could not change that upgrade')); setBusy(false) }
  }
  return (
    <section aria-label="Options" data-testid="proposal-panel" className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-sm text-gray-900 dark:text-slate-100">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Layers className="w-4 h-4" aria-hidden="true" />Options to choose from</h2>
      {options.length === 0 && <p className="text-gray-600 dark:text-slate-300">Offer the customer a choice — Good, Better, Best — and let them pick one and sign.</p>}
      {options.length > 0 && (
        <>
          <p className="mb-2 text-gray-600 dark:text-slate-300">{record.proposal.needsChoice ? 'The customer has not chosen yet. Each price is for the whole job; the quote total counts only the lines every option shares until one is chosen.' : 'The customer chose one. The quote is priced at that option.'}</p>
          <ul className="space-y-2">
            {options.map((o) => (
              <li key={o.id} className={`rounded-lg border p-3 ${o.chosen ? 'border-green-600 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-slate-700'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{o.name}{o.recommended ? <span className="ml-2 text-xs text-orange-700 dark:text-orange-200">Recommended</span> : null}{o.chosen ? <span className="ml-2 text-xs text-green-800 dark:text-green-300">Chosen</span> : null}</p>
                    {(o.brand || o.warranty) && <p className="text-xs text-gray-600 dark:text-slate-300">{[o.brand, o.warranty].filter(Boolean).join(' · ')}</p>}
                    <p className="text-xs text-gray-600 dark:text-slate-300">{o.lines.length} line{o.lines.length === 1 ? '' : 's'}{o.photos.length ? `, ${o.photos.length} photo${o.photos.length === 1 ? '' : 's'}` : ''}{(o.upgrades || []).length ? `, ${o.upgrades!.length} upgrade${o.upgrades!.length === 1 ? '' : 's'}` : ''}{Number(o.discount) > 0 ? `, ${money(o.discount)} off` : ''}</p>
                    {o.chosen && (o.upgrades || []).length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-xs">{o.upgrades!.map((u) => <li key={u.id}><label className="inline-flex items-center gap-1"><input type="checkbox" checked={!!u.selected} disabled={!mayChoose || busy} onChange={(e) => upgrade(u.id!, e.target.checked)} aria-label={`Include ${u.description}`} /> Upgrade: {u.description} ({money(u.total)})</label></li>)}</ul>
                    )}
                  </div>
                  <div className="text-right shrink-0"><p className="font-semibold">{money(o.price)}</p>
                    {mayChoose && !o.chosen && <button type="button" disabled={busy} onClick={() => choose(o.id)} className="text-xs font-medium text-orange-700 underline dark:text-orange-200">Choose for the customer</button>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {mayEdit && <div className="mt-3"><Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>{options.length ? 'Edit options' : 'Add options'}</Button></div>}
      {editing && <OptionsEditor quote={record} initial={options.map(fromView)} onClose={() => setEditing(false)} onSaved={reload} />}
    </section>
  )
}

/** The discount as the server takes it: whole cents for a dollar amount, a percent otherwise; none when not asked for. */
const discountOf = (d: Draft) => {
  const v = Number(d.discountValue)
  if (!d.discountType || !(v > 0)) return null
  return d.discountType === 'amount' ? { type: 'amount' as const, cents: Math.round(v * 100) } : { type: 'percent' as const, percent: v }
}

function OptionsEditor({ quote, initial, onClose, onSaved }: { quote: Record<string, any>; initial: Draft[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [drafts, setDrafts] = useState<Draft[]>(initial.length ? initial : [blank('good'), blank('better'), blank('best')])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [jobPhotos, setJobPhotos] = useState<Array<{ id: string; url: string; caption?: string | null }>>([])
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([])
  const [pickItem, setPickItem] = useState('')
  const { hasFeature } = useAuth()
  const change = (next: Draft[]) => { setDrafts(next); setDirty(true) }
  const patch = (i: number, p: Partial<Draft>) => change(drafts.map((d, j) => (j === i ? { ...d, ...p } : d)))

  // The job's own photos, to choose an option's pictures from (a roofer takes them on the phone); the pricebook, for tiers.
  useEffect(() => {
    if (quote.jobId) client.get(`/api/jobs/${quote.jobId}`).then((j: any) => setJobPhotos((j?.photos || []).filter((p: any) => typeof p.url === 'string'))).catch(() => {})
    if (hasFeature('pricebook')) client.get('/api/pricebook/items', { limit: 200, active: 'true' }).then((r: any) => setItems((r?.data || []).map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {})
  }, [quote.jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => drafts.map((d) => ({
    name: d.name, tier: d.tier || null, brand: d.brand || null, warranty: d.warranty || null, description: d.description || null,
    photos: d.photos, recommended: d.recommended,
    lines: d.lines.filter((l) => l.description.trim()).map(cleanLine),
    upgrades: d.upgrades.filter((l) => l.description.trim()).map(cleanLine),
    discount: discountOf(d),
  }))
  const save = async () => {
    const bad = drafts.findIndex((d) => d.discountType && !(Number(d.discountValue) > 0))
    if (bad >= 0) { setError(`Option ${bad + 1}: enter the discount, or choose "No discount".`); return }
    setSaving(true); setError('')
    try { await client.put(`/api/quotes/${quote.id}/proposal`, { options: body() }); toast.success('Options saved'); onSaved() }
    catch (e) { setError(errMsg(e, 'Could not save the options')); setSaving(false) }
  }
  const fromPricebook = async () => {
    if (!pickItem) return
    setSaving(true); setError('')
    try { await client.post(`/api/quotes/${quote.id}/proposal/from-pricebook`, { pricebookItemId: pickItem }); toast.success('Options built from the price book'); onSaved() }
    catch (e) { setError(errMsg(e, 'Could not build the options from that item')); setSaving(false) }
  }
  const togglePhoto = (i: number, url: string) => {
    const has = drafts[i].photos.includes(url)
    if (!has && drafts[i].photos.length >= MAX_PHOTOS) { setError(`An option shows at most ${MAX_PHOTOS} photos.`); return }
    setError(''); patch(i, { photos: has ? drafts[i].photos.filter((p) => p !== url) : [...drafts[i].photos, url] })
  }

  return (
    <Modal isOpen onClose={onClose} title="Options to choose from" size="xl" dirty={dirty}>
      <div className="space-y-6">
        <p className="text-sm text-gray-600 dark:text-slate-300">Each option is priced as the whole job: the lines on the quote itself are in every option, and the lines you add here are that option's own. The customer picks one and signs.</p>
        {items.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">
            <Field label="Build the options from a price book item's Good / Better / Best">
              <select className={selectCls} value={pickItem} onChange={(e) => setPickItem(e.target.value)} aria-label="Price book item"><option value="">Choose an item…</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </Field>
            <Button variant="secondary" onClick={fromPricebook} disabled={!pickItem || saving}>Build options</Button>
          </div>
        )}
        {drafts.map((d, i) => (
          <fieldset key={i} className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-slate-700">
            <legend className="px-1 text-sm font-semibold">Option {i + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><input className={inputCls} value={d.name} maxLength={80} onChange={(e) => patch(i, { name: e.target.value })} aria-label={`Option ${i + 1} name`} /></Field>
              <Field label="Brand"><input className={inputCls} value={d.brand} maxLength={120} placeholder="e.g. GAF Timberline HDZ" onChange={(e) => patch(i, { brand: e.target.value })} aria-label={`Option ${i + 1} brand`} /></Field>
              <Field label="Level"><select className={`${inputCls}`} value={d.tier} onChange={(e) => patch(i, { tier: e.target.value })} aria-label={`Option ${i + 1} level`}><option value="">—</option><option value="good">Good</option><option value="better">Better</option><option value="best">Best</option></select></Field>
            </div>
            <Field label="Warranty"><input className={inputCls} value={d.warranty} maxLength={300} placeholder="e.g. Lifetime shingle warranty, 10-year workmanship" onChange={(e) => patch(i, { warranty: e.target.value })} aria-label={`Option ${i + 1} warranty`} /></Field>
            <Field label="What the customer is told"><textarea className={inputCls} rows={2} value={d.description} maxLength={2000} onChange={(e) => patch(i, { description: e.target.value })} aria-label={`Option ${i + 1} description`} /></Field>
            <Field label="Photos" hint={`Up to ${MAX_PHOTOS}. Pick from the job's photos, or paste an https address, one per line.`}>
              {jobPhotos.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {jobPhotos.map((p) => (
                    <button type="button" key={p.id} onClick={() => togglePhoto(i, p.url)} aria-pressed={d.photos.includes(p.url)} aria-label={`${d.photos.includes(p.url) ? 'Remove' : 'Use'} photo ${p.caption || ''}`.trim()} className={`h-14 w-14 overflow-hidden rounded border-2 ${d.photos.includes(p.url) ? 'border-orange-600' : 'border-transparent'}`}><img src={p.url} alt={p.caption || 'Job photo'} className="h-full w-full object-cover" /></button>
                  ))}
                </div>
              )}
              <textarea className={inputCls} rows={2} value={d.photos.filter((p) => !jobPhotos.some((j) => j.url === p)).join('\n')} aria-label={`Option ${i + 1} photo addresses`}
                onChange={(e) => patch(i, { photos: [...d.photos.filter((p) => jobPhotos.some((j) => j.url === p)), ...e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)].slice(0, MAX_PHOTOS) })} />
            </Field>
            <LineItemsEditor items={d.lines} onChange={(lines) => patch(i, { lines })} />
            <div className="space-y-2 rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">
              <p className="text-sm font-medium">Upgrades for this option</p>
              <p className="text-xs text-gray-600 dark:text-slate-300">Add-ons the customer can tick after they choose this option, such as copper valleys. They are not in the option's price until ticked.</p>
              <LineItemsEditor items={d.upgrades} onChange={(upgrades) => patch(i, { upgrades })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Discount on this option">
                <select className={inputCls} value={d.discountType} onChange={(e) => patch(i, { discountType: e.target.value as Draft['discountType'], discountValue: e.target.value ? d.discountValue : '' })} aria-label={`Option ${i + 1} discount type`}><option value="">No discount</option><option value="amount">A dollar amount</option><option value="percent">A percent of the option</option></select>
              </Field>
              {d.discountType && <Field label={d.discountType === 'amount' ? 'Dollars off' : 'Percent off'} hint="Taken off the option's price before its upgrades; shown to the customer on the option.">
                <input className={inputCls} type="number" min="0" step={d.discountType === 'amount' ? '0.01' : '0.1'} max={d.discountType === 'percent' ? 100 : undefined} value={d.discountValue} onChange={(e) => patch(i, { discountValue: e.target.value })} aria-label={`Option ${i + 1} discount`} />
              </Field>}
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.recommended} onChange={(e) => change(drafts.map((x, j) => ({ ...x, recommended: j === i ? e.target.checked : false })))} /> Recommended</label>
              {drafts.length > 2 && <button type="button" className="text-sm text-red-700 underline dark:text-red-300" onClick={() => change(drafts.filter((_, j) => j !== i))}>Remove this option</button>}
            </div>
          </fieldset>
        ))}
        {drafts.length < MAX_OPTIONS && <Button variant="secondary" onClick={() => change([...drafts, blank()])}>Add another option</Button>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-gray-200 pt-4 dark:border-slate-700">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save options</Button>
        </div>
        <p className="text-xs text-gray-600 dark:text-slate-300">Saving puts the options in place of the ones above; if the customer had already chosen, they choose again.</p>
      </div>
    </Modal>
  )
}
