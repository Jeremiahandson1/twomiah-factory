import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Plus, Building2, Globe, Server, Search, DollarSign, AlertCircle } from 'lucide-react'
import NewTenantModal from '../components/NewTenantModal'
import { useNavigate } from 'react-router-dom'

type Tenant = {
  id: string
  name: string
  slug: string
  industry: string
  deployment_model: string
  status: string
  plan: string
  email: string
  created_at: string
  billing_type: string | null
  billing_status: string | null
  monthly_amount: number | null
  one_time_amount: number | null
  stripe_subscription_id: string | null
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterBilling, setFilterBilling] = useState<string>('all')
  const navigate = useNavigate()

  const fetchTenants = async () => {
    const { data } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    setTenants(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchTenants() }, [])

  const statusColors: Record<string, string> = {
    pending: 'bg-blue-500/20 text-blue-400',
    deploying: 'bg-yellow-500/20 text-yellow-400',
    trial: 'bg-yellow-500/20 text-yellow-400',
    active: 'bg-green-500/20 text-green-400',
    suspended: 'bg-red-500/20 text-red-400',
    canceled: 'bg-gray-500/20 text-gray-400',
  }

  const billingColors: Record<string, string> = {
    active: 'text-emerald-400',
    past_due: 'text-red-400',
    canceled: 'text-gray-500',
    pending: 'text-yellow-400',
  }

  const filtered = tenants.filter(t => {
    if (search && !t.name.toLowerCase().includes(search.toLowerCase()) && !t.slug.toLowerCase().includes(search.toLowerCase()) && !t.email?.toLowerCase().includes(search.toLowerCase())) return false
    if (filterStatus !== 'all' && t.status !== filterStatus) return false
    if (filterBilling === 'active' && t.billing_status !== 'active') return false
    if (filterBilling === 'past_due' && t.billing_status !== 'past_due') return false
    if (filterBilling === 'unpaid' && (t.billing_status === 'active' || t.billing_type === 'one_time')) return false
    return true
  })

  const mrr = tenants.reduce((sum, t) => {
    if (t.billing_type === 'subscription' && t.billing_status === 'active' && t.monthly_amount) {
      return sum + Number(t.monthly_amount)
    }
    return sum
  }, 0)

  const pastDueCount = tenants.filter(t => t.billing_status === 'past_due').length
  const activeSubCount = tenants.filter(t => t.billing_type === 'subscription' && t.billing_status === 'active').length

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Customers</h1>
          <p className="text-gray-400 text-sm mt-1">{tenants.length} total accounts</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          New Customer
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">MRR</p>
            <p className="text-2xl font-bold text-white">${mrr.toLocaleString()}</p>
          </div>
          <DollarSign size={20} className="text-emerald-400" />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Active Subscriptions</p>
            <p className="text-2xl font-bold text-white">{activeSubCount}</p>
          </div>
          <Globe size={20} className="text-blue-400" />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500">Past Due</p>
            <p className={'text-2xl font-bold ' + (pastDueCount > 0 ? 'text-red-400' : 'text-white')}>{pastDueCount}</p>
          </div>
          <AlertCircle size={20} className={pastDueCount > 0 ? 'text-red-400' : 'text-gray-600'} />
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, slug, or email..."
            className="w-full pl-9 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none">
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="pending">Pending</option>
          <option value="deploying">Deploying</option>
          <option value="suspended">Suspended</option>
          <option value="canceled">Canceled</option>
        </select>
        <select value={filterBilling} onChange={e => setFilterBilling(e.target.value)}
          className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none">
          <option value="all">All Billing</option>
          <option value="active">Paid</option>
          <option value="past_due">Past Due</option>
          <option value="unpaid">No Payment</option>
        </select>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-gray-700 rounded-xl p-16 text-center">
          <Building2 size={40} className="text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 font-medium">{tenants.length === 0 ? 'No customers yet' : 'No matching customers'}</p>
          {tenants.length === 0 && (
            <>
              <p className="text-gray-600 text-sm mt-1">Create your first customer to get started</p>
              <button onClick={() => setShowModal(true)}
                className="mt-6 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                Create First Customer
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Company</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Model</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Plan</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Status</th>
                <th className="text-left text-xs text-gray-500 font-medium px-4 py-3">Billing</th>
                <th className="text-right text-xs text-gray-500 font-medium px-6 py-3">MRR</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => (
                <tr key={t.id}
                  onClick={() => navigate('/tenants/' + t.id)}
                  className={'cursor-pointer hover:bg-gray-800/50 transition-colors ' + (i < filtered.length - 1 ? 'border-b border-gray-800' : '')}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-white text-sm">{t.name}</div>
                    <div className="text-gray-500 text-xs">{t.email || t.slug}</div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-1.5 text-sm">
                      {t.deployment_model === 'saas' ? (
                        <><Globe size={14} className="text-purple-400" /><span className="text-purple-400">SaaS</span></>
                      ) : (
                        <><Server size={14} className="text-orange-400" /><span className="text-orange-400">Owned</span></>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-gray-400 text-sm capitalize">{t.plan || '—'}</td>
                  <td className="px-4 py-4">
                    <span className={'text-xs px-2 py-1 rounded-full font-medium capitalize ' + (statusColors[t.status] || 'bg-gray-500/20 text-gray-400')}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    {t.billing_status ? (
                      <span className={'text-xs font-medium capitalize ' + (billingColors[t.billing_status] || 'text-gray-500')}>
                        {t.billing_status === 'active' ? 'Paid' : t.billing_status.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    {t.billing_type === 'subscription' && t.billing_status === 'active' && t.monthly_amount ? (
                      <span className="text-sm font-medium text-emerald-400">${Number(t.monthly_amount).toLocaleString()}</span>
                    ) : t.billing_type === 'one_time' && t.one_time_amount ? (
                      <span className="text-xs text-gray-500">${Number(t.one_time_amount).toLocaleString()} (license)</span>
                    ) : (
                      <span className="text-xs text-gray-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <NewTenantModal onClose={() => setShowModal(false)} onCreated={fetchTenants} />}
    </div>
  )
}
