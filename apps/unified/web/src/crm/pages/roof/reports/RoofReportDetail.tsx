// Moved from templates/crm-roof/frontend/src/pages/roofReports/RoofReportDetail.tsx. Changes: "Download PDF" fetched
// GET /:id/pdf as a file named .pdf, which the server answers with the print-ready HTML (the template's Puppeteer path
// never had a browser on Render) — it now opens that page in a new tab for the browser's Print → Save as PDF, and says
// so; the AI panel's light ground has its dark partner (its ink was already light in dark mode: light on light).
import { useState, useEffect, lazy, Suspense } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, ExternalLink, MapPin, Eye, Box } from 'lucide-react'
import { useToast } from '../../../../shared'
import { api } from '../../../../api'
import { formatDate } from '../../../date'
import type { Segment as ViewerSegment, Edge as ViewerEdge } from './Roof3DViewer'

const Roof3DViewer = lazy(() => import('./Roof3DViewer'))

/** A segment as roof_report.segments stores it (server roofReportService.ts). */
interface ReportSegment extends Partial<ViewerSegment> {
  areaSqft?: number
}

/** GET /api/roof-reports/:id — the row; `amountCharged` only for a seat with margin:read (no screen shows it). */
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
  segments: ReportSegment[] | null
  edges: ViewerEdge[] | null
  measurements: {
    ridgeLF?: number
    valleyLF?: number
    hipLF?: number
    rakeLF?: number
    eaveLF?: number
    totalPerimeterLF?: number
    wasteFactor?: number
    squaresWithWaste?: number
    iceWaterShieldSqft?: number
  } | null
  userEdited?: boolean
  createdAt: string
  amountCharged?: string | null
  // Nearmap AI-detected data
  roofCondition?: number | null
  roofMaterial?: string | null
  treeOverhangPct?: number | null
  imagerySource?: string | null
  elevationSource?: string | null
}

export default function RoofReportDetail() {
  const { id } = useParams<{ id: string }>()
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
      const data: RoofReport = await api.get(`/api/roof-reports/${id}`)
      setReport(data)
    } catch {
      toast.error('Failed to load roof report')
    } finally {
      setLoading(false)
    }
  }

  const base = api.baseUrl || ''

  // The print-ready report (GET /api/roof-reports/:id/pdf answers HTML) in a new tab; the browser's Print saves the PDF.
  const handlePrint = () => {
    window.open(`${base}/api/roof-reports/${id}/pdf`, '_blank', 'noopener')
  }

  const handleViewHtml = () => {
    window.open(`${base}/api/roof-reports/${id}/html`, '_blank', 'noopener')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
      </div>
    )
  }

  if (!report) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-6">
        <button onClick={() => navigate('/crm/roof-reports')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 mb-6 dark:text-slate-400">
          <ArrowLeft className="w-4 h-4" /> Back to Roof Reports
        </button>
        <div className="bg-white rounded-xl shadow-sm border p-12 text-center dark:bg-slate-900">
          <p className="text-gray-500 dark:text-slate-400">Report not found.</p>
        </div>
      </div>
    )
  }

  const m = report.measurements || {}
  const segments = report.segments || []

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
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-200 transition-colors dark:text-slate-400"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Roof Reports
      </button>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
            <MapPin className="w-5 h-5 text-gray-400" />
            {report.address}
          </h1>
          <p className="text-sm text-gray-500 mt-1 dark:text-slate-400">
            {report.city}, {report.state} {report.zip} &middot; {formatDate(report.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleViewHtml}
            className="flex items-center gap-2 px-4 py-2.5 border text-sm font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            View Full Report
          </button>
          <button
            onClick={handlePrint}
            title="Opens the print-ready report in a new tab — use your browser's Print and choose Save as PDF"
            className="flex items-center gap-2 px-4 py-2.5 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors"
          >
            <Printer className="w-4 h-4" />
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* View tabs — 2D / 3D toggle */}
      <div className="flex items-center gap-1 bg-white rounded-lg border shadow-sm p-1 w-fit dark:bg-slate-900">
        <button
          onClick={() => setViewTab('2d')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewTab === '2d' ? 'bg-orange-50 text-orange-700 dark:text-orange-200 dark:bg-orange-950/40' : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-300'}`}
        >
          <Eye className="w-4 h-4" /> 2D Report
        </button>
        <button
          onClick={() => setViewTab('3d')}
          className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-md transition-colors ${viewTab === '3d' ? 'bg-orange-50 text-orange-700 dark:text-orange-200 dark:bg-orange-950/40' : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-300'}`}
        >
          <Box className="w-4 h-4" /> 3D View
        </button>
      </div>

      {/* Satellite Visual — 2D report */}
      {viewTab === '2d' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden dark:bg-slate-900">
          <iframe
            src={`${base}/api/roof-reports/${id}/html`}
            className="w-full border-0"
            style={{ height: '700px' }}
            title="Roof Report Visual"
          />
        </div>
      )}

      {/* 3D Viewer */}
      {viewTab === '3d' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden p-4 dark:bg-slate-900">
          <Suspense fallback={
            <div className="flex items-center justify-center h-96">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
            </div>
          }>
            <Roof3DViewer
              segments={segments as ViewerSegment[]}
              edges={report.edges || []}
              centerLat={Number(report.lat)}
              centerLng={Number(report.lng)}
              reportId={id!}
            />
          </Suspense>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border p-4 dark:bg-slate-900">
            <p className="text-sm text-gray-500 dark:text-slate-400">{card.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1 dark:text-slate-100">{card.value}</p>
          </div>
        ))}
      </div>

      {/* AI Insights — Nearmap-detected roof properties */}
      {(report.roofCondition != null || report.roofMaterial || report.treeOverhangPct != null) && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl border border-purple-100 p-4 dark:from-purple-950/40 dark:to-blue-950/40 dark:border-purple-900">
          <h2 className="text-sm font-semibold text-purple-900 uppercase tracking-wider mb-3 flex items-center gap-2 dark:text-purple-300">
            <span className="w-2 h-2 bg-purple-500 rounded-full" />
            AI Roof Analysis
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {report.roofCondition != null && (
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Roof Condition</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden dark:bg-slate-700 dark:text-slate-100">
                    <div
                      className={`h-full rounded-full ${
                        report.roofCondition >= 70 ? 'bg-green-500' :
                        report.roofCondition >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${report.roofCondition}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-900 dark:text-slate-100">{report.roofCondition}/100</span>
                </div>
              </div>
            )}
            {report.roofMaterial && (
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Material Detected</p>
                <p className="text-sm font-semibold text-gray-900 mt-1 capitalize dark:text-slate-100">{report.roofMaterial}</p>
              </div>
            )}
            {report.treeOverhangPct != null && (
              <div>
                <p className="text-xs text-gray-500 dark:text-slate-400">Tree Overhang</p>
                <p className="text-sm font-semibold text-gray-900 mt-1 dark:text-slate-100">{Number(report.treeOverhangPct).toFixed(1)}%</p>
              </div>
            )}
          </div>
          {report.imagerySource && (
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-3">
              Imagery: {report.imagerySource === 'nearmap' ? 'Nearmap 5-7cm' : 'Google Solar'}
              {report.elevationSource && report.elevationSource !== 'google_dsm' && ` | Elevation: ${report.elevationSource}`}
            </p>
          )}
        </div>
      )}

      {/* Measurements Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
        <div className="px-4 py-3 border-b bg-gray-50 dark:bg-slate-900">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider dark:text-slate-100">Measurements</h2>
        </div>
        <table className="w-full">
          <thead className="bg-gray-50 border-b dark:bg-slate-900">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Measurement</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
            {measurements.map((row) => (
              <tr key={row.label} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">{row.label}</td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right dark:text-slate-200">
                  {row.value != null ? `${Number(row.value).toLocaleString()} ${row.unit}` : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Segments Table */}
      {segments.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto dark:bg-slate-900">
          <div className="px-4 py-3 border-b bg-gray-50 dark:bg-slate-900">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider dark:text-slate-100">
              Roof Segments ({segments.length})
            </h2>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50 border-b dark:bg-slate-900">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Name</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Area (sqft)</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Pitch</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-slate-400">Azimuth</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
              {segments.map((seg, i) => (
                <tr key={i} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">{seg.name || `Segment ${i + 1}`}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right dark:text-slate-200">{Number(seg.area || seg.areaSqft || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right dark:text-slate-200">{seg.pitch}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 text-right dark:text-slate-200">{seg.azimuthDegrees != null ? `${seg.azimuthDegrees}°` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
