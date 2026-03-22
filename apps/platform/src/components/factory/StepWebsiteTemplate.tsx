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
    { id: 'bold-industrial', name: 'Bold Industrial', description: 'Heavy, dark, safety-stripe accents — built for roofers & construction', navBg: '#111', heroBg: 'linear-gradient(135deg,#1a1a1a,#2d2d2d)', heroText: '#fff', cardBg: '#1e1e1e', cardText: '#eee', btnRadius: '0', fontFamily: "'Oswald',sans-serif" },
    { id: 'professional-corporate', name: 'Professional Corporate', description: 'Navy & slate, serif headings — established and trustworthy', navBg: '#1e3a5f', heroBg: 'linear-gradient(135deg,#1e3a5f,#2d5a8f)', heroText: '#fff', cardBg: '#fff', cardText: '#333', btnRadius: '6px', fontFamily: "'Playfair Display',serif" },
    { id: 'modern-minimal', name: 'Modern Minimal', description: 'Clean whitespace, frosted glass, editorial feel', navBg: '#fafafa', heroBg: 'linear-gradient(135deg,#f5f5f3,#e9e9e7)', heroText: '#222', cardBg: '#fff', cardText: '#333', btnRadius: '16px', fontFamily: "'DM Sans',sans-serif" },
  ],
  fieldservice: [
    { id: 'bold-industrial', name: 'Technical Modern', description: 'Dark slate, electric blue — HVAC & plumbing tech feel', navBg: '#0f1729', heroBg: 'linear-gradient(135deg,#0f1729,#1a2744)', heroText: '#fff', cardBg: '#141d33', cardText: '#e2e8f0', btnRadius: '4px', fontFamily: "'Rajdhani',sans-serif" },
    { id: 'professional-corporate', name: 'Friendly Neighborhood', description: 'Green & amber, rounded — the local service company next door', navBg: '#166534', heroBg: 'linear-gradient(135deg,#166534,#15803d)', heroText: '#fff', cardBg: '#fff', cardText: '#333', btnRadius: '10px', fontFamily: "'Nunito',sans-serif" },
    { id: 'modern-minimal', name: 'Corporate Fleet', description: 'Cool gray, clean lines — professional fleet operation', navBg: '#0f172a', heroBg: 'linear-gradient(135deg,#f1f5f9,#e2e8f0)', heroText: '#0f172a', cardBg: '#fff', cardText: '#334155', btnRadius: '4px', fontFamily: "'Inter',sans-serif" },
  ],
  homecare: [
    { id: 'warm-community', name: 'Warm & Compassionate', description: 'Rose & sage, serif fonts — caring and family-focused', navBg: '#5c3d2e', heroBg: 'linear-gradient(135deg,#fdf8f4,#f7efe6)', heroText: '#3a2a1a', cardBg: '#fdf8f4', cardText: '#4a3a2a', btnRadius: '20px', fontFamily: "'Playfair Display',serif" },
    { id: 'clean-professional', name: 'Clinical Trust', description: 'Teal & white, clean — medical-grade professionalism', navBg: '#0d9488', heroBg: 'linear-gradient(135deg,#eff6ff,#dbeafe)', heroText: '#1a3a3a', cardBg: '#fff', cardText: '#333', btnRadius: '6px', fontFamily: "'Poppins',sans-serif" },
    { id: 'family-modern', name: 'Family Modern', description: 'Lavender & purple, playful — community and family first', navBg: '#7c3aed', heroBg: 'linear-gradient(135deg,#f5f3ff,#ede9fe)', heroText: '#3b1f7a', cardBg: '#f5f3ff', cardText: '#4c1d95', btnRadius: '16px', fontFamily: "'Quicksand',sans-serif" },
  ],
  general: [
    { id: 'clean-minimal', name: 'Clean Minimal', description: 'Emerald accent, pure whitespace — works for any business', navBg: '#fff', heroBg: 'linear-gradient(135deg,#ffffff,#f0fdf4)', heroText: '#111', cardBg: '#fff', cardText: '#333', btnRadius: '8px', fontFamily: "'Space Grotesk',sans-serif" },
    { id: 'trade-professional', name: 'Established & Traditional', description: 'Parchment & brown, serif — looks like 30 years in business', navBg: '#44403c', heroBg: 'linear-gradient(135deg,#faf6f1,#f0e9df)', heroText: '#44403c', cardBg: '#faf6f1', cardText: '#44403c', btnRadius: '4px', fontFamily: "'Merriweather',serif" },
    { id: 'bold-contrast', name: 'Bold Contrast', description: 'Black & white, neon accent — striking and unforgettable', navBg: '#000', heroBg: 'linear-gradient(135deg,#000,#111)', heroText: '#fff', cardBg: '#fff', cardText: '#000', btnRadius: '0', fontFamily: "'Bebas Neue',sans-serif" },
  ],
  dispensary: [
    { id: 'glassmorphism-dark', name: 'Glassmorphism Dark', description: 'Luxury dark, glass effects, purple glow — premium cannabis', navBg: '#0a0a0a', heroBg: 'linear-gradient(135deg,#0a0a0a,#1a0a2e)', heroText: '#fff', cardBg: 'rgba(255,255,255,0.05)', cardText: '#e2e8f0', btnRadius: '12px', fontFamily: "'Outfit',sans-serif" },
    { id: 'botanical-organic', name: 'Botanical Organic', description: 'Cream & forest green, natural — wellness-focused dispensary', navBg: '#14532d', heroBg: 'linear-gradient(135deg,#fefce8,#f0fdf4)', heroText: '#14532d', cardBg: '#fefce8', cardText: '#14532d', btnRadius: '8px', fontFamily: "'Cormorant Garamond',serif" },
    { id: 'streetwear-bold', name: 'Streetwear Bold', description: 'Black, neon green, urban edge — culture-forward brand', navBg: '#000', heroBg: 'linear-gradient(135deg,#000,#0d0d0d)', heroText: '#fff', cardBg: '#000', cardText: '#fff', btnRadius: '0', fontFamily: "'Bebas Neue',sans-serif" },
  ],
}

function getCategory(industry: string): string {
  if (industry === 'home_care' || industry === 'homecare') return 'homecare'
  if (industry === 'hvac' || industry === 'plumbing' || industry === 'electrical' || industry === 'field_service' || industry === 'fieldservice') return 'fieldservice'
  if (industry === 'cannabis' || industry === 'dispensary') return 'dispensary'
  if (industry === 'roofing' || industry === 'construction' || industry === 'contractor' || industry === 'siding' || industry === 'remodeling') return 'contractor'
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
