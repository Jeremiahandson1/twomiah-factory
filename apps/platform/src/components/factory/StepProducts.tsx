import { Globe, Layout, Briefcase, Eye } from 'lucide-react'
import type { FactoryConfig } from './types'

type Props = { config: FactoryConfig; update: (p: Partial<FactoryConfig>) => void; onNext: () => void; onBack: () => void }

const PRODUCTS = [
  { id: 'website', name: 'Website', desc: 'Server-rendered site with SEO, blog, gallery, contact forms', icon: Globe, color: '#3b82f6' },
  { id: 'cms', name: 'CMS Admin Panel', desc: 'Full content management — pages, media, settings, leads', icon: Layout, color: '#8b5cf6' },
  { id: 'crm', name: 'CRM', desc: 'Business management — contacts, jobs, invoices, scheduling, 85+ features', icon: Briefcase, color: '#f97316' },
  { id: 'vision', name: 'Twomiah Vision', desc: 'AI home exterior visualizer', icon: Eye, color: '#10b981' },
]

export function NavButtons({ onBack, onNext, canNext = true, nextLabel = 'Next →' }: { onBack: () => void; onNext: () => void; canNext?: boolean; nextLabel?: string }) {
  return (
    <div className="flex justify-between pt-4 border-t border-gray-800 mt-6">
      <button onClick={onBack} className="text-gray-400 hover:text-white px-4 py-2 rounded-lg text-sm transition-colors">← Back</button>
      <button onClick={onNext} disabled={!canNext} className="bg-orange-500 hover:bg-orange-400 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40">{nextLabel}</button>
    </div>
  )
}

export default function StepProducts({ config, update, onNext, onBack }: Props) {
  const toggle = (id: string) => {
    const products = config.products.includes(id) ? config.products.filter(p => p !== id) : [...config.products, id]
    update({ products })
  }
  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Select Products</h2>
      <p className="text-gray-400 text-sm mb-6">Choose which products to include. Any combination works.</p>
      <div className="flex flex-col gap-4 mb-6">
        {PRODUCTS.map(({ id, name, desc, icon: Icon, color, disabled }) => {
          const selected = config.products.includes(id)
          const borderColor = disabled ? '#1f2937' : selected ? color : '#374151'
          const bgColor = disabled ? 'transparent' : selected ? color + '12' : 'transparent'
          const iconBg = disabled ? '#111827' : selected ? color : '#1f2937'
          const checkBorder = disabled ? '#374151' : selected ? color : '#4b5563'
          const checkBg = disabled ? 'transparent' : selected ? color : 'transparent'
          return (
            <div key={id} onClick={() => !disabled && toggle(id)} className={'flex items-center gap-4 p-5 rounded-xl border-2 transition-all ' + (disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}
              style={{ borderColor, backgroundColor: bgColor }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: iconBg }}>
                <Icon size={24} color={selected ? 'white' : '#6b7280'} />
              </div>
              <div className="flex-1">
                <div className="text-white font-semibold">{name}</div>
                <div className="text-gray-400 text-sm mt-0.5">{desc}</div>
              </div>
              <div className="w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0"
                style={{ borderColor: checkBorder, backgroundColor: checkBg }}>
                {selected && <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
            </div>
          )
        })}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} canNext={config.products.length > 0} />
    </div>
  )
}
