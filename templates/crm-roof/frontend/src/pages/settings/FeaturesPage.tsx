import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, Search } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import api from '../../services/api'
import { fieldNavItems } from '../../components/layout/AppLayout'

// Optional modules the owner can turn on/off. Derived from the sidebar's field
// items (the single place these features are gated), so the list can't drift and
// can't write an id nothing reads.
const OPTIONAL_FEATURES: { id: string; label: string }[] = Array.from(
  new Map(
    fieldNavItems
      .filter(i => !!i.feature)
      .map(i => [i.feature as string, { id: i.feature as string, label: i.label }])
  ).values()
)

export default function FeaturesPage() {
  const navigate = useNavigate()
  const { company, updateCompany } = useAuth()

  const optionalIds = useMemo(() => new Set(OPTIONAL_FEATURES.map(f => f.id)), [])
  const [selected, setSelected] = useState<Set<string>>(() => {
    const current = (company?.enabledFeatures || []) as string[]
    return new Set(current.filter(f => optionalIds.has(f)))
  })
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return OPTIONAL_FEATURES
    return OPTIONAL_FEATURES.filter(f => f.label.toLowerCase().includes(q) || f.id.includes(q))
  }, [query])

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      // Preserve every non-optional id the CRM relies on; only optional/nav-gated
      // ids are added or removed here.
      const preserved = ((company?.enabledFeatures || []) as string[]).filter(f => !optionalIds.has(f))
      const next = [...preserved, ...Array.from(selected)]
      await api.put('/api/company/features', { features: next })
      updateCompany({ enabledFeatures: next })
      setStatus({ ok: true, msg: 'Features updated' })
    } catch (err: any) {
      setStatus({ ok: false, msg: err?.message || 'Failed to update features' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={() => navigate('/crm/settings')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Back to Settings
      </button>

      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Features</h1>
          <p className="text-gray-500 mt-1 max-w-2xl">
            Turn on only the modules you use — the sidebar stays clean. Every feature is
            included free, so add or remove anything anytime at no extra charge.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="shrink-0 px-5 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-60"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {status && (
        <div className={`my-3 text-sm ${status.ok ? 'text-green-600' : 'text-red-600'}`}>{status.msg}</div>
      )}

      <div className="relative my-5 max-w-md">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search features..."
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
        />
      </div>

      <p className="text-sm text-gray-400 mb-3">{selected.size} of {OPTIONAL_FEATURES.length} optional modules on</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(f => {
          const on = selected.has(f.id)
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => toggle(f.id)}
              className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                on ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <span className={`font-medium ${on ? 'text-green-700' : 'text-gray-700'}`}>{f.label}</span>
              <span
                className={`shrink-0 w-5 h-5 rounded flex items-center justify-center border ${
                  on ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 text-transparent'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
