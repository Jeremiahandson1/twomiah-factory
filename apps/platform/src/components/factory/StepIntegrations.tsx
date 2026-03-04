import { useState } from 'react'
import type { FactoryConfig } from './types'
import { NavButtons } from './StepProducts'

type Props = { config: FactoryConfig; updateNested: <K extends keyof FactoryConfig>(key: K, patch: Partial<FactoryConfig[K]>) => void; onNext: () => void; onBack: () => void }

const INTEGRATIONS = [
  { id: 'twilio' as const, name: 'Twilio — SMS & Two-Way Texting', icon: '💬', color: '#F22F46', requiredFeatures: ['two_way_texting', 'sms'], description: 'Required for two-way texting and call tracking.', link: 'https://console.twilio.com', linkText: 'console.twilio.com', fields: [{ key: 'accountSid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', sensitive: false }, { key: 'authToken', label: 'Auth Token', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', sensitive: true }, { key: 'phoneNumber', label: 'Phone Number', placeholder: '+15551234567', sensitive: false }] },
  { id: 'sendgrid' as const, name: 'SendGrid — Transactional Email', icon: '✉️', color: '#1A82E2', requiredFeatures: [], description: 'Sends invoices, quotes, notifications, and review requests.', link: 'https://app.sendgrid.com/settings/api_keys', linkText: 'sendgrid.com', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'SG.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', sensitive: true }] },
  { id: 'stripe' as const, name: 'Stripe — Online Payments', icon: '💳', color: '#6772E5', requiredFeatures: ['online_payments', 'payments'], description: 'Accepts credit cards and ACH payments on invoices.', link: 'https://dashboard.stripe.com/apikeys', linkText: 'dashboard.stripe.com', fields: [{ key: 'secretKey', label: 'Secret Key', placeholder: 'sk_live_xxxxxxxx', sensitive: true }, { key: 'publishableKey', label: 'Publishable Key', placeholder: 'pk_live_xxxxxxxx', sensitive: false }, { key: 'webhookSecret', label: 'Webhook Secret', placeholder: 'whsec_xxxxxxxx', sensitive: true }] },
  { id: 'googleMaps' as const, name: 'Google Maps — GPS & Geocoding', icon: '🗺️', color: '#4285F4', requiredFeatures: ['gps_tracking', 'routing', 'maps'], description: 'Powers GPS tracking, route optimization, and map views.', link: 'https://console.cloud.google.com/apis/credentials', linkText: 'console.cloud.google.com', fields: [{ key: 'apiKey', label: 'API Key', placeholder: 'AIzaSy...', sensitive: false }] },
  { id: 'sentry' as const, name: 'Sentry — Error Monitoring', icon: '🔍', color: '#362D59', requiredFeatures: [], description: 'Captures production errors so you know when something breaks.', link: 'https://sentry.io', linkText: 'sentry.io', fields: [{ key: 'dsn', label: 'DSN', placeholder: 'https://xxx@oyyy.ingest.sentry.io/zzz', sensitive: false }] },
]

export default function StepIntegrations({ config, updateNested, onNext, onBack }: Props) {
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({})
  const selectedFeatures = [...config.features.crm, ...config.features.website]
  const isRelevant = (integ: typeof INTEGRATIONS[0]) => integ.requiredFeatures.length === 0 || integ.requiredFeatures.some(f => selectedFeatures.includes(f))
  const setField = (integId: keyof FactoryConfig['integrations'], fieldKey: string, value: string) =>
    updateNested('integrations', { [integId]: { ...config.integrations[integId], [fieldKey]: value } } as any)

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Integrations</h2>
      <p className="text-gray-400 text-sm mb-2">Enter credentials for services this build will use. All optional — configure later in the deployed app.</p>
      <div className="mb-6 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-300 text-xs">
        🔒 These values go directly into the generated .env file and are never stored on Twomiah's servers.
      </div>
      <div className="flex flex-col gap-4 mb-4">
        {INTEGRATIONS.map(integ => {
          const vals = config.integrations[integ.id] as Record<string, string>
          const relevant = isRelevant(integ)
          const filled = integ.fields.some(f => vals[f.key]?.trim())
          const headerBg = filled ? integ.color + '15' : '#1f2937'
          return (
            <div key={integ.id} className="border-2 rounded-xl overflow-hidden transition-all"
              style={{ borderColor: filled ? integ.color : '#374151', opacity: relevant ? 1 : 0.6 }}>
              <div className="flex items-center gap-3 px-4 py-3" style={{ backgroundColor: headerBg }}>
                <span className="text-2xl flex-shrink-0">{integ.icon}</span>
                <div className="flex-1">
                  <div className="text-white font-semibold text-sm">
                    {integ.name}
                    {filled && <span className="ml-2 text-xs font-bold" style={{ color: integ.color }}>✓ CONFIGURED</span>}
                    {!relevant && <span className="ml-2 text-xs text-gray-500">NOT NEEDED FOR SELECTED FEATURES</span>}
                  </div>
                  <div className="text-gray-400 text-xs mt-0.5">{integ.description}</div>
                </div>
                <a href={integ.link} target="_blank" rel="noopener noreferrer" className="text-blue-400 text-xs hover:text-blue-300 whitespace-nowrap">{integ.linkText} ↗</a>
              </div>
              <div className="p-4 bg-gray-900/50 grid gap-3">
                {integ.fields.map(field => {
                  const fieldKey = integ.id + '.' + field.key
                  const visible = showSensitive[fieldKey] || !field.sensitive
                  const inputCls = vals[field.key]
                    ? 'flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 bg-green-500/10 border-green-700 text-green-300 font-mono'
                    : 'flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500 bg-gray-800 border-gray-700 text-white'
                  return (
                    <div key={field.key}>
                      <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
                      <div className="flex gap-2">
                        <input type={visible ? 'text' : 'password'} value={vals[field.key] || ''}
                          onChange={e => setField(integ.id, field.key, e.target.value)}
                          placeholder={field.placeholder} className={inputCls} />
                        {field.sensitive && (
                          <button onClick={() => setShowSensitive(prev => ({ ...prev, [fieldKey]: !prev[fieldKey] }))}
                            className="px-3 border border-gray-700 rounded-lg bg-gray-800 text-gray-400 hover:text-white text-xs transition-colors">
                            {visible ? '🙈 Hide' : '👁 Show'}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} />
    </div>
  )
}
