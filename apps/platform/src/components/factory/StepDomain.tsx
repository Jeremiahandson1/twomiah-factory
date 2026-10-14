import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'

type Props = {
  config: FactoryConfig
  updateNested: <K extends keyof FactoryConfig>(key: K, patch: Partial<FactoryConfig[K]>) => void
  onNext: () => void
  onBack: () => void
}

const DOMAIN_RE = /^([a-z0-9-]+\.)+[a-z]{2,}$/i

// "Buy one now" was offered here and never bought anything — the build ignored it and set the company up on a domain
// nobody had registered (10/14). Buying is done after the company exists, from Domain billing on its page: a checkout
// link for the customer, or registered on our account, at cost plus the card fee.
export default function StepDomain({ config, updateNested, onNext, onBack }: Props) {
  const mode = config.company.domainMode === 'byod' ? 'byod' : 'skip'
  const domain = config.company.domain || ''
  const canAdvance = mode === 'skip' || DOMAIN_RE.test(domain)

  const pick = (next: 'skip' | 'byod') => {
    updateNested('company', { domainMode: next })
    if (next === 'skip') updateNested('company', { domain: '' })
  }

  return (
    <div>
      <h2 className="text-xl font-semibold mb-2">Domain</h2>
      <p className="text-sm text-gray-500 mb-6">Your website, CRM, and email all live on one domain. Bring one you already own, or skip for now.</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Tile active={mode === 'byod'} onClick={() => pick('byod')} title="They have a domain" desc="They'll add DNS records we provide." />
        <Tile active={mode === 'skip'} onClick={() => pick('skip')} title="Skip for now" desc="Use our temporary URL; connect or buy a domain later." />
      </div>
      <p className="text-xs text-gray-500 mb-6">Need to buy one? Create the company first, then use <strong>Domain billing</strong> on its page — send them a checkout link, or register it on our account. Domains are charged at cost plus the card fee.</p>

      {mode === 'byod' && (
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
