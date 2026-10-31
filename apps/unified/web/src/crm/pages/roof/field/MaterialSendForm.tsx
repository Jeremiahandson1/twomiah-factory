// Send one material order, or several of one supplier's, to the supplier by email (POST /api/material-supply/orders/:id/send and
// /orders/send, the material_supply feature, inventory:update). The box starts with the people this supplier was last emailed at,
// a subject and a message; the order goes as a PDF with no prices on it. If the supplier is ABC, QXO or SRS the box says their
// ordering API is not connected (it needs a partner agreement) and that the order goes by email.
import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { api } from '../../../../api'
import { errorText, useMayWrite, useToast } from '../../../../shared'

interface Start { to: string[]; cc: string[]; subject: string; message: string; attachment: string; sendable: boolean; statusLabel: string; supplierApi: { label: string; connected: boolean } | null }
interface BulkResult { sent: number; failed: number; results: Array<{ id: string; sent: boolean; error?: string }> }

export default function MaterialSendForm({ orderIds, onClose, onSent }: { orderIds: string[]; onClose: () => void; onSent: () => void }) {
  const toast = useToast()
  const many = orderIds.length > 1
  // POST …/send asks inventory:update.
  const mayUpdate = useMayWrite('inventory:update')
  const [start, setStart] = useState<Start | null>(null)
  const [to, setTo] = useState('')
  const [cc, setCc] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<BulkResult | null>(null)

  useEffect(() => {
    let live = true
    api.get(`/api/material-supply/orders/${orderIds[0]}/send`).then((r: any) => {
      if (!live) return
      const s = r as Start
      setStart(s); setTo(s.to.join(', ')); setCc(s.cc.join(', ')); setSubject(many ? '' : s.subject); setMessage(s.message)
    }).catch((e: unknown) => { if (live) setError(errorText(e, 'Could not open the send box')) })
    return () => { live = false }
  }, [orderIds[0]])

  const send = async () => {
    setSending(true); setError(''); setFields({})
    try {
      if (many) {
        const r = (await api.post('/api/material-supply/orders/send', { orderIds, to, cc, subject: subject.trim() || undefined, message })) as BulkResult
        setOutcome(r); onSent()
        if (!r.failed) toast.success(`${r.sent} orders sent to the supplier`)
      } else {
        await api.post(`/api/material-supply/orders/${orderIds[0]}/send`, { to, cc, subject, message })
        toast.success('Order sent to the supplier'); onSent(); onClose()
      }
    } catch (e: any) {
      setFields((e?.data?.fields as Record<string, string>) || {})
      setError(errorText(e, 'The order could not be sent'))
    } finally { setSending(false) }
  }

  const box = 'w-full border rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:border-slate-600'
  const label = 'block text-xs text-gray-600 mb-1 dark:text-slate-400'
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Send to supplier" data-testid="send-to-supplier" className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">{many ? `Send ${orderIds.length} orders to the supplier` : 'Send to the supplier'}</h2>
        {!start && !error && <p className="text-sm text-gray-500 mt-2 dark:text-slate-400">Loading…</p>}
        {start && !outcome && (
          <div className="space-y-3 mt-3">
            {start.supplierApi && (
              <p data-testid="supplier-api-note" className="text-xs rounded-lg bg-gray-50 border px-3 py-2 text-gray-700 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-300">
                {start.supplierApi.label} takes orders through its own ordering system once your company is set up with it; that is not connected yet, so this order goes by email.
              </p>
            )}
            <div>
              <label htmlFor="send-to" className={label}>To (separate several with commas)</label>
              <input id="send-to" value={to} onChange={(e) => setTo(e.target.value)} className={box} inputMode="email" autoComplete="off" />
              {fields.to && <p role="alert" className="text-xs text-red-700 mt-1 dark:text-red-300">{fields.to}</p>}
            </div>
            <div>
              <label htmlFor="send-cc" className={label}>Copy</label>
              <input id="send-cc" value={cc} onChange={(e) => setCc(e.target.value)} className={box} inputMode="email" autoComplete="off" />
              {fields.cc && <p role="alert" className="text-xs text-red-700 mt-1 dark:text-red-300">{fields.cc}</p>}
            </div>
            <div>
              <label htmlFor="send-subject" className={label}>Subject{many ? ' (leave empty to name each order)' : ''}</label>
              <input id="send-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={box} />
            </div>
            <div>
              <label htmlFor="send-message" className={label}>Message</label>
              <textarea id="send-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} className={box} />
            </div>
            <p className="text-xs text-gray-500 dark:text-slate-400">{many ? 'Each order goes as its own email with its PDF attached.' : `The order goes as a PDF, ${start.attachment}, with the materials listed in the email.`} Prices are not included. Replies come to you.</p>
          </div>
        )}
        {outcome && (
          <div data-testid="send-outcome" className="mt-3 space-y-1 text-sm">
            <p className="text-gray-900 dark:text-slate-100">{outcome.sent} sent{outcome.failed ? `, ${outcome.failed} not sent` : ''}.</p>
            {outcome.results.filter((r) => !r.sent).map((r) => <p key={r.id} role="alert" className="text-red-700 dark:text-red-300">{r.error}</p>)}
          </div>
        )}
        {error && <p role="alert" className="text-sm text-red-700 mt-3 dark:text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg dark:text-slate-300 dark:hover:bg-slate-800">{outcome ? 'Close' : 'Cancel'}</button>
          {start && !outcome && (
            <button type="button" onClick={send} disabled={sending || !mayUpdate || (!many && !start.sendable)} className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50">
              <Send className="w-4 h-4" /> {sending ? 'Sending…' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
