import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { Users, Factory, TrendingUp, Activity } from 'lucide-react'

export default function DashboardPage() {
  const [stats, setStats] = useState({ tenants: 0, active: 0, saas: 0, owned: 0 })

  const [error, setError] = useState('')

  useEffect(() => {
    supabase.from('tenants').select('deployment_model, status').then(({ data, error: err }) => {
      if (err) { setError(err.message); return }
      if (!data) return
      setStats({
        tenants: data.length,
        active: data.filter(t => t.status === 'active').length,
        saas: data.filter(t => t.deployment_model === 'saas').length,
        owned: data.filter(t => t.deployment_model === 'owned').length,
      })
    })
  }, [])

  const cards = [
    { label: 'Total Customers', value: stats.tenants, icon: Users, color: 'text-blue-400' },
    { label: 'Active', value: stats.active, icon: Activity, color: 'text-green-400' },
    { label: 'SaaS', value: stats.saas, icon: TrendingUp, color: 'text-purple-400' },
    { label: 'Owned Instances', value: stats.owned, icon: Factory, color: 'text-orange-400' },
  ]

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-white mb-2">Dashboard</h1>
      <p className="text-gray-400 text-sm mb-8">Twomiah Factory operator view</p>
      {error && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">{error}</div>}
      <div className="grid grid-cols-4 gap-4">
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-400">{label}</span>
              <Icon size={18} className={color} />
            </div>
            <span className="text-3xl font-bold text-white">{value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
