import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase, API_URL as API } from '../supabase'
import {
  ArrowLeft, Download, Rocket, RefreshCw, ExternalLink,
  Globe, Clock, CheckCircle, XCircle, AlertCircle,
  Copy, ChevronRight, DollarSign, CreditCard, Package,
  Save, Trash2, Edit3, Database, Palette, Upload
} from 'lucide-react'
import FeatureManagement from '../components/factory/FeatureManagement'

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
  domain?: string
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

type DnsRecord = { type: string; name: string; status: 'verified' | 'pending' | 'error'; current?: string; expected?: string }
type DomainStatus = {
  domain: string; renderHost: string; records: DnsRecord[]; ssl: string; allVerified: boolean
  instructions: { steps: { type: string; name: string; value: string; description: string }[]; note: string }
}

function DomainSetup({ tenantId, currentDomain, websiteUrl, showToast }: {
  tenantId: string; currentDomain?: string; websiteUrl?: string
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  const [domain, setDomain] = useState(currentDomain || '')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [status, setStatus] = useState<DomainStatus | null>(null)

  async function saveDomain() {
    if (!domain.trim()) return
    setSaving(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/domain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session?.access_token },
        body: JSON.stringify({ domain: domain.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast('Domain configured on Render' + (data.renderErrors?.length ? ' (with warnings)' : ''))
        checkDns()
      } else {
        showToast(data.error || 'Failed to save domain', 'error')
      }
    } catch { showToast('Failed to save domain', 'error') }
    setSaving(false)
  }

  async function checkDns() {
    setChecking(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(API + '/api/v1/factory/customers/' + tenantId + '/domain/status', {
        headers: { 'Authorization': 'Bearer ' + session?.access_token },
      })
      if (res.ok) setStatus(await res.json())
      else showToast('Failed to check DNS', 'error')
    } catch { showToast('DNS check failed', 'error') }
    setChecking(false)
  }

  // Auto-check on mount if domain exists
  useEffect(() => { if (currentDomain) checkDns() }, [currentDomain])

  const renderHost = websiteUrl ? (() => { try { return new URL(websiteUrl).hostname } catch { return '' } })() : ''

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
      <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
        <Globe size={16} className="text-orange-400" /> Custom Domain
      </h2>

      {/* Domain input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text" value={domain} onChange={e => setDomain(e.target.value)}
          placeholder="yourbusiness.com"
          className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-orange-500"
        />
        <button onClick={saveDomain} disabled={saving || !domain.trim()}
          className="px-4 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors">
          {saving ? 'Saving...' : currentDomain ? 'Update' : 'Connect Domain'}
        </button>
      </div>

      {/* DNS Instructions */}
      {(currentDomain || status) && renderHost && (
        <div className="mb-4 p-4 bg-gray-800/60 rounded-lg border border-gray-700">
          <h3 className="text-sm font-semibold text-gray-200 mb-3">DNS Setup Instructions</h3>
          <p className="text-xs text-gray-400 mb-3">
            Add these records in your domain provider (GoDaddy, Namecheap, Cloudflare, etc.):
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left py-2 pr-4">Type</th>
                  <th className="text-left py-2 pr-4">Name/Host</th>
                  <th className="text-left py-2 pr-4">Value/Points to</th>
                  <th className="text-left py-2">Purpose</th>
                </tr>
              </thead>
              <tbody className="text-gray-300">
                <tr className="border-b border-gray-700/50">
                  <td className="py-2 pr-4 font-mono text-blue-400">CNAME</td>
                  <td className="py-2 pr-4 font-mono">www</td>
                  <td className="py-2 pr-4 font-mono text-emerald-400">{renderHost}</td>
                  <td className="py-2 text-gray-500">www.{currentDomain || domain}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono text-blue-400">CNAME</td>
                  <td className="py-2 pr-4 font-mono">@</td>
                  <td className="py-2 pr-4 font-mono text-emerald-400">{renderHost}</td>
                  <td className="py-2 text-gray-500">{currentDomain || domain} (root)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            If your DNS provider doesn't support CNAME on the root domain (@), use an ALIAS or ANAME record instead, or use Cloudflare for free CNAME flattening.
          </p>
        </div>
      )}

      {/* DNS Verification Status */}
      {status && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-200">Verification Status</h3>
            <button onClick={checkDns} disabled={checking}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200 transition-colors">
              <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
              {checking ? 'Checking...' : 'Re-check'}
            </button>
          </div>

          {status.records.map((record, i) => (
            <div key={i} className={'flex items-center justify-between p-3 rounded-lg border ' + (
              record.status === 'verified' ? 'bg-emerald-500/5 border-emerald-500/30' :
              record.status === 'error' ? 'bg-red-500/5 border-red-500/30' :
              'bg-yellow-500/5 border-yellow-500/30'
            )}>
              <div>
                <div className="text-sm text-white font-mono">{record.name}</div>
                <div className="text-xs text-gray-400">{record.type} record — {record.current || 'Not found'}</div>
              </div>
              <div className="flex items-center gap-1.5">
                {record.status === 'verified' ? (
                  <><CheckCircle size={14} className="text-emerald-400" /><span className="text-xs text-emerald-400">Connected</span></>
                ) : record.status === 'error' ? (
                  <><XCircle size={14} className="text-red-400" /><span className="text-xs text-red-400">Error</span></>
                ) : (
                  <><Clock size={14} className="text-yellow-400" /><span className="text-xs text-yellow-400">Pending</span></>
                )}
              </div>
            </div>
          ))}

          {/* SSL Status */}
          <div className={'flex items-center justify-between p-3 rounded-lg border ' + (
            status.ssl === 'verified' ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-yellow-500/5 border-yellow-500/30'
          )}>
            <div>
              <div className="text-sm text-white">SSL Certificate</div>
              <div className="text-xs text-gray-400">Auto-provisioned by Render after DNS verification</div>
            </div>
            <div className="flex items-center gap-1.5">
              {status.ssl === 'verified' ? (
                <><CheckCircle size={14} className="text-emerald-400" /><span className="text-xs text-emerald-400">Active</span></>
              ) : (
                <><Clock size={14} className="text-yellow-400" /><span className="text-xs text-yellow-400">Waiting for DNS</span></>
              )}
            </div>
          </div>

          {status.allVerified && (
            <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-sm text-emerald-400">
              <CheckCircle size={16} /> Domain is fully connected! Your site is live at <a href={'https://' + status.domain} target="_blank" rel="noreferrer" className="underline font-semibold">{status.domain}</a>
            </div>
          )}
        </div>
      )}

      {!currentDomain && !status && (
        <p className="text-xs text-gray-500">Enter a domain to connect it to this customer's website. The domain will be automatically configured on Render.</p>
      )}
    </div>
  )
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
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setDeploying(false); return }
      const res = await fetch(API + '/api/v1/factory/customers/' + tenant.id + '/deploy', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ region: 'ohio', plan: 'starter', dbPlan: 'basic_256mb' }),
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

  async function updateCode() {
    if (!tenant) return
    if (!confirm('Update code from latest template? This will NOT touch the database or any saved data — only the application code is updated.')) return
    setDeploying(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setDeploying(false); return }
      const res = await fetch(API + '/api/v1/factory/customers/' + tenant.id + '/update-code', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token },
      })
      const result = await res.json()
      if (res.ok && result.success) { showToast('Code updated successfully — deploying now'); load() }
      else { showToast(result.errors?.[0] || result.error || 'Update failed', 'error') }
    } catch { showToast('Update failed', 'error') }
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

  async function resetStripeCustomer() {
    setCheckoutLoading('reset')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setCheckoutLoading(null); return }
      const res = await fetch(API + '/api/v1/factory/customers/' + id + '/reset-stripe', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: '{}',
      })
      const data = await res.json()
      if (res.ok && data.success) { showToast('Stripe customer reset: ' + data.stripeCustomerId); load() }
      else { showToast(data.error || 'Failed to reset Stripe customer', 'error') }
    } catch { showToast('Failed to reset Stripe customer', 'error') }
    finally { setCheckoutLoading(null) }
  }

  async function switchBilling(mode: string) {
    setCheckoutLoading('switch-' + mode)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setCheckoutLoading(null); return }
      const body: any = { mode }
      if (mode === 'one_time') body.amount = Number(form.one_time_amount) || Number(form.monthly_amount) * 12 || 2497
      if (mode === 'subscription') body.amount = Number(form.monthly_amount) || 149
      if (form.plan) body.plan = form.plan
      const res = await fetch(API + '/api/v1/factory/customers/' + id + '/switch-billing', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok && data.success) { showToast('Billing switched to ' + mode); load() }
      else { showToast(data.error || 'Failed to switch billing', 'error') }
    } catch { showToast('Failed to switch billing', 'error') }
    finally { setCheckoutLoading(null) }
  }

  async function openBillingPortal() {
    setCheckoutLoading('portal')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Not authenticated', 'error'); setCheckoutLoading(null); return }
      const res = await fetch(API + '/api/v1/factory/customers/' + id + '/billing-portal', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) {
        const data = await res.json()
        if (data.url) { navigator.clipboard.writeText(data.url).catch(() => {}); showToast('Portal link copied! Opening...'); window.open(data.url, '_blank') }
      } else { const d = await res.json(); showToast(d.error || 'Failed to create portal session', 'error') }
    } catch { showToast('Failed to create portal session', 'error') }
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
                    <button onClick={deployToRender} disabled={deploying}
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
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={updateCode} disabled={deploying}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-emerald-400 border border-emerald-800 rounded-lg hover:bg-emerald-900/20 disabled:opacity-50 transition-colors">
                      <Upload size={14} /> Update Code
                    </button>
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
                <p className="text-xs text-gray-600">
                  <strong>Update Code</strong> — pushes latest template fixes without touching data.
                  <strong> Redeploy</strong> — restarts existing code.
                  <strong> Regenerate</strong> — full rebuild from scratch.
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-amber-500 bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-500/20">
                <AlertCircle size={14} className="flex-shrink-0" />
                Add RENDER_API_KEY, RENDER_OWNER_ID, GITHUB_TOKEN, and GITHUB_ORG to enable.
              </div>
            )}
          </div>

          {/* Custom Domain */}
          {(tenant.website_url || tenant.render_frontend_url) && (
            <DomainSetup
              tenantId={tenant.id}
              currentDomain={tenant.domain}
              websiteUrl={tenant.website_url || tenant.render_frontend_url}
              showToast={showToast}
            />
          )}

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
                  {tenant.stripe_customer_id && (
                    <button onClick={openBillingPortal} disabled={!!checkoutLoading}
                      className="flex items-center gap-2 px-3 py-2 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white rounded-lg disabled:opacity-50 transition-colors">
                      <CreditCard size={14} />
                      {checkoutLoading === 'portal' ? 'Opening...' : 'Customer Billing Portal'}
                    </button>
                  )}
                </div>

                {/* Quick billing switches */}
                <div className="flex flex-wrap gap-2 mt-3">
                  {tenant.billing_type !== 'one_time' && (
                    <button onClick={() => switchBilling('one_time')} disabled={!!checkoutLoading}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                      {checkoutLoading === 'switch-one_time' ? 'Switching...' : 'Switch to Owned (one-time)'}
                    </button>
                  )}
                  {tenant.billing_type !== 'subscription' && (
                    <button onClick={() => switchBilling('subscription')} disabled={!!checkoutLoading}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                      {checkoutLoading === 'switch-subscription' ? 'Switching...' : 'Switch to Monthly'}
                    </button>
                  )}
                  {tenant.billing_type !== 'free' && (
                    <button onClick={() => switchBilling('free')} disabled={!!checkoutLoading}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-gray-600 hover:bg-gray-500 text-white rounded-lg disabled:opacity-50 transition-colors">
                      {checkoutLoading === 'switch-free' ? 'Switching...' : 'Switch to Free'}
                    </button>
                  )}
                  <button onClick={resetStripeCustomer} disabled={!!checkoutLoading}
                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium bg-red-700 hover:bg-red-600 text-white rounded-lg disabled:opacity-50 transition-colors">
                    {checkoutLoading === 'reset' ? 'Resetting...' : 'Fix/Reset Stripe Customer'}
                  </button>
                </div>

                <p className="text-xs text-gray-600 mt-2">
                  {tenant.stripe_customer_id
                    ? 'Billing portal lets the customer self-manage payments, invoices, and subscriptions.'
                    : 'Creates a Stripe checkout link you can send to the customer. Link is also copied to clipboard.'}
                </p>
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
          {(tenant.admin_email || tenant.email) && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
              <h2 className="text-white font-semibold mb-3">Admin Login</h2>
              <div className="space-y-3 text-sm">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Email</label>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-300">{tenant.admin_email || tenant.email}</span>
                    <CopyButton value={tenant.admin_email || tenant.email} />
                  </div>
                </div>
                {tenant.admin_password ? (
                  <PasswordField password={tenant.admin_password} />
                ) : (
                  <p className="text-xs text-amber-400/80">
                    Password not stored on tenant record. Check the GitHub repo's README.md after deploy completes — generator embeds it there.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Feature Management */}
          <FeatureManagement
            tenantId={id!}
            tenantPlan={tenant.plan}
            onFeaturesUpdated={(features) => setTenant(prev => prev ? { ...prev, features } : prev)}
          />

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

    </div>
  )
}
