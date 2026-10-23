// Settings › Texting — the business texts from ITS OWN number, registered with the carriers in its own name (A2P 10DLC),
// the way Jobber and Housecall Pro set it up. GET/POST /api/texting (server/crm/comms/texting.ts) pass through to the
// Factory, which registers it (apps/api services/a2p.ts) and, once the carriers approve, hands the number to this CRM.
//
// What the page shows, in order: live (the number); texting not switched on (the add-on); the form (not yet sent, or
// turned down with the carriers' reason); in review (where it is, "Check now", a sole proprietor's YES text).
import { useEffect, useState } from 'react'
import { CheckCircle2, Clock, MessageSquare, AlertTriangle, RefreshCw, Send } from 'lucide-react'
import { api } from '../../api'
import { useKnownPermission, useToast } from '../../shared'
import { money as formatMoney } from '@twomiah/tenant-ui/src/money'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'

interface Registration {
  status: string
  stage: 'not_started' | 'not_submitted' | 'brand' | 'campaign' | 'live'
  kind: 'standard' | 'sole_proprietor' | null
  businessName: string | null
  rejectionReason: string | null
  submittedAt: string | null
  messagingEnabled: boolean
  walletCents: number
  fees: { brandCents: number; campaignVettingCents: number; monthlyCampaignCents: number; numberMonthlyCents: number; startCents?: number }
  error?: string
}

// Twilio's own lists (the Factory checks them again).
const BUSINESS_TYPES = ['Limited Liability Corporation', 'Corporation', 'Partnership', 'Co-operative', 'Non-profit Corporation']
const POSITIONS = ['CEO', 'GM', 'Director', 'VP', 'CFO', 'General Counsel', 'Other']
const INDUSTRIES: Array<[string, string]> = [
  ['CONSTRUCTION', 'Construction & trades'], ['PROFESSIONAL_SERVICES', 'Professional services'], ['HEALTHCARE', 'Healthcare & home care'],
  ['CONSUMER', 'Personal services (salon, spa)'], ['FOOD_AND_BEVERAGE', 'Food & drink'], ['HOSPITALITY', 'Hospitality & events'],
  ['AUTOMOTIVE', 'Automotive & RV'], ['RETAIL', 'Retail'], ['REAL_ESTATE', 'Real estate'], ['AGRICULTURE', 'Agriculture'],
  ['TRANSPORTATION', 'Transportation'], ['NOT_FOR_PROFIT', 'Not for profit'],
]
const money = (c: number) => formatMoney((c / 100))
const pretty = (e164: string) => e164.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3')

const CARD = 'bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-6'
const INPUT = 'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100'
const LABEL = 'block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1'
const MUTED = 'text-sm text-gray-600 dark:text-slate-300'
const BTN = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-orange-700 hover:bg-orange-800 text-white disabled:opacity-60'
const BTN2 = 'inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium border border-gray-300 dark:border-slate-600 text-gray-800 dark:text-slate-100 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-60'

export default function TextingPage() {
  const toast = useToast()
  const mayRegister = useKnownPermission('company:update')
  const [sender, setSender] = useState<{ phoneNumber: string | null } | null>(null)
  const [reg, setReg] = useState<Registration | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [form, setForm] = useState({
    kind: 'standard' as 'standard' | 'sole_proprietor',
    legalName: '', businessType: BUSINESS_TYPES[0], ein: '', industry: 'CONSTRUCTION', brandName: '', mobilePhone: '',
    street: '', city: '', region: '', postalCode: '',
    repFirstName: '', repLastName: '', repEmail: '', repPhone: '', repTitle: 'Owner', repJobPosition: 'CEO',
  })
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function load() {
    try {
      const r = await api.get('/api/texting')
      setSender(r.sender); setReg(r.registration)
    } catch (e: any) { setProblem(e?.message || 'Could not load texting.') }
    setLoading(false)
  }
  useEffect(() => {
    load()
    // The form starts from the business's own details.
    api.get('/api/company').then((r: any) => {
      const c = r?.data ?? r
      if (!c) return
      setForm((f) => ({ ...f, legalName: c.name || '', brandName: c.name || '', street: c.address || '', city: c.city || '', region: c.state || '', postalCode: c.zip || '', repEmail: c.email || '', repPhone: c.phone || '' }))
    }).catch(() => {})
  }, [])

  async function submit() {
    setBusy(true); setProblem('')
    const common = { street: form.street, city: form.city, region: form.region, postalCode: form.postalCode, repFirstName: form.repFirstName, repLastName: form.repLastName, repEmail: form.repEmail, repPhone: form.repPhone }
    const body = form.kind === 'standard'
      ? { kind: 'standard', legalName: form.legalName, businessType: form.businessType, ein: form.ein, industry: form.industry, repTitle: form.repTitle, repJobPosition: form.repJobPosition, ...common }
      : { kind: 'sole_proprietor', brandName: form.brandName, mobilePhone: form.mobilePhone, ...common }
    try {
      const r = await api.post('/api/texting/registration', body)
      setReg(r)
      toast.success('Sent to the carriers for review')
    } catch (e: any) {
      setProblem(e?.message || 'That did not go through.')
      await load() // where it stands now (a stopped registration says why)
    }
    setBusy(false)
  }
  async function act(path: string, done: string) {
    setBusy(true); setProblem('')
    try { const r = await api.post(path, {}); if (r?.stage) setReg(r); toast.success(done) } catch (e: any) { setProblem(e?.message || 'That did not go through.') }
    setBusy(false)
  }
  async function openBilling() {
    try { const r = await api.get('/api/messaging-billing/portal-link'); if (r?.url) window.open(r.url, '_blank') } catch (e: any) { setProblem(e?.message || 'Could not open texting billing.') }
  }

  if (loading) return <div className={MUTED}>Loading…</div>

  const upfront = reg ? reg.fees.brandCents + reg.fees.campaignVettingCents : 0
  const monthly = reg ? reg.fees.monthlyCampaignCents + reg.fees.numberMonthlyCents : 0
  // What starts texting: the one-time registration and some to text with (the Factory's MESSAGING_START_CENTS).
  const start = Math.max(reg?.fees.startCents ?? 0, upfront)
  const short = reg ? Math.max(0, start - reg.walletCents) : 0
  /** How the wallet is kept topped up, said before anyone is charged. */
  const reloadTerms = 'When your wallet runs low, we reload $25 from the card you pay Twomiah with (plus card processing) and email you a receipt.'
  const inReview = reg && (reg.stage === 'brand' || reg.stage === 'campaign') && reg.status === 'pending'
  const canFill = mayRegister && reg && !reg.error && !inReview && !sender && reg.messagingEnabled
  const sp = form.kind === 'sole_proprietor'

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><MessageSquare className="w-6 h-6" />Texting</h1>
        <p className={MUTED + ' mt-1'}>Your business texts customers from its own local number, registered with the phone carriers in your business's name — so texts arrive as yours, and replies come straight to Messages.</p>
      </div>

      {problem && <div role="alert" className="flex items-start gap-2 p-4 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-200"><AlertTriangle className="w-5 h-5 shrink-0" /><span>{problem}</span></div>}

      {sender ? (
        <div className={CARD}>
          <div className="flex items-center gap-2 text-green-800 dark:text-green-300 font-semibold"><CheckCircle2 className="w-5 h-5" />Texting is live</div>
          <p className="mt-2 text-gray-900 dark:text-slate-100 text-lg">{sender.phoneNumber ? pretty(sender.phoneNumber) : 'Your number'}</p>
          <p className={MUTED + ' mt-1'}>Texts to your customers go out from this number, and their replies arrive in Messages.</p>
        </div>
      ) : reg?.error ? (
        <div className={CARD}><p className={MUTED}>Texting setup isn't available right now ({reg.error}).</p></div>
      ) : reg && !reg.messagingEnabled ? (
        <div className={CARD}>
          <h2 className="font-semibold text-gray-900 dark:text-white">Turn on texting</h2>
          <p className={MUTED + ' mt-1'}>Texting is $10 a month. To start, you add {money(start)} to your texting wallet — {money(upfront)} for the one-time carrier registration, the rest for your first texts. After that the wallet pays {money(monthly)} a month for the registration and your number, and a fraction of a cent per text. {reloadTerms}</p>
          {mayRegister ? <button type="button" className={BTN + ' mt-4'} onClick={openBilling}>Turn on texting</button> : <p className={MUTED + ' mt-3'}>An owner or admin can turn it on.</p>}
        </div>
      ) : inReview ? (
        <div className={CARD}>
          <div className="flex items-center gap-2 text-gray-900 dark:text-white font-semibold"><Clock className="w-5 h-5" />{reg!.stage === 'brand' ? 'The carriers are reviewing your business' : 'The carriers are reviewing what you text'}</div>
          <p className={MUTED + ' mt-2'}>This usually takes a few days. Your number turns on here by itself once it's approved — nothing else to do.</p>
          {reg!.kind === 'sole_proprietor' && reg!.stage === 'brand' && (
            <div className="mt-4 p-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 text-sm">
              Twilio texts the owner's mobile from <strong>(915) 278-2000</strong> to confirm it's really you. <strong>Reply YES</strong> within 24 hours.
              {mayRegister && <button type="button" className={BTN2 + ' mt-3 block'} disabled={busy} onClick={() => act('/api/texting/registration/resend', 'Sent again')}>Send the confirmation text again</button>}
            </div>
          )}
          {mayRegister && <button type="button" className={BTN2 + ' mt-4'} disabled={busy} onClick={() => act('/api/texting/registration/refresh', 'Checked')}><RefreshCw className="w-4 h-4" />Check now</button>}
        </div>
      ) : (
        <>
          {reg?.status === 'rejected' && reg.rejectionReason && (
            <div className={CARD + ' border-red-300 dark:border-red-800'}>
              <h2 className="font-semibold text-red-800 dark:text-red-200">The carriers turned this down</h2>
              <p className="mt-1 text-gray-900 dark:text-slate-100">{reg.rejectionReason}</p>
              <p className={MUTED + ' mt-2'}>Fix the details below and send it again.</p>
            </div>
          )}
          {!mayRegister ? (
            <div className={CARD}><p className={MUTED}>An owner or admin registers the business for texting.</p></div>
          ) : canFill && (
            <div className={CARD + ' space-y-5'}>
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Register your business for texting</h2>
                <p className={MUTED + ' mt-1'}>The phone carriers require every business that texts customers to register. Costs, from your texting wallet ({money(reg!.walletCents)} now): {money(upfront)} once, then {money(monthly)} a month. {reloadTerms}</p>
                {short > 0 && (
                  <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100 text-sm">
                    Add {money(short)} to your texting wallet to register — {money(start)} starts texting.
                    <button type="button" className={BTN2 + ' mt-2 block'} onClick={openBilling}>Add funds</button>
                  </div>
                )}
              </div>
              <fieldset>
                <legend className={LABEL}>Does the business have an EIN (federal tax ID)?</legend>
                <div className="grid sm:grid-cols-2 gap-3">
                  {([['standard', 'Yes', 'A registered business: LLC, corporation, partnership.'], ['sole_proprietor', 'No', 'Sole proprietor. Twilio texts your mobile once to confirm.']] as const).map(([v, t, d]) => (
                    <label key={v} className={`p-3 rounded-lg border cursor-pointer ${form.kind === v ? 'border-orange-600 bg-orange-50 dark:bg-orange-950/30' : 'border-gray-300 dark:border-slate-600'}`}>
                      <input type="radio" name="kind" value={v} checked={form.kind === v} onChange={() => setForm((f) => ({ ...f, kind: v }))} className="mr-2" />
                      <span className="font-medium text-gray-900 dark:text-white">{t}</span>
                      <span className={'block ' + MUTED}>{d}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {sp ? (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><label className={LABEL} htmlFor="t-brand">Business name customers know</label><input id="t-brand" className={INPUT} value={form.brandName} onChange={set('brandName')} /></div>
                  <div><label className={LABEL} htmlFor="t-mobile">Your mobile (gets the confirmation text)</label><input id="t-mobile" type="tel" className={INPUT} value={form.mobilePhone} onChange={set('mobilePhone')} /></div>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2"><label className={LABEL} htmlFor="t-legal">Legal business name, exactly as on your EIN letter</label><input id="t-legal" className={INPUT} value={form.legalName} onChange={set('legalName')} /></div>
                  <div><label className={LABEL} htmlFor="t-type">Business type</label><select id="t-type" className={INPUT} value={form.businessType} onChange={set('businessType')}>{BUSINESS_TYPES.map((b) => <option key={b}>{codeLabel(b)}</option>)}</select></div>
                  <div><label className={LABEL} htmlFor="t-ein">EIN</label><input id="t-ein" className={INPUT} placeholder="12-3456789" value={form.ein} onChange={set('ein')} /></div>
                  <div className="sm:col-span-2"><label className={LABEL} htmlFor="t-ind">Industry</label><select id="t-ind" className={INPUT} value={form.industry} onChange={set('industry')}>{INDUSTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                </div>
              )}
              <div className="grid sm:grid-cols-4 gap-4">
                <div className="sm:col-span-4"><label className={LABEL} htmlFor="t-street">Business address</label><input id="t-street" className={INPUT} value={form.street} onChange={set('street')} /></div>
                <div className="sm:col-span-2"><label className={LABEL} htmlFor="t-city">City</label><input id="t-city" className={INPUT} value={form.city} onChange={set('city')} /></div>
                <div><label className={LABEL} htmlFor="t-state">State</label><input id="t-state" className={INPUT} maxLength={2} placeholder="WI" value={form.region} onChange={set('region')} /></div>
                <div><label className={LABEL} htmlFor="t-zip">ZIP</label><input id="t-zip" className={INPUT} value={form.postalCode} onChange={set('postalCode')} /></div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div><label className={LABEL} htmlFor="t-first">{sp ? 'Your first name' : 'Contact first name'}</label><input id="t-first" className={INPUT} value={form.repFirstName} onChange={set('repFirstName')} /></div>
                <div><label className={LABEL} htmlFor="t-last">{sp ? 'Your last name' : 'Contact last name'}</label><input id="t-last" className={INPUT} value={form.repLastName} onChange={set('repLastName')} /></div>
                <div><label className={LABEL} htmlFor="t-email">Email</label><input id="t-email" type="email" className={INPUT} value={form.repEmail} onChange={set('repEmail')} /></div>
                <div><label className={LABEL} htmlFor="t-phone">Phone</label><input id="t-phone" type="tel" className={INPUT} value={form.repPhone} onChange={set('repPhone')} /></div>
                {!sp && <div><label className={LABEL} htmlFor="t-title">Title</label><input id="t-title" className={INPUT} value={form.repTitle} onChange={set('repTitle')} /></div>}
                {!sp && <div><label className={LABEL} htmlFor="t-pos">Position</label><select id="t-pos" className={INPUT} value={form.repJobPosition} onChange={set('repJobPosition')}>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select></div>}
              </div>
              <p className={MUTED}>Your website already has what the carriers check: your privacy policy and terms, and a “Text me” box on every form that asks for a phone number.</p>
              <button type="button" className={BTN} disabled={busy || short > 0} onClick={submit}><Send className="w-4 h-4" />{busy ? 'Sending…' : 'Register for texting'}</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
