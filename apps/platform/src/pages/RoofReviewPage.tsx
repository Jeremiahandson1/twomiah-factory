import { useState, useEffect } from 'react'
import { supabase, API_URL as API } from '../supabase'
import { MapPin, Clock, CheckCircle, Loader2, ExternalLink } from 'lucide-react'

interface QueueItem {
  id: string
  report_id: string
  address: string
  company_id: string
  backend_url: string
  status: string
  created_at: string
  tenant?: { name: string; slug: string }
}

export default function RoofReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { loadQueue() }, [])

  const getToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || ''
  }

  const loadQueue = async () => {
    setLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API}/api/v1/factory/roof-review/pending`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setItems(data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleApprove = async (reportId: string) => {
    setApproving(true)
    try {
      const token = await getToken()
      // For now, approve with existing edges (no editing in factory yet)
      // TODO: open editor in factory platform
      const res = await fetch(`${API}/api/v1/factory/roof-review/${reportId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({}), // empty = keep existing edges
      })
      if (!res.ok) throw new Error('Failed to approve')
      setItems(prev => prev.filter(i => i.report_id !== reportId))
    } catch (err: any) {
      setError(err.message)
    } finally {
      setApproving(false)
    }
  }

  const openInTenantCRM = (item: QueueItem) => {
    const url = item.backend_url || `https://${item.tenant?.slug}-api.onrender.com`
    window.open(`${url}/crm/roof-reports`, '_blank')
  }

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
            Auto-detected reports pending your review. Correct edges and approve.
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
            <div key={item.id} className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors">
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
                  <button
                    onClick={() => openInTenantCRM(item)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Open in CRM
                  </button>
                  <button
                    onClick={() => handleApprove(item.report_id)}
                    disabled={approving}
                    className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {approving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
