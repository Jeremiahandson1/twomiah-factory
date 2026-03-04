import { useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { Building2 } from 'lucide-react'
import type { FactoryConfig } from './types'
import { STATE_NAMES } from './StepCompany'

type Props = {
  config: FactoryConfig
  update: (p: Partial<FactoryConfig>) => void
  onNext: () => void
}

type Tenant = { id: string; name: string; slug: string; deployment_model: string; primary_color: string; email: string; city: string; state: string; phone: string; industry: string }

export default function StepCustomer({ config, update, onNext }: Props) {
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('tenants').select('id,name,slug,deployment_model,primary_color,email,city,state,phone,industry')
      .order('name')
      .then(({ data }) => { setTenants(data || []); setLoading(false) })
  }, [])

  const select = (t: Tenant) => {
    update({
      tenant_id: t.id,
      tenant_name: t.name,
      tenant_slug: t.slug,
      company: {
        name: t.name,
        email: t.email || '',
        phone: t.phone || '',
        address: '',
        city: t.city || '',
        state: t.state || '',
        stateFull: STATE_NAMES[(t.state || '').toUpperCase()] || t.state || '',
        zip: '',
        domain: '',
        ownerName: '',
        industry: t.industry || '',
        serviceRegion: t.city || '',
        nearbyCities: ['', '', '', ''],
      }
    })
  }

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Select Customer</h2>
      <p className="text-gray-400 text-sm mb-6">Who is this build for? Select a customer to pre-fill their info.</p>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : tenants.length === 0 ? (
        <div className="text-center py-12">
          <Building2 size={40} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No customers found. Create one in the Customers tab first.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-6">
          {tenants.map(t => (
            <button
              key={t.id}
              onClick={() => select(t)}
              className={
                'text-left p-4 rounded-xl border-2 transition-all ' +
                (config.tenant_id === t.id
                  ? 'border-orange-500 bg-orange-500/10'
                  : 'border-gray-700 hover:border-gray-600 bg-gray-800/40')
              }
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
                  style={{ backgroundColor: t.primary_color || '#f97316' }}>
                  {t.name.charAt(0)}
                </div>
                <div>
                  <div className="text-white text-sm font-medium">{t.name}</div>
                  <div className="text-gray-500 text-xs capitalize">{t.industry || 'construction'} · {t.deployment_model}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onNext}
          disabled={!config.tenant_id}
          className="bg-orange-500 hover:bg-orange-400 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  )
}
