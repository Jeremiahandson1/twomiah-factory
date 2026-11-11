// Moved from templates/crm-roof/frontend/src/pages/roofReports/RoofReportsPage.tsx. Changes: Stripe returns here
// (/crm/roof-reports?purchased=true&session_id=… or ?cancelled=true — server/crm/roof/reports/roofReports.ts) and the
// paid session is confirmed once; a 503 or 402 from the confirmation reads as a sentence; the contact picker reads the
// CRM's contact (one `name`); "Create Report" saves the lines drawn in the editor (it sent the preview's own); the
// print button opens the print-ready page (GET /api/roof-reports/:id/pdf) for the browser's Print → Save as PDF; the
// delete asks through the app's dialog.
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileBarChart, Plus, Trash2, Eye, Printer, MapPin, Calendar, Loader2, ArrowLeft, Check } from 'lucide-react'
import { useMayWrite, useToast, useConfirm, errorText } from '../../../../shared'
import { api } from '../../../../api'
import { formatDate } from '../../../date'
import AddressAutocomplete from '../lib/AddressAutocomplete'
import RoofEdgeEditor from './MapEdgeEditor'
import type { ApiEdge, EditorMeasurements, Segment } from './MapEdgeEditor'
import DrawRoofEditor from './DrawRoofEditor'
import type { DrawnPayload } from './DrawRoofEditor'
import type { DrawBackdrop } from '@twomiah/roof-core/src/v2/drawBackdrop'
import { CUSTOMER_PICKER_PARAMS, customersOnly } from '@twomiah/tenant-ui/src/contacts/types'
import { money } from '@twomiah/tenant-ui/src/money'

/** A row of GET /api/roof-reports (no money on the list). */
interface RoofReport {
  id: string
  address: string
  city: string
  state: string
  zip: string
  totalSquares: number | null
  segmentCount: number | null
  imageryQuality: string | null
  imageryDate?: string | null
  status: string // paid, pending_review, completed
  contactId?: string | null
  createdAt: string
}

/** A row of GET /api/contacts (the CRM's contact: one `name`). */
interface Contact {
  id: string
  name: string
}

/** POST /api/roof-reports/purchase with mode 'manual': the preview the roofer draws on (server roofReportService.ts). */
interface Preview {
  address: string
  city: string
  state: string
  zip: string
  contactId?: string
  mode: 'manual'
  geo: { lat: number; lng: number }
  edges: ApiEdge[]
  segments: Segment[]
  measurements: EditorMeasurements
  zoom?: number
  satelliteImageBase64?: string
  aerialImagePath?: string | null
  mapWidth?: number
  mapHeight?: number
}

/** POST /api/roof-reports/draw-backdrop: the picture the roofer draws on, and what goes back with the drawing. */
interface Drawing {
  address: string
  city: string
  state: string
  zip: string
  contactId: string | null
  geo: { lat: number; lng: number }
  quality: string
  imageryDate: string | null
  aerialImagePath: string | null
  aerialImage: string
  backdrop: DrawBackdrop
}

interface PurchaseReply {
  preview?: Preview
  free?: boolean
  pendingReview?: boolean
  checkoutUrl?: string | null
}

interface ConfirmReply {
  alreadyGenerated?: boolean
  pendingReview?: boolean
}

function isSummerMonth(dateStr: string): boolean {
  const parts = dateStr.split('-')
  if (parts.length >= 2) {
    const month = parseInt(parts[1], 10)
    return month >= 6 && month <= 8
  }
  return false
}

/** What a refused confirmation says to the roofer. */
function confirmFailure(err: unknown): string {
  const status = (err as { status?: number } | null)?.status
  if (status === 503) return 'Card payments for roof reports aren\'t set up on this account, so the report could not be made. Contact Twomiah support.'
  if (status === 402) return 'The payment hasn\'t gone through yet, so the report was not made. If you were charged, contact Twomiah support.'
  return errorText(err, 'The report could not be made after payment. Contact Twomiah support.')
}

export default function RoofReportsPage() {
  // A roof report is DRAWN: the roofer traces the roof over the aerial picture and the report is measured from the
  // lines (roof-reports:create). The automatic "Professional Report" ($9.99 through Stripe, roof-reports:purchase) is
  // no longer offered on this screen — its measuring was not accurate enough to sell; its routes are still on the
  // server, unused from here.
  const mayDrawReport = useMayWrite('roof-reports:create')
  // Roof reports are bought in packs ($15 for 100) and one is used each time a roof's aerial picture is loaded.
  const mayBuyPack = useMayWrite('roof-reports:purchase')
  const mayRemoveReport = useMayWrite('roof-reports:delete')
  const toast = useToast()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [reports, setReports] = useState<RoofReport[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [form, setForm] = useState({ address: '', city: '', state: '', zip: '', contactId: '', eaveOverhangInches: '12' })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [finalizing, setFinalizing] = useState(false)
  // The draw-it-yourself report in progress: the picture for the address, drawn on until Done.
  const [drawing, setDrawing] = useState<Drawing | null>(null)
  // Roof reports left, the pack on sale and when to say "top up" (GET /api/roof-reports/credits).
  const [balance, setBalance] = useState<{ credits: number; pack: { roofs: number; priceCents: number }; lowAt: number } | null>(null)
  const [buying, setBuying] = useState(false)
  const confirmedPack = useRef<string | null>(null)
  // The lines as drawn in the editor, which "Create Report" saves.
  const drawn = useRef<{ edges: ApiEdge[]; measurements: EditorMeasurements } | null>(null)
  // A Stripe session is confirmed once, however often this page mounts or its effect re-runs.
  const confirmedSession = useRef<string | null>(null)

  const loadBalance = async () => {
    try { setBalance(await api.get('/api/roof-reports/credits')) } catch { /* the screen works without the count */ }
  }

  useEffect(() => {
    loadReports()
    loadContacts()
    loadBalance()
  }, [])

  // Back from Stripe after buying a pack (server: success_url ?pack_session=…, cancel_url ?pack_cancelled=true).
  useEffect(() => {
    const session = searchParams.get('pack_session')
    const cancelled = searchParams.get('pack_cancelled') === 'true'
    if (!session && !cancelled) return
    const clear = () => { const next = new URLSearchParams(searchParams); next.delete('pack_session'); next.delete('pack_cancelled'); setSearchParams(next, { replace: true }) }
    if (cancelled) { toast.error('The purchase was cancelled. No roof reports were added.'); clear(); return }
    if (!session || confirmedPack.current === session) return
    confirmedPack.current = session
    api.post('/api/roof-reports/credits/confirm', { sessionId: session })
      .then((r: any) => { toast.success(r?.added ? `${r.added} roof reports added. You have ${r.credits}.` : `Those roof reports were already added. You have ${r?.credits}.`) })
      .catch((err: unknown) => toast.error(errorText(err, 'The roof reports could not be added after payment. Contact Twomiah support.')))
      .finally(() => { loadBalance(); clear() })
  }, [searchParams])

  const buyPack = async () => {
    setBuying(true)
    try {
      const r: { checkoutUrl?: string } = await api.post('/api/roof-reports/credits/checkout', {})
      if (r?.checkoutUrl) window.location.href = r.checkoutUrl
      else toast.error('The payment page could not be opened. Try again.')
    } catch (err) {
      toast.error(errorText(err, 'The payment page could not be opened. Try again.'))
    } finally {
      setBuying(false)
    }
  }

  // Stripe's return (server: success_url /crm/roof-reports?purchased=true&session_id=…, cancel_url ?cancelled=true).
  useEffect(() => {
    const purchased = searchParams.get('purchased')
    const sessionId = searchParams.get('session_id')
    if (purchased === 'true' && sessionId && confirmedSession.current !== sessionId) {
      confirmedSession.current = sessionId
      confirmPurchase(sessionId)
    }
    if (searchParams.get('cancelled') === 'true') {
      toast.error('Report purchase was cancelled')
      const next = new URLSearchParams(searchParams)
      next.delete('cancelled')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams])

  const confirmPurchase = async (sessionId: string) => {
    setConfirming(true)
    try {
      const result: ConfirmReply = await api.post('/api/roof-reports/confirm-purchase', { sessionId })
      if (result.alreadyGenerated) {
        toast.success('Report already submitted')
      } else if (result.pendingReview) {
        toast.success('Report submitted! You\'ll be notified when it\'s ready.')
      } else {
        toast.success('Roof report generated!')
      }
      loadReports()
    } catch (err) {
      toast.error(confirmFailure(err))
    } finally {
      setConfirming(false)
      const next = new URLSearchParams(searchParams)
      next.delete('purchased')
      next.delete('session_id')
      setSearchParams(next, { replace: true })
    }
  }

  const loadReports = async () => {
    setLoading(true)
    try {
      const data: { data?: RoofReport[] } = await api.get('/api/roof-reports')
      setReports(data?.data || [])
    } catch {
      toast.error('Failed to load roof reports')
    } finally {
      setLoading(false)
    }
  }

  const loadContacts = async () => {
    try {
      // Customers only: a vendor is never who this is for (contacts/types.ts CUSTOMER_PICKER_PARAMS).
      const data: { data?: Contact[] } = await api.get('/api/contacts', { limit: 200, ...CUSTOMER_PICKER_PARAMS })
      setContacts(customersOnly(data?.data || []))
    } catch { /* the picker is optional: no contacts:read, no list */ }
  }

  const handleGenerate = async (mode: 'manual' | 'auto') => {
    if (!form.address || !form.city || !form.state || !form.zip) {
      toast.error('Address, city, state, and zip are required')
      return
    }
    setPurchasing(true)
    try {
      // Draw it yourself: the aerial picture for the address, then the drawing screen. Nothing is bought.
      if (mode === 'manual') {
        const picture: Drawing = await api.post('/api/roof-reports/draw-backdrop', {
          address: form.address, city: form.city, state: form.state, zip: form.zip,
          ...(form.contactId && { contactId: form.contactId }),
        })
        setDrawing(picture)
        setShowForm(false)
        loadBalance()
        return
      }
      const result: PurchaseReply = await api.post('/api/roof-reports/purchase', {
        address: form.address,
        city: form.city,
        state: form.state,
        zip: form.zip,
        eaveOverhangInches: Number(form.eaveOverhangInches) || 0,
        mode,
        ...(form.contactId && { contactId: form.contactId }),
      })

      if (result.pendingReview) {
        // Auto-detect: saved and sent for review, customer sees "Processing"
        toast.success('Report submitted! You\'ll be notified when it\'s ready.')
        setShowForm(false)
        loadReports()
      } else if (result.free && result.preview) {
        // Manual: show editor
        drawn.current = { edges: result.preview.edges, measurements: result.preview.measurements }
        setPreview(result.preview)
        setShowForm(false)
      } else if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl
      }
    } catch (err) {
      toast.error(errorText(err, 'The aerial picture could not be loaded. Try again.'))
      loadBalance()
    } finally {
      setPurchasing(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirm('Are you sure you want to delete this roof report?', { title: 'Delete roof report', confirmText: 'Delete' }))) return
    setDeleting(id)
    try {
      await api.delete(`/api/roof-reports/${id}`)
      toast.success('Roof report deleted')
      setReports((prev) => prev.filter((r) => r.id !== id))
    } catch {
      toast.error('Failed to delete roof report')
    } finally {
      setDeleting(null)
    }
  }

  // The print-ready report in a new tab; the browser's Print saves it as a PDF.
  const handlePrint = (id: string) => {
    window.open(`${api.baseUrl || ''}/api/roof-reports/${id}/pdf`, '_blank', 'noopener')
  }

  const qualityBadge = (quality: string) => {
    const colors: Record<string, string> = {
      HIGH: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40',
      MEDIUM: 'bg-yellow-100 text-yellow-700 dark:text-yellow-300 dark:bg-yellow-950/40',
      LOW: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40',
    }
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[quality] || 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800'} dark:text-slate-200`}>
        {quality}
      </span>
    )
  }

  // Show loading overlay while confirming Stripe purchase
  if (confirming) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="w-10 h-10 text-orange-600 dark:text-orange-200 animate-spin" />
        <p className="text-gray-600 font-medium dark:text-slate-400">Generating your roof report...</p>
        <p className="text-sm text-gray-500 dark:text-slate-400">Analyzing satellite imagery and computing measurements</p>
      </div>
    )
  }

  // --- Finalize: save preview + user's edges to DB ---
  const handleFinalize = async (edges: ApiEdge[], measurements: EditorMeasurements) => {
    setFinalizing(true)
    try {
      await api.post('/api/roof-reports/finalize', { preview, edges, measurements })
      toast.success('Roof report created!')
      setPreview(null)
      drawn.current = null
      setForm({ address: '', city: '', state: '', zip: '', contactId: '', eaveOverhangInches: '12' })
      loadReports()
    } catch (err) {
      toast.error(errorText(err, 'Failed to create report'))
      throw err
    } finally {
      setFinalizing(false)
    }
  }

  // --- Done on the drawing screen: the lines and pitches are measured and saved by the server ---
  const handleDrawn = async (drawn: DrawnPayload) => {
    if (!drawing) return
    setFinalizing(true)
    try {
      await api.post('/api/roof-reports/finalize-drawn', {
        address: drawing.address, city: drawing.city, state: drawing.state, zip: drawing.zip,
        ...(drawing.contactId && { contactId: drawing.contactId }),
        geo: drawing.geo, quality: drawing.quality, imageryDate: drawing.imageryDate, aerialImagePath: drawing.aerialImagePath,
        ...drawn,
      })
      toast.success('Roof report created!')
      setDrawing(null)
      setForm({ address: '', city: '', state: '', zip: '', contactId: '', eaveOverhangInches: '12' })
      loadReports()
    } catch (err) {
      toast.error(errorText(err, 'Failed to create report'))
    } finally {
      setFinalizing(false)
    }
  }

  // --- The drawing screen ---
  if (drawing) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <button
          onClick={() => setDrawing(null)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 dark:text-slate-400"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Draw the roof</h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
            {drawing.address}, {drawing.city}, {drawing.state} {drawing.zip} — pick a line type, click dot to dot, and press Done.
            {drawing.imageryDate ? ` Aerial picture taken ${formatDate(drawing.imageryDate)}.` : ''}
          </p>
        </div>
        <DrawRoofEditor aerialImage={drawing.aerialImage} backdrop={drawing.backdrop} busy={finalizing} onDone={handleDrawn} />
      </div>
    )
  }

  // --- Preview/Editor view ---
  if (preview) {
    const aerialUrl = preview.satelliteImageBase64 || `/api/roof-reports/preview-aerial/${(preview.aerialImagePath?.split('/').pop() || '')}`
    const zoom = preview.zoom || 20

    return (
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <button
          onClick={() => setPreview(null)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 dark:text-slate-400"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100">Draw Roof Measurements</h1>
            </div>
            <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
              {preview.address}, {preview.city}, {preview.state} {preview.zip} — Draw ridge, valley, hip, and eave lines on the satellite image.
            </p>
          </div>
          {mayDrawReport && (<button
            onClick={() => {
              const d = drawn.current || { edges: preview.edges, measurements: preview.measurements }
              handleFinalize(d.edges, d.measurements).catch(() => { /* toasted */ })
            }}
            disabled={finalizing}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-700 text-white text-sm font-medium rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {finalizing ? 'Creating...' : 'Create Report'}
          </button>)}
        </div>

        <RoofEdgeEditor
          reportId="preview"
          edges={preview.edges}
          segments={preview.segments}
          centerLat={preview.geo.lat}
          centerLng={preview.geo.lng}
          zoom={zoom}
          aerialImageUrl={aerialUrl}
          mapWidth={preview.mapWidth || 800}
          mapHeight={preview.mapHeight || 600}
          initialMode="add"
          onSave={handleFinalize}
          onChange={(edges, measurements) => { drawn.current = { edges, measurements } }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Roof Reports</h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Draw a roof over its aerial picture and get its measurements and materials list</p>
        </div>
        {mayDrawReport && (<button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Report
        </button>)}
      </div>

      {/* Roof reports left, and buying a pack */}
      {balance && (() => {
        const price = money(balance.pack.priceCents / 100, balance.pack.priceCents % 100 ? 2 : 0)
        const out = balance.credits <= 0, low = !out && balance.credits <= balance.lowAt
        return (
          <div role="status" className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${out ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40' : low ? 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40' : 'bg-white dark:bg-slate-900'}`}>
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100">
                {out ? 'You have no roof reports left' : `${balance.credits.toLocaleString()} roof ${balance.credits === 1 ? 'report' : 'reports'} left`}
                {low && <span className="ml-2 text-amber-800 dark:text-amber-300">— running low</span>}
              </p>
              <p className="text-xs text-gray-600 mt-0.5 dark:text-slate-400">
                One is used each time you load the aerial picture for a roof, and for each new house your website's instant estimator measures. A pack of {balance.pack.roofs} is {price}.
                {!mayBuyPack && (out || low) ? ' Ask an owner or admin to buy more.' : ''}
              </p>
            </div>
            {mayBuyPack && (
              <button type="button" onClick={buyPack} disabled={buying}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg disabled:opacity-50 transition-colors ${out || low ? 'bg-orange-600 text-white hover:bg-orange-700' : 'border text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
                {buying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Buy {balance.pack.roofs} for {price}
              </button>
            )}
          </div>
        )
      })()}

      {/* New Report Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6 dark:bg-slate-900">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">New roof report</h2>
            <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">Enter the address. The aerial picture opens and you draw the roof on it.</p>
          </div>
          <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Street Address *</label>
              <AddressAutocomplete
                value={form.address}
                onChange={(val) => setForm((f) => ({ ...f, address: val }))}
                onSelect={(parsed) => setForm((f) => ({ ...f, ...parsed }))}
                placeholder="Start typing an address..."
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">City *</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">State *</label>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Zip *</label>
                <input
                  type="text"
                  value={form.zip}
                  onChange={(e) => setForm({ ...form, zip: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Link to Contact (optional)</label>
              <select
                value={form.contactId}
                onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
              >
                <option value="">No contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="pt-4 border-t space-y-3">
              <p className="text-xs text-gray-500 dark:text-slate-400">
                You pick a line type (eave, rake, ridge, hip, valley, flashing) and click dot to dot. The report gives the area and squares, the pitch of each section, every line's length, a materials list, and a page to print or save as a PDF.
              </p>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition-colors dark:text-slate-200"
                >
                  Cancel
                </button>
                <span className="text-xs text-gray-500 dark:text-slate-400">Uses 1 roof report</span>
                {mayDrawReport && (<button
                  type="button"
                  onClick={() => handleGenerate('manual')}
                  disabled={purchasing || (balance != null && balance.credits <= 0)}
                  title={balance != null && balance.credits <= 0 ? 'You have no roof reports left. Buy a pack to draw another roof.' : undefined}
                  className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors"
                >
                  {purchasing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {purchasing ? 'Loading the aerial picture…' : 'Draw the roof'}
                </button>)}
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Reports List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center dark:bg-slate-900">
          <FileBarChart className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1 dark:text-slate-100">No roof reports yet</h3>
          <p className="text-sm text-gray-500 mb-1 dark:text-slate-400">Enter an address, draw the roof over its aerial picture, and the report is measured from your lines.</p>
          <p className="text-xs text-gray-500 dark:text-slate-400 mb-4">Area and squares, pitch by section, eaves, rakes, ridges, hips, valleys and flashing, and a materials list.</p>
          {mayDrawReport && (<button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Draw your first report
          </button>)}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
          <table className="w-full">
            <thead className="bg-gray-50 border-b dark:bg-slate-900">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Address</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Squares</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Segments</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Quality</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Date</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{report.address}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">{report.city}, {report.state} {report.zip}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">
                    {report.status === 'pending_review' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40">
                        <Loader2 className="w-3 h-3 animate-spin" /> Processing
                      </span>
                    ) : report.totalSquares ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600 dark:text-slate-400">{report.segmentCount ?? '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {report.imageryQuality ? qualityBadge(report.imageryQuality) : '-'}
                      {report.imageryDate && isSummerMonth(report.imageryDate) && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 dark:text-amber-300 dark:bg-amber-950/40" title="Summer imagery — trees may obscure roof">Summer</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-slate-400">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(report.createdAt)}
                      </div>
                      {report.imageryDate && (
                        <span className="text-[11px] text-gray-500 dark:text-slate-400">Imagery: {report.imageryDate}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigate(`/crm/roof-reports/${report.id}`)}
                        className="p-2 text-gray-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors dark:text-slate-400 dark:hover:text-orange-200 dark:hover:bg-orange-950/40"
                        title="View details"
                        aria-label="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handlePrint(report.id)}
                        className="p-2 text-gray-500 hover:text-orange-700 hover:bg-orange-50 rounded-lg transition-colors dark:text-slate-400 dark:hover:text-orange-200 dark:hover:bg-orange-950/40"
                        title="Print / Save as PDF — opens the print-ready report in a new tab; use your browser's Print to save it as a PDF"
                        aria-label="Print or save as PDF"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      {mayRemoveReport && (<button
                        onClick={() => handleDelete(report.id)}
                        disabled={deleting === report.id}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-950/40"
                        title="Delete report"
                        aria-label="Delete report"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
