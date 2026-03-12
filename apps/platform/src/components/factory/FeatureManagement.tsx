import { useState, useEffect } from 'react'
import { supabase, API_URL as API } from '../../supabase'
import { Shield, Lock, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Clock, Zap } from 'lucide-react'

type FeatureDef = {
  id: string
  name: string
  description: string
  category: string
  core: boolean
  templates: string[]
}

type AuditEntry = {
  id: string
  created_at: string
  action: string
  features: string[]
  previous: string[]
  current: string[]
  changed_by: string
  synced_to_crm: boolean
  note: string | null
}

type Props = {
  tenantId: string
  tenantPlan?: string
  onFeaturesUpdated?: (features: string[]) => void
}

export default function FeatureManagement({ tenantId, onFeaturesUpdated }: Props) {
  const [enabled, setEnabled] = useState<string[]>([])
  const [original, setOriginal] = useState<string[]>([])
  const [available, setAvailable] = useState<FeatureDef[]>([])
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [hasDatabaseUrl, setHasDatabaseUrl] = useState(false)
  const [template, setTemplate] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [showAuditLog, setShowAuditLog] = useState(false)

  useEffect(() => { loadFeatures() }, [tenantId])

  async function loadFeatures() {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('Not authenticated'); setLoading(false); return }

      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/features', {
        headers: { Authorization: 'Bearer ' + token },
      })
      if (!res.ok) throw new Error('Failed to load features')
      const data = await res.json()

      setEnabled(data.enabledFeatures || [])
      setOriginal(data.enabledFeatures || [])
      setAvailable(data.availableFeatures || [])
      setAuditLog(data.auditLog || [])
      setHasDatabaseUrl(data.hasDatabaseUrl)
      setTemplate(data.template || '')

      // Auto-expand categories that have enabled features
      const cats = new Set<string>()
      for (const f of data.availableFeatures || []) {
        if ((data.enabledFeatures || []).includes(f.id)) cats.add(f.category)
      }
      setExpandedCategories(cats)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function saveFeatures() {
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated')

      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/features', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: enabled }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Failed to save') }
      const data = await res.json()

      setOriginal(enabled)
      const syncMsg = data.syncedToCrm ? 'Synced to live CRM.' : 'Saved to Factory (CRM sync unavailable — no database connection).'
      setSuccess(`Features updated. ${syncMsg}`)
      onFeaturesUpdated?.(enabled)

      // Reload audit log
      loadFeatures()
    } catch (err: any) {
      setError(err.message)
    }
    setSaving(false)
  }

  function toggleFeature(featureId: string) {
    const feat = available.find(f => f.id === featureId)
    if (feat?.core) return // can't disable core features
    setEnabled(prev => prev.includes(featureId) ? prev.filter(f => f !== featureId) : [...prev, featureId])
  }

  function toggleCategory(category: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return next
    })
  }

  const hasChanges = JSON.stringify([...enabled].sort()) !== JSON.stringify([...original].sort())
  const added = enabled.filter(f => !original.includes(f))
  const removed = original.filter(f => !enabled.includes(f))

  // Group available features by category
  const categories: Record<string, FeatureDef[]> = {}
  for (const f of available) {
    if (!categories[f.category]) categories[f.category] = []
    categories[f.category].push(f)
  }

  if (loading) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-white font-semibold mb-3 flex items-center gap-2">
          <Shield size={16} className="text-indigo-400" /> Feature Management
        </h2>
        <p className="text-gray-500 text-sm">Loading features...</p>
      </div>
    )
  }

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-white font-semibold flex items-center gap-2">
          <Shield size={16} className="text-indigo-400" /> Feature Management
        </h2>
        <span className="text-xs text-gray-500">{template}</span>
      </div>

      {!hasDatabaseUrl && (
        <div className="flex items-start gap-2 px-3 py-2 bg-yellow-900/20 border border-yellow-800/50 rounded-lg mb-4">
          <AlertTriangle size={14} className="text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-300">No database connection stored. Changes will save to Factory but won't sync to the live CRM until the tenant is redeployed.</p>
        </div>
      )}

      {error && (
        <div className="px-3 py-2 bg-red-900/20 border border-red-800/50 rounded-lg mb-4">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {success && (
        <div className="flex items-start gap-2 px-3 py-2 bg-green-900/20 border border-green-800/50 rounded-lg mb-4">
          <CheckCircle size={14} className="text-green-400 mt-0.5 shrink-0" />
          <p className="text-xs text-green-300">{success}</p>
        </div>
      )}

      {/* Feature toggles by category */}
      <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
        {Object.entries(categories).map(([category, features]) => {
          const expanded = expandedCategories.has(category)
          const enabledCount = features.filter(f => enabled.includes(f.id)).length

          return (
            <div key={category} className="border border-gray-800 rounded-lg overflow-hidden">
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between px-3 py-2 bg-gray-800/50 hover:bg-gray-800 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{category}</span>
                  <span className="text-xs text-gray-500">{enabledCount}/{features.length}</span>
                </div>
                {expanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
              </button>

              {expanded && (
                <div className="px-3 py-2 space-y-1.5">
                  {features.map(feat => {
                    const isEnabled = enabled.includes(feat.id)
                    const isCore = feat.core
                    const wasAdded = added.includes(feat.id)
                    const wasRemoved = removed.includes(feat.id)

                    return (
                      <label
                        key={feat.id}
                        className={'flex items-center justify-between py-1.5 px-2 rounded-lg cursor-pointer transition-colors ' +
                          (isCore ? 'opacity-60 cursor-not-allowed ' : 'hover:bg-gray-800/50 ') +
                          (wasAdded ? 'bg-green-900/10 ' : '') +
                          (wasRemoved ? 'bg-red-900/10 ' : '')
                        }
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={() => toggleFeature(feat.id)}
                            disabled={isCore}
                            className="rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm text-gray-200">{feat.name}</span>
                              {isCore && <Lock size={10} className="text-gray-600" />}
                              {wasAdded && <span className="text-[10px] text-green-400 font-medium">+NEW</span>}
                              {wasRemoved && <span className="text-[10px] text-red-400 font-medium">-REMOVE</span>}
                            </div>
                            <p className="text-xs text-gray-500 truncate">{feat.description}</p>
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Change summary + save */}
      {hasChanges && (
        <div className="mt-4 pt-4 border-t border-gray-800">
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} className="text-amber-400" />
            <span className="text-xs text-gray-400">
              {added.length > 0 && <span className="text-green-400">+{added.length} enabled</span>}
              {added.length > 0 && removed.length > 0 && ' · '}
              {removed.length > 0 && <span className="text-red-400">-{removed.length} disabled</span>}
            </span>
          </div>
          <button
            onClick={saveFeatures}
            disabled={saving}
            className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : hasDatabaseUrl ? 'Save & Sync to CRM' : 'Save Features'}
          </button>
        </div>
      )}

      {/* Audit log */}
      {auditLog.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-800">
          <button
            onClick={() => setShowAuditLog(!showAuditLog)}
            className="flex items-center gap-2 text-sm text-gray-400 hover:text-gray-300 transition-colors"
          >
            <Clock size={14} />
            Change History ({auditLog.length})
            {showAuditLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {showAuditLog && (
            <div className="mt-3 space-y-2 max-h-[200px] overflow-y-auto">
              {auditLog.map(entry => (
                <div key={entry.id} className="px-3 py-2 bg-gray-800/50 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-300">
                      {entry.action === 'enable' && <span className="text-green-400">Enabled</span>}
                      {entry.action === 'disable' && <span className="text-red-400">Disabled</span>}
                      {entry.action === 'bulk_update' && <span className="text-amber-400">Updated</span>}
                      {' '}{entry.features.map(f => f.replace(/_/g, ' ')).join(', ')}
                    </span>
                    {entry.synced_to_crm && <CheckCircle size={10} className="text-green-500" />}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-gray-500">{new Date(entry.created_at).toLocaleString()}</span>
                    <span className="text-[10px] text-gray-600">by {entry.changed_by}</span>
                  </div>
                  {entry.note && <p className="text-[10px] text-gray-500 mt-1">{entry.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
