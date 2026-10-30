// A roofing job's material orders (GET /api/materials?jobId=, the materials feature) and a New order button
// (./MaterialOrderForm, inventory:create). The job page had no Materials card and the Materials page no add control,
// so nothing could be ordered against a job (live test 2026-10-22). The cost shows only to margin:read, the permission
// the server withholds it by (materials.ts).
import { useCallback, useEffect, useState } from 'react'
import { Package, Plus } from 'lucide-react'
import { api } from '../../../../api'
import { money } from '@twomiah/tenant-ui/src/money'
import { useAuth, useMayWrite, usePermissions } from '../../../../shared'
import { formatDate } from '../../../date'
import { supplierName } from '../lib/supplier'
import { listOf } from './http'
import MaterialOrderForm from './MaterialOrderForm'
import MaterialListBuilder from './MaterialListBuilder'

interface Order {
  id: string; supplier?: string | null; status?: string | null; orderDate?: string | null; deliveryDate?: string | null
  totalCost?: string | number | null; lineItems?: Array<{ description?: string; qty?: number; unit?: string }> | null
}

export default function JobMaterials({ jobId, jobAddress }: { jobId: string; jobAddress?: string | null }) {
  const mayAdd = useMayWrite('inventory:create')
  const showCost = usePermissions().can('margin:read')
  const [orders, setOrders] = useState<Order[]>([])
  const [open, setOpen] = useState(false)
  // The squares → material list calculator (roof_material_list, not ready): offered with the same permission that orders.
  const hasList = useAuth().hasFeature('roof_material_list')
  const [listOpen, setListOpen] = useState(false)

  const load = useCallback(async () => {
    try { setOrders(listOf<Order>(await api.get('/api/materials', { jobId, limit: 100 }))) } catch { setOrders([]) }
  }, [jobId])
  useEffect(() => { load() }, [load])

  return (
    <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900" data-testid="job-materials">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100">
          <Package className="w-4 h-4 text-gray-400" /> Materials
        </h2>
        <div className="flex items-center gap-4">
        {mayAdd && hasList && (
          <button type="button" onClick={() => setListOpen(true)} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">
            Material list
          </button>
        )}
        {mayAdd && (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline dark:text-orange-300">
            <Plus className="w-4 h-4" /> New order
          </button>
        )}
        </div>
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">No material orders</p>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="text-sm border-b last:border-0 pb-2 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-gray-900 dark:text-slate-100">{supplierName(o.supplier) || '—'}</span>
                <span className="text-xs text-gray-600 dark:text-slate-400">{(o.status || '').replace(/_/g, ' ')}</span>
              </div>
              <p className="text-xs text-gray-600 dark:text-slate-400">
                {(o.lineItems || []).map((l) => `${l.qty ?? ''} ${l.unit ?? ''} ${l.description ?? ''}`.trim()).join(' · ')}
              </p>
              <p className="text-xs text-gray-500 dark:text-slate-400">
                {o.orderDate ? `Ordered ${formatDate(o.orderDate)}` : 'Not ordered yet'}{o.deliveryDate ? ` · Delivery ${formatDate(o.deliveryDate)}` : ''}
                {showCost && o.totalCost != null ? ` · ${money(o.totalCost)}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
      {listOpen && <MaterialListBuilder jobId={jobId} onClose={() => setListOpen(false)} onSaved={load} />}
      {open && <MaterialOrderForm jobId={jobId} jobAddress={jobAddress} onClose={() => setOpen(false)} onSaved={load} />}
    </div>
  )
}
