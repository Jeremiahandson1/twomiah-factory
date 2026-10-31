// One material order, read (GET /api/materials/:id): who it is from and for, when it is wanted, who the supplier calls, what is on
// it, and a printable copy (GET /api/material-list/orders/:id/pdf, the roof_material_list feature). Opened from the Materials page
// and from a job's Materials card. What the business paid is shown only to a seat the server shows it to (margin:read).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Printer } from 'lucide-react'
import { api } from '../../../../api'
import { money } from '@twomiah/tenant-ui/src/money'
import { errorText, useAuth, usePermissions, useToast } from '../../../../shared'
import { formatDate } from '../../../date'
import { orderStatusLabel, supplierName } from '../lib/supplier'

interface Line { description?: string; qty?: number; unit?: string; unitPrice?: number; total?: number }
export interface OrderRecord {
  id: string; jobId: string | null; supplier: string | null; orderStatus?: string | null; status?: string | null
  poNumber?: string | null; supplierOrderNumber?: string | null; deliveryAddress?: string | null
  orderDate?: string | null; deliveryDate?: string | null
  contactName?: string | null; contactPhone?: string | null; contactEmail?: string | null
  notes?: string | null; lineItems?: Line[] | null; totalCost?: string | number | null
}

export default function MaterialOrderDetail({ orderId, jobNumber, onClose }: { orderId: string; jobNumber?: string | null; onClose: () => void }) {
  const toast = useToast()
  const hasList = useAuth().hasFeature('roof_material_list')
  const showCost = usePermissions().can('margin:read')
  const [order, setOrder] = useState<OrderRecord | null>(null)
  const [error, setError] = useState('')
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    let live = true
    api.get(`/api/materials/${orderId}`).then((r: any) => { if (live) setOrder(r as OrderRecord) }).catch((e: unknown) => { if (live) setError(errorText(e, 'Could not open the order')) })
    return () => { live = false }
  }, [orderId])

  const print = async () => {
    setPrinting(true)
    try {
      const res = await api.raw(`/api/material-list/orders/${orderId}/pdf`)
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || 'Could not make the PDF')
      const name = /filename="?([^";]+)"?/i.exec(res.headers.get('content-disposition') || '')?.[1] || 'material-order.pdf'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) { toast.error(errorText(e, 'Could not make the PDF')) } finally { setPrinting(false) }
  }

  const fact = (label: string, value: React.ReactNode) => value ? <div><dt className="text-xs text-gray-500 dark:text-slate-400">{label}</dt><dd className="text-sm text-gray-900 dark:text-slate-100">{value}</dd></div> : null
  const contact = order ? [order.contactName, order.contactPhone, order.contactEmail].filter(Boolean).join(' · ') : ''
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-label="Material order" data-testid="material-order" className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Material order{order?.poNumber ? ` ${order.poNumber}` : ''}</h2>
            {order && <p className="text-sm text-gray-600 dark:text-slate-400">{supplierName(order.supplier)} · {orderStatusLabel(order.orderStatus ?? order.status)}</p>}
          </div>
          {order && hasList && (
            <button type="button" onClick={print} disabled={printing} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700">
              <Printer className="w-4 h-4" /> {printing ? 'Making the PDF…' : 'Print / PDF'}
            </button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {!order && !error && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}
        {order && (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fact('Job', order.jobId ? <Link to={`/crm/jobs/${order.jobId}`} className="text-orange-700 hover:underline dark:text-orange-300">{jobNumber || 'Open the job'}</Link> : null)}
              {fact('PO number', order.poNumber)}
              {fact('Supplier order #', order.supplierOrderNumber)}
              {fact('Deliver to', order.deliveryAddress)}
              {fact('Order date', order.orderDate ? formatDate(order.orderDate) : null)}
              {fact('Delivery date', order.deliveryDate ? formatDate(order.deliveryDate) : null)}
              {fact('Point of contact', contact)}
            </dl>
            <table className="w-full text-sm mt-4" data-testid="material-order-lines">
              <thead><tr className="text-left text-xs text-gray-500 dark:text-slate-400"><th className="py-1 pr-2">Qty</th><th className="py-1 pr-2">Unit</th><th className="py-1 pr-2">Material</th>{showCost && <th className="py-1 text-right">Total</th>}</tr></thead>
              <tbody>
                {(order.lineItems || []).map((l, i) => (
                  <tr key={i} className="border-t dark:border-slate-700">
                    <td className="py-1 pr-2">{l.qty}</td><td className="py-1 pr-2">{l.unit}</td><td className="py-1 pr-2">{l.description}</td>
                    {showCost && <td className="py-1 text-right">{l.total != null ? money(l.total) : ''}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {showCost && order.totalCost != null && Number(order.totalCost) > 0 && <p className="text-sm text-right font-medium mt-2 text-gray-900 dark:text-slate-100">Total {money(Number(order.totalCost))}</p>}
            {order.notes && <p className="text-sm text-gray-700 mt-3 whitespace-pre-wrap dark:text-slate-300">{order.notes}</p>}
          </>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg dark:text-slate-300 dark:hover:bg-slate-800">Close</button>
        </div>
      </div>
    </div>
  )
}
