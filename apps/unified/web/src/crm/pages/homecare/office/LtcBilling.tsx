// Long-term care insurance billing (item 3, care_ltc_billing): each client's policy and claim numbers, and a claim packet (PDF)
// for every invoice billed to a long-term care insurer.
//   GET /api/care-ltc/invoices   GET|PUT /api/care-ltc/clients/:id/policy   GET /api/care-ltc/invoices/:id/claim-packet
//   (server/crm/homecare/billing/ltcRoutes.ts). Set a client's payer to a "Long-term care insurance" payer under Payers first.
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll, downloadBlob, saveBlob } from '../lib/http'
import { useMay } from '../lib/useMay'
import { money } from '@twomiah/tenant-ui/src/money'

interface Inv { id: string; invoiceNumber: string; periodStart: string; periodEnd: string; total: string; paymentStatus: string; sentAt: string | null; clientId: string; firstName: string; lastName: string; payerName: string; hasPolicy: boolean }
interface Policy { insuredName: string | null; policyNumber: string | null; claimNumber: string | null; dailyMax: number | null; notes: string | null }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'

export default function LtcBilling() {
  const may = useMay('care-billing')
  const toast = useToast()
  const [invoices, setInvoices] = useState<Inv[]>([])
  const [clientId, setClientId] = useState('')
  const [policy, setPolicy] = useState<Policy | null>(null)

  const load = useCallback(async () => {
    try { setInvoices(rows<Inv>(await listAll('/api/care-ltc/invoices'))) } catch (e) { toast.error(errorMessage(e, 'Could not load invoices')) }
  }, [toast])
  useEffect(() => { load() }, [load])

  const clients = [...new Map(invoices.map((i) => [i.clientId, `${i.lastName}, ${i.firstName}`])).entries()]
  useEffect(() => {
    if (!clientId) { setPolicy(null); return }
    api.get(`/api/care-ltc/clients/${clientId}/policy`).then((p) => setPolicy(p as Policy)).catch((e) => toast.error(errorMessage(e)))
  }, [clientId, toast])

  const save = async () => {
    if (!policy) return
    try {
      await api.put(`/api/care-ltc/clients/${clientId}/policy`, policy)
      toast.success('Saved'); load()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const packet = async (i: Inv) => {
    try { saveBlob(await downloadBlob(`/api/care-ltc/invoices/${i.id}/claim-packet`), `claim-packet-invoice-${i.invoiceNumber}.pdf`) } catch (e) { toast.error(errorMessage(e)) }
  }
  const set = (patch: Partial<Policy>) => policy && setPolicy({ ...policy, ...patch })

  return (
    <div className="p-4 max-w-4xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Long-term care insurance</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">Invoices billed to a long-term care insurer. Enter the client&apos;s policy and claim numbers once, then download a claim packet for each sent invoice: a cover sheet, every service with the caregiver and times, and any day over the policy&apos;s daily maximum. To bill an insurer, add it under Payers as &ldquo;Long-term care insurance&rdquo; and set it as the client&apos;s payer. Sending the packet to the insurer is up to your office.</p>

      <h2 className="text-base font-semibold mb-1">Invoices</h2>
      {invoices.length === 0 ? <p className="text-sm mb-5 text-gray-600 dark:text-slate-400">No invoices are billed to a long-term care insurer yet.</p> : (
        <div className="overflow-x-auto rounded-lg border mb-5 border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left"><th className="px-3 py-1.5">Client</th><th>Invoice</th><th>Period</th><th>Total</th><th>Insurer</th><th /></tr></thead>
            <tbody>{invoices.map((i) => (
              <tr key={i.id} className="border-t border-gray-100 dark:border-slate-700">
                <td className="px-3 py-1.5 font-semibold">{i.firstName} {i.lastName}</td>
                <td>#{i.invoiceNumber}</td>
                <td>{i.periodStart} – {i.periodEnd}</td>
                <td>{money(Number(i.total))}</td>
                <td>{i.payerName}</td>
                <td className="text-right pr-3">{!i.sentAt ? 'Not sent yet' : !i.hasPolicy ? 'Policy needed' : <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => packet(i)}>Claim packet</button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}

      <h2 className="text-base font-semibold mb-1">Policy</h2>
      <select className={inp} aria-label="Client" value={clientId} onChange={(e) => setClientId(e.target.value)}>
        <option value="">Choose a client…</option>
        {clients.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select>
      {policy && (
        <div className="grid sm:grid-cols-2 gap-3 text-sm mt-3">
          <label>Insured&apos;s name (if not the client)<br /><input className={`${inp} w-full`} value={policy.insuredName ?? ''} disabled={!may.update} onChange={(e) => set({ insuredName: e.target.value })} /></label>
          <label>Policy number<br /><input className={`${inp} w-full`} value={policy.policyNumber ?? ''} disabled={!may.update} onChange={(e) => set({ policyNumber: e.target.value })} /></label>
          <label>Claim number<br /><input className={`${inp} w-full`} value={policy.claimNumber ?? ''} disabled={!may.update} onChange={(e) => set({ claimNumber: e.target.value })} /></label>
          <label>Daily maximum ($)<br /><input type="number" min="0" step="0.01" className={`${inp} w-full`} value={policy.dailyMax ?? ''} disabled={!may.update} onChange={(e) => set({ dailyMax: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          {may.update && <div><button type="button" className="hc-btn hc-btn-primary hc-btn-sm" onClick={save}>Save policy</button></div>}
        </div>
      )}
    </div>
  )
}
