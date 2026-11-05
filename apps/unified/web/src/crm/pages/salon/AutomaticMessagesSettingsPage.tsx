// Settings › Automatic messages (server crm/salon/retention.ts, /api/retention; hidden feature `retention_sends`):
// rebooking on the due date, birthdays, win-back, a "book your next visit" prompt after a visit, visit milestones, client anniversaries, a message when
// a client moves up a loyalty tier (any of birthday, win-back, milestone, anniversary and tier can carry a single-use offer code), and the follow-up sequences a visit starts.
// Every part is off until the owner switches it on, and nothing from before that moment is ever sent. A text goes only to a number that agreed to
// be texted and never to one that replied STOP; otherwise an email with its unsubscribe link; nothing goes in quiet hours.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, MessageSquareText } from 'lucide-react'
import { api } from '../../../api'
import { useToast, usePermissions } from '../../../shared'
import { momentDate } from '@twomiah/tenant-ui/src/time/companyClock'

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const fieldClass = 'mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100'

type Kind = 'rebook' | 'birthday' | 'win_back' | 'next_visit' | 'milestone' | 'anniversary' | 'tier_up'
type OfferKind = 'birthday' | 'win_back' | 'milestone' | 'anniversary' | 'tier_up'
interface OfferTerms { type: 'amount' | 'percent'; value: number; validDays: number }
interface Settings {
  rebook: boolean; birthday: boolean; winBack: boolean; nextVisit: boolean; drips: boolean
  milestone: boolean; anniversary: boolean; tierUp: boolean; milestoneVisits: number[]; offers: Partial<Record<OfferKind, OfferTerms>>
  winBackDays: number; quietStart: string; quietEnd: string; since: string | null; templates: Partial<Record<Kind, string>>
}
interface LogRow { id: string; kind: string; channel: string | null; status: string; reason: string | null; createdAt: string; clientName: string | null }
interface OfferReportRow { kind: string; words: string; sent: number; used: number; open: number; expired: number; discountCents: number; billedCents: number }
interface OfferReport { from: string; to: string; total: Omit<OfferReportRow, 'kind' | 'words'>; kinds: OfferReportRow[] }
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
const OFFER_KINDS: Partial<Record<Kind, OfferKind>> = { birthday: 'birthday', win_back: 'win_back', milestone: 'milestone', anniversary: 'anniversary', tier_up: 'tier_up' }

/** The offer a message carries: none, or an amount / percent off that lasts so many days. Amounts are typed in dollars, kept in cents. */
function OfferFields({ kind, terms, disabled, error, onChange }: { kind: OfferKind; terms?: OfferTerms; disabled: boolean; error?: string; onChange: (t: OfferTerms | null) => void }) {
  const [text, setText] = useState(terms ? (terms.type === 'amount' ? String(terms.value / 100) : String(terms.value)) : '')
  const on = !!terms
  const parse = (type: 'amount' | 'percent', raw: string, days: number): OfferTerms | null => {
    const n = Number(raw)
    if (!raw.trim() || !Number.isFinite(n) || n <= 0) return null
    return { type, value: type === 'amount' ? Math.round(n * 100) : Math.round(n), validDays: days }
  }
  return (
    <div className="mt-2 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
        <input type="checkbox" className="h-4 w-4" checked={on} disabled={disabled} onChange={(e) => { if (e.target.checked) { setText('10'); onChange({ type: 'amount', value: 1000, validDays: 30 }) } else { setText(''); onChange(null) } }} aria-label={`Include an offer code in the ${kind.replace('_', '-')} message`} /> Include a single-use offer code
      </label>
      {terms && (
        <div className="mt-2 flex flex-wrap items-end gap-3 text-sm text-gray-900 dark:text-slate-100">
          <label>Off<select value={terms.type} disabled={disabled} onChange={(e) => { const type = e.target.value as 'amount' | 'percent'; setText(type === 'amount' ? '10' : '15'); onChange(parse(type, type === 'amount' ? '10' : '15', terms.validDays)) }} className={fieldClass + ' w-32'}><option value="amount">Dollars</option><option value="percent">Percent</option></select></label>
          <label>{terms.type === 'amount' ? 'Dollars off' : 'Percent off'}<input inputMode="decimal" value={text} disabled={disabled} onChange={(e) => { setText(e.target.value); const t = parse(terms.type, e.target.value, terms.validDays); if (t) onChange(t) }} className={fieldClass + ' w-24'} /></label>
          <label>Good for (days)<input type="number" min={1} max={365} value={terms.validDays} disabled={disabled} onChange={(e) => onChange({ ...terms, validDays: Math.max(1, Math.min(365, Math.round(Number(e.target.value)) || 1)) })} className={fieldClass + ' w-24'} /></label>
        </div>
      )}
      {terms && <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">Each client gets a code of their own, put into the message ahead of the booking link (or where you write {'{offer}'}). It works once, on that client&rsquo;s own sale, until its last day.</p>}
      {error && <span role="alert" className="block text-xs text-red-700 dark:text-red-300">{error}</span>}
    </div>
  )
}

interface Preview { quiet: boolean; wouldSend: Array<{ client: string | null; kind: string; via: string }> }

const PARTS: Array<{ key: 'rebook' | 'birthday' | 'winBack' | 'nextVisit' | 'drips' | 'milestone' | 'anniversary' | 'tierUp'; kind?: Kind; title: string; words: string }> = [
  { key: 'rebook', kind: 'rebook', title: 'Rebook on the due date', words: 'When a client is due back for a service (the rebook rhythm on your Service Menu), they are sent a message with your booking link.' },
  { key: 'birthday', kind: 'birthday', title: 'Birthday', words: 'On the day, once a year, for clients with a birthday on their chart.' },
  { key: 'winBack', kind: 'win_back', title: 'Win back a lapsed client', words: 'When a client has not been in for the number of days below. Not sent to a client who has an appointment booked.' },
  { key: 'nextVisit', kind: 'next_visit', title: 'Book your next visit', words: 'Shortly after a visit is completed, a prompt to book the next one. Not sent to a client who already has an appointment booked.' },
  { key: 'milestone', kind: 'milestone', title: 'Visit milestones', words: 'After the visit that makes it a client’s 5th, 10th or 25th (you choose which), a thank-you message.' },
  { key: 'anniversary', kind: 'anniversary', title: 'Client anniversary', words: 'On the day each year a client first came in, from their first year on.' },
  { key: 'tierUp', kind: 'tier_up', title: 'Moving up a loyalty tier', words: 'When a client earns their way into a higher tier of your loyalty program (Loyalty › Tiers). Needs the loyalty program to be on.' },
  { key: 'drips', title: 'Start my follow-up sequences', words: 'A completed visit, or a lapse, starts your own follow-up sequences (Marketing › Sequences) that are set to begin on it. Email only.' },
]
const KIND_WORDS: Record<string, string> = { rebook: 'Rebook', birthday: 'Birthday', win_back: 'Win-back', next_visit: 'Next visit', milestone: 'Visit milestone', anniversary: 'Anniversary', tier_up: 'Loyalty tier', drip_visit_completed: 'Follow-up after a visit', drip_lapsed: 'Follow-up after a lapse' }

export default function AutomaticMessagesSettingsPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = known && can('company:update')
  const [s, setS] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [log, setLog] = useState<LogRow[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loadError, setLoadError] = useState('')
  const [report, setReport] = useState<OfferReport | null>(null)
  const [visitsText, setVisitsText] = useState<string | null>(null)

  const load = useCallback(() => {
    api.get('/api/retention/settings').then((r: Settings) => { setS(r); setDraft(r) }).catch((e: Error) => setLoadError(e.message || 'The settings could not be loaded.'))
    api.get('/api/retention-offers/report').then((r: OfferReport) => setReport(r)).catch(() => setReport(null))
    api.get('/api/retention/log').then((r: any) => setLog(((r?.data ?? r) || []).slice(0, 50))).catch(() => setLog([]))
  }, [])
  useEffect(load, [load])

  if (loadError) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{loadError}</div>
  if (!s || !draft) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  const save = async () => {
    setSaving(true); setErrors({})
    try {
      const r: Settings = await api.put('/api/retention/settings', {
        rebook: draft.rebook, birthday: draft.birthday, winBack: draft.winBack, nextVisit: draft.nextVisit, drips: draft.drips,
        milestone: draft.milestone, anniversary: draft.anniversary, tierUp: draft.tierUp, milestoneVisits: draft.milestoneVisits,
        offers: { birthday: draft.offers.birthday ?? null, win_back: draft.offers.win_back ?? null, milestone: draft.offers.milestone ?? null, anniversary: draft.offers.anniversary ?? null, tier_up: draft.offers.tier_up ?? null },
        winBackDays: Number(draft.winBackDays), quietStart: draft.quietStart, quietEnd: draft.quietEnd,
        templates: { rebook: draft.templates.rebook || '', birthday: draft.templates.birthday || '', win_back: draft.templates.win_back || '', next_visit: draft.templates.next_visit || '', milestone: draft.templates.milestone || '', anniversary: draft.templates.anniversary || '', tier_up: draft.templates.tier_up || '' },
      })
      setS(r); setDraft(r); setPreview(null); setVisitsText(null)
      toast.success('Automatic messages saved')
    } catch (e: any) {
      setErrors(e?.data?.fields || {})
      toast.error(e?.message || 'The settings could not be saved.')
    } finally { setSaving(false) }
  }
  const dirty = JSON.stringify(s) !== JSON.stringify(draft)
  const check = async () => {
    try { setPreview(await api.post('/api/retention/run', { dryRun: true })) } catch (e: any) { toast.error(e?.message || 'The preview could not be made.') }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link to="/crm/settings" className="text-sm text-gray-600 hover:underline dark:text-slate-300">Settings</Link>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><MessageSquareText className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Automatic messages</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Messages that go out by themselves to bring clients back. Everything here is off until you switch it on.</p>
      </div>
      {!mayEdit && <p className="text-sm text-gray-700 dark:text-slate-300">You can see these settings. Only an owner or admin can change them.</p>}

      <section className={box} aria-label="What is sent">
        <div className="space-y-4">
          {PARTS.map((p) => (
            <div key={p.key}>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-900 dark:text-slate-100">
                <input type="checkbox" className="h-4 w-4" checked={draft[p.key]} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, [p.key]: e.target.checked })} /> {p.title}
              </label>
              <p className={hint}>{p.words}</p>
              {p.key === 'winBack' && draft.winBack && (
                <label className="mt-2 block text-sm font-medium text-gray-900 dark:text-slate-100">Days since their last visit
                  <input type="number" min={30} max={730} value={draft.winBackDays} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, winBackDays: Number(e.target.value) })} className={fieldClass + ' max-w-[8rem]'} aria-invalid={!!errors.winBackDays} />
                  {errors.winBackDays && <span role="alert" className="block text-xs text-red-700 dark:text-red-300">{errors.winBackDays}</span>}
                </label>
              )}
              {p.key === 'milestone' && draft.milestone && (
                <label className="mt-2 block text-sm font-medium text-gray-900 dark:text-slate-100">Which visits (separate with commas)
                  <input value={visitsText ?? draft.milestoneVisits.join(', ')} disabled={!mayEdit} onChange={(e) => { setVisitsText(e.target.value); const nums = e.target.value.split(/[ ,]+/).filter(Boolean).map(Number); if (nums.every((n) => Number.isInteger(n))) setDraft({ ...draft, milestoneVisits: nums }) }} className={fieldClass + ' max-w-xs'} aria-invalid={!!errors.milestoneVisits} />
                  {errors.milestoneVisits && <span role="alert" className="block text-xs text-red-700 dark:text-red-300">{errors.milestoneVisits}</span>}
                </label>
              )}
              {p.kind && OFFER_KINDS[p.kind] && draft[p.key] && (
                <OfferFields kind={OFFER_KINDS[p.kind]!} terms={draft.offers[OFFER_KINDS[p.kind]!]} disabled={!mayEdit} error={errors.offers}
                  onChange={(t) => { const offers = { ...draft.offers }; if (t) offers[OFFER_KINDS[p.kind!]!] = t; else delete offers[OFFER_KINDS[p.kind!]!]; setDraft({ ...draft, offers }) }} />
              )}
              {p.kind && draft[p.key] && (
                <label className="mt-2 block text-sm font-medium text-gray-900 dark:text-slate-100">Your own words (optional)
                  <textarea rows={2} maxLength={320} value={draft.templates[p.kind] || ''} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, templates: { ...draft.templates, [p.kind!]: e.target.value } })} className={fieldClass} placeholder="Leave empty to use the standard message." />
                  <span className="block text-xs font-normal text-gray-600 dark:text-slate-400">You can use {'{firstName}'}, {'{salon}'}, {'{service}'}, {'{link}'}, {'{offer}'} (the offer code sentence), {'{count}'} (milestones), {'{years}'} (anniversaries) and {'{tier}'} (tier moves).</span>
                </label>
              )}
            </div>
          ))}
          {errors.templates && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{errors.templates}</p>}
        </div>
      </section>

      <section className={box} aria-label="Quiet hours">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Quiet hours</h2>
        <p className={hint}>Nothing is sent between these times, by your salon&rsquo;s clock. It waits and goes out afterwards.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
          <input aria-label="Quiet hours start" type="time" value={draft.quietStart} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, quietStart: e.target.value })} className={fieldClass + ' max-w-[9rem] mt-0'} />
          <span>to</span>
          <input aria-label="Quiet hours end" type="time" value={draft.quietEnd} disabled={!mayEdit} onChange={(e) => setDraft({ ...draft, quietEnd: e.target.value })} className={fieldClass + ' max-w-[9rem] mt-0'} />
        </div>
        {(errors.quietStart || errors.quietEnd) && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">{errors.quietStart || errors.quietEnd}</p>}
      </section>

      <section className={box} aria-label="Who is messaged">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Who is messaged, and how</h2>
        <ul className={hint + ' list-disc pl-5'}>
          <li>A <strong>text</strong> goes only to a client who agreed to be texted (the &ldquo;Text me&rdquo; box when they book online, or by texting you first) and never to one who replied STOP. Every text ends with &ldquo;Reply STOP to opt out.&rdquo;</li>
          <li>Anyone else with an email address gets an <strong>email</strong> with an unsubscribe link, unless they have unsubscribed.</li>
          <li>A client is sent one rebooking, birthday, win-back, milestone, anniversary or tier message a week at most, and each thing once.</li>
          <li>Nothing from before you switched a part on is sent.</li>
        </ul>
      </section>

      {mayEdit && (
        <div className="flex flex-wrap gap-2">
          <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-white hover:bg-teal-800 disabled:opacity-50">{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Save</button>
          <button onClick={check} disabled={dirty} className="rounded-lg border border-gray-300 px-4 py-2 text-gray-900 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">Who would be messaged now?</button>
        </div>
      )}
      {preview && (
        <section className={box} aria-label="Preview">
          <p className="text-sm text-gray-900 dark:text-slate-100">{preview.wouldSend.length === 0 ? 'Nobody would be messaged right now.' : `${preview.wouldSend.length} message${preview.wouldSend.length === 1 ? '' : 's'} would go out${preview.quiet ? ' once quiet hours end' : ' on the next pass'}. Nothing was sent.`}</p>
          <ul className="mt-2 text-sm text-gray-700 dark:text-slate-300">{preview.wouldSend.map((w, i) => <li key={i}>{w.client || 'A client'} — {KIND_WORDS[w.kind] || w.kind}, by {w.via === 'sms' ? 'text' : w.via}</li>)}</ul>
        </section>
      )}

      <section className={box} aria-label="Offer codes">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Offer codes{report ? `, ${report.from} to ${report.to}` : ''}</h2>
        {!report || report.total.sent === 0 ? <p className={hint}>No offer codes have been sent in this period.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm text-gray-900 dark:text-slate-100">
              <thead><tr className="text-xs text-gray-600 dark:text-slate-400"><th className="py-1 pr-3 font-medium">Message</th><th className="px-2 font-medium">Sent</th><th className="px-2 font-medium">Used</th><th className="px-2 font-medium">Still open</th><th className="px-2 font-medium">Ran out</th><th className="px-2 text-right font-medium">Taken off</th><th className="pl-2 text-right font-medium">Sales they were on</th></tr></thead>
              <tbody>
                {[...report.kinds.filter((k) => k.sent > 0), { kind: 'all', words: 'All', ...report.total }].map((k) => (
                  <tr key={k.kind} className="border-t border-gray-100 dark:border-slate-800"><td className="py-1 pr-3">{k.words}</td><td className="px-2">{k.sent}</td><td className="px-2">{k.used}</td><td className="px-2">{k.open}</td><td className="px-2">{k.expired}</td><td className="px-2 text-right">{dollars(k.discountCents)}</td><td className="pl-2 text-right">{dollars(k.billedCents)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={hint}>A code is typed on the sale at the desk (the &ldquo;Offer code&rdquo; box beside the invoice). A message that did not go out has no code and is not counted.</p>
      </section>

      <section className={box} aria-label="What went out">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">What went out</h2>
        {log.length === 0 ? <p className={hint}>Nothing yet.</p> : (
          <ul className="mt-2 divide-y divide-gray-100 text-sm dark:divide-slate-800">
            {log.map((l) => (
              <li key={l.id} className="py-2 text-gray-900 dark:text-slate-100">
                <span className="font-medium">{l.clientName || 'A client'}</span> — {KIND_WORDS[l.kind] || l.kind}, {l.status === 'sent' ? `sent by ${l.channel === 'sms' ? 'text' : l.channel === 'drip' ? 'a follow-up sequence' : 'email'}` : l.status === 'skipped' ? 'not sent' : 'failed'}
                <span className="text-gray-600 dark:text-slate-400"> · {momentDate(l.createdAt)}</span>
                {l.reason && <span className="block text-xs text-gray-600 dark:text-slate-400">{l.reason}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
