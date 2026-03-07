import { useState, useEffect } from 'react'
import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'

type Props = {
  config: FactoryConfig
  update: (patch: Partial<FactoryConfig>) => void
  onNext: () => void
  onBack: () => void
}

type ThemeOption = {
  id: string
  name: string
  description: string
  navBg: string
  heroBg: string
  heroText: string
  cardBg: string
  cardText: string
  btnRadius: string
  fontFamily: string
}

const THEMES: Record<string, ThemeOption[]> = {
  contractor: [
    { id: 'modern-minimal', name: 'Modern Minimal', description: 'Clean lines, whitespace, modern feel', navBg: '#1a1a1a', heroBg: 'linear-gradient(135deg,#f8f9fa,#e9ecef)', heroText: '#222', cardBg: '#fff', cardText: '#333', btnRadius: '20px', fontFamily: 'system-ui,sans-serif' },
    { id: 'bold-industrial', name: 'Bold Industrial', description: 'Heavy, strong, construction aesthetic', navBg: '#111', heroBg: 'linear-gradient(135deg,#1a1a1a,#2d2d2d)', heroText: '#fff', cardBg: '#1e1e1e', cardText: '#eee', btnRadius: '0', fontFamily: "'Impact',sans-serif" },
    { id: 'professional-corporate', name: 'Professional Corporate', description: 'Traditional, trustworthy look', navBg: '#0d1b2a', heroBg: 'linear-gradient(135deg,#0d1b2a,#1b3a5c)', heroText: '#fff', cardBg: '#fff', cardText: '#333', btnRadius: '4px', fontFamily: 'Georgia,serif' },
  ],
  homecare: [
    { id: 'clean-professional', name: 'Clean Professional', description: 'Clinical yet warm, trust-focused', navBg: '#0d7377', heroBg: 'linear-gradient(135deg,#e8f5f5,#d0ebeb)', heroText: '#1a3a3a', cardBg: '#fff', cardText: '#333', btnRadius: '6px', fontFamily: 'system-ui,sans-serif' },
    { id: 'warm-community', name: 'Warm & Community', description: 'Inviting, family-friendly feel', navBg: '#5c3d2e', heroBg: 'linear-gradient(135deg,#fdf6ee,#f5e6d0)', heroText: '#3a2a1a', cardBg: '#fefaf5', cardText: '#4a3a2a', btnRadius: '20px', fontFamily: 'Georgia,serif' },
  ],
  general: [
    { id: 'clean-minimal', name: 'Clean Minimal', description: 'Simple, works for any service business', navBg: '#1a1a1a', heroBg: 'linear-gradient(135deg,#f5f5f5,#eaeaea)', heroText: '#222', cardBg: '#fff', cardText: '#333', btnRadius: '6px', fontFamily: 'system-ui,sans-serif' },
    { id: 'trade-professional', name: 'Trade Professional', description: 'Structured, professional trade look', navBg: '#1a2744', heroBg: 'linear-gradient(135deg,#1a2744,#2d4a6f)', heroText: '#fff', cardBg: '#fff', cardText: '#333', btnRadius: '4px', fontFamily: 'system-ui,sans-serif' },
  ],
}

function getCategory(industry: string): string {
  if (industry === 'home_care') return 'homecare'
  if (industry && industry !== 'other') return 'contractor'
  return 'general'
}

function MiniPreview({ theme, companyName, primaryColor }: { theme: ThemeOption; companyName: string; primaryColor: string }) {
  const name = companyName || 'Your Company'
  return (
    <div style={{ fontFamily: theme.fontFamily, overflow: 'hidden', borderRadius: '6px 6px 0 0' }}>
      {/* Nav */}
      <div style={{ background: theme.navBg, color: '#fff', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '8px' }}>
        <span style={{ fontWeight: 700 }}>{name}</span>
        <span style={{ opacity: 0.6, fontSize: '6px' }}>Home &nbsp; Services &nbsp; About &nbsp; Contact</span>
      </div>
      {/* Hero */}
      <div style={{ background: theme.heroBg, color: theme.heroText, padding: '20px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: theme.fontFamily.includes('Impact') ? '14px' : '12px', fontWeight: 800, marginBottom: '3px', letterSpacing: theme.fontFamily.includes('Impact') ? '0.05em' : '0' }}>
          {name}
        </div>
        <div style={{ fontSize: '7px', opacity: 0.7, marginBottom: '8px' }}>Professional services you can trust</div>
        <span style={{ background: primaryColor, color: '#fff', fontSize: '7px', padding: '3px 14px', borderRadius: theme.btnRadius, fontWeight: 700, display: 'inline-block' }}>
          Get a Free Estimate
        </span>
      </div>
      {/* Cards */}
      <div style={{ background: theme.heroText === '#fff' ? '#f5f5f5' : '#fff', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', padding: '6px 12px 8px' }}>
        {['Service 1', 'Service 2', 'Service 3'].map(s => (
          <div key={s} style={{ background: theme.cardBg, color: theme.cardText, borderRadius: '3px', padding: '8px 4px', textAlign: 'center' }}>
            <div style={{ fontSize: '12px', marginBottom: '2px' }}>{s === 'Service 1' ? '🔧' : s === 'Service 2' ? '🏠' : '⭐'}</div>
            <div style={{ fontSize: '6px', fontWeight: 600, opacity: 0.8 }}>{s}</div>
          </div>
        ))}
      </div>
      {/* Footer */}
      <div style={{ background: theme.navBg, color: '#fff', padding: '4px 12px', textAlign: 'center', fontSize: '5px', opacity: 0.5 }}>
        &copy; {name}
      </div>
    </div>
  )
}

export default function StepWebsiteTemplate({ config, update, onNext, onBack }: Props) {
  const category = getCategory(config.company.industry)
  const themes = THEMES[category] || THEMES.general
  const [selected, setSelected] = useState(config.websiteTheme || themes[0]?.id || '')

  useEffect(() => {
    const cat = getCategory(config.company.industry)
    const t = THEMES[cat] || THEMES.general
    if (!config.websiteTheme || !t.find(th => th.id === config.websiteTheme)) {
      setSelected(t[0]?.id || '')
    }
  }, [config.company.industry, config.websiteTheme])

  const handleSelect = (id: string) => {
    setSelected(id)
    update({ websiteTheme: id })
  }

  const handleNext = () => {
    update({ websiteTheme: selected })
    onNext()
  }

  const companyName = config.company.name
  const primaryColor = config.branding.primaryColor || '#f97316'

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Website Template</h2>
      <p className="text-gray-400 text-sm mb-6">
        Choose a design for the website. Preview uses the company name and brand color.
      </p>

      <div className={'grid gap-4 mb-4 ' + (themes.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {themes.map(theme => (
          <div
            key={theme.id}
            onClick={() => handleSelect(theme.id)}
            className={
              'rounded-xl border-2 cursor-pointer transition-all overflow-hidden ' +
              (selected === theme.id
                ? 'border-orange-500 ring-2 ring-orange-500/20'
                : 'border-gray-700 hover:border-gray-500')
            }
          >
            <div className="h-48 overflow-hidden">
              <MiniPreview theme={theme} companyName={companyName} primaryColor={primaryColor} />
            </div>
            <div className="p-3 bg-gray-800/50">
              <div className="flex items-center gap-2">
                {selected === theme.id && (
                  <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />
                )}
                <div className="text-sm font-semibold text-white">{theme.name}</div>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{theme.description}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-600 text-center mb-6">
        Templates can be fully customized after deployment via the CMS admin panel.
      </p>

      <NavButtons onBack={onBack} onNext={handleNext} />
    </div>
  )
}
