import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { MapPin, Loader2, ArrowLeft, FileText } from 'lucide-react'

export default function ReportPage() {
  const { auth } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ address: '', city: '', state: '', zip: '' })
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [report, setReport] = useState<any>(null)

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault()
    setGenerating(true)
    setError('')
    setReport(null)

    try {
      const res = await fetch('/api/reports/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
        },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Generation failed')
      }

      const data = await res.json()
      setReport(data.report)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <button onClick={() => navigate('/reports')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Back to Reports
        </button>
        <div className="text-sm text-gray-500">{auth.tenant?.companyName}</div>
      </nav>

      <div className="max-w-2xl mx-auto px-4 py-12">
        {!report ? (
          <>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Generate Roof Report</h1>
            <p className="text-gray-500 mb-8">Enter a US address to generate a professional roof measurement report.</p>

            {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

            <form onSubmit={handleGenerate} className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Street Address</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                  <input type="text" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="123 Main St" required
                    className="w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input type="text" value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    placeholder="Austin" required className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input type="text" value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))}
                    placeholder="TX" required maxLength={2} className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ZIP</label>
                  <input type="text" value={form.zip} onChange={e => setForm(f => ({ ...f, zip: e.target.value }))}
                    placeholder="78701" required className="w-full px-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500" />
                </div>
              </div>
              <button type="submit" disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 disabled:opacity-50 transition-colors">
                {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Report...</> : <><FileText className="w-4 h-4" /> Generate Report</>}
              </button>
            </form>

            <p className="text-center text-xs text-gray-400 mt-4">
              {auth.tenant?.reportsUsedThisMonth || 0} / {auth.tenant?.monthlyReportLimit || 5} reports used this month
            </p>
          </>
        ) : (
          /* Report result */
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{report.address}</h1>
                <p className="text-gray-500">{report.city}, {report.state} {report.zip}</p>
              </div>
              <div className="flex gap-2">
                <a href={`/api/reports/${report.id}/html`} target="_blank" rel="noopener noreferrer"
                  className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50">View Report</a>
                <a href={`/api/reports/${report.id}/pdf`}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                  onClick={async (e) => {
                    e.preventDefault()
                    const res = await fetch(`/api/reports/${report.id}/pdf`, { headers: { Authorization: `Bearer ${auth.token}` } })
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = `roof-report-${report.id}.pdf`; a.click()
                  }}>
                  Download PDF
                </a>
              </div>
            </div>

            {/* Embedded report view */}
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <iframe src={`/api/reports/${report.id}/html`} className="w-full border-0" style={{ height: '700px' }} title="Roof Report" />
            </div>

            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Squares', value: report.totalSquares },
                { label: 'Total Area', value: `${Number(report.totalAreaSqft).toLocaleString()} sqft` },
                { label: 'Segments', value: report.segmentCount },
                { label: 'Quality', value: report.imageryQuality },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-xl shadow-sm border p-4">
                  <p className="text-sm text-gray-500">{c.label}</p>
                  <p className="text-xl font-bold text-gray-900 mt-1">{c.value}</p>
                </div>
              ))}
            </div>

            {/* AI Insights */}
            {(report.roofCondition != null || report.roofMaterial) && (
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-purple-900 uppercase tracking-wider mb-2">AI Analysis</h3>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  {report.roofCondition != null && <div><span className="text-gray-500">Condition:</span> <span className="font-bold">{report.roofCondition}/100</span></div>}
                  {report.roofMaterial && <div><span className="text-gray-500">Material:</span> <span className="font-bold capitalize">{report.roofMaterial}</span></div>}
                  {report.treeOverhangPct != null && <div><span className="text-gray-500">Tree Overhang:</span> <span className="font-bold">{report.treeOverhangPct}%</span></div>}
                </div>
              </div>
            )}

            <button onClick={() => { setReport(null); setForm({ address: '', city: '', state: '', zip: '' }) }}
              className="text-sm text-orange-600 hover:underline">Generate another report</button>
          </div>
        )}
      </div>
    </div>
  )
}
