import { useState } from 'react'
import { Search, ChevronDown, ChevronUp, Lock } from 'lucide-react'
import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'
import {
  type PlanSelection, PLANS_BY_PRODUCT, getPlanTierIndex, getFeatureTier,
} from './planData'

type Props = {
  config: FactoryConfig
  setConfig: React.Dispatch<React.SetStateAction<FactoryConfig>>
  plan?: PlanSelection
  onNext: () => void
  onBack: () => void
}

const CRM_PRESETS = [
  { id: 'service-starter', name: 'Service Starter', icon: '🔧', description: 'HVAC, plumbing, electrical, cleaning', features: ['contacts','jobs','quotes','invoices','scheduling','team','dashboard','drag_drop_calendar','recurring_jobs','online_booking','service_dispatch','pricebook','time_tracking','online_payments','expense_tracking','two_way_texting','google_reviews','lead_inbox'] },
  { id: 'project-pro', name: 'Project Pro', icon: '🏗️', description: 'Remodeling, roofing, general contracting', features: ['contacts','jobs','quotes','invoices','scheduling','team','dashboard','projects','change_orders','daily_logs','selections','time_tracking','photo_capture','expense_tracking','job_costing','online_payments','consumer_financing','documents','client_portal','google_reviews','lead_inbox'] },
  { id: 'contractor-suite', name: 'Contractor Suite', icon: '🏢', description: 'Full commercial construction', features: ['contacts','jobs','quotes','invoices','scheduling','team','dashboard','projects','rfis','change_orders','punch_lists','daily_logs','inspections','bid_management','takeoff_tools','selections','time_tracking','gps_tracking','photo_capture','fleet','online_payments','expense_tracking','job_costing','quickbooks','documents','reports','client_portal','call_tracking','lead_inbox'] },
  { id: 'everything', name: 'Enterprise', icon: '🚀', description: 'Every feature enabled', features: 'all' as const },
]

const WEBSITE_PRESETS = [
  { id: 'lead-capture', name: 'Lead Capture', icon: '📋', description: 'Single page. Hero, services, contact form.', features: ['contact_form'] },
  { id: 'brochure', name: 'Brochure Site', icon: '📄', description: '3–5 pages. Services, about, contact.', features: ['contact_form','services_pages','testimonials'] },
  { id: 'full-site', name: 'Full Site', icon: '🌐', description: 'All pages — gallery, blog, testimonials, visualizer.', features: ['contact_form','services_pages','gallery','blog','testimonials','analytics'] },
  { id: 'custom', name: 'Custom', icon: '⚙️', description: 'Full control over every feature.', features: null },
]

const CRM_REGISTRY = [
  { category: 'Core', features: [
    { id: 'contacts', name: 'Contacts', description: 'Client, lead, vendor management', core: true },
    { id: 'jobs', name: 'Jobs', description: 'Job tracking and management', core: true },
    { id: 'quotes', name: 'Quotes', description: 'Professional estimates and quotes', core: true },
    { id: 'invoices', name: 'Invoices', description: 'Invoice generation and tracking', core: true },
    { id: 'scheduling', name: 'Scheduling', description: 'Calendar and job scheduling', core: true },
    { id: 'team', name: 'Team', description: 'Team member management', core: true },
    { id: 'dashboard', name: 'Dashboard', description: 'Overview dashboard', core: true },
  ]},
  { category: 'Construction', features: [
    { id: 'projects', name: 'Projects', description: 'Multi-phase project management', core: false },
    { id: 'rfis', name: 'RFIs', description: 'Request for information tracking', core: false },
    { id: 'change_orders', name: 'Change Orders', description: 'Change order management', core: false },
    { id: 'punch_lists', name: 'Punch Lists', description: 'Punch list tracking', core: false },
    { id: 'daily_logs', name: 'Daily Logs', description: 'Field daily log reports', core: false },
    { id: 'inspections', name: 'Inspections', description: 'Quality inspections', core: false },
    { id: 'bid_management', name: 'Bid Management', description: 'Bid tracking and submission', core: false },
    { id: 'takeoff_tools', name: 'Takeoff Tools', description: 'Material takeoff calculations', core: false },
    { id: 'selections', name: 'Selections', description: 'Client material selections portal', core: false },
  ]},
  { category: 'Service Trade', features: [
    { id: 'drag_drop_calendar', name: 'Drag & Drop Calendar', description: 'Visual job scheduling', core: false },
    { id: 'recurring_jobs', name: 'Recurring Jobs', description: 'Automated recurring job creation', core: false },
    { id: 'route_optimization', name: 'Route Optimization', description: 'Optimize daily service routes', core: false },
    { id: 'online_booking', name: 'Online Booking', description: 'Customer self-scheduling', core: false },
    { id: 'service_dispatch', name: 'Service Dispatch', description: 'Real-time dispatch board', core: false },
    { id: 'service_agreements', name: 'Service Agreements', description: 'Maintenance agreement management', core: false },
    { id: 'warranties', name: 'Warranties', description: 'Warranty tracking', core: false },
    { id: 'pricebook', name: 'Pricebook', description: 'Standardized pricing catalog', core: false },
  ]},
  { category: 'Field Service', features: [
    { id: 'dispatch_board', name: 'Dispatch Board', description: 'Real-time tech dispatch and scheduling', core: false },
    { id: 'maintenance_contracts', name: 'Maintenance Contracts', description: 'Recurring service agreements', core: false },
    { id: 'flat_rate_pricebook', name: 'Flat-Rate Pricebook', description: 'Standard pricing for common services', core: false },
    { id: 'parts_tracking', name: 'Parts & Inventory', description: 'Track parts, stock levels, and usage', core: false },
  ]},
  { category: 'Automotive', features: [
    { id: 'vehicle_inventory', name: 'Vehicle Inventory', description: 'VIN decode, stock management, pricing', core: false },
    { id: 'sales_pipeline', name: 'Sales Pipeline', description: 'Kanban lead pipeline with ADF/XML import', core: false },
    { id: 'service_department', name: 'Service Department', description: 'Repair orders and service check-in', core: false },
    { id: 'service_to_sales', name: 'Service-to-Sales Bridge', description: 'Alert salespeople when their leads check into service', core: false },
  ]},
  { category: 'Field Operations', features: [
    { id: 'time_tracking', name: 'Time Tracking', description: 'Clock in/out with GPS', core: false },
    { id: 'gps_tracking', name: 'GPS Tracking', description: 'Real-time crew location', core: false },
    { id: 'photo_capture', name: 'Photo Capture', description: 'Job site photo documentation', core: false },
    { id: 'equipment_tracking', name: 'Equipment', description: 'Equipment and tool tracking', core: false },
    { id: 'fleet', name: 'Fleet Management', description: 'Vehicle fleet tracking', core: false },
  ]},
  { category: 'Finance', features: [
    { id: 'online_payments', name: 'Online Payments', description: 'Stripe payment processing', core: false },
    { id: 'expense_tracking', name: 'Expense Tracking', description: 'Expense logging and receipts', core: false },
    { id: 'job_costing', name: 'Job Costing', description: 'Detailed job cost analysis', core: false },
    { id: 'consumer_financing', name: 'Consumer Financing', description: 'Wisetack financing integration', core: false },
    { id: 'quickbooks', name: 'QuickBooks', description: 'QuickBooks sync', core: false },
  ]},
  { category: 'Communication', features: [
    { id: 'two_way_texting', name: 'Two-Way Texting', description: 'SMS communication with clients', core: false },
    { id: 'call_tracking', name: 'Call Tracking', description: 'Inbound call tracking and recording', core: false },
    { id: 'client_portal', name: 'Client Portal', description: 'Customer-facing project portal', core: false },
    { id: 'lead_inbox', name: 'Lead Inbox', description: 'Unified lead feed from Angi, Thumbtack, HomeAdvisor, Google LSA', core: false },
  ]},
  { category: 'Marketing', features: [
    { id: 'paid_ads', name: 'Paid Ads Hub (Google + Meta)', description: 'Google & Meta campaign management', core: false },
    { id: 'google_reviews', name: 'Google Reviews', description: 'Review request automation', core: false },
    { id: 'email_marketing', name: 'Email Marketing', description: 'Drip campaigns and newsletters', core: false },
    { id: 'referral_program', name: 'Referral Program', description: 'Customer referral tracking', core: false },
  ]},
  { category: 'Advanced', features: [
    { id: 'inventory', name: 'Inventory', description: 'Warehouse and material inventory', core: false },
    { id: 'documents', name: 'Documents', description: 'Document management and storage', core: false },
    { id: 'reports', name: 'Reports', description: 'Custom reporting dashboard', core: false },
    { id: 'custom_dashboards', name: 'Custom Dashboards', description: 'Drag-and-drop widget dashboards', core: false },
    { id: 'ai_receptionist', name: 'AI Receptionist', description: 'AI-powered call handling', core: false },
    { id: 'map_view', name: 'Map View', description: 'Map-based job visualization', core: false },
  ]},
]

const WEBSITE_REGISTRY = [
  { category: 'Pages & Content', features: [
    { id: 'contact_form', name: 'Contact Form', description: 'Lead capture form' },
    { id: 'services_pages', name: 'Services Pages', description: 'Individual service pages' },
    { id: 'gallery', name: 'Photo Gallery', description: 'Project photo gallery' },
    { id: 'blog', name: 'Blog', description: 'News and articles' },
    { id: 'testimonials', name: 'Testimonials', description: 'Customer reviews display' },
    { id: 'analytics', name: 'Analytics', description: 'Google Analytics integration' },
  ]},
]

const HOMECARE_MODULES = [
  { icon: '👤', label: 'Client Management', desc: 'Profiles, onboarding, emergency contacts' },
  { icon: '🧑‍⚕️', label: 'Caregiver Management', desc: 'Certifications, pay rates, availability' },
  { icon: '📅', label: 'Scheduling', desc: 'Drag-and-drop calendar, recurring shifts' },
  { icon: '🕐', label: 'Time Tracking & GPS', desc: 'Clock in/out, GPS logging, geofencing' },
  { icon: '✅', label: 'EVV Verification', desc: 'Electronic visit verification' },
  { icon: '📋', label: 'Authorizations', desc: 'Auth tracking, units, expiry alerts' },
  { icon: '💰', label: 'Billing & Invoicing', desc: 'Auto-generate invoices from visits' },
  { icon: '💵', label: 'Payroll', desc: 'Pay periods, Gusto sync' },
  { icon: '🔒', label: 'HIPAA Compliance', desc: 'Background checks, audit log' },
  { icon: '💬', label: 'Communication', desc: 'SMS, push, message board' },
  { icon: '📊', label: 'Reports & Analytics', desc: 'Hours, revenue, payer mix, census' },
  { icon: '📱', label: 'Caregiver Portal', desc: 'Mobile clock in/out, shift pickup' },
]

export default function StepFeatures({ config, setConfig, plan, onNext, onBack }: Props) {
  const hasWebsite = config.products.includes('website')
  const hasCRM = config.products.includes('crm')
  const isHomeCare = config.company?.industry === 'home_care'
  const [tab, setTab] = useState(hasCRM ? 'crm' : 'website')

  if (!hasWebsite && !hasCRM) {
    return (
      <div>
        <h2 className="text-xl font-bold text-white mb-2">Features</h2>
        <div className="text-center py-16 text-gray-500">
          <p>No products with configurable features selected.</p>
          <p className="text-sm mt-1">CMS features are managed through the admin after deployment.</p>
        </div>
        <NavButtons onBack={onBack} onNext={onNext} />
      </div>
    )
  }

  const setFeatures = (key: 'crm' | 'website', features: string[]) =>
    setConfig(prev => ({ ...prev, features: { ...prev.features, [key]: features } }))

  const setPaidAds = (val: boolean) =>
    setConfig(prev => ({ ...prev, features: { ...prev.features, paid_ads: val } }))

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Configure Features</h2>
      <p className="text-gray-400 text-sm mb-6">Select which features to enable for each product.</p>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {hasCRM && (
          <button onClick={() => setTab('crm')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'crm' ? 'bg-orange-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            CRM ({config.features.crm.length})
          </button>
        )}
        {hasWebsite && (
          <button onClick={() => setTab('website')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'website' ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            Website ({config.features.website.length})
          </button>
        )}
        {(hasCRM || hasWebsite) && (
          <button onClick={() => setTab('ads')} className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === 'ads' ? 'bg-green-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}>
            📣 Ads {config.features.paid_ads ? '✓' : ''}
          </button>
        )}
      </div>

      {tab === 'crm' && hasCRM && (
        isHomeCare ? (
          <HomeCareIncluded />
        ) : (
          <CRMFeatures
            selected={config.features.crm}
            onChange={f => setFeatures('crm', f)}
            industry={config.company?.industry}
            plan={plan}
          />
        )
      )}
      {tab === 'website' && hasWebsite && (
        <WebsiteFeatures
          selected={config.features.website}
          onChange={f => setFeatures('website', f)}
        />
      )}
      {tab === 'ads' && (
        <PaidAdsFeature enabled={config.features.paid_ads} onChange={setPaidAds} />
      )}

      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  )
}

function HomeCareIncluded() {
  return (
    <div className="mb-4">
      <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-5 mb-6">
        <h3 className="text-green-400 font-bold text-lg mb-1">Twomiah Care — Everything Included</h3>
        <p className="text-green-300 text-sm">The Home Care CRM is a complete, fixed platform. Every module is included — nothing to configure. Fill in company details and deploy.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {HOMECARE_MODULES.map(m => (
          <div key={m.label} className="flex items-start gap-3 bg-gray-800 border border-gray-700 rounded-lg p-3">
            <span className="text-xl flex-shrink-0">{m.icon}</span>
            <div>
              <div className="text-white text-sm font-semibold flex items-center gap-1">
                <svg width="12" height="12" viewBox="0 0 12 12" className="text-green-500 flex-shrink-0"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                {m.label}
              </div>
              <div className="text-gray-400 text-xs mt-0.5">{m.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const FIELD_SERVICE_INDUSTRIES = new Set(['field_service', 'hvac', 'plumbing'])

function CRMFeatures({ selected, onChange, industry, plan }: { selected: string[], onChange: (f: string[]) => void, industry?: string, plan?: PlanSelection }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Plan-based feature locking
  const hasPlan = plan && plan.planId
  const currentTierIdx = hasPlan ? getPlanTierIndex(plan.product, plan.planId) : -1
  const plans = hasPlan ? PLANS_BY_PRODUCT[plan.product] : []
  const planFeatures = hasPlan ? new Set(plans[currentTierIdx]?.features || []) : new Set<string>()

  // Determine if a feature is locked by plan (included in current tier — can't uncheck)
  const isLockedByPlan = (featureId: string) => hasPlan && planFeatures.has(featureId)
  // Determine if a feature requires upgrade (exists in a higher tier only)
  const getUpgradeTier = (featureId: string): string | null => {
    if (!hasPlan) return null
    const featureTierIdx = getFeatureTier(plan.product, featureId)
    if (featureTierIdx < 0 || featureTierIdx <= currentTierIdx) return null
    return plans[featureTierIdx]?.name || null
  }

  const filteredRegistry = CRM_REGISTRY.filter(c =>
    c.category !== 'Field Service' || FIELD_SERVICE_INDUSTRIES.has(industry || '')
  )
  const allFeatures = filteredRegistry.flatMap(c => c.features)
  const allIds = allFeatures.map(f => f.id)
  const coreIds = allFeatures.filter(f => f.core).map(f => f.id)

  const toggle = (id: string) => {
    if (coreIds.includes(id)) return
    if (isLockedByPlan(id)) return // Can't uncheck plan features
    if (getUpgradeTier(id)) return // Can't check upgrade features
    onChange(selected.includes(id) ? selected.filter(f => f !== id) : [...selected, id])
  }

  const applyPreset = (preset: typeof CRM_PRESETS[0]) => {
    if (hasPlan) return // Presets disabled when plan controls features
    if (preset.features === 'all') onChange([...allIds])
    else onChange([...preset.features])
  }

  return (
    <div className="mb-4">
      {hasPlan && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4 mb-4">
          <div className="text-orange-400 text-sm font-semibold">Features set by your plan — {plans[currentTierIdx]?.name}</div>
          <p className="text-orange-300/70 text-xs mt-1">Features included in your plan are locked. Higher-tier features show upgrade labels.</p>
        </div>
      )}

      {!hasPlan && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          {CRM_PRESETS.map(p => (
            <button key={p.id} onClick={() => applyPreset(p)}
              className="text-left p-3 border border-gray-700 hover:border-gray-600 rounded-xl bg-gray-800/50 transition-all">
              <div className="text-xl mb-1">{p.icon}</div>
              <div className="text-white text-xs font-semibold">{p.name}</div>
              <div className="text-gray-500 text-xs mt-0.5">{p.description}</div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-2.5 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search features..."
            className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
        </div>
        <span className="text-gray-500 text-xs whitespace-nowrap">{selected.length}/{allIds.length} selected</span>
        {!hasPlan && (
          <>
            <button onClick={() => onChange([...allIds])} className="text-orange-400 text-xs hover:text-orange-300 font-semibold">All</button>
            <button onClick={() => onChange([...coreIds])} className="text-gray-400 text-xs hover:text-gray-300">Core only</button>
          </>
        )}
      </div>

      {filteredRegistry.map(cat => {
        const filtered = cat.features.filter(f =>
          !search || f.name.toLowerCase().includes(search.toLowerCase())
        )
        if (!filtered.length) return null
        const isOpen = expanded[cat.category] !== false
        const catCount = filtered.filter(f => selected.includes(f.id)).length
        return (
          <div key={cat.category} className="border border-gray-700 rounded-xl overflow-hidden mb-2">
            <button onClick={() => setExpanded(prev => ({ ...prev, [cat.category]: !isOpen }))}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 text-left">
              <span className="text-white text-sm font-semibold">{cat.category}
                <span className="text-gray-500 font-normal ml-2">{catCount}/{filtered.length}</span>
              </span>
              {isOpen ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
            </button>
            {isOpen && (
              <div className="px-4 py-2 bg-gray-900/50">
                {filtered.map(f => {
                  const locked = f.core || isLockedByPlan(f.id)
                  const upgradeTo = getUpgradeTier(f.id)
                  const isUpgrade = !!upgradeTo
                  return (
                    <div key={f.id} onClick={() => toggle(f.id)}
                      className={`flex items-center gap-3 py-2 ${locked || isUpgrade ? 'cursor-default' : 'cursor-pointer'} ${isUpgrade ? 'opacity-50' : ''}`}>
                      <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-all ${
                        isUpgrade ? 'border-gray-600 bg-transparent' :
                        selected.includes(f.id) ? (locked ? 'border-green-500 bg-green-500' : 'border-orange-500 bg-orange-500') : 'border-gray-600'
                      }`}>
                        {selected.includes(f.id) && !isUpgrade && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        {isUpgrade && <Lock size={10} className="text-gray-500" />}
                      </div>
                      <span className={`text-sm ${isUpgrade ? 'text-gray-500' : 'text-white'}`}>{f.name}</span>
                      {f.core && <span className="text-green-500 text-xs">CORE</span>}
                      {isLockedByPlan(f.id) && !f.core && <span className="text-green-500 text-xs">PLAN</span>}
                      {isUpgrade && <span className="text-yellow-500 text-xs">Upgrade to {upgradeTo}</span>}
                      {!isUpgrade && f.description && <span className="text-gray-500 text-xs">{f.description}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function WebsiteFeatures({ selected, onChange }: { selected: string[], onChange: (f: string[]) => void }) {
  const [activePreset, setActivePreset] = useState<string | null>(null)
  const [showCustom, setShowCustom] = useState(false)
  const allIds = WEBSITE_REGISTRY.flatMap(c => c.features.map(f => f.id))

  const applyPreset = (preset: typeof WEBSITE_PRESETS[0]) => {
    setActivePreset(preset.id)
    if (preset.id === 'custom') { setShowCustom(true); return }
    setShowCustom(false)
    onChange(preset.features || [])
  }

  return (
    <div className="mb-4">
      <div className="grid grid-cols-2 gap-3 mb-4">
        {WEBSITE_PRESETS.map(p => (
          <div key={p.id} onClick={() => applyPreset(p)}
            className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${activePreset === p.id ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800/40'}`}>
            <div className="text-2xl mb-2">{p.icon}</div>
            <div className="text-white font-semibold text-sm">{p.name}</div>
            <div className="text-gray-400 text-xs mt-1">{p.description}</div>
          </div>
        ))}
      </div>

      {activePreset && activePreset !== 'custom' && selected.length > 0 && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
          <div className="text-green-400 text-sm font-semibold mb-1">✅ {selected.length} features selected</div>
          <div className="text-green-300 text-xs">{selected.map(f => f.replace(/_/g, ' ')).join(', ')}</div>
          <button onClick={() => { setActivePreset('custom'); setShowCustom(true) }}
            className="text-blue-400 text-xs mt-2 hover:text-blue-300">Customize →</button>
        </div>
      )}

      {showCustom && (
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-white text-sm font-semibold">Custom Features</span>
            <button onClick={() => onChange([...allIds])} className="text-blue-400 text-xs hover:text-blue-300">Select All</button>
          </div>
          {WEBSITE_REGISTRY.map(cat => (
            <div key={cat.category} className="mb-3">
              <div className="text-gray-400 text-xs font-semibold mb-2 uppercase tracking-wider">{cat.category}</div>
              {cat.features.map(f => (
                <div key={f.id} onClick={() => onChange(selected.includes(f.id) ? selected.filter(x => x !== f.id) : [...selected, f.id])}
                  className="flex items-center gap-3 py-2 cursor-pointer">
                  <div className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${selected.includes(f.id) ? 'border-blue-500 bg-blue-500' : 'border-gray-600'}`}>
                    {selected.includes(f.id) && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                  <span className="text-white text-sm">{f.name}</span>
                  <span className="text-gray-500 text-xs">{f.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PaidAdsFeature({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`border-2 rounded-xl overflow-hidden ${enabled ? 'border-green-500' : 'border-gray-700'}`}>
      <div className={`flex items-center gap-4 p-5 ${enabled ? 'bg-green-500/10' : 'bg-gray-800/50'}`}>
        <span className="text-4xl">📣</span>
        <div className="flex-1">
          <div className="text-white font-bold text-lg">Paid Ads — Google + Meta</div>
          <div className="text-gray-400 text-sm mt-1">AI-powered campaign creation via Twomiah Ads. Launches Google campaigns automatically after onboarding.</div>
        </div>
        <button onClick={() => onChange(!enabled)}
          className={`px-6 py-2 rounded-lg font-bold text-white transition-colors ${enabled ? 'bg-green-500 hover:bg-green-400' : 'bg-orange-500 hover:bg-orange-400'}`}>
          {enabled ? 'Enabled ✓' : 'Enable'}
        </button>
      </div>
      {enabled && (
        <div className="px-5 py-3 bg-yellow-500/10 border-t border-yellow-500/20 text-yellow-300 text-sm">
          Twomiah Ads tenant provisioned automatically on generate. Client connects Google Ads after deployment.
        </div>
      )}
    </div>
  )
}
