// Good / Better / Best beside a quote (server: packages/tenant-backend invoicing/quoteOptions.ts, quotes.ts /:id/proposal).
// The office builds up to three SETS of options — a set the customer picks one of (Good / Better / Best), or an additive set
// they add any of (add-ons) — each option with lines, a brand, a warranty, photos. The customer picks on the quote's link
// and signs, and the quote's price follows every pick. Here: what the sets are and what is picked, "Choose for the
// customer" (a yes by phone), the editor, and building a set from a pricebook item's Good / Better / Best tiers.
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
const MAX_SETS = 3
const MAX_PHOTOS = 6
type SetKind = 'one' | 'any'
const KIND_LABEL: Record<SetKind, string> = { one: 'The customer picks one', any: 'The customer adds any they want' }

interface OptionView {
  id: string; name: string; tier: string | null; brand: string | null; warranty: string | null; description: string | null
  photos: string[]; recommended: boolean; chosen: boolean; price: string; addPrice?: string
  setIndex?: number; setName?: string; setKind?: SetKind
  lines: Array<LineItemInput & { id?: string; total?: string }>
}
interface SetView { index: number; name: string; kind: SetKind; options: OptionView[]; chosenOptionIds: string[]; needsChoice: boolean }
interface Draft { name: string; tier: string; brand: string; warranty: string; description: string; photos: string[]; recommended: boolean; lines: LineItemInput[] }
interface SetDraft { name: string; kind: SetKind; options: Draft[] }

const blank = (tier = ''): Draft => ({ name: tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '', tier, brand: '', warranty: '', description: '', photos: [], recommended: false, lines: [{ description: '', quantity: 1, unitPrice: 0 }] })
const blankSet = (kind: SetKind = 'one'): SetDraft => ({ name: '', kind, options: kind === 'one' ? [blank('good'), blank('better'), blank('best')] : [blank(), blank()] })
const fromView = (o: OptionView): Draft => ({
  name: o.name, tier: o.tier || '', brand: o.brand || '', warranty: o.warranty || '', description: o.description || '', photos: o.photos || [], recommended: o.recommended,
  lines: o.lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), ...(l.type ? { type: l.type } : {}), ...(l.unitCost !== undefined && l.unitCost !== null ? { unitCost: Number(l.unitCost) } : {}), ...(l.pricebookItemId ? { pricebookItemId: l.pricebookItemId } : {}) })),
})
/** The sets as the server answers them; a quote answered before sets existed (options only) is one pick-one set. */
const setsOf = (proposal: any): SetView[] => {
  if (!proposal) return []
  if (Array.isArray(proposal.sets) && proposal.sets.length) return proposal.sets
  const options: OptionView[] = proposal.options || []
  return options.length ? [{ index: 0, name: 'Options', kind: 'one', options, chosenOptionIds: options.filter((o) => o.chosen).map((o) => o.id), needsChoice: !options.some((o) => o.chosen) }] : []
}

/** The side panel of a quote. Nothing for a seat that cannot read quotes, a business without the feature that has no options yet, or another document. */
export function ProposalPanel({ record }: { record: Record<string, any> }) {
  const { hasFeature, can } = useAuth()
  const toast = useToast()
  const sets = setsOf(record.proposal)
  const optionCount = sets.reduce((n, s) => n + s.options.length, 0)
  const mayEdit = hasFeature('quote_proposals') && can('quotes:update') && OPEN.includes(record.status)
  const mayChoose = can('quotes:update') && OPEN.includes(record.status)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!can('quotes:read') || (!optionCount && !hasFeature('quote_proposals'))) return null

  // The page reads the quote when it opens; a change here reloads it, so the total and the lines follow.
  const reload = () => window.location.reload()
  const choose = async (optionId: string, chosen = true) => {
    setBusy(true)
    try { await client.post(`/api/quotes/${record.id}/proposal/choose`, { optionId, chosen }); toast.success(chosen ? 'Option chosen' : 'Add-on removed'); reload() }
    catch (e) { toast.error(errMsg(e, 'Could not change that option')); setBusy(false) }
  }
  const needsChoice = !!record.proposal?.needsChoice
  return (
    <section aria-label="Options" data-testid="proposal-panel" className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-6 text-sm text-gray-900 dark:text-slate-100">
      <h2 className="font-semibold mb-3 flex items-center gap-2"><Layers className="w-4 h-4" aria-hidden="true" />Options to choose from</h2>
      {optionCount === 0 && <p className="text-gray-600 dark:text-slate-300">Offer the customer a choice — Good, Better, Best — or add-ons they can take any of, and let them pick and sign.</p>}
      {optionCount > 0 && (
        <>
          <p className="mb-2 text-gray-600 dark:text-slate-300">{needsChoice ? 'The customer has not chosen yet. Each price is for the whole job with that option; the quote total counts only what is chosen so far.' : 'The customer has chosen. The quote is priced at their picks.'}</p>
          <div className="space-y-4">
            {sets.map((s) => (
              <div key={s.index} data-testid="proposal-set">
                {sets.length > 1 || s.kind === 'any' ? <p className="mb-1 font-medium">{s.name} <span className="text-xs font-normal text-gray-600 dark:text-slate-300">· {s.kind === 'any' ? 'add any' : 'choose one'}{s.needsChoice ? ' · not chosen yet' : ''}</span></p> : null}
                <ul className="space-y-2">
                  {s.options.map((o) => (
                    <li key={o.id} className={`rounded-lg border p-3 ${o.chosen ? 'border-green-600 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-slate-700'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium">{o.name}{o.recommended ? <span className="ml-2 text-xs text-orange-700 dark:text-orange-200">Recommended</span> : null}{o.chosen ? <span className="ml-2 text-xs text-green-800 dark:text-green-300">{s.kind === 'any' ? 'Added' : 'Chosen'}</span> : null}</p>
                          {(o.brand || o.warranty) && <p className="text-xs text-gray-600 dark:text-slate-300">{[o.brand, o.warranty].filter(Boolean).join(' · ')}</p>}
                          <p className="text-xs text-gray-600 dark:text-slate-300">{o.lines.length} line{o.lines.length === 1 ? '' : 's'}{o.photos.length ? `, ${o.photos.length} photo${o.photos.length === 1 ? '' : 's'}` : ''}</p>
                        </div>
                        <div className="text-right shrink-0"><p className="font-semibold">{s.kind === 'any' ? `+ ${money(o.addPrice ?? o.price)}` : money(o.price)}</p>
                          {mayChoose && s.kind === 'one' && !o.chosen && <button type="button" disabled={busy} onClick={() => choose(o.id)} className="text-xs font-medium text-orange-700 underline dark:text-orange-200">Choose for the customer</button>}
                          {mayChoose && s.kind === 'any' && <button type="button" disabled={busy} onClick={() => choose(o.id, !o.chosen)} className="text-xs font-medium text-orange-700 underline dark:text-orange-200">{o.chosen ? 'Remove for the customer' : 'Add for the customer'}</button>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
      {mayEdit && <div className="mt-3"><Button variant="secondary" onClick={() => setEditing(true)} disabled={busy}>{optionCount ? 'Edit options' : 'Add options'}</Button></div>}
      {editing && <OptionsEditor quote={record} initial={sets.map((s) => ({ name: sets.length > 1 || s.kind === 'any' ? s.name : '', kind: s.kind, options: s.options.map(fromView) }))} onClose={() => setEditing(false)} onSaved={reload} />}
    </section>
  )
}

function OptionsEditor({ quote, initial, onClose, onSaved }: { quote: Record<string, any>; initial: SetDraft[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [sets, setSets] = useState<SetDraft[]>(initial.length ? initial : [blankSet('one')])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [jobPhotos, setJobPhotos] = useState<Array<{ id: string; url: string; caption?: string | null }>>([])
  const [items, setItems] = useState<Array<{ id: string; name: string }>>([])
  const [pickItem, setPickItem] = useState('')
  const { hasFeature } = useAuth()
  const change = (next: SetDraft[]) => { setSets(next); setDirty(true) }
  const patchSet = (si: number, p: Partial<SetDraft>) => change(sets.map((s, j) => (j === si ? { ...s, ...p } : s)))
  const patch = (si: number, i: number, p: Partial<Draft>) => patchSet(si, { options: sets[si].options.map((d, j) => (j === i ? { ...d, ...p } : d)) })

  // The job's own photos, to choose an option's pictures from (a roofer takes them on the phone); the pricebook, for tiers.
  useEffect(() => {
    if (quote.jobId) client.get(`/api/jobs/${quote.jobId}`).then((j: any) => setJobPhotos((j?.photos || []).filter((p: any) => typeof p.url === 'string'))).catch(() => {})
    if (hasFeature('pricebook')) client.get('/api/pricebook/items', { limit: 200, active: 'true' }).then((r: any) => setItems((r?.data || []).map((x: any) => ({ id: x.id, name: x.name })))).catch(() => {})
  }, [quote.jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  const body = () => sets.map((s) => ({
    name: s.name.trim() || null, kind: s.kind,
    options: s.options.map((d) => ({
      name: d.name, tier: d.tier || null, brand: d.brand || null, warranty: d.warranty || null, description: d.description || null,
      photos: d.photos, recommended: d.recommended,
      lines: d.lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, ...(l.type ? { type: l.type } : {}), ...(l.unitCost !== undefined ? { unitCost: l.unitCost } : {}), ...(l.pricebookItemId ? { pricebookItemId: l.pricebookItemId } : {}) })),
    })),
  }))
  const save = async () => {
    setSaving(true); setError('')
    try { await client.put(`/api/quotes/${quote.id}/proposal`, { sets: body() }); toast.success('Options saved'); onSaved() }
    catch (e) { setError(errMsg(e, 'Could not save the options')); setSaving(false) }
  }
  const clear = async () => {
    setSaving(true); setError('')
    try { await client.put(`/api/quotes/${quote.id}/proposal`, { sets: [] }); toast.success('Options removed'); onSaved() }
    catch (e) { setError(errMsg(e, 'Could not remove the options')); setSaving(false) }
  }
  const fromPricebook = async () => {
    if (!pickItem) return
    setSaving(true); setError('')
    try { await client.post(`/api/quotes/${quote.id}/proposal/from-pricebook`, { pricebookItemId: pickItem }); toast.success('Options built from the price book'); onSaved() }
    catch (e) { setError(errMsg(e, 'Could not build the options from that item')); setSaving(false) }
  }
  const togglePhoto = (si: number, i: number, url: string) => {
    const d = sets[si].options[i]
    const has = d.photos.includes(url)
    if (!has && d.photos.length >= MAX_PHOTOS) { setError(`An option shows at most ${MAX_PHOTOS} photos.`); return }
    setError(''); patch(si, i, { photos: has ? d.photos.filter((p) => p !== url) : [...d.photos, url] })
  }

  return (
    <Modal isOpen onClose={onClose} title="Options to choose from" size="xl" dirty={dirty}>
      <div className="space-y-6">
        <p className="text-sm text-gray-600 dark:text-slate-300">The lines on the quote itself are in every option. A set the customer picks one of is priced as the whole job with that option; an add-on set is anything they want on top, each at what it adds. Up to {MAX_SETS} sets.</p>
        {items.length > 0 && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3 dark:bg-slate-800/60">
            <Field label="Build one set from a price book item's Good / Better / Best (replaces the sets below)">
              <select className={selectCls} value={pickItem} onChange={(e) => setPickItem(e.target.value)} aria-label="Price book item"><option value="">Choose an item…</option>{items.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
            </Field>
            <Button variant="secondary" onClick={fromPricebook} disabled={!pickItem || saving}>Build options</Button>
          </div>
        )}
        {sets.map((s, si) => (
          <fieldset key={si} className="space-y-4 rounded-xl border-2 border-gray-300 p-4 dark:border-slate-600" data-testid="set-editor">
            <legend className="px-1 text-sm font-semibold">Set {si + 1}{s.name ? `: ${s.name}` : ''}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={sets.length > 1 ? 'Set name (the customer sees it)' : 'Set name (optional)'}><input className={inputCls} value={s.name} maxLength={80} placeholder="e.g. Furnace, Thermostat, Add-ons" onChange={(e) => patchSet(si, { name: e.target.value })} aria-label={`Set ${si + 1} name`} /></Field>
              <Field label="How the customer chooses"><select className={selectCls} value={s.kind} onChange={(e) => patchSet(si, { kind: e.target.value as SetKind })} aria-label={`Set ${si + 1} kind`}>{(Object.keys(KIND_LABEL) as SetKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
            </div>
            {s.options.map((d, i) => (
              <fieldset key={i} className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-slate-700">
                <legend className="px-1 text-sm font-semibold">Option {i + 1}</legend>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Name"><input className={inputCls} value={d.name} maxLength={80} onChange={(e) => patch(si, i, { name: e.target.value })} aria-label={`Set ${si + 1} option ${i + 1} name`} /></Field>
                  <Field label="Brand"><input className={inputCls} value={d.brand} maxLength={120} placeholder="e.g. GAF Timberline HDZ" onChange={(e) => patch(si, i, { brand: e.target.value })} aria-label={`Set ${si + 1} option ${i + 1} brand`} /></Field>
                  <Field label="Level"><select className={`${inputCls}`} value={d.tier} onChange={(e) => patch(si, i, { tier: e.target.value })} aria-label={`Set ${si + 1} option ${i + 1} level`}><option value="">—</option><option value="good">Good</option><option value="better">Better</option><option value="best">Best</option></select></Field>
                </div>
                <Field label="Warranty"><input className={inputCls} value={d.warranty} maxLength={300} placeholder="e.g. Lifetime shingle warranty, 10-year workmanship" onChange={(e) => patch(si, i, { warranty: e.target.value })} aria-label={`Set ${si + 1} option ${i + 1} warranty`} /></Field>
                <Field label="What the customer is told"><textarea className={inputCls} rows={2} value={d.description} maxLength={2000} onChange={(e) => patch(si, i, { description: e.target.value })} aria-label={`Set ${si + 1} option ${i + 1} description`} /></Field>
                <Field label="Photos" hint={`Up to ${MAX_PHOTOS}. Pick from the job's photos, or paste an https address, one per line.`}>
                  {jobPhotos.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {jobPhotos.map((p) => (
                        <button type="button" key={p.id} onClick={() => togglePhoto(si, i, p.url)} aria-pressed={d.photos.includes(p.url)} aria-label={`${d.photos.includes(p.url) ? 'Remove' : 'Use'} photo ${p.caption || ''}`.trim()} className={`h-14 w-14 overflow-hidden rounded border-2 ${d.photos.includes(p.url) ? 'border-orange-600' : 'border-transparent'}`}><img src={p.url} alt={p.caption || 'Job photo'} className="h-full w-full object-cover" /></button>
                      ))}
                    </div>
                  )}
                  <textarea className={inputCls} rows={2} value={d.photos.filter((p) => !jobPhotos.some((j) => j.url === p)).join('\n')} aria-label={`Set ${si + 1} option ${i + 1} photo addresses`}
                    onChange={(e) => patch(si, i, { photos: [...d.photos.filter((p) => jobPhotos.some((j) => j.url === p)), ...e.target.value.split('\n').map((x) => x.trim()).filter(Boolean)].slice(0, MAX_PHOTOS) })} />
                </Field>
                <LineItemsEditor items={d.lines} onChange={(lines) => patch(si, i, { lines })} />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.recommended} onChange={(e) => patchSet(si, { options: s.options.map((x, j) => ({ ...x, recommended: j === i ? e.target.checked : false })) })} /> Recommended</label>
                  {s.options.length > 2 && <button type="button" className="text-sm text-red-700 underline dark:text-red-300" onClick={() => patchSet(si, { options: s.options.filter((_, j) => j !== i) })}>Remove this option</button>}
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              {s.options.length < MAX_OPTIONS && <Button variant="secondary" onClick={() => patchSet(si, { options: [...s.options, blank()] })}>Add another option to this set</Button>}
              {sets.length > 1 && <button type="button" className="text-sm text-red-700 underline dark:text-red-300" onClick={() => change(sets.filter((_, j) => j !== si))}>Remove this set</button>}
            </div>
          </fieldset>
        ))}
        {sets.length < MAX_SETS && <Button variant="secondary" onClick={() => change([...sets, blankSet(sets.length ? 'any' : 'one')])}>Add another set</Button>}
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 pt-4 dark:border-slate-700">
          {initial.length > 0 && <button type="button" className="mr-auto text-sm text-red-700 underline dark:text-red-300" onClick={clear} disabled={saving}>Remove every option</button>}
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Save options</Button>
        </div>
        <p className="text-xs text-gray-600 dark:text-slate-300">Saving puts these sets in place of the ones above; if the customer had already chosen, they choose again.</p>
      </div>
    </Modal>
  )
}
