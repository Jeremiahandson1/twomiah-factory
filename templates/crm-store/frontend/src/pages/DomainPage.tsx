import { useEffect, useState } from 'react'
import { Globe, Loader2, CheckCircle2, AlertCircle, Copy, Check, ExternalLink } from 'lucide-react'
import api, { type DomainCheck, type DomainStatus } from '../services/api'
import { useMayWrite } from '../shared'

// The store's own web address — the same page, in the same words, as the premium sites' Domain page
// (website-premium-*/admin/src/pages/DomainPage.tsx), through the same Factory routes (backend routes/domain.ts).
// Owner, 10/15: "store owners should be able to buy like everyone else." Buying shows both prices first, the yearly
// renewal in bold; once it is live the storefront is on the domain and this admin on app.<domain>.

const usd = (cents: number) => '$' + (cents / 100).toFixed(2)
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}$/

export default function DomainPage() {
  const mayManage = useMayWrite('settings:update')
  const [statusLoading, setStatusLoading] = useState(true)
  const [status, setStatus] = useState<DomainStatus>({ status: 'unconfigured' })
  const [tab, setTab] = useState<'byod' | 'buy'>('buy')
  const [byodInput, setByodInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [buyInput, setBuyInput] = useState('')
  const [check, setCheck] = useState<DomainCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const fetchStatus = async () => {
    try { setStatus(await api.domainStatus()) } catch { setStatus({ status: 'unconfigured' }) } finally { setStatusLoading(false) }
  }
  const params = new URLSearchParams(window.location.search)
  const justRegistered = params.get('domain') === 'registered'
  const wasCancelled = params.get('domain') === 'cancelled'

  useEffect(() => {
    fetchStatus()
    // Back from Stripe: ask every 8s until the registration lands; while nameservers settle, every 30s.
    const pollMs = justRegistered && status.status === 'unconfigured' ? 8_000 : 30_000
    const t = setInterval(() => {
      if (status.status === 'pending_nameservers' || status.status === 'partial' || (justRegistered && status.status === 'unconfigured')) fetchStatus()
    }, pollMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.status, justRegistered])

  // Availability, with both prices, half a second after typing stops.
  useEffect(() => {
    const d = buyInput.trim().toLowerCase()
    if (!d || !DOMAIN_RE.test(d)) { setCheck(null); return }
    let cancelled = false
    setChecking(true)
    const t = setTimeout(async () => {
      try { const data = await api.checkDomain(d); if (!cancelled) setCheck(data) }
      catch (e: any) { if (!cancelled) setCheck({ domain: d, available: false, errorMessage: e?.message || 'Could not check' }) }
      finally { if (!cancelled) setChecking(false) }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [buyInput])

  const attach = async (domain: string) => {
    setSubmitting(true); setError(null)
    try { setStatus(await api.attachDomain(domain)) } catch (e: any) { setError(e?.message || 'Could not connect that domain') } finally { setSubmitting(false) }
  }
  const startBuyCheckout = async (domain: string) => {
    setSubmitting(true); setError(null)
    try {
      const r = await api.domainCheckout(domain)
      if (r?.url) { window.location.href = r.url; return }
      setError('The checkout did not open. Try again in a moment.')
    } catch (e: any) { setError(e?.message || 'The checkout did not open') }
    setSubmitting(false)
  }
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(text); setTimeout(() => setCopied(null), 1500) } catch { /* clipboard blocked */ }
  }

  if (!mayManage) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Domain</h1>
        <p className="text-sm text-gray-600 dark:text-slate-300">Only the store owner can buy or connect the store's domain.</p>
      </div>
    )
  }
  if (statusLoading) {
    return <div className="flex items-center gap-2 py-20 text-sm text-gray-600 dark:text-slate-300"><Loader2 className="h-4 w-4 animate-spin" /> Loading domain status…</div>
  }

  const ours = !!status.registrar && status.registrar !== 'byod'
  const errorBox = error && <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Domain</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">Your store's public address.</p>
      </div>

      {justRegistered && status.status === 'unconfigured' && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 dark:border-amber-800 dark:bg-amber-950/40">
          <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin text-amber-700 dark:text-amber-300" />
          <div className="text-sm">
            <div className="font-semibold text-amber-900 dark:text-amber-100">Payment received — registering your domain…</div>
            <div className="mt-0.5 text-amber-900 dark:text-amber-200">This usually takes 30-60 seconds. This page updates the moment the registrar confirms. If it doesn't update within 2 minutes, refresh and we'll show you what's up.</div>
          </div>
        </div>
      )}
      {wasCancelled && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          Checkout cancelled — no charges made. Try a different domain below, or use the "I already own a domain" tab.
        </div>
      )}

      {status.status === 'active' && status.domain && (
        <section className="card p-5">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="mt-0.5 h-6 w-6 flex-shrink-0 text-green-700 dark:text-green-300" />
            <div className="space-y-2 text-sm text-gray-700 dark:text-slate-200">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{status.domain} is live</h2>
              <p>Your store is at{' '}
                <a href={'https://' + status.domain} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-700 underline dark:text-primary-300">https://{status.domain} <ExternalLink className="h-3 w-3" /></a>
                {' '}and this admin at{' '}
                <a href={'https://app.' + status.domain} className="text-primary-700 underline dark:text-primary-300">https://app.{status.domain}</a>.
              </p>
              <p className="text-xs text-gray-600 dark:text-slate-400">SSL certificates are auto-renewed. To change your domain, contact support so we don't accidentally take your store offline mid-DNS-flip.</p>
            </div>
          </div>
        </section>
      )}

      {(status.status === 'pending_nameservers' || status.status === 'partial') && status.domain && (
        <section className="card border-l-4 border-amber-400 p-5">
          <div className="flex items-start gap-4">
            <AlertCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="flex-1 space-y-3 text-sm text-gray-700 dark:text-slate-200">
              {ours ? (
                <>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Setting up {status.domain}</h2>
                  <p>We registered it and are pointing it at your store — there's nothing for you to do. It usually goes live within 15 minutes.</p>
                </>
              ) : (
                <>
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Almost there — point your nameservers</h2>
                  <p>We've reserved <span className="font-mono font-semibold">{status.domain}</span>. The last step is to point your domain's nameservers at ours so we can manage DNS, SSL, and email for you. Do this at whoever you bought the domain from (GoDaddy, Namecheap, etc).</p>
                  {!!status.nameservers?.length && (
                    <div className="rounded-lg bg-gray-50 p-4 dark:bg-slate-800">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-slate-300">Set these nameservers</div>
                      {status.nameservers.map((ns) => (
                        <div key={ns} className="flex items-center justify-between gap-3 py-0.5">
                          <span className="font-mono text-gray-900 dark:text-slate-100">{ns}</span>
                          <button onClick={() => copy(ns)} className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100">
                            {copied === ns ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <details>
                    <summary className="cursor-pointer font-medium text-primary-700 dark:text-primary-300">Step-by-step instructions</summary>
                    <ol className="mt-3 list-decimal space-y-1 pl-5">
                      <li>Sign in to your domain registrar (where you bought {status.domain}).</li>
                      <li>Find DNS settings or Nameservers for {status.domain}.</li>
                      <li>Replace whatever's there with the nameservers above.</li>
                      <li>Save. Propagation usually takes 15-60 minutes, sometimes up to 24h.</li>
                      <li>This page updates when DNS goes live — leave it open or come back later.</li>
                    </ol>
                  </details>
                </>
              )}
              <div className="text-xs text-gray-600 dark:text-slate-400">Checking again automatically every 30 seconds. <button onClick={fetchStatus} className="text-primary-700 underline dark:text-primary-300">Check now</button></div>
            </div>
          </div>
        </section>
      )}

      {status.status === 'unconfigured' && (
        <>
          <section className="card flex items-start gap-4 p-5">
            <Globe className="mt-0.5 h-6 w-6 flex-shrink-0 text-gray-500 dark:text-slate-400" />
            <div className="text-sm text-gray-700 dark:text-slate-200">
              <h2 className="mb-1 text-lg font-semibold text-gray-900 dark:text-slate-100">Your store is launching on a temporary URL</h2>
              <p>Once you set up a real domain below, we'll handle SSL, DNS, and email authentication automatically.</p>
            </div>
          </section>

          <div className="flex gap-1 border-b border-gray-200 dark:border-slate-700" role="tablist">
            {([['buy', 'Buy a new one'], ['byod', 'I already own a domain']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setError(null) }}
                className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === k ? 'border-primary-500 text-gray-900 dark:text-slate-100' : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-slate-300 dark:hover:text-slate-100'}`}>{label}</button>
            ))}
          </div>

          {tab === 'buy' && (
            <section className="card space-y-3 p-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Buy a domain</h2>
              <p className="text-sm text-gray-700 dark:text-slate-200">We'll register it on your behalf and set everything up. Type the domain you want — we'll check if it's open right now.</p>
              <label className="sr-only" htmlFor="buy-domain">Domain to buy</label>
              <input id="buy-domain" type="text" value={buyInput} onChange={(e) => setBuyInput(e.target.value)} placeholder="yourshop.com"
                autoComplete="off" autoCapitalize="off" spellCheck={false} className="input font-mono" />
              {checking && <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</div>}

              {/* Both prices before anyone pays — the renewal in bold, and said plainly when it jumps. No price, no
                  Register: the owner never buys blind. (Same rule as the premium page, 10/15.) */}
              {!checking && check?.available && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950/40">
                  <div className="text-sm text-green-900 dark:text-green-100">
                    <span className="font-semibold">{check.domain}</span> is available
                    {check.quote ? (
                      <div className="mt-1">
                        {usd(check.quote.firstYearCents)} for the first year, then <strong>{usd(check.quote.renewalCents)} a year</strong> after that.
                        {check.quote.renewsHigher && (
                          <div className="mt-1 font-semibold text-amber-900 dark:text-amber-200">Heads up: this ending renews at {usd(check.quote.renewalCents)} a year — much more than the first year. A .com usually stays close.</div>
                        )}
                      </div>
                    ) : (
                      <div className="mt-1 text-amber-900 dark:text-amber-200">We can't show the price for this one right now, so it can't be registered here. Try again in a few minutes, or try a .com.</div>
                    )}
                  </div>
                  <button onClick={() => startBuyCheckout(check.domain)} disabled={submitting || !check.quote} className="btn-primary">
                    {submitting ? 'Starting…' : 'Register'}
                  </button>
                </div>
              )}
              {!checking && check && !check.available && !check.errorMessage && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  <div className="mb-2"><span className="font-semibold">{check.domain}</span> is taken.{check.suggestions?.length ? ' Try one of these:' : ' Try a different one.'}</div>
                  {!!check.suggestions?.length && (
                    <div className="flex flex-wrap gap-2">
                      {check.suggestions.map((s) => (
                        <button key={s.domain} type="button" onClick={() => setBuyInput(s.domain)}
                          className="rounded-md border border-amber-300 bg-white px-3 py-1.5 font-mono text-sm text-gray-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800">
                          {s.domain}
                          {s.quote && <span className="ml-1.5 text-xs text-gray-600 dark:text-slate-300">{usd(s.quote.firstYearCents)}, then <strong>{usd(s.quote.renewalCents)}/yr</strong></span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!checking && check?.errorMessage && (
                <div className="text-sm text-gray-600 dark:text-slate-300">The domain registrar didn't answer — try again in a minute, or connect a domain you already own.</div>
              )}
              {errorBox}
            </section>
          )}

          {tab === 'byod' && (
            <section className="card space-y-3 p-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Connect your existing domain</h2>
              <p className="text-sm text-gray-700 dark:text-slate-200">Enter it below. We'll show you what nameservers to point at us — you make that one-time change at your registrar (GoDaddy, Namecheap, etc.) and the rest is automatic.</p>
              <label className="sr-only" htmlFor="own-domain">Domain you own</label>
              <input id="own-domain" type="text" value={byodInput} onChange={(e) => setByodInput(e.target.value)} placeholder="yourshop.com"
                autoComplete="off" autoCapitalize="off" spellCheck={false} className="input font-mono" />
              <button onClick={() => attach(byodInput.trim().toLowerCase())} disabled={submitting || !DOMAIN_RE.test(byodInput.trim().toLowerCase())}
                className="btn-primary inline-flex items-center gap-2">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                {submitting ? 'Setting up…' : 'Connect this domain'}
              </button>
              {errorBox}
            </section>
          )}
        </>
      )}
    </div>
  )
}
