import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { MapPin, Loader2, ArrowLeft, FileText, Check } from 'lucide-react'
import MapEdgeEditor from '../components/MapEdgeEditor'

type Step = 'address' | 'loading' | 'editor' | 'done'

export default function ReportPage() {
  const { auth } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<Step>('address')
  const [form, setForm] = useState({ address: '', city: '', state: '', zip: '' })
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [report, setReport] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  // Step 1: Enter address → fetch preview
  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault()
    setStep('loading')
    setError('')

    try {
      const res = await fetch('/api/reports/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
        },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Preview failed')
      }

      const data = await res.json()
      setPreview(data)
      setStep('editor')
    } catch (err: any) {
      setError(err.message)
      setStep('address')
    }
  }

  // Step 3: Save user-edited edges → create report
  const handleFinalize = async (edges: any[], measurements: any) => {
    setSaving(true)
    try {
      const res = await fetch('/api/reports/finalize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${auth.token}`,
        },
        body: JSON.stringify({ preview, edges, measurements }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Save failed')
      }

      const data = await res.json()
      setReport(data.report)
      setStep('done')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Nav */}
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <button onClick={() => step === 'editor' ? setStep('address') : navigate('/reports')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> {step === 'editor' ? 'Change Address' : 'Back to Reports'}
        </button>
        <div className="flex items-center gap-4">
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs">
            <StepDot active={step === 'address'} done={step !== 'address'} label="1. Address" />
            <div className="w-6 h-px bg-gray-300" />
            <StepDot active={step === 'editor' || step === 'loading'} done={step === 'done'} label="2. Edit Lines" />
            <div className="w-6 h-px bg-gray-300" />
            <StepDot active={step === 'done'} done={false} label="3. Report" />
          </div>
          <span className="text-sm text-gray-400">{auth.tenant?.companyName}</span>
        </div>
      </nav>

      {/* Step 1: Address input */}
      {step === 'address' && (
        <div className="max-w-2xl mx-auto px-4 py-12">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">New Roof Report</h1>
          <p className="text-gray-500 mb-8">Enter a US address. We'll pull satellite imagery with roof segments so you can draw measurements.</p>

          {error && <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

          <form onSubmit={handlePreview} className="bg-white rounded-xl shadow-sm border p-6 space-y-4">
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
            <button type="submit"
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-orange-600 text-white font-semibold rounded-lg hover:bg-orange-700 transition-colors">
              <FileText className="w-4 h-4" /> Get Satellite Image
            </button>
          </form>

          <p className="text-center text-xs text-gray-400 mt-4">
            {auth.tenant?.reportsUsedThisMonth || 0} / {auth.tenant?.monthlyReportLimit || 5} reports used this month
          </p>
        </div>
      )}

      {/* Loading */}
      {step === 'loading' && (
        <div className="flex flex-col items-center justify-center h-96 gap-4">
          <Loader2 className="w-10 h-10 text-orange-600 animate-spin" />
          <div className="text-center">
            <p className="text-lg font-semibold text-gray-900">Fetching satellite imagery...</p>
            <p className="text-sm text-gray-500 mt-1">{form.address}, {form.city}, {form.state} {form.zip}</p>
          </div>
        </div>
      )}

      {/* Step 2: Editor — draw/edit roof lines */}
      {step === 'editor' && preview && (
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">Draw Roof Lines</h1>
              <p className="text-sm text-gray-500 mt-1">
                {preview.address}, {preview.city}, {preview.state} {preview.zip} —
                Draw ridge, valley, hip, rake, and eave lines along the roof edges. Colored segments show detected roof planes with pitch angles.
              </p>
            </div>
            <button
              onClick={() => handleFinalize([], {})}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Check className="w-4 h-4" /> {saving ? 'Saving...' : 'Create Report'}
            </button>
          </div>

          <MapEdgeEditor
            reportId="preview"
            edges={[]}
            segments={preview.autoSegments || []}
            centerLat={preview.geo.lat}
            centerLng={preview.geo.lng}
            zoom={preview.zoom || 20}
            aerialImageUrl={preview.satelliteImageBase64 || ''}
            mapWidth={preview.mapWidth || 800}
            mapHeight={preview.mapHeight || 600}
            initialMode="add"
            onSave={handleFinalize}
          />

          <p className="text-xs text-gray-400 mt-4">
            Draw ridge, valley, hip, rake, and eave lines along the roof edges. The colored regions show detected roof segments with pitch angles. Press Ctrl+Z to undo.
          </p>
        </div>
      )}

      {/* Step 3: Done — show report */}
      {step === 'done' && report && (
        <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{report.address}</h1>
              <p className="text-gray-500">{report.city}, {report.state} {report.zip}</p>
            </div>
            <div className="flex gap-2">
              <a href={`/api/reports/${report.id}/html`} target="_blank" rel="noopener noreferrer"
                className="px-4 py-2 border rounded-lg text-sm font-medium hover:bg-gray-50">View Full Report</a>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                onClick={async () => {
                  const res = await fetch(`/api/reports/${report.id}/pdf`, { headers: { Authorization: `Bearer ${auth.token}` } })
                  if (res.ok) {
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a'); a.href = url; a.download = `roof-report-${report.id}.pdf`; a.click()
                  }
                }}>
                Download PDF
              </button>
            </div>
          </div>

          {/* Embedded report */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <iframe src={`/api/reports/${report.id}/html`} className="w-full border-0" style={{ height: '700px' }} title="Roof Report" />
          </div>

          {/* Summary cards */}
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

          <div className="flex gap-4">
            <button onClick={() => { setReport(null); setPreview(null); setForm({ address: '', city: '', state: '', zip: '' }); setStep('address') }}
              className="text-sm text-orange-600 hover:underline">Generate another report</button>
            <button onClick={() => navigate('/reports')}
              className="text-sm text-gray-500 hover:underline">View all reports</button>
          </div>
        </div>
      )}
    </div>
  )
}

function StepDot({ active, done, label }: { active: boolean; done: boolean; label: string }) {
  return (
    <span className={`${active ? 'text-orange-600 font-semibold' : done ? 'text-green-600' : 'text-gray-400'}`}>
      {done ? '✓ ' : ''}{label}
    </span>
  )
}
