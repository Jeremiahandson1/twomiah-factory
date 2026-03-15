import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { ArrowLeft, Download, ExternalLink, MapPin } from 'lucide-react'
import api from '../../services/api'

interface RoofReport {
  id: string
  address: string
  city: string
  state: string
  zip: string
  totalAreaSqft: number
  totalSquares: number
  segments: any[]
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
  createdAt: string
}

export default function RoofReportDetail() {
  const { id } = useParams<{ id: string }>()
  const { token } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  const [report, setReport] = useState<RoofReport | null>(null)
  const [loading, setLoading] = useState(true)

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
        <button onClick={() => navigate('/roof-reports')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
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
        onClick={() => navigate('/roof-reports')}
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

      {/* Satellite Visual — the main product */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <iframe
          src={`${window.location.origin}/api/roof-reports/${id}/html`}
          className="w-full border-0"
          style={{ height: '700px' }}
          title="Roof Report Visual"
        />
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm border p-4">
            <p className="text-sm text-gray-500">{card.label}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{card.value}</p>
          </div>
        ))}
      </div>

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
