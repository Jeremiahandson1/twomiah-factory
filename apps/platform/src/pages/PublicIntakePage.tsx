import { useEffect, useRef, useState } from 'react'
import { API_URL } from '../supabase'

type Step = 'business' | 'location' | 'voice' | 'domain' | 'brand' | 'review' | 'submitted'

interface IntakeState {
  businessName: string
  businessType: string
  contactEmail: string
  contactPhone: string
  ownerName: string
  city: string
  state: string
  serviceAreas: string
  description: string
  services: string
  primaryColor: string
  brandColors: string
  goals: string
  logo: File | null
  photos: File[]
  notes: string
  // Optional — customer's preferred domain. Skip = launch on
  // <slug>-site.onrender.com, decide later in admin.
  requestedDomain: string
}

type DomainCheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; priceUsd?: number }
  | { status: 'unavailable'; suggestions: Array<{ domain: string; priceUsd?: number }> }
  | { status: 'error'; message: string }

const INDUSTRIES = [
  { value: 'general_contractor', label: 'Contractor / Construction' },
  { value: 'roofing', label: 'Roofing' },
  { value: 'home_care', label: 'Home Care Agency' },
  { value: 'hvac', label: 'HVAC / Plumbing / Electrical' },
  { value: 'landscaping', label: 'Landscaping / Lawn Care' },
  { value: 'dispensary', label: 'Cannabis Dispensary' },
  { value: 'restaurant', label: 'Restaurant / Food Service' },
  { value: 'food_truck', label: 'Food Truck / Mobile Food' },
  { value: 'cafe', label: 'Café / Bakery' },
  { value: 'fitness', label: 'Gym / Fitness / Yoga' },
  { value: 'salon', label: 'Salon / Spa / Beauty' },
  { value: 'hotel', label: 'Hotel / Hospitality' },
  { value: 'events', label: 'Events / Wedding / Catering' },
  { value: 'other', label: 'Other' },
]

export default function PublicIntakePage() {
  const [step, setStep] = useState<Step>('business')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intakeId, setIntakeId] = useState<string | null>(null)
  const [state, setState] = useState<IntakeState>({
    businessName: '', businessType: '', contactEmail: '', contactPhone: '',
    ownerName: '', city: '', state: '', serviceAreas: '',
    description: '', services: '', primaryColor: '#1a1a1a',
    brandColors: '', goals: '', logo: null, photos: [], notes: '',
    requestedDomain: '',
  })
  const [domainCheck, setDomainCheck] = useState<DomainCheckState>({ status: 'idle' })

  // Debounced live availability check. Runs ~500ms after the customer
  // stops typing in the domain field.
  useEffect(() => {
    const d = state.requestedDomain.trim().toLowerCase()
    if (!d) { setDomainCheck({ status: 'idle' }); return }
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.[a-z]{2,}$/.test(d)) {
      setDomainCheck({ status: 'idle' }); return
    }
    let cancelled = false
    setDomainCheck({ status: 'checking' })
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/factory/public/domain/check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ domain: d }),
        })
        if (cancelled) return
        const data = await res.json()
        if (!res.ok) { setDomainCheck({ status: 'error', message: data.error || 'Check failed' }); return }
        if (data.available) {
          setDomainCheck({ status: 'available', priceUsd: data.priceUsd })
        } else {
          setDomainCheck({
            status: 'unavailable',
            suggestions: (data.suggestions || []).map((s: any) => ({ domain: s.domain, priceUsd: s.priceUsd })),
          })
        }
      } catch (e: any) {
        if (!cancelled) setDomainCheck({ status: 'error', message: e.message })
      }
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [state.requestedDomain])

  const update = (patch: Partial<IntakeState>) => setState(s => ({ ...s, ...patch }))

  const submit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('businessName', state.businessName)
      fd.append('businessType', state.businessType)
      fd.append('contactEmail', state.contactEmail)
      if (state.contactPhone) fd.append('contactPhone', state.contactPhone)
      if (state.ownerName) fd.append('ownerName', state.ownerName)
      if (state.city) fd.append('city', state.city)
      if (state.state) fd.append('state', state.state)
      if (state.serviceAreas) fd.append('serviceAreas', state.serviceAreas)
      if (state.description) fd.append('description', state.description)
      if (state.services) fd.append('services', state.services)
      if (state.primaryColor) fd.append('primaryColor', state.primaryColor)
      if (state.brandColors) fd.append('brandColors', state.brandColors)
      if (state.goals) fd.append('goals', state.goals)
      if (state.notes) fd.append('notes', state.notes)
      if (state.requestedDomain.trim()) fd.append('requestedDomain', state.requestedDomain.trim().toLowerCase())
      if (state.logo) fd.append('logo', state.logo)
      for (const p of state.photos) fd.append('photos[]', p)

      const res = await fetch(`${API_URL}/api/v1/factory/public/intake`, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setIntakeId(data.intakeId)
      setStep('submitted')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const StepBadge = ({ s, label, num }: { s: Step; label: string; num: number }) => {
    const order: Step[] = ['business', 'location', 'voice', 'domain', 'brand', 'review']
    const idx = order.indexOf(s)
    const cur = order.indexOf(step)
    const done = idx < cur
    const active = idx === cur
    return (
      <div className="flex items-center gap-2">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
          done ? 'bg-green-500 text-white' : active ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-500'
        }`}>{done ? '✓' : num}</div>
        <span className={`text-xs font-medium ${active ? 'text-gray-900' : 'text-gray-500'}`}>{label}</span>
      </div>
    )
  }

  if (step === 'submitted') {
    return <SubmittedScreen intakeId={intakeId!} contactEmail={state.contactEmail} />
  }

  const canAdvance = (() => {
    if (step === 'business') return state.businessName.length >= 2 && state.businessType && state.contactEmail.includes('@')
    if (step === 'location') return true
    if (step === 'voice') return true
    if (step === 'domain') return true   // domain is optional
    if (step === 'brand') return true
    return true
  })()

  const next = () => {
    const order: Step[] = ['business', 'location', 'voice', 'domain', 'brand', 'review']
    const i = order.indexOf(step)
    setStep(order[Math.min(i + 1, order.length - 1)])
  }
  const back = () => {
    const order: Step[] = ['business', 'location', 'voice', 'domain', 'brand', 'review']
    const i = order.indexOf(step)
    setStep(order[Math.max(i - 1, 0)])
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto p-6 pt-12 pb-24">
        <div className="mb-2 text-xs font-semibold tracking-wider text-orange-600 uppercase">Twomiah Premium Website</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Get your preview in minutes</h1>
        <p className="text-gray-600 mb-6">Tell us about your business. We'll send you a complete preview to review before paying.</p>

        {/* Pricing model v2 (2026-07): flat $49/mo, NO build fee. The optional
            $499 "True Customization" is a separate one-time hand-labor charge
            sold later, not part of this funnel's pitch. */}
        <div className="relative bg-white border-2 border-orange-300 rounded-xl p-5 mb-8 overflow-hidden">
          <div className="absolute top-0 right-0 bg-orange-500 text-white text-xs font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">
            No build fee
          </div>
          <div className="grid grid-cols-3 gap-4 text-center pt-3">
            <div>
              <div className="text-2xl font-bold text-gray-900">Free</div>
              <div className="text-xs text-gray-500 mt-1">Preview + revisions</div>
            </div>
            <div className="border-x border-gray-200">
              <div className="text-2xl font-bold text-orange-600">$0</div>
              <div className="text-xs text-gray-500 mt-1">Build fee — see it before you pay anything</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-900">$49/mo</div>
              <div className="text-xs text-gray-500 mt-1">Hosting + CMS + edits, cancel anytime</div>
            </div>
          </div>
          <div className="text-xs text-gray-500 text-center mt-4">
            No charge until you click <span className="font-semibold text-gray-700">Approve &amp; launch my site</span> on the preview.
            Keep the site you approved for <span className="font-semibold text-orange-600">$49/mo</span> — that's it.
          </div>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 mb-8">
          <StepBadge s="business" label="Business" num={1} />
          <StepBadge s="location" label="Location" num={2} />
          <StepBadge s="voice" label="Voice" num={3} />
          <StepBadge s="domain" label="Domain" num={4} />
          <StepBadge s="brand" label="Brand" num={5} />
          <StepBadge s="review" label="Review" num={6} />
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {step === 'business' && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Business basics</h2>
              <Field label="Business name *">
                <input type="text" value={state.businessName} onChange={e => update({ businessName: e.target.value })} className="input" placeholder="e.g. Madison Roofing Co" />
              </Field>
              <Field label="Industry *">
                <select value={state.businessType} onChange={e => update({ businessType: e.target.value })} className="input">
                  <option value="">Select…</option>
                  {INDUSTRIES.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                </select>
              </Field>
              <Field label="Your email *" hint="Where we'll send your preview link">
                <input type="email" value={state.contactEmail} onChange={e => update({ contactEmail: e.target.value })} className="input" placeholder="you@example.com" />
              </Field>
              <Field label="Phone (optional)">
                <input type="tel" value={state.contactPhone} onChange={e => update({ contactPhone: e.target.value })} className="input" placeholder="(608) 555-0142" />
              </Field>
              <Field label="Owner / contact name (optional)">
                <input type="text" value={state.ownerName} onChange={e => update({ ownerName: e.target.value })} className="input" />
              </Field>
            </div>
          )}
          {step === 'location' && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Where you operate</h2>
              <div className="grid grid-cols-2 gap-4">
                <Field label="City">
                  <input type="text" value={state.city} onChange={e => update({ city: e.target.value })} className="input" placeholder="Madison" />
                </Field>
                <Field label="State">
                  <input type="text" value={state.state} onChange={e => update({ state: e.target.value })} className="input" placeholder="WI" />
                </Field>
              </div>
              <Field label="Service areas / cities you cover" hint="Comma or newline-separated. Helps us write SEO copy.">
                <textarea rows={3} value={state.serviceAreas} onChange={e => update({ serviceAreas: e.target.value })} className="input" placeholder="Madison, Sun Prairie, Verona, Fitchburg" />
              </Field>
            </div>
          )}
          {step === 'voice' && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Tell us your story</h2>
              <p className="text-sm text-gray-500">The composer reads this to set tone + write copy. Two or three sentences of plain English go a long way.</p>
              <Field label="Describe your business" hint="What do you do? Who's it for? What makes you different?">
                <textarea rows={5} value={state.description} onChange={e => update({ description: e.target.value })} className="input" placeholder="Family-owned roofing company in Madison since 2014. We specialize in asphalt shingle re-roofs and storm damage insurance work…" />
              </Field>
              <Field label="Services you offer" hint="One per line, or comma-separated">
                <textarea rows={4} value={state.services} onChange={e => update({ services: e.target.value })} className="input" placeholder="Roof replacement&#10;Storm damage&#10;Insurance claims&#10;Gutters&#10;Skylights" />
              </Field>
              <Field label="What do you want this site to do?" hint="e.g. book estimates, get leads, sell online, share menu — pick what matters">
                <input type="text" value={state.goals} onChange={e => update({ goals: e.target.value })} className="input" placeholder="Book free estimates, get insurance leads" />
              </Field>
            </div>
          )}
          {step === 'domain' && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Pick your domain</h2>
              <p className="text-sm text-gray-500">
                Have a domain in mind? Type it below and we'll check availability. Skip this step and we'll launch you
                on a temporary URL — you can hook up a real domain whenever you're ready in admin.
              </p>
              <Field label="Domain you'd like (optional)" hint="No https://, just the name. We'll check if it's open.">
                <input
                  type="text"
                  value={state.requestedDomain}
                  onChange={e => update({ requestedDomain: e.target.value })}
                  className="input font-mono"
                  placeholder="e.g. madisonroofing.com"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              </Field>
              {domainCheck.status === 'checking' && (
                <div className="text-sm text-gray-500 flex items-center gap-2">
                  <span className="inline-block w-3 h-3 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                  Checking…
                </div>
              )}
              {domainCheck.status === 'available' && (
                <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between">
                  <div className="text-sm">
                    <span className="font-semibold text-green-900">{state.requestedDomain}</span>
                    <span className="text-green-800"> is available</span>
                    {domainCheck.priceUsd && (
                      <span className="text-green-700 ml-1">— ${domainCheck.priceUsd.toFixed(2)}/yr</span>
                    )}
                  </div>
                  <span className="text-green-700 text-xl">✓</span>
                </div>
              )}
              {domainCheck.status === 'unavailable' && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3">
                  <div className="text-sm text-orange-900 mb-3">
                    <span className="font-semibold">{state.requestedDomain}</span> is taken.
                    {domainCheck.suggestions.length > 0
                      ? ' Here are some available alternatives:'
                      : ' Try a different one.'}
                  </div>
                  {domainCheck.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {domainCheck.suggestions.map(s => (
                        <button
                          key={s.domain}
                          type="button"
                          onClick={() => update({ requestedDomain: s.domain })}
                          className="px-3 py-1.5 bg-white border border-orange-300 rounded-md text-sm font-mono text-gray-800 hover:bg-orange-100 hover:border-orange-400 transition"
                        >
                          {s.domain}
                          {s.priceUsd && <span className="text-xs text-gray-500 ml-1.5">${s.priceUsd.toFixed(0)}/yr</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {domainCheck.status === 'error' && (
                <div className="text-sm text-gray-500 italic">
                  Live check is offline — that's fine. We'll verify availability when you approve your preview.
                </div>
              )}
              <div className="text-xs text-gray-500 leading-relaxed pt-2 border-t border-gray-100">
                <strong>Already own a domain?</strong> Type it here too — at launch we'll send you the DNS instructions to
                point it at your site. No transfer required, you keep the registrar relationship.
              </div>
            </div>
          )}
          {step === 'brand' && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Brand basics</h2>
              <p className="text-sm text-gray-500">Optional — we'll pick what looks great if you skip.</p>
              <Field label="Primary brand color">
                <div className="flex items-center gap-3">
                  <input type="color" value={state.primaryColor} onChange={e => update({ primaryColor: e.target.value })} className="w-14 h-11 rounded-lg border border-gray-300 cursor-pointer" />
                  <input type="text" value={state.primaryColor} onChange={e => update({ primaryColor: e.target.value })} className="input flex-1 font-mono" />
                </div>
              </Field>
              <Field label="Other brand colors / notes (optional)">
                <input type="text" value={state.brandColors} onChange={e => update({ brandColors: e.target.value })} className="input" placeholder="Cream secondary, warm gold accents" />
              </Field>
              <Field label="Logo (optional)" hint="PNG, JPG, SVG. Max 8 MB.">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={e => update({ logo: e.target.files?.[0] || null })} className="input" />
                {state.logo && <div className="text-xs text-gray-500 mt-1">Selected: {state.logo.name}</div>}
              </Field>
              <Field label="Photos (optional, up to 8)" hint="Hero + portfolio / work / team shots. We use them in the composed sections.">
                <input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => update({ photos: Array.from(e.target.files || []).slice(0, 8) })} className="input" />
                {state.photos.length > 0 && <div className="text-xs text-gray-500 mt-1">{state.photos.length} photo{state.photos.length === 1 ? '' : 's'} selected</div>}
              </Field>
            </div>
          )}
          {step === 'review' && (
            <div className="space-y-5">
              <h2 className="text-xl font-bold text-gray-900">Quick review</h2>
              <ReviewRow label="Business" value={state.businessName} />
              <ReviewRow label="Industry" value={INDUSTRIES.find(i => i.value === state.businessType)?.label || state.businessType} />
              <ReviewRow label="Contact" value={[state.contactEmail, state.contactPhone].filter(Boolean).join(' · ')} />
              {state.ownerName && <ReviewRow label="Owner" value={state.ownerName} />}
              {(state.city || state.state) && <ReviewRow label="Location" value={[state.city, state.state].filter(Boolean).join(', ')} />}
              {state.serviceAreas && <ReviewRow label="Service areas" value={state.serviceAreas} />}
              {state.description && <ReviewRow label="About" value={state.description} multiline />}
              {state.services && <ReviewRow label="Services" value={state.services} multiline />}
              {state.goals && <ReviewRow label="Goals" value={state.goals} />}
              {state.requestedDomain && <ReviewRow label="Domain" value={state.requestedDomain} />}
              <ReviewRow label="Brand color" value={
                <span className="inline-flex items-center gap-2">
                  <span className="w-5 h-5 rounded border border-gray-300" style={{ background: state.primaryColor }} />
                  <span className="font-mono">{state.primaryColor}</span>
                </span>
              } />
              {state.logo && <ReviewRow label="Logo" value={state.logo.name} />}
              {state.photos.length > 0 && <ReviewRow label="Photos" value={`${state.photos.length} attached`} />}
              <Field label="Anything else? (optional)">
                <textarea rows={3} value={state.notes} onChange={e => update({ notes: e.target.value })} className="input" placeholder="Sites you love, things to avoid, deadlines…" />
              </Field>
              {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
            </div>
          )}

          <div className="flex justify-between items-center pt-6 border-t border-gray-200 mt-6">
            <button onClick={back} disabled={step === 'business' || submitting} className="text-gray-500 hover:text-gray-900 text-sm font-medium disabled:opacity-30">
              ← Back
            </button>
            {step !== 'review' ? (
              <button onClick={next} disabled={!canAdvance} className="bg-orange-500 hover:bg-orange-400 text-white px-6 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40">
                Continue →
              </button>
            ) : (
              <button onClick={submit} disabled={submitting} className="bg-orange-500 hover:bg-orange-400 text-white px-6 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40">
                {submitting ? 'Submitting…' : 'Submit & compose my preview'}
              </button>
            )}
          </div>
        </div>

        <div className="text-center text-xs text-gray-400 mt-6">
          By submitting you agree we may email you a preview link. Free to preview and request changes — you only pay if you approve.
        </div>
      </div>

      <style>{`
        .input { display:block; width:100%; padding:10px 14px; border:1px solid #d1d5db; border-radius:8px; font-size:14px; background:#fff; }
        .input:focus { outline:none; border-color:#f97316; box-shadow:0 0 0 3px rgba(249,115,22,.15); }
      `}</style>
    </div>
  )
}

function SubmittedScreen({ intakeId, contactEmail }: { intakeId: string; contactEmail: string }) {
  const [ready, setReady] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const startedAtRef = useRef(Date.now())

  // Tick a visible "elapsed time" counter so the customer knows the page
  // is alive (not just spinning forever).
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  // Poll status every 10s until ready. Stops on first success.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    async function tick() {
      try {
        const res = await fetch(`${API_URL}/api/v1/factory/public/intake/${intakeId}/status`)
        if (!res.ok) throw new Error('status check failed')
        const data = await res.json()
        if (cancelled) return
        if (data.ready && data.previewUrl) {
          setPreviewUrl(data.previewUrl)
          setReady(true)
          return
        }
      } catch { /* keep polling */ }
      if (!cancelled) timer = setTimeout(tick, 10000)
    }
    tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [intakeId])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedStr = mins > 0 ? `${mins}:${String(secs).padStart(2, '0')}` : `${secs}s`

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white max-w-xl w-full rounded-2xl shadow-sm border border-gray-200 p-10 text-center">
        {!ready ? (
          <>
            <div className="w-16 h-16 mx-auto mb-6 flex items-center justify-center">
              <div className="w-12 h-12 rounded-full border-4 border-orange-200 border-t-orange-500 animate-spin" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Composing your preview…</h1>
            <p className="text-gray-600 leading-relaxed mb-6">
              Our AI is writing your home, about, services, and contact pages right now.
              This usually takes 1–2 minutes.
            </p>
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600 mb-6">
              <div className="font-semibold text-gray-900 mb-1">Elapsed: {elapsedStr}</div>
              <div>You can leave this page open and it'll auto-refresh — or close it and watch your inbox for the preview link. We'll email <span className="font-semibold text-gray-900">{contactEmail}</span> when it's ready.</div>
            </div>
            <div className="text-xs text-gray-500">
              Reference: <code className="bg-gray-100 px-2 py-1 rounded">{intakeId}</code>
            </div>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-green-600"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">Your preview is ready.</h1>
            <p className="text-gray-600 leading-relaxed mb-6">
              We've composed a 4-page draft. Click below to review it — request changes from any page, or approve and buy.
            </p>
            <a
              href={previewUrl || '#'}
              className="inline-block bg-orange-500 hover:bg-orange-400 text-white px-8 py-3 rounded-lg text-base font-semibold transition-colors mb-6"
            >
              Open my preview →
            </a>
            <div className="text-xs text-gray-500">
              We've also emailed the link to <span className="font-mono">{contactEmail}</span>.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-gray-900 mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-xs text-gray-500 mt-1.5">{hint}</div>}
    </div>
  )
}

function ReviewRow({ label, value, multiline }: { label: string; value: React.ReactNode; multiline?: boolean }) {
  return (
    <div className={`flex ${multiline ? 'flex-col' : 'items-start justify-between'} gap-1.5 text-sm`}>
      <span className="text-gray-500 font-medium">{label}</span>
      <span className={`text-gray-900 ${multiline ? 'mt-1 whitespace-pre-wrap' : 'text-right'}`}>{value}</span>
    </div>
  )
}
