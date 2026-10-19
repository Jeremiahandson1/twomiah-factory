// Moved from templates/crm-homecare/frontend/src/components/admin/InsuranceCardUploader.tsx — front and back photos of
// the client's insurance card. Saved through their own endpoint (not the client save, so a 5 MB image is not resent on
// every edit); a phone opens the camera. Photos are shrunk to 1600px JPEG before upload.
//   GET /api/insurance-cards/:clientId?side=  → { side, image, uploadedAt }
//   PUT /api/insurance-cards/:clientId { side, imageBase64 }  (null clears that side)
import { useState, useEffect } from 'react'
import { useConfirm, useToast } from '../../../../shared'
import { api, errorMessage } from '../lib/http'
import { useMay } from '../lib/useMay'

const compress = async (file: File): Promise<string> => {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file)
  })
  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })
  const MAX = 1600
  const scale = Math.min(1, MAX / Math.max(img.width, img.height))
  const w = Math.round(img.width * scale); const h = Math.round(img.height * scale)
  const c = document.createElement('canvas'); c.width = w; c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0, w, h)
  return c.toDataURL('image/jpeg', 0.85)
}

type Side = 'front' | 'back'

export default function InsuranceCardUploader({ clientId }: { clientId: string }) {
  // Uploading and removing are care-clients:update, the server's check (lib/useMay.ts).
  const may = useMay('care-clients')
  const toast = useToast()
  const confirm = useConfirm()
  const [front, setFront] = useState<string | null>(null)
  const [back, setBack] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Side | null>(null)

  useEffect(() => {
    if (!clientId) return
    Promise.all((['front', 'back'] as const).map((side) =>
      api.get(`/api/insurance-cards/${clientId}`, { side }).catch(() => null) as Promise<{ image?: string | null } | null>))
      .then(([f, b]) => { setFront(f?.image || null); setBack(b?.image || null) })
      .finally(() => setLoading(false))
  }, [clientId])

  const save = async (side: Side, imageBase64: string | null) => {
    await api.put(`/api/insurance-cards/${clientId}`, { side, imageBase64 })
  }

  const upload = async (side: Side, file: File) => {
    if (!file?.type?.startsWith('image/')) { toast.error('Pick an image'); return }
    setBusy(side)
    try {
      const dataUri = await compress(file)
      await save(side, dataUri)
      if (side === 'front') setFront(dataUri); else setBack(dataUri)
    } catch (e) { toast.error('Upload failed: ' + errorMessage(e, 'upload failed')) }
    finally { setBusy(null) }
  }

  const clear = async (side: Side) => {
    if (!(await confirm(`Remove ${side} of insurance card?`, { danger: true }))) return
    setBusy(side)
    try {
      await save(side, null)
      if (side === 'front') setFront(null); else setBack(null)
    } catch (e) { toast.error('Not removed: ' + errorMessage(e, 'upload failed')) }
    finally { setBusy(null) }
  }

  const sideBlock = (label: string, img: string | null, sideKey: Side) => (
    <div className="flex-1 min-w-[220px]">
      <div className="mb-1 text-xs font-bold text-gray-700 dark:text-slate-200">{label}</div>
      <div className="h-40 flex items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-100 dark:border-slate-700 dark:bg-slate-900">
        {img ? <img src={img} alt={`Insurance card ${label.toLowerCase()}`} className="max-w-full max-h-full object-contain" />
          : <span className="text-sm text-gray-500 dark:text-slate-400">No image</span>}
      </div>
      {may.update && <div className="flex gap-1.5 mt-1.5">
        <label className="hc-btn hc-btn-sm hc-btn-secondary" style={{ cursor: busy === sideKey ? 'wait' : 'pointer', opacity: busy === sideKey ? 0.6 : 1 }}>
          {busy === sideKey ? 'Uploading…' : img ? 'Replace' : '+ Upload'}
          <input type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload(sideKey, f) }} />
        </label>
        {img && (
          <button type="button" disabled={busy === sideKey} onClick={() => clear(sideKey)}
            className="px-2.5 py-1 rounded-md text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200">Remove</button>
        )}
      </div>}
    </div>
  )

  return (
    <>
      <h4 style={{ borderBottom: '2px solid var(--hc-blue-ink)', paddingBottom: '0.5rem', marginTop: '1rem', marginBottom: '0.75rem' }}>Insurance Card Images</h4>
      {loading ? (
        <div className="text-sm text-gray-500 dark:text-slate-400">Loading…</div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {sideBlock('Front', front, 'front')}
          {sideBlock('Back', back, 'back')}
        </div>
      )}
    </>
  )
}
