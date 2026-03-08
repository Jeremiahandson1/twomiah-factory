import { useState, useEffect } from 'react'
import { Plus, Trash2, RefreshCw, Sparkles } from 'lucide-react'
import { supabase, API_URL } from '../../supabase'
import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'

type Props = { config: FactoryConfig; setConfig: React.Dispatch<React.SetStateAction<FactoryConfig>>; onNext: () => void; onBack: () => void }

const HOME_CARE_SERVICES = [
  { id: 'personal-care', name: 'Personal Care', desc: 'Bathing, grooming, dressing assistance' },
  { id: 'companion-care', name: 'Companion Care', desc: 'Social engagement, light housekeeping' },
  { id: 'respite-care', name: 'Respite Care', desc: 'Relief for family caregivers' },
  { id: 'memory-care', name: 'Memory Care', desc: "Alzheimer's and dementia support" },
  { id: 'skilled-nursing', name: 'Skilled Nursing Support', desc: 'Medication, post-hospital care' },
  { id: 'transportation', name: 'Transportation', desc: 'Rides to appointments and errands' },
  { id: 'meal-prep', name: 'Meal Preparation', desc: 'Nutritious meals and grocery help' },
  { id: 'light-housekeeping', name: 'Light Housekeeping', desc: 'Laundry, dishes, tidying up' },
]

const CONTRACTOR_SERVICES = [
  { id: 'roofing', name: 'Roofing', desc: 'Replacement, repair, and inspection' },
  { id: 'siding', name: 'Siding', desc: 'Vinyl, fiber cement, wood siding' },
  { id: 'windows', name: 'Windows & Doors', desc: 'Replacement windows and entry doors' },
  { id: 'gutters', name: 'Gutters', desc: 'Seamless gutters and gutter guards' },
  { id: 'painting', name: 'Painting', desc: 'Interior and exterior painting' },
  { id: 'decks', name: 'Decks & Patios', desc: 'Custom deck design and installation' },
  { id: 'remodeling', name: 'Remodeling', desc: 'Kitchen, bath, basement remodels' },
  { id: 'insulation', name: 'Insulation', desc: 'Energy-efficient insulation solutions' },
]

export default function StepContent({ config, setConfig, onNext, onBack }: Props) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [customServiceName, setCustomServiceName] = useState('')
  const industry = config.company?.industry || ''
  const serviceOptions = industry === 'home_care' ? HOME_CARE_SERVICES : CONTRACTOR_SERVICES
  const content = config.content
  const selectedServices = content.services?.length > 0 ? content.services : serviceOptions.slice(0, 6).map(s => s.id)

  // Initialize default services on mount (intentionally runs once)
  useEffect(() => {
    if (!content.services || content.services.length === 0) {
      setConfig(prev => {
        const opts = (prev.company?.industry === 'home_care' ? HOME_CARE_SERVICES : CONTRACTOR_SERVICES)
        return { ...prev, content: { ...prev.content, services: opts.slice(0, 6).map(s => s.id) } }
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateContent = (patch: Partial<FactoryConfig['content']>) =>
    setConfig(prev => ({ ...prev, content: { ...prev.content, ...patch } }))

  const toggleService = (id: string) => {
    const next = selectedServices.includes(id) ? selectedServices.filter(s => s !== id) : [...selectedServices, id]
    updateContent({ services: next })
  }

  const addCustomService = () => {
    if (!customServiceName.trim()) return
    const id = customServiceName.toLowerCase().replace(/\s+/g, '-')
    updateContent({
      customServices: [...(content.customServices || []), { id, name: customServiceName.trim(), desc: '' }],
      services: [...selectedServices, id],
    })
    setCustomServiceName('')
  }

  const removeCustomService = (id: string) => updateContent({
    customServices: (content.customServices || []).filter(s => s.id !== id),
    services: selectedServices.filter(s => s !== id),
  })

  const generateWithAI = async () => {
    setGenerating(true); setError('')
    try {
      const apiUrl = API_URL
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(apiUrl + '/api/v1/factory/generate-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session?.access_token },
        body: JSON.stringify({
          companyName: config.company?.name,
          city: config.company?.city,
          state: config.company?.state,
          industry,
          services: selectedServices,
          serviceRegion: config.company?.serviceRegion,
          ownerName: config.company?.ownerName,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'AI generation failed')
      }
      const data = await res.json()
      updateContent({
        heroTagline: data.heroTagline || content.heroTagline,
        aboutText: data.aboutText || content.aboutText,
        ctaText: data.ctaText || content.ctaText,
      })
    } catch {
      setError('AI generation unavailable — fill in content manually.')
    }
    setGenerating(false)
  }

  const allServices = [...serviceOptions, ...(content.customServices || [])]

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Content & Services</h2>
      <p className="text-gray-400 text-sm mb-6">Choose services to offer, then customize your copy — or let AI write it.</p>

      <div className="mb-8">
        <h3 className="text-white font-semibold mb-3">Services Offered</h3>
        <div className="grid grid-cols-2 gap-3">
          {allServices.map(svc => {
            const selected = selectedServices.includes(svc.id)
            const isCustom = (content.customServices || []).find(c => c.id === svc.id)
            return (
              <div key={svc.id} onClick={() => toggleService(svc.id)}
                className={'flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ' + (selected ? 'border-blue-500 bg-blue-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800/40')}>
                <div className={'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ' + (selected ? 'border-blue-500 bg-blue-500' : 'border-gray-600')}>
                  {selected && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                </div>
                <div className="flex-1">
                  <div className="text-white text-sm font-semibold">{svc.name}</div>
                  <div className="text-gray-400 text-xs mt-0.5">{svc.desc}</div>
                </div>
                {isCustom && (
                  <button onClick={e => { e.stopPropagation(); removeCustomService(svc.id) }}
                    className="text-red-400 hover:text-red-300 p-1 flex-shrink-0">
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="flex gap-2 mt-3">
          <input value={customServiceName} onChange={e => setCustomServiceName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCustomService()}
            placeholder="Add a custom service..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
          <button onClick={addCustomService}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="mb-6 p-5 rounded-xl border border-purple-500/30 bg-purple-500/5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-purple-300 font-bold mb-1"><Sparkles size={16} /> AI Content Generation</div>
            <div className="text-gray-400 text-sm">Generate tailored hero copy and service descriptions for {config.company?.name || 'your company'}.</div>
          </div>
          <button onClick={generateWithAI} disabled={generating || !config.company?.name}
            className="flex items-center gap-2 px-5 py-2 rounded-lg font-semibold text-sm text-white flex-shrink-0 disabled:opacity-50"
            style={{ background: generating ? '#6b7280' : 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
            {generating ? <><RefreshCw size={14} className="animate-spin" /> Generating...</> : <><Sparkles size={14} /> Generate</>}
          </button>
        </div>
        {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      </div>

      <div className="flex flex-col gap-4 mb-4">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Hero Tagline <span className="text-gray-600">(shown in nav badge)</span></label>
          <input value={content.heroTagline || ''} onChange={e => updateContent({ heroTagline: e.target.value })}
            placeholder="e.g. Compassionate In-Home Care"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">About Section <span className="text-gray-600">(2-3 sentences)</span></label>
          <textarea value={content.aboutText || ''} onChange={e => updateContent({ aboutText: e.target.value })}
            placeholder={'Tell visitors about ' + (config.company?.name || 'your company') + '...'}
            rows={4}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 resize-vertical" />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Call-to-Action Text</label>
          <input value={content.ctaText || ''} onChange={e => updateContent({ ctaText: e.target.value })}
            placeholder="e.g. Ready to discuss care options for your loved one?"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500" />
        </div>
      </div>

      <NavButtons onBack={onBack} onNext={onNext} canNext={(content.services?.length ?? 1) > 0} nextLabel="Review & Generate →" />
    </div>
  )
}
