// Moved from templates/crm-homecare/frontend/src/components/OnboardingPacketPage.tsx.
// The new hire's onboarding packet — public, opened from the emailed /onboarding/:token link. Captures the deeper
// personal details, the emergency contact and the background-check consent (standalone disclosure + typed signature;
// the server records IP and user agent). A Wisconsin agency also asks for the SSN, used only to submit the WI DOJ
// (WORCS) check and scrubbed once WORCS accepts it; other states never ask for it.
//
// GET  /api/public/onboarding-packets/:token         hr/onboardingPackets.ts — the packet's own fields (camelCase),
//                                                    requiresSsn, bgcDisclosureText, agencyName, agencyPhone, agencyState;
//                                                    404 / 410 with the server's sentence
// PUT  /api/public/onboarding-packets/:token         a draft → done
// POST /api/public/onboarding-packets/:token/submit  → done, with the server's thank-you
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, errorMessage } from '../lib/http'
import { usePageTitle } from '../lib/usePageTitle'
import { pageCompanyName } from './shared'

interface Packet {
  status: string
  firstName: string | null
  lastName: string | null
  preferredName: string | null
  legalFirstName: string | null
  legalMiddleName: string | null
  legalLastName: string | null
  pronouns: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  dateOfBirth: string | null
  driversLicenseNumber: string | null
  driversLicenseState: string | null
  emergencyContactName: string | null
  emergencyContactRelationship: string | null
  emergencyContactPhone: string | null
  emergencyContactEmail: string | null
  bgcDisclosureText: string | null
  requiresSsn: boolean
  agencyName: string | null
  agencyPhone: string | null
  agencyState: string | null
}

const emptyForm = {
  preferredName: '', legalFirstName: '', legalMiddleName: '', legalLastName: '', pronouns: '',
  address: '', city: '', state: '', zip: '', dateOfBirth: '',
  driversLicenseNumber: '', driversLicenseState: '',
  emergencyContactName: '', emergencyContactRelationship: '', emergencyContactPhone: '', emergencyContactEmail: '',
  bgcConsentSignature: '', consentChecked: false, ssn: '',
}
type Form = typeof emptyForm
type TextKey = Exclude<keyof Form, 'consentChecked'>

const label = 'block text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-slate-300 mb-1'
const input = 'w-full rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-primary-500'
const section = 'bg-white dark:bg-slate-800 px-5 sm:px-8 py-6 border-b border-gray-200 dark:border-slate-700'
const heading = 'inline-block text-lg font-extrabold text-gray-900 dark:text-slate-100 mb-3 pb-1 border-b-2 border-primary-500'

export default function OnboardingPacketPage({ token }: { token: string }) {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [packet, setPacket] = useState<Packet | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  // The template's App.tsx titled this route "Your onboarding — <agency>".
  usePageTitle(`Your onboarding — ${pageCompanyName()}`)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data: Packet = await api.get(`/api/public/onboarding-packets/${encodeURIComponent(token)}`)
      setPacket(data)
      const home = data.agencyState || ''
      setForm((f) => ({
        ...f,
        preferredName: data.preferredName || '',
        legalFirstName: data.legalFirstName || data.firstName || '',
        legalMiddleName: data.legalMiddleName || '',
        legalLastName: data.legalLastName || data.lastName || '',
        pronouns: data.pronouns || '',
        address: data.address || '', city: data.city || '', state: data.state || home, zip: data.zip || '',
        dateOfBirth: data.dateOfBirth ? String(data.dateOfBirth).slice(0, 10) : '',
        driversLicenseNumber: data.driversLicenseNumber || '',
        driversLicenseState: data.driversLicenseState || home,
        emergencyContactName: data.emergencyContactName || '',
        emergencyContactRelationship: data.emergencyContactRelationship || '',
        emergencyContactPhone: data.emergencyContactPhone || '',
        emergencyContactEmail: data.emergencyContactEmail || '',
      }))
      if (data.status === 'submitted') setSubmitted(true)
    } catch (err) {
      setLoadError(errorMessage(err, 'Unable to load packet.'))
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { load() }, [load])

  const set = (k: TextKey, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const details = () => ({
    preferredName: form.preferredName, legalFirstName: form.legalFirstName, legalMiddleName: form.legalMiddleName,
    legalLastName: form.legalLastName, pronouns: form.pronouns,
    address: form.address, city: form.city, state: form.state, zip: form.zip,
    dateOfBirth: form.dateOfBirth || null,
    driversLicenseNumber: form.driversLicenseNumber, driversLicenseState: form.driversLicenseState,
    emergencyContactName: form.emergencyContactName, emergencyContactRelationship: form.emergencyContactRelationship,
    emergencyContactPhone: form.emergencyContactPhone, emergencyContactEmail: form.emergencyContactEmail,
  })

  const saveDraft = async () => {
    if (!packet) return
    setSaving(true)
    try {
      await api.put(`/api/public/onboarding-packets/${encodeURIComponent(token)}`, details())
      setSavedAt(new Date())
    } catch (err) {
      setSubmitError(errorMessage(err, 'Save failed.'))
    } finally {
      setSaving(false)
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (!form.consentChecked) { setSubmitError('Please read and acknowledge the background check disclosure.'); return }
    if (!form.bgcConsentSignature.trim()) { setSubmitError('Please type your full legal name as your electronic signature.'); return }
    if (!form.dateOfBirth) { setSubmitError('Date of birth is required to run the background check.'); return }
    const ssnDigits = form.ssn.replace(/\D/g, '')
    if (packet?.requiresSsn && ssnDigits.length !== 9) { setSubmitError('Please enter a valid 9-digit Social Security Number.'); return }

    setSubmitting(true)
    try {
      await api.post(`/api/public/onboarding-packets/${encodeURIComponent(token)}/submit`, {
        ...details(),
        dateOfBirth: form.dateOfBirth,
        bgcConsentSignature: form.bgcConsentSignature.trim(),
        ...(packet?.requiresSsn ? { ssn: ssnDigits } : {}),
      })
      setSubmitted(true)
    } catch (err) {
      setSubmitError(errorMessage(err, 'Submission failed.'))
    } finally {
      setSubmitting(false)
    }
  }

  // XXX-XX-XXXX as the person types.
  const onSsnChange = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 9)
    set('ssn', d.length > 5 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : d.length > 3 ? `${d.slice(0, 3)}-${d.slice(3)}` : d)
  }

  const agencyName = packet?.agencyName || 'the agency'
  const phone = packet?.agencyPhone
  const callOffice: ReactNode = phone
    ? <>call the office at <a className="underline text-primary-700 dark:text-primary-200" href={`tel:${String(phone).replace(/[^\d+]/g, '')}`}>{phone}</a></>
    : <>contact the office</>

  const field = (k: TextKey, extra: Record<string, unknown> = {}) => (
    <input className={input} value={form[k]} onChange={(e) => set(k, e.target.value)} {...extra} />
  )
  const upper = (k: TextKey, max: number) => (
    <input className={input} maxLength={max} value={form[k]} onChange={(e) => set(k, e.target.value.toUpperCase())} />
  )

  const page = 'min-h-screen w-full bg-gray-50 dark:bg-slate-900 px-4 py-8'
  if (loading) {
    return <div className={page}><div className="max-w-3xl mx-auto text-center p-12 text-gray-600 dark:text-slate-300">Loading your onboarding packet…</div></div>
  }
  if (loadError) {
    return (
      <div className={page}><div className="max-w-3xl mx-auto rounded-xl bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 p-6">
        <h1 className="text-xl font-bold text-red-700 dark:text-red-300">We couldn't open your packet</h1>
        <p className="mt-2 text-gray-700 dark:text-slate-200">{loadError}</p>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">Please contact the office for a new link.</p>
      </div></div>
    )
  }

  const hero = (badge: string, title: string, sub: string) => (
    <div className="rounded-t-xl bg-slate-900 dark:bg-slate-950 text-white px-5 sm:px-8 py-7">
      <div className="inline-block mb-2.5 px-2.5 py-0.5 rounded-full bg-white/15 text-xs font-bold uppercase tracking-wider text-white">{badge}</div>
      <h1 className="text-2xl font-extrabold text-white">{title}</h1>
      <p className="mt-1.5 text-sm text-slate-200">{sub}</p>
    </div>
  )

  if (submitted) {
    return (
      <div className={page}><div className="max-w-3xl mx-auto">
        {hero('Submitted', `You're all set, ${packet?.firstName || ''}!`, "Thank you for completing your onboarding packet. We'll be in touch as soon as your background check clears and your schedule is ready.")}
        <div className="rounded-b-xl bg-white dark:bg-slate-800 border border-t-0 border-gray-200 dark:border-slate-700 px-5 sm:px-8 py-6">
          <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/30 text-green-900 dark:text-green-100 px-4 py-3 mb-4">
            {packet?.requiresSsn
              ? <><strong>Your background check is running now.</strong> Most Wisconsin DOJ checks return within 1 business day. We'll let you know if there's anything further we need from you.</>
              : <><strong>Your consent is on file.</strong> We'll let you know if there's anything further we need from you for your background check.</>}
          </div>
          <p className="text-gray-700 dark:text-slate-200">In the meantime, watch your email for your caregiver app login instructions (sent separately). If you have any questions, {callOffice}.</p>
        </div>
      </div></div>
    )
  }

  return (
    <div className={page}><div className="max-w-3xl mx-auto">
      {hero('Caregiver Onboarding', `Welcome, ${packet?.firstName || ''}`, 'This packet takes about 10–15 minutes. Save a draft at any time and come back to it.')}

      <form onSubmit={submit}>
        <div className={section}>
          <h2 className={heading}>Your legal name &amp; info</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={label}>Legal First Name *</label>{field('legalFirstName', { required: true })}</div>
            <div><label className={label}>Legal Last Name *</label>{field('legalLastName', { required: true })}</div>
            <div><label className={label}>Middle Name</label>{field('legalMiddleName')}</div>
            <div><label className={label}>Preferred Name</label>{field('preferredName', { placeholder: "What we'll call you" })}</div>
            <div><label className={label}>Pronouns</label>{field('pronouns', { placeholder: 'she/her, he/him, they/them' })}</div>
            <div><label className={label}>Date of Birth *</label>{field('dateOfBirth', { type: 'date', required: true })}</div>
          </div>
        </div>

        <div className={section}>
          <h2 className={heading}>Where do you live?</h2>
          <div className="mb-3"><label className={label}>Street Address</label>{field('address')}</div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2"><label className={label}>City</label>{field('city')}</div>
            <div><label className={label}>State</label>{upper('state', 2)}</div>
            <div><label className={label}>ZIP</label>{field('zip', { maxLength: 10 })}</div>
          </div>
        </div>

        <div className={section}>
          <h2 className={heading}>Driver's license</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={label}>License Number</label>{field('driversLicenseNumber')}</div>
            <div><label className={label}>Issuing State</label>{upper('driversLicenseState', 2)}</div>
          </div>
        </div>

        <div className={section}>
          <h2 className={heading}>Emergency contact</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={label}>Name</label>{field('emergencyContactName')}</div>
            <div><label className={label}>Relationship</label>{field('emergencyContactRelationship', { placeholder: 'e.g. spouse, parent, friend' })}</div>
            <div><label className={label}>Phone</label>{field('emergencyContactPhone', { type: 'tel' })}</div>
            <div><label className={label}>Email</label>{field('emergencyContactEmail', { type: 'email' })}</div>
          </div>
          <div className="text-right mt-3">
            <button type="button" onClick={saveDraft} disabled={saving}
              className="px-5 py-2.5 rounded-lg border-2 border-gray-500 bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 font-bold disabled:opacity-60">
              {saving ? 'Saving…' : savedAt ? 'Draft Saved ✓' : 'Save Draft'}
            </button>
          </div>
        </div>

        <div className={section}>
          <h2 className={heading}>Background check disclosure &amp; authorization</h2>
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-4 mb-4">
            <p className="text-sm text-amber-900 dark:text-amber-100 mb-3">
              <strong>Please read this disclosure carefully.</strong>{' '}
              {packet?.requiresSsn
                ? 'Wisconsin law requires a caregiver background check through the Wisconsin DOJ before you can be scheduled for shifts with clients.'
                : 'A caregiver background check is required before you can be scheduled for shifts with clients.'}
            </p>
            <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-sm leading-relaxed text-gray-700 dark:text-slate-200">
              {packet?.bgcDisclosureText || ''}
            </div>
          </div>
          <label className="flex items-start gap-2.5 mb-4 cursor-pointer text-gray-700 dark:text-slate-200">
            <input type="checkbox" className="mt-1 scale-125" checked={form.consentChecked} onChange={(e) => setForm((f) => ({ ...f, consentChecked: e.target.checked }))} />
            <span>I have read the disclosure above, and I authorize {agencyName} to obtain the described background check report about me.</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>Electronic Signature — Type your full legal name *</label>
              {field('bgcConsentSignature', { placeholder: 'e.g. Jane Marie Doe' })}
            </div>
            {packet?.requiresSsn && (
              <div>
                <label className={label}>Social Security Number *</label>
                <input className={input} value={form.ssn} onChange={(e) => onSsnChange(e.target.value)} placeholder="XXX-XX-XXXX" inputMode="numeric" autoComplete="off" />
                <div className="text-xs text-gray-600 dark:text-slate-300 mt-1">Used only to submit the WI DOJ check. Not stored long-term.</div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-b-xl bg-white dark:bg-slate-800 border border-t-0 border-gray-200 dark:border-slate-700 px-5 sm:px-8 py-6">
          {submitError && <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-100 px-4 py-3 mb-4">{submitError}</div>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-gray-600 dark:text-slate-300">By submitting, you authorize the background check above and confirm the information you provided is accurate.</div>
            <button type="submit" disabled={submitting} className="px-6 py-3 rounded-lg bg-green-700 hover:bg-green-800 text-white font-bold disabled:opacity-60">
              {submitting ? 'Submitting…' : 'Submit & Authorize'}
            </button>
          </div>
        </div>
      </form>
    </div></div>
  )
}
