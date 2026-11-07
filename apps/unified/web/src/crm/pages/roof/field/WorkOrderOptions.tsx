// A work order's send options (roofing parity row 27; Roofr + AccuLynx; work_order_send_options, not ready). Server:
// crm/roof/workOrders.ts PUT /api/work-orders/:id/options and POST /:id/send { channel }.
//   · approval: the crew's standing answer, or on / off for this order (off: accepted when sent);
//   · email and CC, besides the text; the crew page in Spanish, with the office's own Spanish scope;
//   · how long the link lasts, and whether the sub sees the materials and the office's photos.
import { useState } from 'react'
import { api } from '../../../../api'
import { useToast, errorText, useMayWrite } from '../../../../shared'

export interface SendOptions {
  requiresApproval?: boolean | null; recipientEmail?: string | null; ccEmails?: string[]; language?: string; scopeEs?: string | null
  linkDays?: number | null; showMaterials?: boolean; showPhotos?: boolean
}

export function WorkOrderOptions({ orderId, value, onSaved, onSend }: { orderId: string; value: SendOptions; onSaved: () => void; onSend: (channel: 'text' | 'email' | 'both') => void }) {
  const toast = useToast()
  // The options and sending are the dispatcher's (the routes ask jobs:dispatch).
  const mayDispatch = useMayWrite('jobs:dispatch')
  const [f, setF] = useState({
    approval: value.requiresApproval === true ? 'on' : value.requiresApproval === false ? 'off' : 'crew',
    email: value.recipientEmail || '', cc: (value.ccEmails || []).join(', '), language: value.language || 'en', scopeEs: value.scopeEs || '',
    linkDays: value.linkDays ? String(value.linkDays) : '', showMaterials: value.showMaterials !== false, showPhotos: value.showPhotos !== false,
  })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/api/work-orders/${orderId}/options`, {
        requiresApproval: f.approval === 'crew' ? null : f.approval === 'on', recipientEmail: f.email.trim() || null,
        ccEmails: f.cc.split(/[,\s]+/).filter(Boolean), language: f.language, scopeEs: f.scopeEs.trim() || null,
        linkDays: f.linkDays ? Number(f.linkDays) : null, showMaterials: f.showMaterials, showPhotos: f.showPhotos,
      })
      toast.success('Send options saved'); onSaved()
    } catch (e) { toast.error(errorText(e, 'Could not save the options')) } finally { setBusy(false) }
  }
  if (!mayDispatch) return null
  const field = 'mt-1 w-full rounded border px-2 py-1 text-sm bg-white dark:bg-slate-900 dark:border-slate-700'
  return (
    <div className="mt-2 rounded-lg border border-gray-200 p-3 text-xs space-y-2 dark:border-slate-700" data-testid="wo-options">
      <div className="grid gap-2 sm:grid-cols-2">
        <label>Ask the crew to accept
          <select className={field} value={f.approval} onChange={(e) => setF({ ...f, approval: e.target.value })}>
            <option value="crew">As the crew is set</option><option value="on">Yes, ask</option><option value="off">No — accepted when sent</option>
          </select>
        </label>
        <label>Crew page language
          <select className={field} value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}><option value="en">English</option><option value="es">Spanish</option></select>
        </label>
        <label>Email to<input className={field} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="crew@example.com" /></label>
        <label>CC (commas between)<input className={field} value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })} /></label>
        <label>Link lasts (days)<input className={field} inputMode="numeric" value={f.linkDays} onChange={(e) => setF({ ...f, linkDays: e.target.value.replace(/[^0-9]/g, '') })} placeholder="30, or a week past the start" /></label>
        <div className="flex flex-col justify-end gap-1">
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.showMaterials} onChange={(e) => setF({ ...f, showMaterials: e.target.checked })} /> The sub sees the materials</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.showPhotos} onChange={(e) => setF({ ...f, showPhotos: e.target.checked })} /> The sub sees the office’s photos</label>
        </div>
      </div>
      {f.language === 'es' && <label className="block">Scope in Spanish (shown instead of the English scope; the page’s own words are in Spanish already)<textarea className={field} rows={3} value={f.scopeEs} onChange={(e) => setF({ ...f, scopeEs: e.target.value })} /></label>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={save} className="rounded border px-2 py-1">Save options</button>
        <button type="button" disabled={busy || !f.email.trim()} onClick={() => onSend('email')} className="rounded border px-2 py-1">Email it</button>
        <button type="button" disabled={busy || !f.email.trim()} onClick={() => onSend('both')} className="rounded border px-2 py-1">Text and email it</button>
      </div>
    </div>
  )
}
