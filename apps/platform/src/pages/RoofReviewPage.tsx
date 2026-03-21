import { useState, useEffect, useCallback } from 'react'
import { supabase, API_URL as API } from '../supabase'
import { MapPin, Clock, CheckCircle, Loader2, ArrowLeft, ExternalLink } from 'lucide-react'
import RoofEdgeEditor from './RoofEdgeEditor'

interface QueueItem {
  id: string
  report_id: string
  address: string
  company_id: string
  backend_url: string
  status: string
  created_at: string
  tenant?: { name: string; slug: string; render_backend_url?: string }
}

interface ReportData {
  id: string
  lat: number
  lng: number
  edges: any[]
  segments: any[]
  measurements: any
  aerialImagePath?: string
}

export default function RoofReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Editor state
  const [selectedItem, setSelectedItem] = useState<QueueItem | null>(null)
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [satelliteUrl, setSatelliteUrl] = useState('')
  const [loadingReport, setLoadingReport] = useState(false)
  const [approving, setApproving] = useState(false)

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || ''
  }, [])

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API}/api/v1/factory/roof-review/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load')
      setItems(await res.json())
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { loadQueue() }, [loadQueue])

  // Open a report in the editor
  const handleOpen = async (item: QueueItem) => {
    setSelectedItem(item)
    setLoadingReport(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`${API}/api/v1/factory/roof-review/${item.report_id}/data`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to fetch report data')
      const { report } = await res.json()
      setReportData(report)

      // Fetch satellite image for the editor
      // Use Google Static Maps at zoom 20 as fallback
      const googleKey = report.googleMapsKey || ''
      const zoom = 20
      const satUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${report.lat},${report.lng}&zoom=${zoom}&size=800x600&maptype=satellite&key=${googleKey}`
      setSatelliteUrl(satUrl)
    } catch (err: any) {
      setError(err.message)
      setSelectedItem(null)
    } finally {
      setLoadingReport(false)
    }
  }

  // Save edits and approve
  const handleSaveAndApprove = async (edges: any[], measurements: any) => {
    if (!selectedItem) return
    setApproving(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API}/api/v1/factory/roof-review/${selectedItem.report_id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ edges, measurements }),
      })
      if (!res.ok) throw new Error('Failed to approve')
      setItems(prev => prev.filter(i => i.report_id !== selectedItem.report_id))
      setSelectedItem(null)
      setReportData(null)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setApproving(false)
    }
  }

  // --- Editor view ---
  if (selectedItem && loadingReport) {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-96 gap-4">
        <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
        <p className="text-gray-400">Loading report data...</p>
      </div>
    )
  }

  if (selectedItem && reportData) {
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setSelectedItem(null); setReportData(null) }}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-gray-400" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-white">{selectedItem.address}</h1>
              <p className="text-sm text-gray-400">
                {selectedItem.tenant?.name || 'Unknown tenant'} — Correct edges and approve
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {approving && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
            <a
              href={`${selectedItem.backend_url || `https://${selectedItem.tenant?.slug}-api.onrender.com`}/crm/roof-reports`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 px-3 py-1 text-xs text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
            >
              <ExternalLink className="w-3 h-3" /> Open in CRM
            </a>
            <span className="px-3 py-1 bg-orange-500/20 text-orange-400 text-sm font-medium rounded-full">
              Pending Review
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl p-4">
          <RoofEdgeEditor
            reportId={reportData.id}
            edges={reportData.edges}
            segments={reportData.segments || []}
            centerLat={reportData.lat}
            centerLng={reportData.lng}
            zoom={20}
            aerialImageUrl={satelliteUrl}
            mapWidth={800}
            mapHeight={600}
            initialMode="select"
            onSave={handleSaveAndApprove}
          />
        </div>
      </div>
    )
  }

  // --- Queue list view ---
  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Roof Report Review</h1>
          <p className="text-sm text-gray-400 mt-1">
            Correct edges and approve reports before customers see them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-3 py-1 bg-orange-500/20 text-orange-400 text-sm font-medium rounded-full">
            {items.length} pending
          </span>
          <button onClick={loadQueue} className="px-3 py-1.5 text-sm text-gray-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors">
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm p-3 rounded-lg">
          {error}
          <button onClick={() => setError('')} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-xl p-12 text-center">
          <CheckCircle className="w-12 h-12 mx-auto text-green-400 mb-3" />
          <h3 className="text-lg font-medium text-white mb-1">All caught up</h3>
          <p className="text-sm text-gray-400">No reports pending review.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map(item => (
            <div
              key={item.id}
              className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors cursor-pointer"
              onClick={() => handleOpen(item)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <MapPin className="w-5 h-5 text-orange-400" />
                  <div>
                    <p className="font-medium text-white">{item.address || 'Unknown address'}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className="text-xs text-gray-400">
                        {item.tenant?.name || 'Unknown tenant'}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Clock className="w-3 h-3" />
                        {new Date(item.created_at).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-400">Click to review →</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
