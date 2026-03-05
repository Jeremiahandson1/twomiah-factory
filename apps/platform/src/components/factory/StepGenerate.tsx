import { useState } from 'react'
import { Zap, Loader2, Check, AlertCircle, Download } from 'lucide-react'
import { supabase, API_URL } from '../../supabase'
import type { FactoryConfig } from './types'

type Props = { config: FactoryConfig; onBack: () => void; onReset: () => void }

function SummaryCard({ title, items, extra }: { title: string; items: string[]; extra?: string }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
      <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">{title}</div>
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => <span key={i} className="bg-gray-700/60 text-gray-300 text-xs px-2.5 py-1 rounded-lg capitalize">{item}</span>)}
        {extra && <span className="text-gray-500 text-xs py-1">{extra}</span>}
      </div>
    </div>
  )
}

export default function StepGenerate({ config, onBack, onReset }: Props) {
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState<any>(null)
  const apiUrl = API_URL

  const [authToken, setAuthToken] = useState('')

  const handleGenerate = async () => {
    setGenerating(true); setError('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token || ''
      setAuthToken(token)
      if (!token) throw new Error('Not authenticated. Please sign in again.')
      const res = await fetch(apiUrl + '/api/v1/factory/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Generation failed')
      }
      const data = await res.json()
      setResult(data)
    } catch (err: any) { setError(err.message) }
    setGenerating(false)
  }

  const handleDeploy = async () => {
    if (!result?.customerId) { setError('No customer linked. Create a customer first, then generate a build from their detail page.'); return }
    setDeploying(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Not authenticated. Please sign in again.')
      const res = await fetch(apiUrl + '/api/v1/factory/customers/' + result.customerId + '/deploy', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbPlan: 'basic_256mb' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Deploy failed')
      }
      const data = await res.json()
      setDeployResult(data)
    } catch (err: any) { setError(err.message) }
    setDeploying(false)
  }

  if (result) {
    return (
      <div className="text-center py-8">
        <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4"><Check size={32} className="text-green-500" /></div>
        <h2 className="text-2xl font-bold text-white mb-2">Build Ready!</h2>
        <p className="text-gray-400 mb-8">Generated in {result.generatedIn}</p>
        {!deployResult ? (
          <button onClick={handleDeploy} disabled={deploying} className="flex items-center justify-center gap-3 w-full py-4 rounded-xl text-white font-bold text-lg mb-3 transition-colors" style={{ background: deploying ? '#4b5563' : '#7c3aed' }}>
            {deploying ? <><Loader2 size={22} className="animate-spin" /> Deploying to Render...</> : '🚀 Deploy to Live URL'}
          </button>
        ) : (
          <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-xl text-left">
            <div className="text-green-400 font-bold mb-2">🎉 Deploying! Live in ~2 minutes.</div>
            {deployResult.deployedUrl && <a href={deployResult.deployedUrl} target="_blank" rel="noopener noreferrer" className="text-purple-400 font-semibold break-all">{deployResult.deployedUrl}</a>}
          </div>
        )}
        {result.downloadUrl && (
          <a href={apiUrl + result.downloadUrl + (authToken ? '?token=' + authToken : '')} className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-gray-700 text-gray-300 hover:text-white transition-colors mb-6">
            <Download size={16} /> Download zip
          </a>
        )}
        {result.defaultPassword && (
          <div className="text-left bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-5">
            <div className="text-yellow-400 font-bold text-sm mb-3">🔑 Admin Login Credentials — save these now</div>
            <div className="grid grid-cols-2 gap-3">
              {[{ label: 'Admin URL', value: result.adminUrl }, { label: 'Email', value: config.company?.email }, { label: 'Temp Password', value: result.defaultPassword }, { label: 'Build ID', value: result.buildId }].filter(r => r.value).map(row => (
                <div key={row.label}><div className="text-yellow-600 text-xs font-semibold uppercase tracking-wider mb-1">{row.label}</div><code className="block text-yellow-200 text-sm bg-yellow-500/10 px-2 py-1 rounded break-all">{row.value}</code></div>
              ))}
            </div>
          </div>
        )}
        <button onClick={onReset} className="mt-6 text-gray-500 hover:text-gray-400 text-sm underline">Start a new build</button>
      </div>
    )
  }

  const crmCount = config.features.crm.length
  const integRows = [{ label: 'Twilio SMS', val: config.integrations.twilio.accountSid }, { label: 'SendGrid Email', val: config.integrations.sendgrid.apiKey }, { label: 'Stripe Payments', val: config.integrations.stripe.secretKey }, { label: 'Google Maps', val: config.integrations.googleMaps.apiKey }]

  return (
    <div>
      <h2 className="text-xl font-bold text-white mb-1">Review & Generate</h2>
      <p className="text-gray-400 text-sm mb-6">Review your configuration, then generate the build package.</p>
      <div className="grid gap-4 mb-6">
        <div className="flex items-center gap-3 bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg flex-shrink-0" style={{ backgroundColor: config.branding.primaryColor }}>{config.tenant_name.charAt(0)}</div>
          <div><div className="text-white font-bold">{config.tenant_name}</div><div className="text-gray-400 text-sm">{config.tenant_slug}.twomiah.app</div></div>
        </div>
        <SummaryCard title="Products" items={config.products.map(p => p.toUpperCase())} />
        <SummaryCard title="Company" items={[config.company.name, config.company.email, config.company.phone, [config.company.city, config.company.state].filter(Boolean).join(', '), config.company.domain].filter(Boolean)} />
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Branding</div>
          <div className="flex gap-3 flex-wrap">
            <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-md" style={{ background: config.branding.primaryColor }} /><span className="text-gray-300 text-xs font-mono">{config.branding.primaryColor}</span></div>
            <div className="flex items-center gap-2"><div className="w-6 h-6 rounded-md" style={{ background: config.branding.secondaryColor }} /><span className="text-gray-300 text-xs font-mono">{config.branding.secondaryColor}</span></div>
            {config.branding.logo && <span className="text-green-400 text-xs">✓ Logo</span>}
            {config.branding.favicon && <span className="text-green-400 text-xs">✓ Favicon</span>}
            {config.branding.heroPhoto && <span className="text-green-400 text-xs">✓ Hero photo</span>}
          </div>
        </div>
        {config.products.includes('crm') && crmCount > 0 && <SummaryCard title={'CRM Features (' + crmCount + ')'} items={config.features.crm.slice(0, 8).map(f => f.replace(/_/g, ' '))} extra={crmCount > 8 ? '+' + (crmCount - 8) + ' more' : undefined} />}
        <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
          <div className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">Integrations</div>
          <div className="flex flex-wrap gap-2">
            {integRows.map(({ label, val }) => (
              <span key={label} className={'text-xs px-2.5 py-1 rounded-lg border ' + (val ? 'bg-green-500/10 border-green-700 text-green-400' : 'bg-yellow-500/10 border-yellow-700/50 text-yellow-600')}>{val ? '✓' : '⚠'} {label}</span>
            ))}
          </div>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg mb-4 text-red-400 text-sm"><AlertCircle size={16} className="flex-shrink-0" />{error}</div>}
      <button onClick={handleGenerate} disabled={generating} className="flex items-center justify-center gap-3 w-full py-4 rounded-xl text-white font-bold text-lg transition-colors mb-3" style={{ background: generating ? '#4b5563' : '#f97316' }}>
        {generating ? <><Loader2 size={22} className="animate-spin" /> Generating build...</> : <><Zap size={22} /> Generate Package</>}
      </button>
      <button onClick={onBack} className="w-full py-3 text-gray-500 hover:text-gray-400 text-sm transition-colors">← Back to edit</button>
    </div>
  )
}
