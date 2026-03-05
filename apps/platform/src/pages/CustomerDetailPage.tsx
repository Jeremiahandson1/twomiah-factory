import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, API_URL as API } from '../supabase'
import {
  ArrowLeft, Download, Rocket, RefreshCw, ExternalLink,
  Globe, Clock, CheckCircle, XCircle, AlertCircle,
  Copy, ChevronRight, DollarSign, CreditCard, Package,
  Save, Trash2, Edit3, Database, Palette
} from 'lucide-react'

type Tenant = {
  id: string; name: string; slug: string; email: string; phone: string
  city: string; state: string; industry: string; status: string
  primary_color: string; deployment_model: string; created_at: string
  admin_email?: string; admin_password?: string
  billing_type?: string; billing_status?: string; plan?: string
  monthly_amount?: number; one_time_amount?: number
  paid_at?: string; next_billing_date?: string; notes?: string
  products?: string[]; features?: string[]
  stripe_customer_id?: string; stripe_subscription_id?: string
  render_frontend_url?: string; render_backend_url?: string; website_url?: string
}

type FactoryJob = {
  id: string; tenant_id: string; template: string; status: string
  github_repo: string | null; render_url: string | null
  features: string[]; created_at: string
  zip_name?: string; build_id?: string
}

type Toast = { msg: string; type: 'success' | 'error' }

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: React.ReactNode }> = {
    complete:  { color: 'text-green-400 bg-green-400/10 border-green-400/30',    icon: <CheckCircle size={12} /> },
    active:    { color: 'text-green-400 bg-green-400/10 border-green-400/30',    icon: <CheckCircle size={12} /> },
    pending:   { color: 'text-blue-400 bg-blue-400/10 border-blue-400/30',       icon: <Download size={12} /> },
    deploying: { color: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30', icon: <RefreshCw size={12} className="animate-spin" /> },
    failed:    { color: 'text-red-400 bg-red-400/10 border-red-400/30',          icon: <XCircle size={12} /> },
  }
  const s = map[status] || { color: 'text-gray-400 bg-gray-400/10 border-gray-400/30', icon: <Clock size={12} /> }
  return (
    <span className={'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ' + s.color}>
      {s.icon}{status}
    </span>
  )
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(value).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="text-gray-500 hover:text-gray-300 transition-colors ml-1">
      {copied ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
    </button>
  )
}

function PasswordField({ password }: { password: string }) {
  const [visible, setVisible] = useState(false)
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">Temp Password</label>
      <div className="flex items-center gap-2">
        <span className="text-gray-300 font-mono">{visible ? password : '••••••••'}</span>
        <button onClick={() => setVisible(!visible)} className="text-gray-500 hover:text-gray-300 text-xs transition-colors">
          {visible ? 'Hide' : 'Show'}
        </button>
        <CopyButton value={password} />
      </div>
    </div>
  )
}

function productIcon(type: string) {
  switch (type) {
    case 'website': return <Globe size={14} className="text-emerald-400" />
    case 'cms':     return <Palette size={14} className="text-purple-400" />
    case 'crm':     return <Database size={14} className="text-blue-400" />
    default:        return <Package size={14} className="text-gray-400" />
  }
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [jobs, setJobs] = useState<FactoryJob[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [deletingJob, setDeletingJob] = useState<string | null>(null)
  const [showDeployModal, setShowDeployModal] = useState(false)
  const [deployPlan, setDeployPlan] = useState<string>('basic-256mb')
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [stripeConfigured, setStripeConfigured] = useState(false)
  const [deployConfigured, setDeployConfigured] = useState(false)
  const [form, setForm] = useState<Partial<Tenant>>({})

  useEffect(() => { load(); fetchConfigs() }, [id])

  async function load() {
    if (!id) return
    setLoading(true)
    const [{ data: t }, { data: j }] = await Promise.all([
      supabase.from('tenants').select('*').eq('id', id).single(),
      supabase.from('factory_jobs').select('*').eq('tenant_id', id).order('created_at', { ascending: false }),
    ])
    setTenant(t)
    setJobs(j || [])
    if (t) setForm({
      status: t.status,
      billing_type: t.billing_type || '',
      billing_status: t.billing_status || 'pending',
      plan: t.plan || '',
      monthly_amount: t.monthly_amount,
      one_time_amount: t.one_time_amount,
      paid_at: t.paid_at ? t.paid_at.split('T')[0] : '',
      next_billing_date: t.next_billing_date ? t.next_billing_date.split('T')[0] : '',
      render_frontend_url: t.render_frontend_url || '',
      render_backend_url: t.render_backend_url || '',
      website_url: t.website_url || '',
      notes: t.notes || '',
    })
    setLoading(false)
  }

  async function fetchConfigs() {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) return
      const [stripeRes, deployRes] = await Promise.all([
        fetch(API + '/api/v1/factory/stripe/config', { headers: { Authorization: 'Bearer ' + token } }),
        fetch(API + '/api/v1/factory/deploy/config',  { headers: { Authorization: 'Bearer ' + token } }),
      ])
      if (stripeRes.ok) { const d = await stripeRes.json(); setStripeConfigured(d.configured) }
      if (deployRes.ok) { const d = await deployRes.json(); setDeployConfigured(d.configured) }
    } catch (e) { console.warn('[CustomerDetail] Config fetch failed:', e) }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const { error } = await supabase.from('tenants').update({
        status: form.status,
        billing_type: form.billing_type,
        billing_status: form.billing_status,
        plan: form.plan,
        monthly_amount: form.monthly_amount ? Number(form.monthly_amount) : null,
        one_time_amount: form.one_time_amount ? Number(form.one_time_amount) : null,
        paid_at: form.paid_at || null,
        next_billing_date: form.next_billing_date || null,
        render_frontend_url: form.render_frontend_url,
        render_backend_url: form.render_backend_url,
        website_url: form.website_url,
        notes: form.notes,
      }).eq('id', id!)
      if (error) throw error
      showToast('Customer updated')
      setEditMode(false)
      load()
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this customer record? This cannot be undone.')) return
    try {
      await supabase.from('factory_jobs').delete().eq('tenant_id', id!)
      await supabase.from('tenants').delete().eq('id', id!)
      navigate('/tenants')
    } catch (e: unknown) {
      showToast('Failed to delete', 'error')
    }
  }

  async function deleteJob(jobId: string) {
    if (!confirm('Delete this build? The zip file will also be removed.')) return
    setDeletingJob(jobId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); return }
      await fetch(API + '/api/v1/factory/jobs/' + jobId, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + session.access_token },
      })
      setJobs(prev => prev.filter(j => j.id !== jobId))
      showToast('Build deleted', 'success')
    } catch (e: unknown) {
      showToast('Failed to delete: ' + (e instanceof Error ? e.message : 'unknown error'), 'error')
    } finally {
      setDeletingJob(null)
    }
  }

  async function deployToRender() {
    if (!tenant) return
    setDeploying(true)
    setShowDeployModal(false)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setDeploying(false); return }
      const res = await fetch(API + '/api/v1/factory/customers/' + tenant.id + '/deploy', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: 'ohio', plan: 'free', dbPlan: deployPlan }),
      })
      const data = await res.json()
      if (res.ok) { showToast('Deployment started! Services will be live in a few minutes.'); setTimeout(load, 15000) }
      else showToast(data.error || 'Deploy failed', 'error')
    } catch (e: unknown) {
      showToast('Deploy failed', 'error')
    } finally {
      setDeploying(false)
    }
  }

  async function redeploy() {
    if (!tenant) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); return }
      const res = await fetch(API + '/api/v1/factory/customers/' + tenant.id + '/redeploy', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token },
      })
      if (res.ok) showToast('Redeploy triggered')
      else { const d = await res.json(); showToast(d.error || 'Redeploy failed', 'error') }
    } catch { showToast('Redeploy failed', 'error') }
  }

  async function regenerate() {
    if (!tenant) return
    if (!confirm('Regenerate package from saved config and redeploy?')) return
    setDeploying(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setDeploying(false); return }
      const res = await fetch(API + '/api/v1/factory/customers/' + tenant.id + '/regenerate', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token },
      })
      if (res.ok) { showToast('Regenerating and deploying...'); load() }
      else { const d = await res.json(); showToast(d.error || 'Regenerate failed', 'error') }
    } catch { showToast('Regenerate failed', 'error') }
    finally { setDeploying(false) }
  }

  async function handleCheckout(type: string) {
    setCheckoutLoading(type)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setCheckoutLoading(null); return }
      const endpoint = type === 'subscription'
        ? API + '/api/v1/factory/customers/' + id + '/checkout/subscription'
        : API + '/api/v1/factory/customers/' + id + '/checkout/license'
      const body = type === 'subscription'
        ? { planId: form.plan || 'custom', monthlyAmount: Number(form.monthly_amount) || 149 }
        : { planId: form.plan || 'custom', amount: Number(form.one_time_amount) || 2497 }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.url) { navigator.clipboard.writeText(data.url).catch(() => {}); showToast('Checkout link copied!'); window.open(data.url, '_blank') }
      } else { const d = await res.json(); showToast(d.error || 'Failed to create checkout', 'error') }
    } catch { showToast('Failed to create checkout', 'error') }
    finally { setCheckoutLoading(null) }
  }

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  if (loading) return <div className="p-8 text-gray-500 text-sm">Loading...</div>
  if (!tenant) return <div className="p-8 text-red-400 text-sm">Customer not found.</div>

  const latestJob = jobs[0]
  const latestDeployed = jobs.find(j => j.status === 'complete')
  const enabledFeatures = tenant.features || latestJob?.features || []

  return (
    <div className="p-8 max-w-6xl mx-auto">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${
          toast.type === 'error' ? 'bg-red-500 text-white' : 'bg-emerald-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <button onClick={() => navigate('/tenants')}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-300 text-sm mb-6 transition-colors">
        <ArrowLeft size={16} /> Back to Customers
      </button>

      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0"
            style={{ backgroundColor: tenant.primary_color || '#f97316' }}>
            {tenant.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">{tenant.name}</h1>
            <div className="text-gray-400 text-sm mt-1 flex items-center gap-3">
              <span>{tenant.email}</span>
              {tenant.city && <span>· {tenant.city}, {tenant.state}</span>}
              {tenant.slug && <span>· {tenant.slug}</span>}
            </div>
            <div className="mt-2">
              <StatusBadge status={latestJob?.status || tenant.status || 'pending'} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!editMode ? (
            <>
              <button onClick={() => setEditMode(true)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors">
                <Edit3 size={14} /> Edit
              </button>
              <button onClick={() => navigate('/factory?tenant=' + id)}
                className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
                <Rocket size={16} /> New Build
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEditMode(false)}
                className="px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-300 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-400 disabled:opacity-50 transition-colors">
                <Save size={14} /> {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left / Main column */}
        <div className="col-span-2 space-y-6">

          {/* Deployment */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Rocket size={16} className="text-orange-400" /> Deployment
            </h2>

            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Status</label>
                {editMode ? (
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                    <option value="pending">Pending</option>
                    <option value="deploying">Deploying</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="canceled">Canceled</option>
                  </select>
                ) : (
                  <p className="text-sm font-medium text-gray-200 capitalize">{tenant.status}</p>
                )}
              </div>
              {tenant.products && tenant.products.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Products</label>
                  <div className="flex gap-2">
                    {tenant.products.map(p => (
                      <span key={p} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-800 text-gray-300 text-xs font-medium rounded-lg border border-gray-700">
                        {productIcon(p)} {p.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* URLs */}
            <div className="space-y-3 mb-5">
              {(['render_frontend_url', 'render_backend_url', 'website_url'] as const).map(field => {
                const label = field === 'render_frontend_url' ? 'CRM URL' : field === 'render_backend_url' ? 'API URL' : 'Website URL'
                const val = form[field] as string
                return (
                  <div key={field}>
                    <label className="text-xs text-gray-500 block mb-1">{label}</label>
                    {editMode ? (
                      <input type="text" value={val || ''} onChange={e => setForm({ ...form, [field]: e.target.value })}
                        placeholder="https://..." className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600" />
                    ) : val ? (
                      <div className="flex items-center gap-2">
                        <a href={val} target="_blank" rel="noreferrer" className="text-blue-400 text-sm hover:text-blue-300 flex items-center gap-1 truncate">
                          {val.replace('https://', '')} <ExternalLink size={12} />
                        </a>
                        <CopyButton value={val} />
                      </div>
                    ) : (
                      <p className="text-sm text-gray-600">Not set</p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Deploy Actions */}
            {deployConfigured ? (
              <div className="space-y-2">
                {!latestDeployed && (
                  <div className="flex gap-2">
                    <button onClick={() => setShowDeployModal(true)} disabled={deploying}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors">
                      <Rocket size={14} /> {deploying ? 'Deploying...' : 'Deploy to Render'}
                    </button>
                    <button onClick={regenerate} disabled={deploying}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-orange-400 border border-orange-900 rounded-lg hover:bg-orange-900/20 disabled:opacity-50 transition-colors">
                      <RefreshCw size={14} /> Regenerate
                    </button>
                  </div>
                )}
                {latestDeployed && (
                  <div className="flex items-center gap-2 text-sm text-emerald-400 mb-2">
                    <CheckCircle size={14} /> Deployed
                  </div>
                )}
                {latestDeployed && (
                  <div className="flex gap-2">
                    <button onClick={redeploy} disabled={deploying}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 border border-gray-700 rounded-lg hover:bg-gray-800 transition-colors">
                      <RefreshCw size={14} /> Redeploy
                    </button>
                    <button onClick={regenerate} disabled={deploying}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-orange-400 border border-orange-900 rounded-lg hover:bg-orange-900/20 transition-colors">
                      <Package size={14} /> Regenerate Package
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-600">Creates GitHub repo + Render services automatically.</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
                <AlertCircle size={14} className="flex-shrink-0" />
                Add RENDER_API_KEY, RENDER_OWNER_ID, GITHUB_TOKEN, and GITHUB_ORG to enable.
              </div>
            )}
          </div>

          {/* Billing */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <DollarSign size={16} className="text-orange-400" /> Billing
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Billing Type</label>
                {editMode ? (
                  <select value={form.billing_type || ''} onChange={e => setForm({ ...form, billing_type: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                    <option value="">Not set</option>
                    <option value="subscription">Subscription (monthly)</option>
                    <option value="one_time">One-time license</option>
                    <option value="free">Free / demo</option>
                  </select>
                ) : (
                  <p className="text-sm font-medium text-gray-200 capitalize">{tenant.billing_type || 'Not Set'}</p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Payment Status</label>
                {editMode ? (
                  <select value={form.billing_status || 'pending'} onChange={e => setForm({ ...form, billing_status: e.target.value })}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                    <option value="pending">Pending</option>
                    <option value="active">Active / Paid</option>
                    <option value="past_due">Past Due</option>
                    <option value="canceled">Canceled</option>
                  </select>
                ) : (
                  <p className="text-sm font-medium text-gray-200 capitalize">{tenant.billing_status || 'Pending'}</p>
                )}
              </div>

              {(form.billing_type === 'subscription' || tenant.billing_type === 'subscription') && (<>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Monthly Amount ($)</label>
                  {editMode ? (
                    <input type="number" value={form.monthly_amount || ''} onChange={e => setForm({ ...form, monthly_amount: Number(e.target.value) })}
                      placeholder="149.00" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600" />
                  ) : (
                    <p className="text-sm font-medium text-gray-200">{tenant.monthly_amount ? `$${Number(tenant.monthly_amount).toFixed(2)}` : '—'}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Next Billing Date</label>
                  {editMode ? (
                    <input type="date" value={form.next_billing_date || ''} onChange={e => setForm({ ...form, next_billing_date: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
                  ) : (
                    <p className="text-sm font-medium text-gray-200">{tenant.next_billing_date ? new Date(tenant.next_billing_date).toLocaleDateString() : '—'}</p>
                  )}
                </div>
              </>)}

              {(form.billing_type === 'one_time' || tenant.billing_type === 'one_time') && (<>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">License Amount ($)</label>
                  {editMode ? (
                    <input type="number" value={form.one_time_amount || ''} onChange={e => setForm({ ...form, one_time_amount: Number(e.target.value) })}
                      placeholder="2497.00" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600" />
                  ) : (
                    <p className="text-sm font-medium text-gray-200">{tenant.one_time_amount ? `$${Number(tenant.one_time_amount).toFixed(2)}` : '—'}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Paid Date</label>
                  {editMode ? (
                    <input type="date" value={form.paid_at || ''} onChange={e => setForm({ ...form, paid_at: e.target.value })}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white" />
                  ) : (
                    <p className="text-sm font-medium text-gray-200">{tenant.paid_at ? new Date(tenant.paid_at).toLocaleDateString() : '—'}</p>
                  )}
                </div>
              </>)}
            </div>

            <div className="mt-4">
              <label className="text-xs text-gray-500 block mb-1">Plan</label>
              {editMode ? (
                <select value={form.plan || ''} onChange={e => setForm({ ...form, plan: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white">
                  <option value="">Custom</option>
                  <option value="starter">Starter ($49/mo | $997 license)</option>
                  <option value="pro">Pro ($149/mo | $2,497 license)</option>
                  <option value="business">Business ($299/mo | $4,997 license)</option>
                  <option value="construction">Construction ($599/mo | $9,997 license)</option>
                </select>
              ) : (
                <p className="text-sm font-medium text-gray-200 capitalize">{tenant.plan || 'Custom'}</p>
              )}
            </div>

            {/* Stripe Actions */}
            {stripeConfigured && !editMode && (
              <div className="mt-5 pt-5 border-t border-gray-800">
                <label className="text-xs text-gray-500 block mb-2">Payment Actions</label>
                <div className="flex flex-wrap gap-2">
                  {(!tenant.billing_status || tenant.billing_status === 'pending') && (<>
                    <button onClick={() => handleCheckout('subscription')} disabled={!!checkoutLoading}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                      <CreditCard size={14} />
                      {checkoutLoading === 'subscription' ? 'Creating...' : 'Subscription Checkout'}
                    </button>
                    <button onClick={() => handleCheckout('license')} disabled={!!checkoutLoading}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                      <DollarSign size={14} />
                      {checkoutLoading === 'license' ? 'Creating...' : 'License Checkout'}
                    </button>
                  </>)}
                </div>
                <p className="text-xs text-gray-600 mt-2">Creates a Stripe checkout link you can send to the customer. Link is also copied to clipboard.</p>
              </div>
            )}
            {!stripeConfigured && !editMode && (
              <div className="mt-5 pt-5 border-t border-gray-800">
                <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
                  <AlertCircle size={14} className="flex-shrink-0" />
                  Stripe not configured. Add STRIPE_SECRET_KEY to enable payments.
                </div>
              </div>
            )}
          </div>

          {/* Build History */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Clock size={16} className="text-orange-400" /> Build History
            </h2>
            {jobs.length === 0 ? (
              <div className="text-gray-500 text-sm">No builds yet.</div>
            ) : (
              <div className="space-y-2">
                {jobs.map((job, i) => {
                  const zipName = job.zip_name || (tenant.slug + '-twomiah-build.zip')
                  const downloadUrl = job.build_id ? API + '/api/v1/factory/download/' + job.build_id + '/' + zipName : ''
                  return (
                    <div key={job.id} className="flex items-center justify-between py-3 border-b border-gray-800 last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-800 flex items-center justify-center text-gray-400 text-xs font-bold">
                          {jobs.length - i}
                        </div>
                        <div>
                          <div className="text-white text-sm font-medium">{job.template || 'crm'} build</div>
                          <div className="text-gray-500 text-xs mt-0.5">
                            {new Date(job.created_at).toLocaleString()}
                            {job.features?.length > 0 && ' · ' + job.features.length + ' features'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={job.status} />
                        {downloadUrl ? (
                          <button onClick={async () => { const { data: { session: s } } = await supabase.auth.getSession(); window.open(downloadUrl + '?token=' + (s?.access_token || ''), '_blank') }}
                            className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs transition-colors px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700">
                            <Download size={13} /> ZIP
                          </button>
                        ) : (
                          <span className="flex items-center gap-1.5 text-gray-600 text-xs px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700 cursor-not-allowed">
                            <Download size={13} /> ZIP
                          </span>
                        )}
                        <button
                          onClick={() => deleteJob(job.id)}
                          disabled={deletingJob === job.id}
                          title="Delete build"
                          className="flex items-center text-gray-600 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-400/10 disabled:opacity-40"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-3">Notes</h2>
            {editMode ? (
              <textarea value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })}
                rows={4} placeholder="Internal notes about this customer..."
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 resize-none" />
            ) : (
              <p className="text-sm text-gray-400">{tenant.notes || 'No notes'}</p>
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Details */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-4">Details</h2>
            <div className="space-y-3 text-sm">
              {tenant.phone && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Phone</span>
                  <span className="text-gray-300">{tenant.phone}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Model</span>
                <span className="text-gray-300 capitalize">{tenant.deployment_model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Created</span>
                <span className="text-gray-300">{new Date(tenant.created_at).toLocaleDateString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Total Builds</span>
                <span className="text-gray-300">{jobs.length}</span>
              </div>
            </div>
          </div>

          {/* Admin Login */}
          {tenant.admin_email && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-white font-semibold mb-3">Admin Login</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300">{tenant.admin_email}</span>
                    <CopyButton value={tenant.admin_email} />
                  </div>
                </div>
                {tenant.admin_password && (
                  <PasswordField password={tenant.admin_password} />
                )}
              </div>
            </div>
          )}

          {/* Enabled Features */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-3">
              Enabled Features <span className="text-gray-500 font-normal">({enabledFeatures.length})</span>
            </h2>
            {enabledFeatures.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {enabledFeatures.map((f: string) => (
                  <span key={f} className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-400 text-xs capitalize">
                    {f.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-600">No features recorded</p>
            )}
          </div>

          {/* Quick Actions */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h2 className="text-white font-semibold mb-3">Quick Actions</h2>
            <div className="space-y-2">
              <button onClick={() => navigate('/factory?tenant=' + id)}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors">
                <span className="flex items-center gap-2"><Rocket size={14} className="text-orange-400" /> New Build</span>
                <ChevronRight size={14} className="text-gray-600" />
              </button>
              {(tenant.render_frontend_url || latestDeployed?.render_url) && (
                <a href={tenant.render_frontend_url || latestDeployed?.render_url!} target="_blank" rel="noreferrer"
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm transition-colors">
                  <span className="flex items-center gap-2"><Globe size={14} className="text-blue-400" /> Open CRM</span>
                  <ExternalLink size={14} className="text-gray-600" />
                </a>
              )}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="bg-gray-900 border border-red-900/50 rounded-xl p-6">
            <h2 className="text-red-400 font-semibold mb-3">Danger Zone</h2>
            <button onClick={handleDelete}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-red-400 border border-red-900 rounded-lg hover:bg-red-900/20 transition-colors">
              <Trash2 size={14} /> Delete Customer Record
            </button>
          </div>

        </div>
      </div>

      {/* Deploy Plan Modal */}
      {showDeployModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-white font-bold text-lg mb-1">Deploy to Render</h2>
            <p className="text-gray-400 text-sm mb-6">Choose a database plan for this customer. This creates a GitHub repo, Postgres database, and web services.</p>

            <div className="space-y-3 mb-6">
              {[
                { value: 'free',        label: 'Free',          price: '$0/mo',  desc: 'Testing only. DB expires after 90 days.', color: 'border-gray-500' },
                { value: 'basic-256mb', label: 'Basic 256MB',   price: '$6/mo',  desc: 'Good for small production CRMs.', color: 'border-blue-500' },
                { value: 'basic-1gb',   label: 'Basic 1GB',     price: '$19/mo', desc: 'Recommended for active customers.', color: 'border-indigo-500' },
                { value: 'basic-4gb',   label: 'Basic 4GB',     price: '$75/mo', desc: 'High-volume workloads.', color: 'border-purple-500' },
              ].map(opt => (
                <div key={opt.value}
                  onClick={() => setDeployPlan(opt.value)}
                  className={'flex items-center justify-between p-4 rounded-xl border-2 cursor-pointer transition-all ' + (deployPlan === opt.value ? opt.color + ' bg-white/5' : 'border-gray-700 hover:border-gray-600')}>
                  <div>
                    <div className="text-white font-semibold text-sm">{opt.label}</div>
                    <div className="text-gray-400 text-xs mt-0.5">{opt.desc}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-white text-sm font-bold">{opt.price}</div>
                    {deployPlan === opt.value && <div className="text-xs text-green-400 mt-0.5">Selected ✓</div>}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowDeployModal(false)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-gray-700 text-gray-400 hover:text-white text-sm font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={deployToRender}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors">
                <Rocket size={14} /> Deploy Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
