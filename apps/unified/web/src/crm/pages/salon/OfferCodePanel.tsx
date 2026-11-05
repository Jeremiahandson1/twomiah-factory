// An offer code at the sale (server crm/salon/offers.ts, POST /api/retention-offers/redeem; hidden feature `retention_sends`).
// The client was sent a code in a birthday, win-back, milestone, anniversary or tier message; the desk types it beside their sale. The server
// checks it is theirs, unspent and in date, says what it would take off, and on a yes takes it off — once. Every rule is the server's.
import { useState } from 'react'
import { Loader2, Ticket } from 'lucide-react'
import { api, useAuth, useToast, usePermissions, useConfirm, money } from '../../../shared'
import { Button, inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'

const CLOSED = new Set(['paid', 'void', 'refunded'])

export function OfferCodePanel({ invoiceId, status, reload }: { invoiceId: string; status: string; reload?: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  const { hasFeature } = useAuth()
  const { can, known } = usePermissions()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const on = hasFeature('retention_sends') && known && can('invoices:update') && !CLOSED.has(status)
  if (!on) return null

  const apply = async () => {
    const typed = code.trim()
    if (!typed) return
    setBusy(true); setProblem('')
    try {
      const q: { discount: number; words: string; cappedAtSale: boolean } = await api.post('/api/retention-offers/redeem', { code: typed, invoiceId, preview: true })
      const ok = await confirm(`${q.words}: ${money(q.discount)} comes off this sale${q.cappedAtSale ? ' (the whole of what is left on it)' : ''}. The code can only be used once.`, { title: 'Take this offer off the sale?', confirmText: 'Take it off', danger: false })
      if (!ok) return
      const r: { discount: number } = await api.post('/api/retention-offers/redeem', { code: typed, invoiceId })
      toast.success(`${money(r.discount)} off`)
      setCode(''); reload?.()
    } catch (e: any) { setProblem(e?.message || 'That code could not be used.') } finally { setBusy(false) }
  }
  return (
    <section aria-label="Offer code" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" data-testid="offer-code-panel">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-slate-100"><Ticket className="h-4 w-4 text-teal-700 dark:text-teal-300" aria-hidden="true" />Offer code</h2>
      <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">From a birthday, win-back or other message the client was sent. One code per sale.</p>
      <div className="mt-2 flex items-end gap-2 text-sm text-gray-900 dark:text-slate-100">
        <label className="min-w-0 flex-1">Code<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') apply() }} className={inputCls + ' mt-1'} placeholder="BDAY-7KQ2MX" autoCapitalize="characters" /></label>
        <Button variant="secondary" onClick={apply} disabled={busy || !code.trim()}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Apply'}</Button>
      </div>
      {problem && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{problem}</p>}
    </section>
  )
}
