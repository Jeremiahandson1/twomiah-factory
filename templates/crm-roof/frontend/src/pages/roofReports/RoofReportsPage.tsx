import { useState, useEffect } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FileBarChart, Plus, Trash2, Eye, Download, MapPin, Calendar, DollarSign, Loader2, ArrowLeft, Check } from 'lucide-react'
import api from '../../services/api'
import AddressAutocomplete from '../../components/common/AddressAutocomplete'
import RoofEdgeEditor from './RoofEdgeEditor'

interface RoofReport {
  id: string
  address: string
  city: string
  state: string
  zip: string
  totalSquares: number
  segmentCount: number
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW'
  imageryDate?: string | null
  status: string
  contactId?: string
  createdAt: string
}

interface Contact {
  id: string
  firstName: string
  lastName: string
}

function isSummerMonth(dateStr: string): boolean {
  const parts = dateStr.split('-')
  if (parts.length >= 2) {
    const month = parseInt(parts[1], 10)
    return month >= 6 && month <= 8
  }
  return false
}

export default function RoofReportsPage() {
  const { token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [reports, setReports] = useState<RoofReport[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [form, setForm] = useState({ address: '', city: '', state: '', zip: '', contactId: '', eaveOverhangInches: 12 })
  const [preview, setPreview] = useState<any>(null)
  const [finalizing, setFinalizing] = useState(false)

  useEffect(() => {
    loadReports()
    loadContacts()
  }, [])

  // Handle Stripe success redirect
  useEffect(() => {
    const purchased = searchParams.get('purchased')
    const sessionId = searchParams.get('session_id')
    if (purchased === 'true' && sessionId) {
      confirmPurchase(sessionId)
    }
    const cancelled = searchParams.get('cancelled')
    if (cancelled === 'true') {
      toast.error('Report purchase was cancelled')
      searchParams.delete('cancelled')
      setSearchParams(searchParams, { replace: true })
    }
  }, [searchParams])

  const confirmPurchase = async (sessionId: string) => {
    setConfirming(true)
    try {
      const result = await api.request('/api/roof-reports/confirm-purchase', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      })
      if (result.alreadyGenerated) {
        toast.success('Report already generated')
      } else {
        toast.success('Roof report generated successfully!')
      }
      loadReports()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to generate report after payment')
    } finally {
      setConfirming(false)
      // Clean up URL params
      searchParams.delete('purchased')
      searchParams.delete('session_id')
      setSearchParams(searchParams, { replace: true })
    }
  }

  const loadReports = async () => {
    setLoading(true)
    try {
      const data = await api.request('/api/roof-reports')
      setReports(data?.data || [])
    } catch {
      toast.error('Failed to load roof reports')
    } finally {
      setLoading(false)
    }
  }

  const loadContacts = async () => {
    try {
      const data = await api.request('/api/contacts?limit=200')
      setContacts(data?.data || data || [])
    } catch {}
  }

  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.address || !form.city || !form.state || !form.zip) {
      toast.error('Address, city, state, and zip are required')
      return
    }
    setPurchasing(true)
    try {
      const result = await api.request('/api/roof-reports/purchase', {
        method: 'POST',
        body: JSON.stringify({
          address: form.address,
          city: form.city,
          state: form.state,
          zip: form.zip,
          eaveOverhangInches: form.eaveOverhangInches,
          ...(form.contactId && { contactId: form.contactId }),
        }),
      })

      if (result.free && result.preview) {
        // No Stripe — show editor preview for review/adjustment
        setPreview(result.preview)
        setShowForm(false)
      } else if (result.free && result.report) {
        // Legacy fallback
        toast.success('Roof report generated!')
        setShowForm(false)
        loadReports()
      } else if (result.checkoutUrl) {
        // Redirect to Stripe Checkout
        window.location.href = result.checkoutUrl
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to start purchase')
    } finally {
      setPurchasing(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this roof report?')) return
    setDeleting(id)
    try {
      await api.request(`/api/roof-reports/${id}`, { method: 'DELETE' })
      toast.success('Roof report deleted')
      setReports((prev) => prev.filter((r) => r.id !== id))
    } catch {
      toast.error('Failed to delete roof report')
    } finally {
      setDeleting(null)
    }
  }

  const handleDownloadPdf = async (id: string) => {
    // Opens the print-friendly HTML view in a new tab
    window.open(`${window.location.origin}/api/roof-reports/${id}/html`, '_blank')
  }

  const qualityBadge = (quality: string) => {
    const colors: Record<string, string> = {
      HIGH: 'bg-green-100 text-green-700',
      MEDIUM: 'bg-yellow-100 text-yellow-700',
      LOW: 'bg-red-100 text-red-700',
    }
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[quality] || 'bg-gray-100 text-gray-700'}`}>
        {quality}
      </span>
    )
  }

  // Show loading overlay while confirming Stripe purchase
  if (confirming) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
        <p className="text-gray-600 font-medium">Generating your roof report...</p>
        <p className="text-sm text-gray-400">Analyzing satellite imagery and computing measurements</p>
      </div>
    )
  }

  // --- Finalize: save preview + user's edges to DB ---
  const handleFinalize = async (edges: any[], measurements: any) => {
    setFinalizing(true)
    try {
      await api.request('/api/roof-reports/finalize', {
        method: 'POST',
        body: JSON.stringify({ preview, edges, measurements }),
      })
      toast.success('Roof report created!')
      setPreview(null)
      setForm({ address: '', city: '', state: '', zip: '', contactId: '', eaveOverhangInches: 12 })
      loadReports()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create report')
    } finally {
      setFinalizing(false)
    }
  }

  // --- Preview/Editor view ---
  if (preview) {
    const aerialUrl = preview.satelliteImageBase64 || `/api/roof-reports/preview-aerial/${(preview.aerialImagePath?.split('/').pop() || '')}`
    const zoom = preview.zoom || 20

    return (
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <button
          onClick={() => setPreview(null)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Review Roof Measurements</h1>
            <p className="text-sm text-gray-500 mt-1">
              {preview.address}, {preview.city}, {preview.state} {preview.zip} — Adjust lines as needed, then create report.
            </p>
          </div>
          <button
            onClick={() => handleFinalize(preview.edges, preview.measurements)}
            disabled={finalizing}
            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {finalizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {finalizing ? 'Creating...' : 'Create Report'}
          </button>
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
          onSave={handleFinalize}
        />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Roof Reports</h1>
          <p className="text-sm text-gray-500 mt-1">Professional satellite-based roof measurement reports</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Report
        </button>
      </div>

      {/* New Report Form */}
      {showForm && (
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Generate New Roof Report</h2>
            <span className="flex items-center gap-1 text-sm font-semibold text-green-700 bg-green-50 px-3 py-1 rounded-full">
              <DollarSign className="w-3.5 h-3.5" />
              $9.99 per report
            </span>
          </div>
          <form onSubmit={handlePurchase} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Street Address *</label>
              <AddressAutocomplete
                value={form.address}
                onChange={(val) => setForm({ ...form, address: val })}
                onSelect={(parsed) => setForm({ ...form, ...parsed })}
                placeholder="Start typing an address..."
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">City *</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Dallas"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">State *</label>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="TX"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Zip *</label>
                <input
                  type="text"
                  value={form.zip}
                  onChange={(e) => setForm({ ...form, zip: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="75201"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link to Contact (optional)</label>
              <select
                value={form.contactId}
                onChange={(e) => setForm({ ...form, contactId: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">No contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Eave Overhang Offset</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  max={36}
                  value={form.eaveOverhangInches}
                  onChange={(e) => setForm({ ...form, eaveOverhangInches: Number(e.target.value) || 0 })}
                  className="w-24 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <span className="text-sm text-gray-500">inches (expands roof segments outward to account for eave overhang)</span>
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t">
              <p className="text-xs text-gray-400">
                Includes satellite imagery overlay, ridge/valley/hip/rake/eave measurements, waste factor, ice & water shield analysis, and PDF export.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={purchasing}
                  className="flex items-center gap-2 px-5 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {purchasing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <DollarSign className="w-4 h-4" />
                      Purchase Report — $9.99
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Reports List */}
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <FileBarChart className="w-12 h-12 mx-auto text-gray-400 mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-1">No roof reports yet</h3>
          <p className="text-sm text-gray-500 mb-1">Professional satellite-based roof measurements for $9.99/report.</p>
          <p className="text-xs text-gray-400 mb-4">Ridges, valleys, hips, rakes, eaves, waste factor, ice & water shield — all computed from satellite data.</p>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Generate First Report
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Address</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Squares</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Segments</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Quality</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{report.address}</p>
                        <p className="text-xs text-gray-500">{report.city}, {report.state} {report.zip}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{report.totalSquares ?? '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{report.segmentCount ?? '-'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {report.imageryQuality ? qualityBadge(report.imageryQuality) : '-'}
                      {report.imageryDate && isSummerMonth(report.imageryDate) && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-orange-100 text-orange-700" title="Summer imagery — trees may obscure roof">Summer</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-1.5 text-sm text-gray-500">
                        <Calendar className="w-3.5 h-3.5" />
                        {new Date(report.createdAt).toLocaleDateString()}
                      </div>
                      {report.imageryDate && (
                        <span className="text-[11px] text-gray-400">Imagery: {report.imageryDate}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigate(`/crm/roof-reports/${report.id}`)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDownloadPdf(report.id)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        title="Print / PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(report.id)}
                        disabled={deleting === report.id}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                        title="Delete report"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
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
