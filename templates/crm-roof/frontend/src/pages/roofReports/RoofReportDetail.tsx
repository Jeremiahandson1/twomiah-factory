import { useState, useEffect, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { ArrowLeft, Download, ExternalLink, MapPin, Eye, Box } from 'lucide-react'
import api from '../../services/api'

const Roof3DViewer = lazy(() => import('./Roof3DViewer'))

interface RoofReport {
  id: string
  address: string
  city: string
  state: string
  zip: string
  lat: number
  lng: number
  totalAreaSqft: number
  totalSquares: number
  segments: any[]
  edges: any[]
  measurements: {
    ridgeLF: number
    valleyLF: number
    hipLF: number
    rakeLF: number
    eaveLF: number
    totalPerimeterLF: number
    wasteFactor: number
    squaresWithWaste: number
    iceWaterShieldSqft: number
  }
  userEdited?: boolean
  createdAt: string
  // Nearmap AI-detected data
  roofCondition?: number | null
  roofMaterial?: string | null
  treeOverhangPct?: number | null
  imagerySource?: string | null
  elevationSource?: string | null
}

export default function RoofReportDetail() {
  const { id } = useParams<{ id: string }>()
  const { token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [report, setReport] = useState<RoofReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewTab, setViewTab] = useState<'2d' | '3d'>('2d')

  useEffect(() => {
    loadReport()
  }, [id])

  const loadReport = async () => {
    setLoading(true)
    try {
      const data = await api.request(`/api/roof-reports/${id}`)
      setReport(data)
    } catch {
      toast.error('Failed to load roof report')
    } finally {
      setLoading(false)
    }
  }

  const handleDownloadPdf = async () => {
    try {
      const res = await fetch(`/api/roof-reports/${id}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `roof-report-${id}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download PDF')
    }
  }

  const handleViewHtml = () => {
    window.open(`${window.location.origin}/api/roof-reports/${id}/html`, '_blank')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <button onClick={() => navigate('/crm/roof-reports')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to Roof Reports
        </button>
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
          <p className="text-gray-500">Report not found.</p>
        </div>
      </div>
    )
  }

  const m = report.measurements || {} as any

  const summaryCards = [
    { label: 'Total Area', value: `${Number(report.totalAreaSqft || 0).toLocaleString()} sqft` },
    { label: 'Total Squares', value: String(report.totalSquares ?? '-') },
    { label: 'Waste Factor', value: `${m.wasteFactor ?? 0}%` },
    { label: 'Squares w/ Waste', value: String(m.squaresWithWaste ?? '-') },
  ]

  const measurements = [
    { label: 'Ridge', value: m.ridgeLF, unit: 'LF' },
    { label: 'Valley', value: m.valleyLF, unit: 'LF' },
    { label: 'Hip', value: m.hipLF, unit: 'LF' },
    { label: 'Rake', value: m.rakeLF, unit: 'LF' },
    { label: 'Eave', value: m.eaveLF, unit: 'LF' },
    { label: 'Total Perimeter', value: m.totalPerimeterLF, unit: 'LF' },
    { label: 'Ice & Water Shield', value: m.iceWaterShieldSqft, unit: 'sqft' },
  ]

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Back Button */}
      <button
        onClick={() => navigate('/crm/roof-reports')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Roof Reports
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-gray-400" />
            {report.address}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {report.city}, {report.state} {report.zip} &middot; {new Date(report.createdAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleViewHtml}
            className="flex items-center gap-2 px-4 py-2.5 border text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            View Full Report
          </button>
          <button
            onClick={handleDownloadPdf}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Download PDF
          </button>
        </div>
      </div>

      {/* View tabs — 2D / 3D toggle */}
      <div className="flex items-center gap-1 bg-white rounded-lg border shadow-sm p-1 w-fit">
        <button
          onClick={() => setViewTab('2d')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewTab === '2d' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
        >
          <Eye className="w-4 h-4" /> 2D Report
        </button>
        <button
          onClick={() => setViewTab('3d')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewTab === '3d' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
        >
          <Box className="w-4 h-4" /> 3D View
        </button>
      </div>

      {/* Satellite Visual — 2D report */}
      {viewTab === '2d' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <iframe
            src={`${window.location.origin}/api/roof-reports/${id}/html`}
            className="w-full border-0"
            style={{ height: '700px' }}
            title="Roof Report Visual"
          />
        </div>
      )}

      {/* 3D Viewer */}
      {viewTab === '3d' && report && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden p-4">
          <Suspense fallback={
            <div className="flex items-center justify-center h-96">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          }>
            <Roof3DViewer
              segments={report.segments}
              edges={report.edges}
              centerLat={report.lat}
              centerLng={report.lng}
              reportId={id!}
            />
          </Suspense>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

      {/* AI Insights — Nearmap-detected roof properties */}
      {(report.roofCondition != null || report.roofMaterial || report.treeOverhangPct != null) && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-100 p-4">
          <h2 className="text-sm font-semibold text-purple-900 uppercase tracking-wider mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-purple-500 rounded-full" />
            AI Roof Analysis
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {report.roofCondition != null && (
              <div>
                <p className="text-xs text-gray-500">Roof Condition</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        report.roofCondition >= 70 ? 'bg-green-500' :
                        report.roofCondition >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${report.roofCondition}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-900">{report.roofCondition}/100</span>
                </div>
              </div>
            )}
            {report.roofMaterial && (
              <div>
                <p className="text-xs text-gray-500">Material Detected</p>
                <p className="text-sm font-semibold text-gray-900 mt-1 capitalize">{report.roofMaterial}</p>
              </div>
            )}
            {report.treeOverhangPct != null && (
              <div>
                <p className="text-xs text-gray-500">Tree Overhang</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{report.treeOverhangPct.toFixed(1)}%</p>
              </div>
            )}
          </div>
          {report.imagerySource && (
            <p className="text-xs text-gray-400 mt-3">
              Imagery: {report.imagerySource === 'nearmap' ? 'Nearmap 5-7cm' : 'Google Solar'}
              {report.elevationSource && report.elevationSource !== 'google_dsm' && ` | Elevation: ${report.elevationSource}`}
            </p>
          )}
        </div>
      )}

      {/* Measurements Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Measurements</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Measurement</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {measurements.map((m) => (
              <tr key={m.label} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{m.label}</td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right">
                  {m.value != null ? `${Number(m.value).toLocaleString()} ${m.unit}` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Segments Table */}
      {report.segments && report.segments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Roof Segments ({report.segments.length})
            </h2>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Area (sqft)</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Pitch</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Azimuth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {report.segments.map((seg, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{seg.name || `Segment ${i + 1}`}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right">{Number(seg.area || seg.areaSqft || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right">{seg.pitch}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right">{seg.azimuthDegrees != null ? `${seg.azimuthDegrees}°` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
