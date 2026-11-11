// Where an order is filled from, on the order page (parity tier 2 #11, stock by location — Shopify's fulfilment location; server
// crm/store/stock/locations.ts /orders/:id; feature store_locations, not ready). The location its units came off, and — before it is
// sent, with nothing refunded — a change of location, which puts those units back and takes them at the new one.
import { useEffect, useState } from 'react'
import { api } from '../../../../api'
import { errorText, useAuth, usePermissions, useToast } from '../../../../shared'

interface Where { locationId: string | null; locationName: string | null; locations: Array<{ id: string; name: string }>; canChange: boolean; why: string | null }

export function OrderLocation({ orderId, status, onChanged }: { orderId: string; /** the order's status: read again when it moves (sent — live test 11/11: the picker stayed until a reload) */ status?: string; onChanged?: () => void }) {
  const on = useAuth().hasFeature('store_locations')
  const { known, can } = usePermissions()
  const mayChange = !known || can('orders:update')
  const toast = useToast()
  const [where, setWhere] = useState<Where | null>(null)
  const [saving, setSaving] = useState(false)
  const load = () => api.get(`/api/admin/stock-locations/orders/${encodeURIComponent(orderId)}`).then((r: any) => setWhere(r)).catch(() => setWhere(null))
  useEffect(() => { if (on) load() }, [on, orderId, status]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!on || !where || !where.locationId) return null
  const change = async (to: string) => {
    setSaving(true)
    try { await api.put(`/api/admin/stock-locations/orders/${encodeURIComponent(orderId)}`, { locationId: to }); toast.success('Location changed — the stock moved with it'); await load(); onChanged?.() }
    catch (e) { toast.error(errorText(e, "Couldn't change the location")) } finally { setSaving(false) }
  }
  return (
    <div className="text-sm text-gray-800 dark:text-slate-200" data-testid="order-location">
      {where.canChange && mayChange && where.locations.length > 1 ? (
        <label>Filled from{' '}
          <select className="input ml-1 w-auto" value={where.locationId} disabled={saving} onChange={(e) => void change(e.target.value)}>
            {where.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      ) : (
        <p>Filled from <span className="font-medium">{where.locationName || 'a location that was removed'}</span>{where.why && where.locations.length > 1 ? <span className="text-gray-600 dark:text-slate-400"> — {where.why}</span> : null}</p>
      )}
    </div>
  )
}
