import { useEffect, useRef, useState } from 'react'
import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'

type Props = {
  config: FactoryConfig
  updateNested: <K extends keyof FactoryConfig>(key: K, patch: Partial<FactoryConfig[K]>) => void
  onNext: () => void
  onBack: () => void
}

type Availability = {
  checking: boolean
  available?: boolean
  priceUsd?: number
  premium?: boolean
  error?: string
}

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i

export default function StepDomain({ config, updateNested, onNext, onBack }: Props) {
  const mode = config.company.domainMode || 'skip'
  const domain = config.company.domain || ''
  const years = config.company.purchaseYears ?? 1
  const [availability, setAvailability] = useState<Availability>({ checking: false })
  const debounceRef = useRef<any>(null)

  // Live availability check in buy mode — debounced 500ms so we don't spam
  // the rate-limited endpoint while the customer is still typing.
  useEffect(() => {
    if (mode !== 'buy') { setAvailability({ checking: false }); return }
    if (!domain || !DOMAIN_RE.test(domain)) { setAvailability({ checking: false }); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setAvailability({ checking: true })
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/v1/factory/public/domain/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain }),
        })
        const data = await res.json()
        if (!res.ok) {
          setAvailability({ checking: false, error: data.error || 'Lookup failed' })
        } else {
          setAvailability({ checking: false, available: !!data.available, priceUsd: data.priceUsd, premium: !!data.premium })
        }
      } catch (err: any) {
        setAvailability({ checking: false, error: err.message })
      }
    }, 500)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [mode, domain])

  const canAdvance = mode === 'skip' || (mode === 'byod' && DOMAIN_RE.test(domain)) || (mode === 'buy' && DOMAIN_RE.test(domain) && availability.available === true)

  const pick = (next: 'skip' | 'byod' | 'buy') => {
    updateNested('company', { domainMode: next })
    if (next === 'skip') updateNested('company', { domain: '' })
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Domain</h2>
      <p className="text-sm text-gray-500 mb-6">Your website, CRM, and email all live on one domain. Bring your own, buy one now, or skip for now.</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Tile active={mode === 'byod'} onClick={() => pick('byod')} title="I have a domain" desc="You'll add DNS records we provide." />
        <Tile active={mode === 'buy'} onClick={() => pick('buy')} title="Buy one now" desc="We'll register it and set everything up automatically." />
        <Tile active={mode === 'skip'} onClick={() => pick('skip')} title="Skip for now" desc="Use our temporary URL; connect a domain from Settings later." />
      </div>

      {(mode === 'byod' || mode === 'buy') && (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Domain</label>
            <input
              type="text"
              placeholder="yourbusiness.com"
              value={domain}
              onChange={e => updateNested('company', { domain: e.target.value.trim().toLowerCase() })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-orange-500"
            />
            {domain && !DOMAIN_RE.test(domain) && (
              <p className="text-xs text-red-600 mt-1">Enter a valid domain (example.com)</p>
            )}
          </div>

          {mode === 'buy' && DOMAIN_RE.test(domain) && (
            <div className="p-3 rounded-md bg-gray-50 border border-gray-200 text-sm">
              {availability.checking && <span className="text-gray-500">Checking availability…</span>}
              {availability.error && <span className="text-red-600">Error: {availability.error}</span>}
              {!availability.checking && availability.available === true && (
                <span className="text-green-700">
                  Available{availability.priceUsd ? ' — $' + availability.priceUsd.toFixed(2) + ' / year' : ''}
                  {availability.premium ? ' (premium)' : ''}
                </span>
              )}
              {!availability.checking && availability.available === false && (
                <span className="text-red-600">Taken. Try a different name.</span>
              )}
            </div>
          )}

          {mode === 'buy' && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 mb-1">Registration length</label>
              <select
                value={years}
                onChange={e => updateNested('company', { purchaseYears: parseInt(e.target.value, 10) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              >
                <option value={1}>1 year</option>
                <option value={2}>2 years</option>
                <option value={3}>3 years</option>
                <option value={5}>5 years</option>
                <option value={10}>10 years</option>
              </select>
            </div>
          )}
        </div>
      )}

      <NavButtons onBack={onBack} onNext={onNext} canNext={canAdvance} nextLabel="Continue" />
    </div>
  )
}

function Tile({ active, onClick, title, desc }: { active: boolean; onClick: () => void; title: string; desc: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={'text-left p-4 rounded-lg border-2 transition-all ' + (active ? 'border-orange-500 bg-orange-50' : 'border-gray-200 bg-white hover:border-gray-300')}
    >
      <div className="font-semibold text-sm mb-1">{title}</div>
      <div className="text-xs text-gray-500">{desc}</div>
    </button>
  )
}
