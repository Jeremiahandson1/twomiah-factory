import { Globe, Layout, Briefcase, Eye, Sparkles, AlertTriangle } from 'lucide-react'
import type { FactoryConfig } from './types'
import { pickPremiumTrack, premiumTrackLabel, allSupportedPremiumIndustries } from './premiumIndustries'

type Props = { config: FactoryConfig; update: (p: Partial<FactoryConfig>) => void; onNext: () => void; onBack: () => void }

const PRODUCTS: Array<{ id: string; name: string; desc: string; icon: typeof Globe; color: string; disabled?: boolean }> = [
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
    let products: string[]
    if (config.products.includes(id)) {
      products = config.products.filter(p => p !== id)
      // Dropping 'website' also drops the premium tier flag — it only makes
      // sense alongside the website product.
      if (id === 'website') products = products.filter(p => p !== 'website-premium')
    } else {
      products = [...config.products, id]
    }
    update({ products })
  }

  const isPremium = config.products.includes('website-premium')
  const setPremium = (next: boolean) => {
    const products = next
      ? Array.from(new Set([...config.products, 'website-premium']))
      : config.products.filter(p => p !== 'website-premium')
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
            <div key={id}>
              <div onClick={() => !disabled && toggle(id)} className={'flex items-center gap-4 p-5 rounded-xl border-2 transition-all ' + (disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer')}
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
              {id === 'website' && selected && (
                <WebsiteTierPicker
                  isPremium={isPremium}
                  industry={config.company?.industry}
                  setPremium={setPremium}
                />
              )}
            </div>
          )
        })}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} canNext={config.products.length > 0} />
    </div>
  )
}

function WebsiteTierPicker({ isPremium, industry, setPremium }: { isPremium: boolean; industry: string | undefined; setPremium: (v: boolean) => void }) {
  const track = pickPremiumTrack(industry)
  const supported = !!track
  return (
    <div className="mt-3 ml-16 pl-2 border-l-2 border-blue-500/30">
      <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">Website tier</div>
      <div className="grid grid-cols-2 gap-3">
        <TierCard
          selected={!isPremium}
          onClick={() => setPremium(false)}
          name="Standard"
          price="$19/mo"
          setup="No build fee"
          accent="#3b82f6"
          bullets={[
            'Fixed EJS template, token-swapped',
            'Theme picker on the next step',
            'Same look across builds in the vertical',
          ]}
        />
        <TierCard
          selected={isPremium}
          onClick={() => supported && setPremium(true)}
          disabled={!supported}
          name="Premium"
          price="$75/mo"
          setup="+ $1,000 one-time build"
          accent="#8b5cf6"
          icon={<Sparkles size={14} />}
          bullets={[
            'AI-composed sections per build — no two sites look identical',
            'Per-vertical template family + brand-driven palette',
            'Customer reviews draft before paying',
          ]}
        />
      </div>
      {isPremium && track && (
        <div className="mt-3 flex items-start gap-2 text-xs text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded-lg px-3 py-2">
          <Sparkles size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Industry <span className="font-mono">{industry || '(unset)'}</span> routes to <span className="font-semibold">{premiumTrackLabel(track)}</span>.
          </span>
        </div>
      )}
      {!supported && (
        <div className="mt-3 flex items-start gap-2 text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
          <span>
            Premium isn't available for industry <span className="font-mono">{industry || '(unset)'}</span> yet.
            Supported: <span className="opacity-80">{allSupportedPremiumIndustries().slice(0, 12).join(', ')}…</span>
          </span>
        </div>
      )}
    </div>
  )
}

function TierCard({ selected, onClick, disabled, name, price, setup, accent, bullets, icon }: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  name: string
  price: string
  setup: string
  accent: string
  bullets: string[]
  icon?: React.ReactNode
}) {
  const borderColor = disabled ? '#1f2937' : selected ? accent : '#374151'
  const bgColor = disabled ? 'transparent' : selected ? accent + '14' : 'transparent'
  return (
    <div
      onClick={() => !disabled && onClick()}
      className={'p-4 rounded-xl border-2 transition-all ' + (disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer')}
      style={{ borderColor, backgroundColor: bgColor }}
    >
      <div className="flex items-center gap-2 mb-1">
        {icon && <span style={{ color: accent }}>{icon}</span>}
        <span className="text-white font-semibold text-sm">{name}</span>
        {selected && (
          <span className="ml-auto w-4 h-4 rounded-sm flex items-center justify-center" style={{ backgroundColor: accent }}>
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        )}
      </div>
      <div className="text-white text-lg font-bold leading-tight" style={{ color: accent }}>{price}</div>
      <div className="text-gray-500 text-xs mb-2">{setup}</div>
      <ul className="text-xs text-gray-400 space-y-1">
        {bullets.map(b => (
          <li key={b} className="flex items-start gap-1.5">
            <span className="text-gray-600 mt-0.5">•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
