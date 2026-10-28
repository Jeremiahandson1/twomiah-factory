// Settings › Billing › Own it (server modules/license.ts → Factory services/ownItLicense.ts): the owner buys the software
// outright and takes the code. The price (36× the monthly), what comes with it and what Terms §7 means are on the screen
// BEFORE the button; payment is Stripe's page. After it, the handover (a GitHub invitation and a data export) is
// automatic and this panel shows how far it got. Shown to the owner only — it is a purchase on the business's behalf.
import { useEffect, useState } from 'react'
import { KeyRound, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { api } from '../../api'
import { useAuth, usePermissions, money } from '../../shared'

interface Offer {
  eligible: boolean
  reason: string | null
  planName: string | null
  monthlyCents: number | null
  months: number
  priceCents: number | null
  includes: string[]
  terms: string[]
  termsVersion: string
  license: { paidAt: string; githubUsername: string; amountCents: number; handoverStatus: 'paid' | 'complete' | 'needs_attention'; repoInvited: boolean; exportSent: boolean } | null
}

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const dollars = (cents: number) => money(cents / 100, cents % 100 === 0 ? 0 : 2)

export default function OwnItPanel() {
  const { user } = useAuth() as { user?: { role?: string } }
  const { can, known } = usePermissions()
  // The owner's (the server refuses anyone else); billing:manage is the permission the plan's own changes ask.
  const isOwner = user?.role === 'owner' && (!known || can('billing:manage'))
  const justPaid = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('license') === 'paid'
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loadError, setLoadError] = useState('')
  const [github, setGithub] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOwner) return
    let alive = true, tries = 0
    const load = () => api.get('/api/license')
      .then((o: Offer) => { if (alive) setOffer(o) })
      .catch((e: Error) => { if (alive) setLoadError(e.message || 'The licence could not be loaded.') })
    load()
    // Straight back from Stripe the payment may not have landed yet: look again for a couple of minutes.
    const timer = justPaid ? setInterval(() => { tries++; if (tries > 24) clearInterval(timer); else load() }, 5000) : null
    return () => { alive = false; if (timer) clearInterval(timer) }
  }, [isOwner, justPaid])

  if (!isOwner) return null
  if (loadError) return <div className="mx-auto max-w-4xl px-6 pb-6"><div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div></div>
  if (!offer) return <div className="mx-auto max-w-4xl px-6 pb-6"><Loader2 className="h-6 w-6 animate-spin text-gray-500 dark:text-slate-300" aria-label="Loading" /></div>

  const buy = async () => {
    setBusy(true); setError('')
    try {
      const r: { url: string } = await api.post('/api/license/checkout', { githubUsername: github.trim().replace(/^@/, ''), acceptedTerms: true, termsVersion: offer.termsVersion })
      window.location.href = r.url
    } catch (e) {
      setError((e as Error).message || 'The checkout could not be opened.')
      setBusy(false)
    }
  }

  const lic = offer.license
  return (
    <div className="mx-auto max-w-4xl px-6 pb-8">
      <section className={box} aria-labelledby="own-it-title">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-6 w-6 shrink-0 text-gray-600 dark:text-slate-300" aria-hidden />
          <div className="min-w-0 flex-1">
            <h2 id="own-it-title" className="text-lg font-semibold text-gray-900 dark:text-white">Buy it outright and take the code</h2>

            {lic ? (
              <div className="mt-3 space-y-2 text-sm text-gray-800 dark:text-slate-200">
                <p className="flex items-start gap-2 font-medium text-green-800 dark:text-green-300"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />You own your licence — {dollars(lic.amountCents)} paid.</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Your code: {lic.repoInvited ? <>an invitation went to GitHub user <strong>{lic.githubUsername}</strong> — accept it from GitHub, then clone.</> : 'we are adding your GitHub user now.'}</li>
                  <li>Your data: {lic.exportSent ? 'the download link was emailed to you. You can make a fresh export any time in Settings › Your Data.' : 'being prepared; it will be emailed to you.'}</li>
                </ul>
                {lic.handoverStatus === 'needs_attention' && (
                  <p role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />One step did not finish on its own. Our team has been told and will complete it and write to you.</p>
                )}
                <p className="text-gray-600 dark:text-slate-300">Your hosted Twomiah service carries on until you end it from the billing portal above.</p>
              </div>
            ) : justPaid ? (
              <p role="status" className="mt-3 flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Payment received — setting up your handover. This page updates in a minute.</p>
            ) : !offer.eligible ? (
              <p className="mt-3 text-sm text-gray-700 dark:text-slate-200">{offer.reason}</p>
            ) : (
              <>
                <p className="mt-2 text-gray-800 dark:text-slate-200">
                  <span className="text-3xl font-bold text-gray-900 dark:text-white">{dollars(offer.priceCents!)}</span>
                  <span className="ml-2 text-sm">one time — {offer.months} × your {dollars(offer.monthlyCents!)} a month ({offer.planName})</span>
                </p>
                <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">What you get</h3>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-800 dark:text-slate-200">{offer.includes.map((t) => <li key={t}>{t}</li>)}</ul>
                <h3 className="mt-4 text-sm font-semibold text-gray-900 dark:text-white">What it is, and is not</h3>
                <ul className="mt-1 list-disc space-y-1 rounded-lg border border-gray-200 bg-gray-50 py-3 pl-8 pr-4 text-sm text-gray-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">{offer.terms.map((t) => <li key={t}>{t}</li>)}</ul>

                <div className="mt-4 max-w-sm">
                  <label htmlFor="own-it-github" className="block text-sm font-medium text-gray-800 dark:text-slate-200">Your GitHub username</label>
                  <input id="own-it-github" value={github} onChange={(e) => setGithub(e.target.value)} autoComplete="off" spellCheck={false} placeholder="acme-builders"
                    className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100" />
                  <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">The account we invite to your code. No account yet? Make a free one at github.com first.</p>
                </div>
                <label className="mt-4 flex items-start gap-2 text-sm text-gray-800 dark:text-slate-200">
                  <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-1 h-4 w-4" />
                  <span>I understand this is a licence to run the software for my own business, not to resell it, and that my hosted subscription is not cancelled.</span>
                </label>
                {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</p>}
                <button type="button" onClick={buy} disabled={busy || !accepted || !github.trim()}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-orange-700 px-4 py-2 text-sm font-medium text-white hover:bg-orange-800 disabled:opacity-60">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Buy it outright — {dollars(offer.priceCents!)}
                </button>
                <p className="mt-2 text-xs text-gray-600 dark:text-slate-300">You pay on Stripe’s page. Nothing is charged until you do.</p>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
