import { useState, useEffect } from 'react'
import { supabase, API_URL } from '../supabase'
import { Save, Plus, Trash2, DollarSign, Package, Server, Wrench, Layers, Loader2 } from 'lucide-react'

async function apiFetch(path: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}/api/v1/factory${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...opts.headers },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Request failed')
  return json
}

type SaasTier = { id: string; name: string; monthlyPrice: number; annualPrice: number; perUser?: boolean; highlight?: boolean; users: any; features: string[] }
type SelfHosted = { id: string; name: string; price: number }
type SelfHostedAddon = { id: string; name: string; price: number; type: string }
type DeployService = { id: string; name: string; price: number; description: string }
type FeatureBundle = { id: string; name: string; price: number; description: string }
type Product = { id: string; name: string }
type ProductPricing = {
  product: string
  saas_tiers: SaasTier[]
  self_hosted: SelfHosted[]
  self_hosted_addons: SelfHostedAddon[]
  deploy_services: DeployService[]
  feature_bundles: FeatureBundle[]
}

export default function PricingAdminPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'tiers' | 'selfHosted' | 'addons' | 'deploy' | 'bundles'>('tiers')

  const [products, setProducts] = useState<Product[]>([])
  const [selectedProduct, setSelectedProduct] = useState('')
  const [allPricing, setAllPricing] = useState<ProductPricing[]>([])

  // Current product's data
  const [tiers, setTiers] = useState<SaasTier[]>([])
  const [selfHosted, setSelfHosted] = useState<SelfHosted[]>([])
  const [selfHostedAddons, setSelfHostedAddons] = useState<SelfHostedAddon[]>([])
  const [deployServices, setDeployServices] = useState<DeployService[]>([])
  const [featureBundles, setFeatureBundles] = useState<FeatureBundle[]>([])

  useEffect(() => { loadPricing() }, [])

  // When product selection changes, load that product's data
  useEffect(() => {
    if (!selectedProduct || !allPricing.length) return
    const p = allPricing.find(r => r.product === selectedProduct)
    if (p) {
      setTiers(p.saas_tiers || [])
      setSelfHosted(p.self_hosted || [])
      setSelfHostedAddons(p.self_hosted_addons || [])
      setDeployServices(p.deploy_services || [])
      setFeatureBundles(p.feature_bundles || [])
    }
  }, [selectedProduct, allPricing])

  async function loadPricing() {
    try {
      const data = await apiFetch('/pricing')
      setProducts(data.products || [])
      setAllPricing(data.pricing || [])
      const first = data.products?.[0]?.id || 'crm'
      setSelectedProduct(first)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await apiFetch('/pricing', {
        method: 'PUT',
        body: JSON.stringify({
          product: selectedProduct,
          saas_tiers: tiers,
          self_hosted: selfHosted,
          self_hosted_addons: selfHostedAddons,
          deploy_services: deployServices,
          feature_bundles: featureBundles,
        }),
      })
      // Update local cache
      setAllPricing(prev => prev.map(p =>
        p.product === selectedProduct
          ? { ...p, saas_tiers: tiers, self_hosted: selfHosted, self_hosted_addons: selfHostedAddons, deploy_services: deployServices, feature_bundles: featureBundles }
          : p
      ))
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function updateTier(idx: number, field: string, value: any) {
    setTiers(prev => prev.map((t, i) => i === idx ? { ...t, [field]: value } : t))
  }

  function updateTierUsers(idx: number, field: string, value: any) {
    setTiers(prev => prev.map((t, i) => i === idx ? { ...t, users: { ...t.users, [field]: value } } : t))
  }

  function updateTierFeature(idx: number, fIdx: number, value: string) {
    setTiers(prev => prev.map((t, i) => {
      if (i !== idx) return t
      const features = [...t.features]
      features[fIdx] = value
      return { ...t, features }
    }))
  }

  function addTierFeature(idx: number) {
    setTiers(prev => prev.map((t, i) => i === idx ? { ...t, features: [...t.features, ''] } : t))
  }

  function removeTierFeature(idx: number, fIdx: number) {
    setTiers(prev => prev.map((t, i) => i === idx ? { ...t, features: t.features.filter((_, fi) => fi !== fIdx) } : t))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  const currentProductName = products.find(p => p.id === selectedProduct)?.name || selectedProduct

  const tabs = [
    { id: 'tiers' as const, label: 'SaaS Tiers', icon: DollarSign, count: tiers.length },
    { id: 'bundles' as const, label: 'Feature Add-Ons', icon: Layers, count: featureBundles.length },
    { id: 'selfHosted' as const, label: 'Self-Hosted Licenses', icon: Server, count: selfHosted.length },
    { id: 'addons' as const, label: 'Self-Hosted Add-Ons', icon: Package, count: selfHostedAddons.length },
    { id: 'deploy' as const, label: 'Deploy Services', icon: Wrench, count: deployServices.length },
  ]

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pricing Configuration</h1>
          <p className="text-sm text-gray-400 mt-1">Manage pricing per product — tiers, add-ons, and services</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {saved && <div className="bg-green-500/20 border border-green-500/30 text-green-400 px-4 py-2 rounded-lg text-sm">Pricing saved for {currentProductName}</div>}
      {error && <div className="bg-red-500/20 border border-red-500/30 text-red-400 px-4 py-2 rounded-lg text-sm">{error}</div>}

      {/* Product Selector */}
      <div className="flex gap-2">
        {products.map(p => (
          <button
            key={p.id}
            onClick={() => setSelectedProduct(p.id)}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
              selectedProduct === p.id
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>

      {/* Category Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
              tab === t.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <t.icon className="w-4 h-4" />
            <span className="hidden sm:inline">{t.label}</span>
            <span className="text-xs bg-gray-600 px-1.5 py-0.5 rounded">{t.count}</span>
          </button>
        ))}
      </div>

      {/* SaaS Tiers */}
      {tab === 'tiers' && (
        <div className="space-y-4">
          {tiers.map((tier, idx) => (
            <div key={idx} className="bg-gray-800 border border-gray-700 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-semibold text-white">{tier.name || 'New Tier'}</span>
                <button onClick={() => setTiers(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 p-1"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Plan ID</label>
                  <input value={tier.id} onChange={e => updateTier(idx, 'id', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Name</label>
                  <input value={tier.name} onChange={e => updateTier(idx, 'name', e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Monthly Price ($)</label>
                  <input type="number" value={tier.monthlyPrice} onChange={e => updateTier(idx, 'monthlyPrice', Number(e.target.value))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Annual Price ($/mo)</label>
                  <input type="number" value={tier.annualPrice} onChange={e => updateTier(idx, 'annualPrice', Number(e.target.value))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Users Included</label>
                  <input type="number" value={tier.users?.included ?? 0} onChange={e => updateTierUsers(idx, 'included', Number(e.target.value))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Max Users</label>
                  <input type="number" value={tier.users?.max ?? ''} onChange={e => updateTierUsers(idx, 'max', e.target.value ? Number(e.target.value) : null)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" placeholder="unlimited" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Extra User ($/mo)</label>
                  <input type="number" value={tier.users?.additionalPrice ?? ''} onChange={e => updateTierUsers(idx, 'additionalPrice', e.target.value ? Number(e.target.value) : null)} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" placeholder="n/a" />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={tier.highlight || false} onChange={e => updateTier(idx, 'highlight', e.target.checked)} className="rounded" />
                    Highlight
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                    <input type="checkbox" checked={tier.perUser || false} onChange={e => updateTier(idx, 'perUser', e.target.checked)} className="rounded" />
                    Per-user
                  </label>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Features (display list)</label>
                <div className="space-y-1">
                  {tier.features.map((f, fIdx) => (
                    <div key={fIdx} className="flex gap-2">
                      <input value={f} onChange={e => updateTierFeature(idx, fIdx, e.target.value)} className="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-1 text-sm text-white" />
                      <button onClick={() => removeTierFeature(idx, fIdx)} className="text-red-400 hover:text-red-300 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                  <button onClick={() => addTierFeature(idx)} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-1"><Plus className="w-3 h-3" /> Add feature</button>
                </div>
              </div>
            </div>
          ))}
          <button onClick={() => setTiers(prev => [...prev, { id: '', name: '', monthlyPrice: 0, annualPrice: 0, users: { included: 1, max: 5 }, features: [] }])} className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-4 h-4" /> Add Tier</button>
        </div>
      )}

      {/* Feature Bundles / Add-Ons */}
      {tab === 'bundles' && (
        <div className="space-y-3">
          {featureBundles.map((b, idx) => (
            <div key={idx} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">ID</label>
                  <input value={b.id} onChange={e => setFeatureBundles(prev => prev.map((x, i) => i === idx ? { ...x, id: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Name</label>
                  <input value={b.name} onChange={e => setFeatureBundles(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Price ($/mo)</label>
                  <input type="number" value={b.price} onChange={e => setFeatureBundles(prev => prev.map((x, i) => i === idx ? { ...x, price: Number(e.target.value) } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Description</label>
                  <input value={b.description} onChange={e => setFeatureBundles(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
              </div>
              <button onClick={() => setFeatureBundles(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 p-2"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setFeatureBundles(prev => [...prev, { id: '', name: '', price: 0, description: '' }])} className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-4 h-4" /> Add Bundle</button>
        </div>
      )}

      {/* Self-Hosted Licenses */}
      {tab === 'selfHosted' && (
        <div className="space-y-3">
          {selfHosted.map((s, idx) => (
            <div key={idx} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">ID</label>
                  <input value={s.id} onChange={e => setSelfHosted(prev => prev.map((x, i) => i === idx ? { ...x, id: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Name</label>
                  <input value={s.name} onChange={e => setSelfHosted(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Price ($)</label>
                  <input type="number" value={s.price} onChange={e => setSelfHosted(prev => prev.map((x, i) => i === idx ? { ...x, price: Number(e.target.value) } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
              </div>
              <button onClick={() => setSelfHosted(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 p-2"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setSelfHosted(prev => [...prev, { id: '', name: '', price: 0 }])} className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-4 h-4" /> Add License</button>
        </div>
      )}

      {/* Self-Hosted Add-Ons */}
      {tab === 'addons' && (
        <div className="space-y-3">
          {selfHostedAddons.map((a, idx) => (
            <div key={idx} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 grid grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">ID</label>
                  <input value={a.id} onChange={e => setSelfHostedAddons(prev => prev.map((x, i) => i === idx ? { ...x, id: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Name</label>
                  <input value={a.name} onChange={e => setSelfHostedAddons(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Price ($)</label>
                  <input type="number" value={a.price} onChange={e => setSelfHostedAddons(prev => prev.map((x, i) => i === idx ? { ...x, price: Number(e.target.value) } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Type</label>
                  <select value={a.type} onChange={e => setSelfHostedAddons(prev => prev.map((x, i) => i === idx ? { ...x, type: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white">
                    <option value="one_time">One-time</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="per_hour">Per hour</option>
                  </select>
                </div>
              </div>
              <button onClick={() => setSelfHostedAddons(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 p-2"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setSelfHostedAddons(prev => [...prev, { id: '', name: '', price: 0, type: 'one_time' }])} className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-4 h-4" /> Add Add-On</button>
        </div>
      )}

      {/* Deploy Services */}
      {tab === 'deploy' && (
        <div className="space-y-3">
          {deployServices.map((d, idx) => (
            <div key={idx} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex items-center gap-4">
              <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">ID</label>
                  <input value={d.id} onChange={e => setDeployServices(prev => prev.map((x, i) => i === idx ? { ...x, id: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Name</label>
                  <input value={d.name} onChange={e => setDeployServices(prev => prev.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Price ($)</label>
                  <input type="number" value={d.price} onChange={e => setDeployServices(prev => prev.map((x, i) => i === idx ? { ...x, price: Number(e.target.value) } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Description</label>
                  <input value={d.description} onChange={e => setDeployServices(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))} className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white" />
                </div>
              </div>
              <button onClick={() => setDeployServices(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-300 p-2"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => setDeployServices(prev => [...prev, { id: '', name: '', price: 0, description: '' }])} className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1"><Plus className="w-4 h-4" /> Add Service</button>
        </div>
      )}
    </div>
  )
}
