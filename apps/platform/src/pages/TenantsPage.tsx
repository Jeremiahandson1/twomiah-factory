import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Plus, Building2, Globe, Server, MoreVertical } from 'lucide-react'
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
}

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const navigate = useNavigate()

  const fetchTenants = async () => {
    const { data } = await supabase.from('tenants').select('*').order('created_at', { ascending: false })
    setTenants(data || [])
    setLoading(false)
  }

  useEffect(() => { fetchTenants() }, [])

  const statusColors: Record<string, string> = {
    trial: 'bg-yellow-500/20 text-yellow-400',
    active: 'bg-green-500/20 text-green-400',
    suspended: 'bg-red-500/20 text-red-400',
    cancelled: 'bg-gray-500/20 text-gray-400',
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
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

      {loading ? (
        <div className="text-gray-400 text-sm">Loading...</div>
      ) : tenants.length === 0 ? (
        <div className="border border-dashed border-gray-700 rounded-xl p-16 text-center">
          <Building2 size={40} className="text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400 font-medium">No customers yet</p>
          <p className="text-gray-600 text-sm mt-1">Create your first customer to get started</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-6 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Create First Customer
          </button>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Company</th>
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Industry</th>
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Model</th>
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Plan</th>
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Status</th>
                <th className="text-left text-xs text-gray-500 font-medium px-6 py-3">Created</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t, i) => (
                <tr key={t.id}
                  onClick={() => navigate('/tenants/' + t.id)}
                  className={'cursor-pointer hover:bg-gray-800/50 transition-colors ' + (i < tenants.length - 1 ? 'border-b border-gray-800' : '')}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-white text-sm">{t.name}</div>
                    <div className="text-gray-500 text-xs">{t.slug}.twomiah.app</div>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm capitalize">{t.industry}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5 text-sm">
                      {t.deployment_model === 'saas' ? (
                        <><Globe size={14} className="text-purple-400" /><span className="text-purple-400">SaaS</span></>
                      ) : (
                        <><Server size={14} className="text-orange-400" /><span className="text-orange-400">Owned</span></>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-sm capitalize">{t.plan}</td>
                  <td className="px-6 py-4">
                    <span className={'text-xs px-2 py-1 rounded-full font-medium capitalize ' + (statusColors[t.status] || '')}>
                      {t.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-gray-500 text-sm">
                    {new Date(t.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4">
                    <button className="text-gray-600 hover:text-gray-400 transition-colors">
                      <MoreVertical size={16} />
                    </button>
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
