// Pay rules (item 2, care_payroll_rules): the overtime rule the agency's state requires, paid travel between visits, each
// caregiver's payroll id, and the hours files for ADP and Paychex.
//   GET|PUT /api/pay-rules    PUT /api/pay-rules/caregiver/:id/worker-id    GET /api/pay-rules/export/adp|paychex?startDate&endDate
//   (server/crm/homecare/payroll/payRulesRoutes.ts)
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, errorMessage, downloadFile, saveBlob } from '../lib/http'
import { agencyToday } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

interface Rules { overtimeRule: string; travel: { enabled: boolean; maxGapMinutes: number; capMinutes: number } }
interface Files { adpCompanyCode: string | null; adpDoubleTimeCode: string | null; paychexClientId: string | null; paychexComponents: { regular: string; overtime: string; doubleTime: string } }
interface Person { id: string; firstName: string | null; lastName: string | null; isActive: boolean; payrollWorkerId: string | null }
interface Reply { rules: Rules; overtimeRules: Array<{ id: string; label: string }>; files: Files; caregivers: Person[] }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

export default function PayRules() {
  const may = useMay('care-payroll')
  const toast = useToast()
  const [data, setData] = useState<Reply | null>(null)
  const [rules, setRules] = useState<Rules | null>(null)
  const [files, setFiles] = useState<Files | null>(null)
  const [ids, setIds] = useState<Record<string, string>>({})
  const [start, setStart] = useState(shift(agencyToday(), -13))
  const [end, setEnd] = useState(agencyToday())
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/pay-rules') as Reply
      setData(r); setRules(r.rules); setFiles(r.files)
      setIds(Object.fromEntries(r.caregivers.map((c) => [c.id, c.payrollWorkerId ?? ''])))
    } catch (e) { toast.error(errorMessage(e, 'Could not load pay rules')) }
  }, [toast])
  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!rules || !files) return
    setSaving(true)
    try { await api.put('/api/pay-rules', { overtimeRule: rules.overtimeRule, travel: rules.travel, files }); toast.success('Saved'); load() }
    catch (e) { toast.error(errorMessage(e)) } finally { setSaving(false) }
  }
  const saveId = async (p: Person) => {
    if ((ids[p.id] ?? '') === (p.payrollWorkerId ?? '')) return
    try { await api.put(`/api/pay-rules/caregiver/${p.id}/worker-id`, { payrollWorkerId: ids[p.id] || null }); toast.success('Saved'); load() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const download = async (kind: 'adp' | 'paychex') => {
    try {
      // The file keeps the name the server gave it: ADP reads the name (EPI + company code + batch number), so it must not be changed.
      const { blob, fileName } = await downloadFile(`/api/pay-rules/export/${kind}?startDate=${start}&endDate=${end}`)
      saveBlob(blob, fileName || (kind === 'adp' ? `EPI-${end}.csv` : `paychex_hours_${start}_${end}.csv`))
    } catch (e) { toast.error(errorMessage(e)) }
  }

  if (!data || !rules || !files) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const set = (patch: Partial<Rules['travel']>) => setRules({ ...rules, travel: { ...rules.travel, ...patch } })

  return (
    <div className="p-4 max-w-4xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Pay rules</h1>
      <p className="text-sm mb-4 text-gray-600 dark:text-slate-400">How overtime and travel are paid, and the hours files for ADP and Paychex. Check your state&apos;s rule with your payroll provider; the choices here do not cover every rule (holiday pay, meal and rest break pay, a blended rate for weeks with more than one pay rate).</p>

      <h2 className="text-base font-semibold mb-1">Overtime</h2>
      <select className={inp} aria-label="Overtime rule" value={rules.overtimeRule} disabled={!may.update} onChange={(e) => setRules({ ...rules, overtimeRule: e.target.value })}>
        {data.overtimeRules.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>

      <h2 className="text-base font-semibold mt-5 mb-1">Travel between visits</h2>
      <label className="text-sm block mb-2"><input type="checkbox" checked={rules.travel.enabled} disabled={!may.update} onChange={(e) => set({ enabled: e.target.checked })} /> Pay travel time between two visits on the same day at different clients</label>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>Only when the gap is at most (minutes)<br /><input type="number" className={`${inp} w-28`} value={rules.travel.maxGapMinutes} disabled={!may.update} onChange={(e) => set({ maxGapMinutes: Number(e.target.value) })} /></label>
        <label>Pay at most (minutes)<br /><input type="number" className={`${inp} w-28`} value={rules.travel.capMinutes} disabled={!may.update} onChange={(e) => set({ capMinutes: Number(e.target.value) })} /></label>
      </div>
      <p className="text-xs mt-1 text-gray-600 dark:text-slate-400">Travel is paid at the caregiver&apos;s rate and counts toward overtime. It is worked out from punch times, or scheduled times if there are no punches. It is never billed to the client.</p>

      <h2 className="text-base font-semibold mt-5 mb-1">ADP and Paychex</h2>
      <div className="grid sm:grid-cols-2 gap-3 text-sm">
        <label>ADP company code (3 characters)<br /><input className={inp} value={files.adpCompanyCode ?? ''} disabled={!may.update} onChange={(e) => setFiles({ ...files, adpCompanyCode: e.target.value })} /></label>
        <label>ADP earnings code for double time<br /><input className={inp} value={files.adpDoubleTimeCode ?? ''} disabled={!may.update} onChange={(e) => setFiles({ ...files, adpDoubleTimeCode: e.target.value })} /></label>
        <label>Paychex client id<br /><input className={inp} value={files.paychexClientId ?? ''} disabled={!may.update} onChange={(e) => setFiles({ ...files, paychexClientId: e.target.value })} /></label>
        <div className="flex gap-2">
          {(['regular', 'overtime', 'doubleTime'] as const).map((k) => (
            <label key={k}>Paychex &ldquo;{k === 'doubleTime' ? 'double time' : k}&rdquo;<br /><input className={`${inp} w-full`} value={files.paychexComponents[k]} disabled={!may.update} onChange={(e) => setFiles({ ...files, paychexComponents: { ...files.paychexComponents, [k]: e.target.value } })} /></label>
          ))}
        </div>
      </div>
      {may.update && <button type="button" className="hc-btn hc-btn-primary hc-btn-sm mt-4" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>}

      <h2 className="text-base font-semibold mt-6 mb-1">Each caregiver&apos;s payroll id</h2>
      <p className="text-xs mb-2 text-gray-600 dark:text-slate-400">The ADP file number or the Paychex worker id. Max 10 characters. The files need one for everyone in them.</p>
      <div className="overflow-x-auto rounded-lg border mb-4 border-gray-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <tbody>{data.caregivers.filter((c) => c.isActive).map((c) => (
            <tr key={c.id} className="border-t first:border-t-0 border-gray-100 dark:border-slate-700">
              <td className="px-3 py-1.5 font-semibold">{c.firstName} {c.lastName}</td>
              <td><input className={inp} aria-label={`Payroll id for ${c.firstName} ${c.lastName}`} value={ids[c.id] ?? ''} disabled={!may.update} onChange={(e) => setIds({ ...ids, [c.id]: e.target.value })} onBlur={() => saveId(c)} /></td>
            </tr>))}</tbody>
        </table>
      </div>

      {may.update && (
        <>
          <h2 className="text-base font-semibold mb-1">Download hours</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">From<br /><input type="date" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
            <label className="text-sm">To<br /><input type="date" className={inp} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => download('adp')}>ADP file</button>
            <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => download('paychex')}>Paychex file</button>
          </div>
          <p className="text-xs mt-1 text-gray-600 dark:text-slate-400">The files carry hours; ADP and Paychex apply the pay rates they have. Mileage is not in them. Try one real import with your provider before relying on a file.</p>
        </>
      )}
    </div>
  )
}
