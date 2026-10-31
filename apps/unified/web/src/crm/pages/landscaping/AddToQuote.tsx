// Under a price from Area Pricing: put it on a quote as a line — on one of the customer's open quotes, or a new quote — as a
// normal line or as an option the customer can tick. The price is the rate card's, worked out again by the server on add.
import { useEffect, useState } from 'react'
import { api } from '../../../api'
import { useToast, useMayWrite } from '../../../shared'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

interface QuoteRow { id: string; number: string; name: string; status: string; total?: string | number }
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback

export default function AddToQuote({ siteId, serviceType, line }: { siteId: string; serviceType: string; line: { description: string; unitPrice: number } }) {
  const toast = useToast()
  const mayAdd = useMayWrite('quotes:update')
  const mayCreate = useMayWrite('quotes:create')
  const [contactId, setContactId] = useState<string | null>(null)
  const [siteName, setSiteName] = useState('')
  const [quotes, setQuotes] = useState<QuoteRow[]>([])
  const [pick, setPick] = useState('new')
  const [optional, setOptional] = useState(false)
  const [busy, setBusy] = useState(false)
  const [doneNote, setDoneNote] = useState('')

  useEffect(() => {
    setDoneNote(''); setQuotes([]); setPick('new')
    ;(async () => {
      try {
        const s = (await api.get(`/api/sites/${siteId}`)) as any
        const site = s?.data ?? s
        setContactId(site?.contactId ?? null); setSiteName(site?.name ?? '')
        if (site?.contactId) {
          const q = (await api.get('/api/quotes', { contactId: site.contactId, limit: 20 })) as any
          const open = ((q?.data ?? []) as QuoteRow[]).filter((x) => x.status === 'draft' || x.status === 'sent')
          setQuotes(open); if (open.length) setPick(open[0].id)
        }
      } catch { /* the "new quote" choice still works */ }
    })()
  }, [siteId, serviceType])

  if (!mayAdd && !mayCreate) return null
  const add = async () => {
    setBusy(true)
    try {
      if (pick === 'new') {
        const q = (await api.post('/api/quotes', {
          name: `${siteName || 'Property'} — ${serviceType.replace(/_/g, ' ')}`, contactId: contactId || undefined, siteId,
          lineItems: [{ description: line.description, quantity: 1, unitPrice: line.unitPrice, type: 'service', optional: false }],
        })) as any
        setDoneNote(`New quote ${q?.number ?? ''} made with this line.`.replace('  ', ' '))
      } else {
        await api.post('/api/area-pricing/quote/add', { quoteId: pick, siteId, serviceType, optional })
        const q = quotes.find((x) => x.id === pick)
        setDoneNote(`Added to quote ${q?.number ?? ''}${optional ? ' as an option' : ''}.`)
      }
      toast.success('Added to the quote')
    } catch (e) { toast.error(errorText(e, 'Could not add it to the quote')) }
    finally { setBusy(false) }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select aria-label="Quote to add to" className="input w-auto" value={pick} onChange={(e) => setPick(e.target.value)}>
        {mayCreate && <option value="new">A new quote for this customer</option>}
        {mayAdd && quotes.map((q) => <option key={q.id} value={q.id}>{q.number} · {q.name} ({codeLabel(q.status)})</option>)}
      </select>
      {pick !== 'new' && <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} /> As an option the customer can tick</label>}
      <button onClick={add} disabled={busy || (pick === 'new' && !mayCreate)} className="btn-primary disabled:opacity-50">Add to quote</button>
      {doneNote && <span className="text-sm text-green-700 dark:text-green-300">{doneNote}</span>}
    </div>
  )
}
