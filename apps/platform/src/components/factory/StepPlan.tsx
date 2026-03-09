import { useState } from 'react'
import { Check, Lock, Sparkles, ArrowRight } from 'lucide-react'
import type { FactoryConfig } from './types'
import {
  type ProductLine, type PlanSelection,
  PRODUCT_META, PLANS_BY_PRODUCT, SETUP_TIERS, ADDONS, PRODUCT_CONFIG_MAP,
} from './planData'

type Props = {
  product: ProductLine
  config: FactoryConfig
  setConfig: React.Dispatch<React.SetStateAction<FactoryConfig>>
  plan: PlanSelection
  setPlan: React.Dispatch<React.SetStateAction<PlanSelection>>
  onNext: () => void
}

export default function StepPlan({ product, config, setConfig, plan, setPlan, onNext }: Props) {
  const meta = PRODUCT_META[product]
  const plans = PLANS_BY_PRODUCT[product]
  const isAnnual = plan.billingCycle === 'annual'

  const selectedPlan = plans.find(p => p.id === plan.planId)

  const selectPlan = (planId: string) => {
    const p = plans.find(x => x.id === planId)!
    setPlan(prev => ({ ...prev, planId }))
    // Auto-set features in factory config
    const hasPaidAds = p.features.includes('paid_ads')
    const crmFeatures = p.features.filter(f => f !== 'paid_ads')
    setConfig(prev => ({
      ...prev,
      products: PRODUCT_CONFIG_MAP[product].products,
      company: { ...prev.company, industry: PRODUCT_CONFIG_MAP[product].industry },
      features: { ...prev.features, crm: crmFeatures, website: p.websiteFeatures, paid_ads: hasPaidAds },
    }))
  }

  const toggleBilling = () =>
    setPlan(prev => ({ ...prev, billingCycle: prev.billingCycle === 'monthly' ? 'annual' : 'monthly' }))

  const selectSetup = (id: string) =>
    setPlan(prev => ({ ...prev, setupTierId: id }))

  const toggleAddon = (id: string) =>
    setPlan(prev => ({
      ...prev,
      addonIds: prev.addonIds.includes(id)
        ? prev.addonIds.filter(a => a !== id)
        : [...prev.addonIds, id],
    }))

  const availableAddons = ADDONS.filter(a => !a.products || a.products.includes(product))

  // Calculate total
  const planPrice = selectedPlan ? (isAnnual ? selectedPlan.annual : selectedPlan.monthly) : 0
  const addonTotal = availableAddons
    .filter(a => plan.addonIds.includes(a.id))
    .reduce((sum, a) => sum + a.monthly, 0)
  const setupPrice = SETUP_TIERS.find(t => t.id === plan.setupTierId)?.price || 0

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-3xl">{meta.icon}</span>
        <div>
          <h2 className="text-xl font-bold text-white">{meta.name}</h2>
          <p className="text-gray-400 text-sm">{meta.tagline}</p>
        </div>
      </div>

      {/* Billing toggle */}
      <div className="flex items-center justify-center gap-3 my-6">
        <span className={`text-sm font-medium ${!isAnnual ? 'text-white' : 'text-gray-500'}`}>Monthly</span>
        <button onClick={toggleBilling}
          className="relative w-14 h-7 rounded-full transition-colors"
          style={{ backgroundColor: isAnnual ? meta.color : '#374151' }}>
          <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${isAnnual ? 'translate-x-7' : 'translate-x-0.5'}`} />
        </button>
        <span className={`text-sm font-medium ${isAnnual ? 'text-white' : 'text-gray-500'}`}>
          Annual
          <span className="ml-1 text-xs px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400">Save 15%</span>
        </span>
      </div>

      {/* Plan cards */}
      <div className={`grid gap-3 mb-8 ${plans.length <= 2 ? 'grid-cols-2' : plans.length === 3 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {plans.map((p, idx) => {
          const active = plan.planId === p.id
          const price = isAnnual ? p.annual : p.monthly
          const borderColor = active ? meta.color : p.highlight ? meta.color + '60' : '#374151'
          return (
            <div key={p.id} onClick={() => selectPlan(p.id)}
              className="relative flex flex-col p-4 rounded-xl border-2 cursor-pointer transition-all"
              style={{ borderColor, backgroundColor: active ? meta.color + '12' : 'transparent' }}>
              {p.highlight && !active && (
                <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-xs font-bold"
                  style={{ backgroundColor: meta.color, color: 'white' }}>
                  Popular
                </div>
              )}
              <div className="text-white font-bold text-sm mb-1">{p.name}</div>
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-2xl font-bold text-white">${price}</span>
                <span className="text-gray-500 text-xs">/mo</span>
              </div>
              <div className="text-gray-400 text-xs mb-3">{p.websiteDesc}</div>

              {/* Feature diff: show what this tier adds over the previous */}
              <div className="flex-1 space-y-1.5">
                {idx === 0 ? (
                  p.features.slice(0, 6).map(f => (
                    <div key={f} className="flex items-center gap-1.5 text-xs text-gray-300">
                      <Check size={10} className="text-green-500 flex-shrink-0" />
                      <span>{formatFeatureName(f)}</span>
                    </div>
                  ))
                ) : (
                  <>
                    <div className="text-xs text-gray-500 mb-1">Everything in {plans[idx - 1].name}, plus:</div>
                    {getNewFeatures(plans, idx).slice(0, 6).map(f => (
                      <div key={f} className="flex items-center gap-1.5 text-xs text-gray-300">
                        <Sparkles size={10} style={{ color: meta.color }} className="flex-shrink-0" />
                        <span>{formatFeatureName(f)}</span>
                      </div>
                    ))}
                    {getNewFeatures(plans, idx).length > 6 && (
                      <div className="text-xs text-gray-500">+{getNewFeatures(plans, idx).length - 6} more</div>
                    )}
                  </>
                )}
              </div>

              {/* Selection indicator */}
              <div className="mt-4 pt-3 border-t border-gray-800">
                {active ? (
                  <div className="flex items-center justify-center gap-1.5 text-sm font-bold" style={{ color: meta.color }}>
                    <Check size={16} /> Selected
                  </div>
                ) : (
                  <div className="text-center text-gray-500 text-sm">Select</div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Setup tier */}
      <div className="mb-8">
        <h3 className="text-white font-bold text-sm mb-3">Setup & Onboarding</h3>
        <div className="grid grid-cols-3 gap-3">
          {SETUP_TIERS.map(t => {
            const active = plan.setupTierId === t.id
            return (
              <div key={t.id} onClick={() => selectSetup(t.id)}
                className="p-4 rounded-xl border-2 cursor-pointer transition-all"
                style={{ borderColor: active ? meta.color : '#374151', backgroundColor: active ? meta.color + '12' : 'transparent' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white font-bold text-sm">{t.name}</span>
                  <span className="text-white font-bold text-sm">${t.price}</span>
                </div>
                <div className="text-gray-400 text-xs">{t.description}</div>
                {active && <div className="text-xs font-bold mt-2" style={{ color: meta.color }}>Selected ✓</div>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Add-ons */}
      {availableAddons.length > 0 && (
        <div className="mb-8">
          <h3 className="text-white font-bold text-sm mb-3">Optional Add-Ons</h3>
          <div className="grid grid-cols-2 gap-3">
            {availableAddons.map(a => {
              const active = plan.addonIds.includes(a.id)
              return (
                <div key={a.id} onClick={() => toggleAddon(a.id)}
                  className="flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all"
                  style={{ borderColor: active ? meta.color : '#374151', backgroundColor: active ? meta.color + '12' : 'transparent' }}>
                  <div className="w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    style={{ borderColor: active ? meta.color : '#4b5563', backgroundColor: active ? meta.color : 'transparent' }}>
                    {active && <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                  <div className="flex-1">
                    <div className="text-white text-sm font-semibold">{a.name}</div>
                    <div className="text-gray-400 text-xs">{a.description}</div>
                  </div>
                  <div className="text-white font-bold text-sm">${a.monthly}<span className="text-gray-500 text-xs font-normal">/mo</span></div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Summary footer */}
      <div className="flex items-center justify-between pt-4 border-t border-gray-800 mt-6">
        <div>
          {selectedPlan && (
            <div className="text-gray-400 text-sm">
              <span className="text-white font-bold text-lg">${planPrice + addonTotal}</span>/mo
              {setupPrice > 0 && <span className="ml-2 text-xs">+ ${setupPrice} one-time setup</span>}
            </div>
          )}
        </div>
        <button onClick={onNext} disabled={!plan.planId}
          className="flex items-center gap-2 bg-orange-500 hover:bg-orange-400 text-white px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40">
          Continue <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function getNewFeatures(plans: { features: string[] }[], tierIdx: number): string[] {
  const prev = new Set(plans[tierIdx - 1].features)
  return plans[tierIdx].features.filter(f => !prev.has(f))
}

function formatFeatureName(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/Gps/g, 'GPS')
    .replace(/Rfis/g, 'RFIs')
    .replace(/Evv/g, 'EVV')
    .replace(/Ai /g, 'AI ')
    .replace(/Crm/g, 'CRM')
}
