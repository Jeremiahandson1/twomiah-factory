import { useEffect, useState } from 'react'
import { Globe, Loader2, CheckCircle2, AlertCircle, Copy, Check, ExternalLink } from 'lucide-react'
import { api } from '../api/client'

interface DomainStatus {
  status: 'unconfigured' | 'pending_nameservers' | 'active' | 'partial'
  domain?: string | null
  nameservers?: string[]
}

interface CheckResult {
  domain: string
  available: boolean
  priceUsd?: number
  premium?: boolean
  suggestions?: Array<{ domain: string; priceUsd?: number }>
  errorMessage?: string
}

export function DomainPage() {
  const [statusLoading, setStatusLoading] = useState(true)
  const [status, setStatus] = useState<DomainStatus>({ status: 'unconfigured' })
  const [tab, setTab] = useState<'byod' | 'buy'>('byod')
  const [byodInput, setByodInput] = useState('')
  const [byodSubmitting, setByodSubmitting] = useState(false)
  const [byodError, setByodError] = useState<string | null>(null)
  const [buyInput, setBuyInput] = useState('')
  const [check, setCheck] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const fetchStatus = async () => {
    try {
      const data = await api.get<DomainStatus>('/api/admin/domain/status')
      setStatus(data)
    } catch (e: any) {
      // Non-fatal — treat as unconfigured if the proxy can't reach factory.
      setStatus({ status: 'unconfigured' })
    } finally {
      setStatusLoading(false)
    }
  }
  const params = new URLSearchParams(window.location.search)
  const justRegistered = params.get('domain') === 'registered'
  const wasCancelled = params.get('domain') === 'cancelled'

  useEffect(() => {
    fetchStatus()
    // Poll every 30s when in a transient state. After Stripe Checkout
    // returns with ?domain=registered, poll faster (every 8s) for the
    // first 2 minutes because that's when the webhook should fire.
    const pollMs = justRegistered && status.status === 'unconfigured' ? 8_000 : 30_000
    const t = setInterval(() => {
      if (status.status === 'pending_nameservers' || status.status === 'partial' ||
          (justRegistered && status.status === 'unconfigured')) fetchStatus()
    }, pollMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.status, justRegistered])

  const attach = async (mode: 'byod' | 'buy', domain: string) => {
    setByodSubmitting(true); setByodError(null)
    try {
      const data = await api.post<DomainStatus>('/api/admin/domain/attach', { domain, mode })
      setStatus(data)
      setTab('byod')
    } catch (e: any) {
      setByodError(e.message)
    } finally {
      setByodSubmitting(false)
    }
  }

  // Buy flow — kick off Stripe Checkout. On success, customer returns
  // to /admin/domain?domain=registered and the polling effect picks up
  // the new state automatically.
  const startBuyCheckout = async (domain: string) => {
    setByodSubmitting(true); setByodError(null)
    try {
      const data = await api.post<{ url: string }>('/api/admin/domain/buy-checkout', { domain, years: 1 })
      if (data.url) window.location.href = data.url
    } catch (e: any) {
      setByodError(e.message); setByodSubmitting(false)
    }
  }

  // Debounced availability check for the buy tab.
  useEffect(() => {
    const d = buyInput.trim().toLowerCase()
    if (!d || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}$/.test(d)) {
      setCheck(null); return
    }
    let cancelled = false
    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const data = await api.post<CheckResult>('/api/admin/domain/check', { domain: d })
        if (!cancelled) setCheck(data)
      } catch (e: any) {
        if (!cancelled) setCheck({ domain: d, available: false, errorMessage: e.message })
      } finally {
        if (!cancelled) setChecking(false)
      }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [buyInput])

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked — ignore */ }
  }

  if (statusLoading) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="text-muted text-sm flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading domain status…
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl text-ink">Domain</h1>
        <p className="text-muted text-sm mt-1">Your site's public address.</p>
      </div>

      {justRegistered && status.status === 'unconfigured' && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 px-5 py-4 flex items-start gap-3">
          <Loader2 className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5 animate-spin" />
          <div>
            <div className="font-semibold text-orange-900 text-sm">Payment received — registering your domain…</div>
            <div className="text-orange-800 text-sm mt-0.5">
              This usually takes 30-60 seconds. This page auto-updates the moment the registrar confirms.
              If it doesn't update within 2 minutes, refresh and we'll show you what's up.
            </div>
          </div>
        </div>
      )}

      {wasCancelled && (
        <div className="mb-6 rounded-lg border border-line bg-paper-alt px-5 py-3 text-sm text-ink-soft">
          Checkout cancelled — no charges made. Try a different domain below, or use the "I already own a domain" tab.
        </div>
      )}

      {/* Current state */}
      {status.status === 'active' && (
        <section className="card card-padding mb-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg text-ink mb-1">{status.domain} is live</h2>
              <p className="text-sm text-ink-soft mb-3">
                Your site is publicly reachable at <a href={'https://' + status.domain} target="_blank" rel="noopener noreferrer"
                  className="text-orange-600 underline inline-flex items-center gap-1">
                  https://{status.domain} <ExternalLink className="w-3 h-3" />
                </a>
              </p>
              <p className="text-xs text-muted">
                SSL certificates are auto-renewed. To change your domain, contact support so we
                don't accidentally take your site offline mid-DNS-flip.
              </p>
            </div>
          </div>
        </section>
      )}

      {status.status === 'pending_nameservers' && status.domain && (
        <section className="card card-padding mb-6 border-l-4 border-orange-400">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
              <AlertCircle className="w-5 h-5 text-orange-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg text-ink mb-1">Almost there — point your nameservers</h2>
              <p className="text-sm text-ink-soft mb-4">
                We've reserved <span className="font-mono font-semibold">{status.domain}</span>. The
                last step is to point your domain's nameservers at ours so we can manage DNS, SSL,
                and email for you. Do this at whoever you bought the domain from (GoDaddy, Namecheap, etc).
              </p>
              {status.nameservers && status.nameservers.length > 0 && (
                <div className="bg-paper rounded-lg p-4 mb-4">
                  <div className="text-xs uppercase tracking-wider text-muted mb-2 font-semibold">Set these nameservers</div>
                  <div className="space-y-1.5">
                    {status.nameservers.map(ns => (
                      <div key={ns} className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm text-ink">{ns}</span>
                        <button onClick={() => copyToClipboard(ns, ns)}
                          className="text-xs text-muted hover:text-ink inline-flex items-center gap-1">
                          {copied === ns ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <details className="text-sm text-ink-soft">
                <summary className="cursor-pointer text-orange-600 hover:text-orange-700 font-medium">
                  Step-by-step instructions
                </summary>
                <div className="mt-3 pl-4 space-y-2 border-l border-line">
                  <p><strong>1.</strong> Sign in to your domain registrar (where you bought {status.domain}).</p>
                  <p><strong>2.</strong> Find DNS settings or Nameservers for {status.domain}.</p>
                  <p><strong>3.</strong> Replace whatever's there with the two nameservers above.</p>
                  <p><strong>4.</strong> Save. Propagation usually takes 15-60 minutes, sometimes up to 24h.</p>
                  <p><strong>5.</strong> This page auto-updates when DNS goes live — leave it open or come back later.</p>
                </div>
              </details>
              <div className="mt-4 text-xs text-muted">
                Checking again automatically every 30 seconds. <button onClick={fetchStatus}
                  className="text-orange-600 hover:text-orange-700 underline">Check now</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {status.status === 'unconfigured' && (
        <>
          <section className="card card-padding mb-6 bg-paper border border-line">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-paper-alt flex items-center justify-center flex-shrink-0">
                <Globe className="w-5 h-5 text-muted" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg text-ink mb-1">Your site is launching on a temporary URL</h2>
                <p className="text-sm text-ink-soft">
                  Once you set up a real domain below, we'll handle SSL, DNS, and email
                  authentication automatically. You'll keep ownership of the domain at your
                  registrar — we just manage it.
                </p>
              </div>
            </div>
          </section>

          {/* Tabs */}
          <div className="flex gap-1 mb-4 border-b border-line">
            <button onClick={() => setTab('byod')} className={
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ' +
              (tab === 'byod' ? 'text-ink border-orange-500' : 'text-muted hover:text-ink border-transparent')
            }>I already own a domain</button>
            <button onClick={() => setTab('buy')} className={
              'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ' +
              (tab === 'buy' ? 'text-ink border-orange-500' : 'text-muted hover:text-ink border-transparent')
            }>Buy a new one</button>
          </div>

          {tab === 'byod' && (
            <section className="card card-padding">
              <h2 className="text-lg text-ink mb-1">Connect your existing domain</h2>
              <p className="text-sm text-ink-soft mb-5">
                Paste it below. We'll show you what nameservers to point at us — you do that one-time
                change at your registrar (GoDaddy, Namecheap, etc.) and the rest is automatic.
              </p>
              <div className="space-y-3">
                <input type="text" value={byodInput} onChange={e => setByodInput(e.target.value)}
                  placeholder="madisonroofing.com"
                  autoComplete="off" autoCapitalize="off" spellCheck={false}
                  className="input font-mono" />
                <button onClick={() => attach('byod', byodInput.trim().toLowerCase())}
                  disabled={byodSubmitting || !byodInput.trim()}
                  className="btn-primary btn-md inline-flex items-center gap-2 disabled:opacity-40">
                  {byodSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                  {byodSubmitting ? 'Setting up…' : 'Connect this domain'}
                </button>
                {byodError && (
                  <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{byodError}</div>
                )}
              </div>
            </section>
          )}

          {tab === 'buy' && (
            <section className="card card-padding">
              <h2 className="text-lg text-ink mb-1">Buy a domain</h2>
              <p className="text-sm text-ink-soft mb-5">
                We'll register it on your behalf and set everything up. Type the domain you want — we'll
                check if it's open right now.
              </p>
              <input type="text" value={buyInput} onChange={e => setBuyInput(e.target.value)}
                placeholder="madisonroofing.com"
                autoComplete="off" autoCapitalize="off" spellCheck={false}
                className="input font-mono mb-3" />
              {checking && (
                <div className="text-sm text-muted flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking…
                </div>
              )}
              {!checking && check?.available && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="font-semibold text-green-900">{check.domain}</span>
                    <span className="text-green-800"> is available</span>
                    {check.priceUsd && <span className="text-green-700 ml-1">— ${check.priceUsd.toFixed(2)}/yr</span>}
                  </div>
                  <button onClick={() => startBuyCheckout(check.domain)}
                    disabled={byodSubmitting}
                    className="btn-primary btn-sm">
                    {byodSubmitting ? 'Starting…' : 'Register'}
                  </button>
                </div>
              )}
              {!checking && check && !check.available && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                  <div className="text-sm text-orange-900 mb-3">
                    <span className="font-semibold">{check.domain}</span> is taken.
                    {check.suggestions && check.suggestions.length > 0
                      ? ' Try one of these:'
                      : ' Try a different one.'}
                  </div>
                  {check.suggestions && check.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {check.suggestions.map(s => (
                        <button key={s.domain} type="button"
                          onClick={() => setBuyInput(s.domain)}
                          className="px-3 py-1.5 bg-white border border-orange-300 rounded-md text-sm font-mono text-ink hover:bg-orange-100 hover:border-orange-400 transition">
                          {s.domain}
                          {s.priceUsd && <span className="text-xs text-muted ml-1.5">${s.priceUsd.toFixed(0)}/yr</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!checking && check?.errorMessage && (
                <div className="text-xs text-muted italic mt-2">
                  Domain registrar is offline right now — try BYOD if you already own a domain.
                </div>
              )}
              {byodError && (
                <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{byodError}</div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  )
}
