import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import { Plus, FileText, MapPin, Trash2, ExternalLink, ArrowLeft } from 'lucide-react'

interface Report {
  id: string
  address: string
  city: string
  state: string
  zip: string
  totalSquares: number
  segmentCount: number
  imageryQuality: string
  roofCondition: number | null
  roofMaterial: string | null
  createdAt: string
}

export default function ReportsListPage() {
  const { auth, logout } = useAuth()
  const navigate = useNavigate()
  const [reports, setReports] = useState<Report[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadReports() }, [])

  const loadReports = async () => {
    try {
      const res = await fetch('/api/reports?limit=50', {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setReports(data.reports)
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this report?')) return
    await fetch(`/api/reports/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    setReports(r => r.filter(x => x.id !== id))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft className="w-4 h-4" /> Home
          </button>
          <h1 className="text-lg font-bold text-gray-900">My Reports</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            {auth.tenant?.reportsUsedThisMonth || 0}/{auth.tenant?.monthlyReportLimit || 5} this month
          </span>
          <button onClick={() => navigate('/reports/new')}
            className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700">
            <Plus className="w-4 h-4" /> New Report
          </button>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-700">Logout</button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-600" />
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border p-12 text-center">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-gray-900 mb-2">No reports yet</h2>
            <p className="text-gray-500 mb-6">Generate your first roof measurement report.</p>
            <button onClick={() => navigate('/reports/new')}
              className="px-6 py-3 bg-orange-600 text-white font-medium rounded-lg hover:bg-orange-700">
              Generate Report
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase">Address</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Squares</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Segments</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Quality</th>
                  <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 uppercase">Condition</th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {reports.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{r.address}</div>
                          <div className="text-xs text-gray-500">{r.city}, {r.state} {r.zip}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium">{r.totalSquares}</td>
                    <td className="px-4 py-3 text-right text-sm">{r.segmentCount}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        r.imageryQuality === 'HIGH' ? 'bg-green-100 text-green-700' :
                        r.imageryQuality === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                      }`}>{r.imageryQuality}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-sm">
                      {r.roofCondition != null ? <span className="font-medium">{r.roofCondition}/100</span> : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-gray-500">
                      {new Date(r.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <a href={`/api/reports/${r.id}/html`} target="_blank" rel="noopener noreferrer"
                          className="p-1.5 text-gray-400 hover:text-blue-600" title="View report">
                          <ExternalLink className="w-4 h-4" />
                        </a>
                        <button onClick={() => handleDelete(r.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600" title="Delete">
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

        {/* API Key section */}
        {auth.tenant?.apiKey && (
          <div className="mt-8 bg-white rounded-xl shadow-sm border p-6">
            <h3 className="text-sm font-semibold text-gray-900 mb-2">API Access</h3>
            <p className="text-xs text-gray-500 mb-3">Use this key to generate reports programmatically.</p>
            <code className="block px-4 py-2 bg-gray-100 rounded-lg text-sm font-mono text-gray-700 select-all">
              {auth.tenant.apiKey}
            </code>
          </div>
        )}
      </div>
    </div>
  )
}
