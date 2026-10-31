// Pay rules (rows 19–21, care_payroll_rules / care_payroll_providers): the agency's state and its overtime rule, holidays, sleepovers,
// break premiums, the overnight split, facility thresholds, daily and weekly limits, travel and mileage, each caregiver's payroll id and
// pay profile, the services left out of overtime, the audit trail of classified hours, and the payroll files and provider pushes.
//   GET|PUT /api/pay-rules    PUT /api/pay-rules/caregiver/:id/worker-id|pay-profile    GET /api/pay-rules/audit    POST /api/pay-rules/mileage/compute
//   GET /api/pay-rules/export/adp|paychex|excel?startDate&endDate    PUT /api/care-types/:id { excludeFromOvertime }
//   GET /api/payroll-providers    PUT /api/payroll-providers/:p    POST /api/payroll-providers/:p/push    (server/crm/homecare/payroll/)
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useToast } from '../../../../shared'
import { api, errorMessage, downloadFile, saveBlob } from '../lib/http'
import { agencyToday } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

interface Travel { enabled: boolean; maxGapMinutes: number; capMinutes: number; rateCents: number | null; method: 'gap' | 'addresses' | 'gps'; roundToMinutes: number; fromHome: boolean; mileageFromVisits: boolean }
interface Holiday { date: string; label: string; multiplier: number }
interface Rules {
  state: string | null; overtimeRule: string; travel: Travel; holidays: Holiday[]; sleepoverCents: number; breakPremiums: boolean; splitOvernightAtMidnight: boolean
  facility: { weeklyHours: number; dailyOtAfterHours: number | null }
  limits: { dailyHours: number | null; weeklyHours: number | null; mode: 'off' | 'warn' | 'block'; capPayable: boolean }
}
interface Files {
  adpLayout: 'workforce_now' | 'homecare' | 'clicktime'
  adpCompanyCode: string | null; adpBatchName: string | null; adpDepartmentCode: string | null
  adpDoubleTimeCode: string | null; adpHolidayCode: string | null; adpTravelCode: string | null; adpMileageCode: string | null; adpBonusCode: string | null; adpOtherPayCode: string | null
  paychexClientId: string | null
  paychexComponents: Record<string, string>
  paychexOverrides: Record<string, string | null>
  paychexCheckTemplate: string | null
  gustoWorkweeks: boolean
}
interface Person { id: string; firstName: string | null; lastName: string | null; isActive: boolean; payrollWorkerId: string | null; mileageRate: number | null; isFacilityStaff: boolean }
interface StateRow { code: string; name: string; rule: string; note: string | null }
interface Reply { rules: Rules; overtimeRules: Array<{ id: string; label: string; cite: string }>; states: StateRow[]; files: Files; agencyMileageRate: number; caregivers: Person[] }
interface CareType { id: string; name: string; excludeFromOvertime?: boolean }
interface AuditRow { reviewId: string | null; kind: string; date: string; clientName: string | null; minutes: number; regularMinutes: number; overtimeMinutes: number; doubleTimeMinutes: number; unpaidMinutes: number; isHoliday: boolean; rateCents: number; reasons: string[] }
interface Audit { ruleLabel: string | null; live: AuditRow[]; limitWarnings: string[]; blendedRate: number | null; stored: Array<{ segmentDate: string; segmentKind: string; minutes: number; regularMinutes: number; overtimeMinutes: number; doubleTimeMinutes: number; unpaidMinutes: number; rateCents: number; reasons: string[] }> }
interface ProviderView { label: string; fields: Record<string, string | boolean | null>; configured: boolean; ownerStep: string }
interface Providers { providers: Record<string, ProviderView>; recentPushes: Array<{ id: string; provider: string; periodStart: string; periodEnd: string; status: string; people: number; error: string | null; createdAt: string }> }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const muted = 'text-xs text-gray-600 dark:text-slate-400'
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const h2 = (m: number) => (m / 60).toFixed(2)
const PROVIDER_FIELD_LABELS: Record<string, string> = { clientId: 'Client id', clientSecret: 'Client secret', certificatePem: 'Mutual-TLS certificate (PEM)', privateKeyPem: 'Private key (PEM)', companyId: 'Flex company id', companyUuid: 'Company uuid', accessToken: 'Access token', partnerToken: 'Partner API token', sandbox: 'Sandbox / demo', autoSubmit: 'Submit the payroll (file and pay) after it is calculated' }
const PUSH_STATUS: Record<string, string> = { accepted: 'Accepted', sent: 'Sent', failed: 'Failed', calculated: 'Calculated', submitted: 'Submitted' }

export default function PayRules() {
  const may = useMay('care-payroll')
  const { hasFeature } = useAuth()
  const toast = useToast()
  const [data, setData] = useState<Reply | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [files, setFiles] = useState<Files | null>(null)
  const [ids, setIds] = useState<Record<string, string>>({})
  const [rates, setRates] = useState<Record<string, string>>({})
  const [careTypes, setCareTypes] = useState<CareType[]>([])
  const [start, setStart] = useState(shift(agencyToday(), -13))
  const [end, setEnd] = useState(agencyToday())
  const [saving, setSaving] = useState(false)
  const [auditFor, setAuditFor] = useState('')
  const [audit, setAudit] = useState<Audit | null>(null)
  const [providers, setProviders] = useState<Providers | null>(null)
  const [providerForms, setProviderForms] = useState<Record<string, Record<string, string | boolean | null>>>({})
  const [pushing, setPushing] = useState<string | null>(null)
  const providersOn = hasFeature('care_payroll_providers')

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/pay-rules') as Reply
      setData(r); setRules(r.rules); setFiles(r.files)
      setIds(Object.fromEntries(r.caregivers.map((c) => [c.id, c.payrollWorkerId ?? ''])))
      setRates(Object.fromEntries(r.caregivers.map((c) => [c.id, c.mileageRate == null ? '' : String(c.mileageRate)])))
      const ct = await api.get('/api/care-types') as { data: CareType[] }
      setCareTypes(ct.data ?? [])
      if (providersOn) {
        const p = await api.get('/api/payroll-providers') as Providers
        setProviders(p)
        setProviderForms(Object.fromEntries(Object.entries(p.providers).map(([k, v]) => [k, { ...v.fields }])))
      }
    } catch (e) { toast.error(errorMessage(e, 'Could not load pay rules')) }
  }, [toast, providersOn])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!rules || !files) return
    setSaving(true)
    try { await api.put('/api/pay-rules', { ...rules, files }); toast.success('Saved'); load() }
    catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }
  const saveId = async (p: Person) => {
    if ((ids[p.id] ?? '') === (p.payrollWorkerId ?? '')) return
    try { await api.put(`/api/pay-rules/caregiver/${p.id}/worker-id`, { payrollWorkerId: ids[p.id] || null }); toast.success('Saved'); load() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const saveProfile = async (p: Person, patch: { mileageRate?: string | null; isFacilityStaff?: boolean }) => {
    try { await api.put(`/api/pay-rules/caregiver/${p.id}/pay-profile`, patch); toast.success('Saved'); load() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const toggleCareType = async (ct: CareType, on: boolean) => {
    try { await api.put(`/api/care-types/${ct.id}`, { excludeFromOvertime: on }); setCareTypes(careTypes.map((x) => (x.id === ct.id ? { ...x, excludeFromOvertime: on } : x))) }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const download = async (kind: 'adp' | 'paychex' | 'excel') => {
    try {
      // The file keeps the name the server gave it: ADP reads the name (EPI + company code + batch number), so it must not be changed.
      const { blob, fileName } = await downloadFile(`/api/pay-rules/export/${kind}?startDate=${start}&endDate=${end}`)
      saveBlob(blob, fileName || `payroll_${kind}_${start}_${end}.${kind === 'excel' ? 'xlsx' : 'csv'}`)
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const computeMileage = async () => {
    try {
      const r = await api.post('/api/pay-rules/mileage/compute', { startDate: start, endDate: end }) as { trips: unknown[]; skipped: number; mapService: string }
      toast.success(`${r.trips.length} trip${r.trips.length === 1 ? '' : 's'} recorded (${r.mapService === 'map' ? 'from the map service' : 'estimated from the addresses'}), ${r.skipped} skipped`)
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const loadAudit = async () => {
    if (!auditFor) return
    try { setAudit(await api.get(`/api/pay-rules/audit?caregiverId=${auditFor}&startDate=${start}&endDate=${end}`) as Audit) }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const saveProvider = async (p: string) => {
    try { await api.put(`/api/payroll-providers/${p}`, providerForms[p]); toast.success('Saved'); load() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const push = async (p: string) => {
    setPushing(p)
    try {
      const r = await api.post(`/api/payroll-providers/${p}/push`, { startDate: start, endDate: end }) as { status: string; people: number }
      toast.success(`${PUSH_STATUS[r.status] ?? r.status}: ${r.people} ${r.people === 1 ? 'person' : 'people'}`)
      load()
    } catch (e) { toast.error(errorMessage(e)) } finally { setPushing(null) }
  }

  if (!data || !rules || !files) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const setTravel = (patch: Partial<Travel>) => setRules({ ...rules, travel: { ...rules.travel, ...patch } })
  const stateRow = data.states.find((s) => s.code === rules.state)
  const ro = !may.update
  const num = (v: string) => (v === '' ? null : Number(v))

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Pay rules</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">How overtime, holidays, breaks, sleepovers, travel and mileage are paid; the payroll files; and, once connected, the pushes to your payroll provider. Every hour of every pay run carries the reason it was classified (the audit trail below). Have your payroll adviser check one real week against these rules before relying on them.</p>

      <h2 className="text-base font-semibold mb-1">Your state and its overtime rule</h2>
      <div className="flex flex-wrap gap-3 items-end">
        <label className="text-sm">State<br />
          <select className={inp} aria-label="State" value={rules.state ?? ''} disabled={ro} onChange={(e) => { const s = data.states.find((x) => x.code === e.target.value); setRules({ ...rules, state: e.target.value || null, overtimeRule: s ? s.rule : rules.overtimeRule }) }}>
            <option value="">— pick a state —</option>
            {data.states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select></label>
        <label className="text-sm">Rule<br />
          <select className={inp} aria-label="Overtime rule" value={rules.overtimeRule} disabled={ro} onChange={(e) => setRules({ ...rules, overtimeRule: e.target.value })}>
            {data.overtimeRules.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select></label>
      </div>
      <p className={`${muted} mt-1`}>{stateRow?.note ?? 'Federal: hours over 40 in the work week at 1.5×.'} <em>{data.overtimeRules.find((r) => r.id === rules.overtimeRule)?.cite}</em></p>

      <h2 className="text-base font-semibold mt-5 mb-1">Holidays</h2>
      <p className={muted}>Hours worked on a holiday carry a premium at the multiplier (1.5 = time and a half). An hour that is also overtime carries the larger of the two premiums, never both.</p>
      <table className="text-sm mt-1"><tbody>
        {rules.holidays.map((hd, i) => (
          <tr key={i}>
            <td><input type="date" className={inp} aria-label="Holiday date" value={hd.date} disabled={ro} onChange={(e) => setRules({ ...rules, holidays: rules.holidays.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} /></td>
            <td><input className={inp} aria-label="Holiday name" value={hd.label} disabled={ro} onChange={(e) => setRules({ ...rules, holidays: rules.holidays.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></td>
            <td><input type="number" step="0.25" min="1" max="3" className={`${inp} w-20`} aria-label="Holiday multiplier" value={hd.multiplier} disabled={ro} onChange={(e) => setRules({ ...rules, holidays: rules.holidays.map((x, j) => (j === i ? { ...x, multiplier: Number(e.target.value) } : x)) })} />×</td>
            <td>{!ro && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setRules({ ...rules, holidays: rules.holidays.filter((_, j) => j !== i) })}>Remove</button>}</td>
          </tr>))}
      </tbody></table>
      {!ro && <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm mt-1" onClick={() => setRules({ ...rules, holidays: [...rules.holidays, { date: agencyToday(), label: 'Holiday', multiplier: 1.5 }] })}>Add a holiday</button>}

      <h2 className="text-base font-semibold mt-5 mb-1">Breaks, sleepovers, overnight visits</h2>
      <label className="text-sm block"><input type="checkbox" checked={rules.breakPremiums} disabled={ro || !rules.overtimeRule.startsWith('california') || rules.overtimeRule === 'california_personal_attendant'} onChange={(e) => setRules({ ...rules, breakPremiums: e.target.checked })} /> Pay California meal and rest break premiums (Labor Code §512, §226.7): one hour at the regular rate for each workday a meal break was not recorded on the shift review (or waived), and one for a rest break marked missed. Personal attendants are exempt.</label>
      <label className="text-sm block mt-1">Sleepover amount (dollars, on top of the awake minutes) <input type="number" step="0.01" min="0" className={`${inp} w-28`} value={(rules.sleepoverCents / 100).toFixed(2)} disabled={ro} onChange={(e) => setRules({ ...rules, sleepoverCents: Math.round(Number(e.target.value) * 100) })} /></label>
      <label className="text-sm block mt-1"><input type="checkbox" checked={rules.splitOvernightAtMidnight} disabled={ro} onChange={(e) => setRules({ ...rules, splitOvernightAtMidnight: e.target.checked })} /> Split a visit that runs past midnight at midnight, so each part counts toward its own day</label>

      <h2 className="text-base font-semibold mt-5 mb-1">Facility staff</h2>
      <p className={muted}>A caregiver marked facility staff (below) is paid under these lines instead of the state rule (29 U.S.C. §207(j) allows a hospital or residential care establishment to pay by the day).</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <label>Overtime over (hours a week)<br /><input type="number" className={`${inp} w-24`} value={rules.facility.weeklyHours} disabled={ro} onChange={(e) => setRules({ ...rules, facility: { ...rules.facility, weeklyHours: Number(e.target.value) } })} /></label>
        <label>Overtime over (hours a day, blank for none)<br /><input type="number" className={`${inp} w-24`} value={rules.facility.dailyOtAfterHours ?? ''} disabled={ro} onChange={(e) => setRules({ ...rules, facility: { ...rules.facility, dailyOtAfterHours: num(e.target.value) } })} /></label>
      </div>

      <h2 className="text-base font-semibold mt-5 mb-1">Daily and weekly limits</h2>
      <div className="flex flex-wrap gap-3 text-sm items-end">
        <label>Limits<br /><select className={inp} value={rules.limits.mode} disabled={ro} onChange={(e) => setRules({ ...rules, limits: { ...rules.limits, mode: e.target.value as Rules['limits']['mode'] } })}><option value="off">Off</option><option value="warn">Warn on the pay run</option><option value="block">Block approval and files</option></select></label>
        <label>Hours a day<br /><input type="number" className={`${inp} w-24`} value={rules.limits.dailyHours ?? ''} disabled={ro} onChange={(e) => setRules({ ...rules, limits: { ...rules.limits, dailyHours: num(e.target.value) } })} /></label>
        <label>Hours a week<br /><input type="number" className={`${inp} w-24`} value={rules.limits.weeklyHours ?? ''} disabled={ro} onChange={(e) => setRules({ ...rules, limits: { ...rules.limits, weeklyHours: num(e.target.value) } })} /></label>
        <label><input type="checkbox" checked={rules.limits.capPayable} disabled={ro} onChange={(e) => setRules({ ...rules, limits: { ...rules.limits, capPayable: e.target.checked } })} /> Do not pay the hours over a limit</label>
      </div>

      <h2 className="text-base font-semibold mt-5 mb-1">Travel between visits</h2>
      <label className="text-sm block mb-2"><input type="checkbox" checked={rules.travel.enabled} disabled={ro} onChange={(e) => setTravel({ enabled: e.target.checked })} /> Pay travel time between two visits on the same day at different clients (a visit's own flag on the shift review overrides this either way)</label>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>Worked out from<br /><select className={inp} value={rules.travel.method} disabled={ro} onChange={(e) => setTravel({ method: e.target.value as Travel['method'] })}><option value="gap">The gap between the visits</option><option value="addresses">The clients' addresses (map estimate)</option><option value="gps">The GPS clock-out and clock-in points</option></select></label>
        <label>Only when the gap is at most (minutes)<br /><input type="number" className={`${inp} w-28`} value={rules.travel.maxGapMinutes} disabled={ro} onChange={(e) => setTravel({ maxGapMinutes: Number(e.target.value) })} /></label>
        <label>Pay at most (minutes)<br /><input type="number" className={`${inp} w-28`} value={rules.travel.capMinutes} disabled={ro} onChange={(e) => setTravel({ capMinutes: Number(e.target.value) })} /></label>
        <label>Round up to<br /><select className={inp} value={rules.travel.roundToMinutes} disabled={ro} onChange={(e) => setTravel({ roundToMinutes: Number(e.target.value) })}>{[1, 5, 10, 15, 30].map((n) => <option key={n} value={n}>{n === 1 ? 'the minute' : `${n} minutes`}</option>)}</select></label>
        <label>Travel rate (dollars an hour, blank = the caregiver's rate)<br /><input type="number" step="0.01" className={`${inp} w-28`} value={rules.travel.rateCents == null ? '' : (rules.travel.rateCents / 100).toFixed(2)} disabled={ro} onChange={(e) => setTravel({ rateCents: e.target.value === '' ? null : Math.round(Number(e.target.value) * 100) })} /></label>
      </div>
      <label className="text-sm block mt-1"><input type="checkbox" checked={rules.travel.fromHome} disabled={ro || rules.travel.method === 'gap'} onChange={(e) => setTravel({ fromHome: e.target.checked })} /> Also pay the estimated drive from the caregiver's home address to the first visit of the day</label>
      <label className="text-sm block mt-1"><input type="checkbox" checked={rules.travel.mileageFromVisits} disabled={ro} onChange={(e) => setTravel({ mileageFromVisits: e.target.checked })} /> Record the miles between completed visits' addresses as travel mileage when the pay run is made</label>
      <p className={`${muted} mt-1`}>Travel counts toward overtime and is never billed to the client. Map answers need the Maps key on the server; without it the estimate is the straight line × 1.3 at 30 mph, and each trip says which. Mileage is paid at the caregiver's own rate below, else the agency's (${data.agencyMileageRate.toFixed(2)} a mile, Payroll › Settings); travel miles and errand miles are listed apart.</p>

      <h2 className="text-base font-semibold mt-5 mb-1">Services left out of overtime</h2>
      <p className={muted}>Hours of a checked service are always regular and never count toward the day or the week.</p>
      <div className="flex flex-wrap gap-3 text-sm">{careTypes.map((ct) => <label key={ct.id}><input type="checkbox" checked={!!ct.excludeFromOvertime} disabled={ro} onChange={(e) => toggleCareType(ct, e.target.checked)} /> {ct.name}</label>)}</div>

      <h2 className="text-base font-semibold mt-5 mb-1">Payroll files</h2>
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <label>ADP layout<br /><select className={`${inp} w-full`} value={files.adpLayout} disabled={ro} onChange={(e) => setFiles({ ...files, adpLayout: e.target.value as Files['adpLayout'] })}><option value="workforce_now">Workforce Now paydata (codes for each kind of pay)</option><option value="homecare">11-column home care (HOL / MIL / EXP rows)</option><option value="clicktime">ClickTime variant (employee name, regular includes overtime)</option></select></label>
        <label>ADP company code (3 characters)<br /><input className={inp} value={files.adpCompanyCode ?? ''} disabled={ro} onChange={(e) => setFiles({ ...files, adpCompanyCode: e.target.value })} /></label>
        <label>ADP batch name (home care layout)<br /><input className={inp} value={files.adpBatchName ?? ''} disabled={ro} onChange={(e) => setFiles({ ...files, adpBatchName: e.target.value })} /></label>
        <label>ADP department code<br /><input className={inp} value={files.adpDepartmentCode ?? ''} disabled={ro} onChange={(e) => setFiles({ ...files, adpDepartmentCode: e.target.value })} /></label>
        {([['adpDoubleTimeCode', 'double time'], ['adpHolidayCode', 'holiday hours'], ['adpTravelCode', 'travel hours (own rate)'], ['adpMileageCode', 'mileage (non-taxable)'], ['adpBonusCode', 'pickup bonus'], ['adpOtherPayCode', 'other pay (premiums, sleepovers, expenses)']] as const).map(([k, label]) => (
          <label key={k}>ADP code for {label}<br /><input className={inp} value={files[k] ?? ''} disabled={ro} onChange={(e) => setFiles({ ...files, [k]: e.target.value })} /></label>))}
        <label>Paychex client id<br /><input className={inp} value={files.paychexClientId ?? ''} disabled={ro} onChange={(e) => setFiles({ ...files, paychexClientId: e.target.value })} /></label>
        {Object.keys(files.paychexComponents).map((k) => (
          <label key={k}>Paychex component: {k === 'doubleTime' ? 'double time' : k === 'otherPay' ? 'other pay' : k}<br /><input className={`${inp} w-full`} value={files.paychexComponents[k]} disabled={ro} onChange={(e) => setFiles({ ...files, paychexComponents: { ...files.paychexComponents, [k]: e.target.value } })} /></label>))}
        <label>Paychex check template (turns on the version header, columns M–Q and the [Pay] line)<br /><input className={inp} value={files.paychexCheckTemplate ?? ''} disabled={ro} onChange={(e) => setFiles({ ...files, paychexCheckTemplate: e.target.value })} /></label>
        {([['state', 'override state (M)'], ['local', 'override local (N)'], ['localJurisdiction', 'override local jurisdiction (O)'], ['laborAssignment', 'labor assignment (P)']] as const).map(([k, label]) => (
          <label key={k}>Paychex {label}<br /><input className={inp} value={files.paychexOverrides[k] ?? ''} disabled={ro} onChange={(e) => setFiles({ ...files, paychexOverrides: { ...files.paychexOverrides, [k]: e.target.value } })} /></label>))}
        <label className="sm:col-span-3"><input type="checkbox" checked={files.gustoWorkweeks} disabled={ro} onChange={(e) => setFiles({ ...files, gustoWorkweeks: e.target.checked })} /> Gusto file: a Workweeks column (each work week's dates, hours and earnings) for non-exempt caregivers</label>
      </div>
      {may.update && <button type="button" className="hc-btn hc-btn-primary hc-btn-sm mt-4" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>}

      <h2 className="text-base font-semibold mt-6 mb-1">Each caregiver</h2>
      <p className={`${muted} mb-2`}>The payroll id is the ADP file number or the Paychex worker id (max 10 characters); the files need one for everyone in them. The mileage rate is theirs alone; blank uses the agency's.</p>
      <div className="overflow-x-auto rounded-lg border mb-4 border-gray-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead><tr className="text-left"><th className="px-3 py-1.5">Caregiver</th><th className="px-3 py-1.5">Payroll id</th><th className="px-3 py-1.5">Mileage rate ($/mile)</th><th className="px-3 py-1.5">Facility staff</th></tr></thead>
          <tbody>{data.caregivers.filter((c) => c.isActive).map((c) => (
            <tr key={c.id} className="border-t border-gray-100 dark:border-slate-700">
              <td className="px-3 py-1.5 font-semibold">{c.firstName} {c.lastName}</td>
              <td><input className={inp} aria-label={`Payroll id for ${c.firstName} ${c.lastName}`} value={ids[c.id] ?? ''} disabled={ro} onChange={(e) => setIds({ ...ids, [c.id]: e.target.value })} onBlur={() => saveId(c)} /></td>
              <td><input className={`${inp} w-24`} aria-label={`Mileage rate for ${c.firstName} ${c.lastName}`} value={rates[c.id] ?? ''} disabled={ro} onChange={(e) => setRates({ ...rates, [c.id]: e.target.value })} onBlur={() => { if ((rates[c.id] ?? '') !== (c.mileageRate == null ? '' : String(c.mileageRate))) saveProfile(c, { mileageRate: rates[c.id] || null }) }} /></td>
              <td><input type="checkbox" aria-label={`Facility staff: ${c.firstName} ${c.lastName}`} checked={c.isFacilityStaff} disabled={ro} onChange={(e) => saveProfile(c, { isFacilityStaff: e.target.checked })} /></td>
            </tr>))}</tbody>
        </table>
      </div>

      <h2 className="text-base font-semibold mb-1">Pay period</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">From<br /><input type="date" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm">To<br /><input type="date" className={inp} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        {may.update && (<>
          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => download('adp')}>ADP file</button>
          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => download('paychex')}>Paychex file</button>
          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => download('excel')}>Detailed Excel</button>
          <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={computeMileage}>Record mileage between visits</button>
        </>)}
      </div>
      <p className={`${muted} mt-1`}>The hours files carry hours, and the amounts under the codes above; ADP and Paychex apply the pay rates they have. Try one real import with your provider before relying on a file.</p>

      <h2 className="text-base font-semibold mt-6 mb-1">How each hour was classified</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">Caregiver<br /><select className={inp} value={auditFor} onChange={(e) => setAuditFor(e.target.value)}><option value="">— pick —</option>{data.caregivers.filter((c) => c.isActive).map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}</select></label>
        <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" disabled={!auditFor} onClick={loadAudit}>Show</button>
      </div>
      {audit && (
        <div className="mt-2 text-sm">
          <p className={muted}>{audit.ruleLabel ?? 'Federal'}{audit.blendedRate != null ? ` · blended regular rate $${audit.blendedRate.toFixed(2)}` : ''}{audit.stored.length ? ` · stored when the period was approved (${audit.stored.length} rows)` : ' · not yet approved: the live classification'}</p>
          {audit.limitWarnings.map((w) => <p key={w} className="text-amber-700 dark:text-amber-300">{w}</p>)}
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 mt-1">
            <table className="w-full text-xs">
              <thead><tr className="text-left"><th className="px-2 py-1">Date</th><th className="px-2 py-1">What</th><th className="px-2 py-1">Hours</th><th className="px-2 py-1">Regular</th><th className="px-2 py-1">Overtime</th><th className="px-2 py-1">Double</th><th className="px-2 py-1">Unpaid</th><th className="px-2 py-1">Rate</th><th className="px-2 py-1">Why</th></tr></thead>
              <tbody>{audit.live.map((r, i) => (
                <tr key={i} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="px-2 py-1">{r.date}</td><td className="px-2 py-1">{r.kind === 'travel' ? 'Travel' : `Visit${r.clientName ? ` — ${r.clientName}` : ''}`}{r.isHoliday ? ' (holiday)' : ''}</td>
                  <td className="px-2 py-1">{h2(r.minutes)}</td><td className="px-2 py-1">{h2(r.regularMinutes)}</td><td className="px-2 py-1">{h2(r.overtimeMinutes)}</td><td className="px-2 py-1">{h2(r.doubleTimeMinutes)}</td><td className="px-2 py-1">{h2(r.unpaidMinutes)}</td>
                  <td className="px-2 py-1">${(r.rateCents / 100).toFixed(2)}</td><td className="px-2 py-1">{r.reasons.join('; ')}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </div>
      )}

      {providersOn && providers && (
        <>
          <h2 className="text-base font-semibold mt-6 mb-1">Payroll providers</h2>
          <p className={muted}>Push the pay period above straight to your provider. Each needs the account step its note describes before anything is sent; until then the push answers with that step and nothing leaves.</p>
          <div className="grid md:grid-cols-2 gap-3 mt-2">
            {Object.entries(providers.providers).map(([p, v]) => (
              <div key={p} className="rounded-lg border p-3 text-sm border-gray-200 dark:border-slate-700">
                <div className="flex items-center justify-between"><strong>{v.label}</strong><span className={`text-xs ${v.configured ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-slate-400'}`}>{v.configured ? 'Connected' : 'Not connected'}</span></div>
                <p className={`${muted} my-1`}>{v.ownerStep}</p>
                {Object.entries(v.fields).map(([k, val]) => typeof val === 'boolean' || k === 'sandbox' || k === 'autoSubmit' ? (
                  <label key={k} className="block"><input type="checkbox" checked={providerForms[p]?.[k] === true} disabled={ro} onChange={(e) => setProviderForms({ ...providerForms, [p]: { ...providerForms[p], [k]: e.target.checked } })} /> {PROVIDER_FIELD_LABELS[k] ?? k}</label>
                ) : (
                  <label key={k} className="block mt-1">{PROVIDER_FIELD_LABELS[k] ?? k}<br />{k.endsWith('Pem') ? <textarea className={`${inp} w-full`} rows={2} value={String(providerForms[p]?.[k] ?? '')} disabled={ro} onChange={(e) => setProviderForms({ ...providerForms, [p]: { ...providerForms[p], [k]: e.target.value } })} /> : <input className={`${inp} w-full`} type={k.toLowerCase().includes('secret') || k.toLowerCase().includes('token') ? 'password' : 'text'} value={String(providerForms[p]?.[k] ?? '')} disabled={ro} onChange={(e) => setProviderForms({ ...providerForms, [p]: { ...providerForms[p], [k]: e.target.value } })} />}</label>
                ))}
                {may.update && <div className="flex gap-2 mt-2">
                  <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => saveProvider(p)}>Save</button>
                  <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={pushing === p} onClick={() => push(p)}>{pushing === p ? 'Sending…' : `Send ${start} to ${end}`}</button>
                </div>}
              </div>))}
          </div>
          {providers.recentPushes.length > 0 && (
            <table className="w-full text-xs mt-3"><thead><tr className="text-left"><th className="px-2 py-1">When</th><th className="px-2 py-1">Provider</th><th className="px-2 py-1">Period</th><th className="px-2 py-1">People</th><th className="px-2 py-1">Result</th></tr></thead>
              <tbody>{providers.recentPushes.map((r) => <tr key={r.id} className="border-t border-gray-100 dark:border-slate-700"><td className="px-2 py-1">{new Date(r.createdAt).toLocaleString()}</td><td className="px-2 py-1">{providers.providers[r.provider]?.label ?? r.provider}</td><td className="px-2 py-1">{r.periodStart} to {r.periodEnd}</td><td className="px-2 py-1">{r.people}</td><td className="px-2 py-1">{PUSH_STATUS[r.status] ?? r.status}{r.error ? ` — ${r.error}` : ''}</td></tr>)}</tbody></table>
          )}
        </>
      )}
    </div>
  )
}
