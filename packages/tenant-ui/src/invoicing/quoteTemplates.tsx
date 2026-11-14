// Quote templates and "create similar" (feature quote_templates, not ready): the pieces Quotes and a quote's page share.
// Nothing here creates a quote. "Create similar" and "From a template" fill the ordinary New Quote form, and saving that form is the
// one POST /api/quotes — so numbering, totals and every rule on a new quote are the quote route's own.
import React, { useContext, useEffect, useState } from 'react'
import { AuthContext } from '../auth/AuthContext'
import { useMayWrite } from '../auth/PermissionsContext'
import type { LineItemInput } from './types'
import { Button, ConfirmModal, Field, Modal, errMsg, inputCls, money } from './ui'

type Api = { get: (u: string, p?: any) => Promise<any>; post: (u: string, b?: any) => Promise<any>; delete: (u: string, id?: string) => Promise<any> }
type Toast = { success: (m: string) => void; error: (m: string) => void }

/** Does this business have the feature on? False where there is no sign-in context (an older template's page). */
export function useQuoteFeature(id: string): boolean {
  const auth = useContext(AuthContext)
  return !!auth?.hasFeature?.(id)
}

/** A quote's lines as the New Quote form takes them. PUT replaces every line, so the cost and estimating fields ride along. */
export function formLines(lineItems: any[] | undefined, blank: () => LineItemInput): LineItemInput[] {
  if (!lineItems?.length) return [blank()]
  return lineItems.map((li: any) => ({
    description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice),
    ...(li.type ? { type: li.type } : {}),
    ...(li.unitCost === null || li.unitCost === undefined ? {} : { unitCost: Number(li.unitCost) }),
    ...(li.pricebookItemId ? { pricebookItemId: li.pricebookItemId } : {}),
    ...(li.optional ? { optional: true, selected: !!li.selected } : {}),
    ...(li.section ? { section: li.section } : {}),
    ...(li.markupPct === null || li.markupPct === undefined ? {} : { markupPct: Number(li.markupPct) }),
    ...(li.allowance ? { allowance: true } : {}),
    ...(li.costCode ? { costCode: li.costCode } : {}),
    ...(li.imageUrl ? { imageUrl: li.imageUrl } : {}),
    ...(li.formulaKey ? { formulaKey: li.formulaKey } : {}),
    ...(li.quantityFormula ? { quantityFormula: li.quantityFormula } : {}),
    ...(li.priceFormula ? { priceFormula: li.priceFormula } : {}),
  }))
}

/**
 * A quote's Good / Better / Best options as PUT /api/quotes/:id/proposal takes them, for "Create similar" (contractor final pass
 * 11/14: the copy dropped the options, while a template kept them). The customer's pick is not copied. Null when it has none.
 */
export function proposalFromQuote(view: any): { sets: any[] } | null {
  const sets = Array.isArray(view?.sets) ? view.sets : []
  if (!sets.length) return null
  const lines = (ls: any[] | undefined) => formLines(ls, () => ({} as LineItemInput)).filter((l: any) => l.description).map(({ optional: _o, selected: _s, ...rest }: any) => rest)
  return {
    sets: sets.map((st: any) => ({
      name: st.name ?? null, kind: st.kind || 'one',
      options: (st.options || []).map((o: any) => ({
        name: o.name, tier: o.tier ?? null, brand: o.brand ?? null, warranty: o.warranty ?? null, description: o.description ?? null,
        photos: Array.isArray(o.photos) ? o.photos : [], recommended: !!o.recommended, attachments: Array.isArray(o.attachments) ? o.attachments : [],
        lines: lines(o.lines), upgrades: o.upgrades?.length ? lines(o.upgrades) : [],
        discount: Number(o.discountCents) > 0 ? { type: 'amount', cents: Number(o.discountCents) } : Number(o.discountPercent) > 0 ? { type: 'percent', percent: Number(o.discountPercent) } : null,
      })),
    })),
  }
}

/** "Save as a template": asks for a name, saves the quote's lines and wording, says so. */
export function SaveTemplateModal({ api, toast, quote, onClose }: { api: Api; toast: Toast; quote: { id: string; name: string } | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const mayCreate = useMayWrite('quotes:create')   // POST /api/quote-templates
  useEffect(() => { setName(quote?.name || '') }, [quote])
  const save = async () => {
    if (!quote) return
    setBusy(true)
    try { await api.post('/api/quote-templates', { quoteId: quote.id, name: name.trim() }); toast.success('Saved as a template'); onClose() } catch (e) { toast.error(errMsg(e, 'Could not save the template')) } finally { setBusy(false) }
  }
  return (
    <Modal isOpen={!!quote} onClose={onClose} title="Save as a template" size="md">
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-slate-300">The lines and their pictures, the Good / Better / Best options, the wording, tax and deposit are kept. The customer and dates are not, so you pick them each time you use it.</p>
        <Field label="Template name"><input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} maxLength={120} autoFocus /></Field>
        <div className="flex justify-end gap-3"><Button variant="secondary" onClick={onClose}>Cancel</Button>{mayCreate && <Button onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save template'}</Button>}</div>
        {!mayCreate && <p className="text-sm text-gray-600 dark:text-slate-300">Your role cannot save templates.</p>}
      </div>
    </Modal>
  )
}

/** "From a template": the company's templates, to start a quote from or remove. */
export function TemplatePickerModal({ api, toast, open, onClose, onUse, mayDelete }: { api: Api; toast: Toast; open: boolean; onClose: () => void; onUse: (body: any) => void; mayDelete: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null)
  const [busy, setBusy] = useState('')
  const [removing, setRemoving] = useState<any | null>(null)
  // DELETE /api/quote-templates/:id asks quotes:delete; the page's own mayDelete is asked as well.
  const mayRemove = useMayWrite('quotes:delete') && mayDelete
  const load = () => api.get('/api/quote-templates').then((r: any) => setRows(r?.data || [])).catch(() => setRows([]))
  useEffect(() => { if (open) { setRows(null); load() } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const use = async (id: string) => {
    setBusy(id)
    try { const t = await api.get(`/api/quote-templates/${id}`); onUse(t?.body); onClose() } catch (e) { toast.error(errMsg(e, 'Could not open the template')) } finally { setBusy('') }
  }
  const remove = async () => {
    if (!removing) return
    try { await api.delete('/api/quote-templates', removing.id); toast.success('Template deleted'); setRemoving(null); load() } catch (e) { toast.error(errMsg(e, 'Could not delete the template')) }
  }
  return (
    <>
      <Modal isOpen={open} onClose={onClose} title="Start from a template" size="md">
        {rows === null ? <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p> : rows.length === 0 ? (
          <p className="text-sm text-gray-600 dark:text-slate-300" data-testid="no-templates">No templates yet. Open a quote you want to reuse and choose “Save as template”.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800" data-testid="template-list">
            {rows.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0"><p className="font-medium text-gray-900 dark:text-white truncate">{t.name}</p><p className="text-xs text-gray-500 dark:text-slate-400">{t.lineCount} {t.lineCount === 1 ? 'line' : 'lines'} · {money(t.total)}</p></div>
                <div className="flex gap-2 shrink-0">
                  <Button onClick={() => use(t.id)} disabled={busy === t.id}>{busy === t.id ? 'Opening…' : 'Use'}</Button>
                  {mayRemove && <Button variant="secondary" onClick={() => setRemoving(t)} aria-label={`Delete ${t.name}`}>Delete</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmModal isOpen={!!removing} onClose={() => setRemoving(null)} onConfirm={remove} title="Delete this template?" message={removing ? `“${removing.name}” will be removed. Quotes already made from it are not changed.` : ''} confirmText="Delete" />
    </>
  )
}
