import { useCallback, useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { api } from '../../../api';
import FormError, { errorText } from '../../ui/FormError';
import { useMayWrite } from '../../../shared';
import { companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock';
import { BTN, ON, OFF, CARD, LABEL, INPUT, MUTED, money } from './registerUi';

/**
 * PAYROLL EXPORT (feature bar_payroll_export; server: crm/bar/barPayroll.ts, barPayrollMath.ts, barPayrollRoutes.ts). A pay period's
 * hours, overtime and tips for each person, as a file for Gusto, ADP or a spreadsheet. Nothing is sent: the file is a download,
 * and the person uploads it in Gusto or ADP. A manager's (bar:manage).
 */
interface Person { userId: string; name: string; regularHours: number; overtimeHours: number; totalHours: number; tipsTotalCents: number; cashInHandCents: number; paycheckTipsCents: number; tipOutPaidCents: number; tipOutReceivedCents: number; poolShareCents: number; adpFileNumber: string | null }
interface Settings { overtimeAfterHours: number; adp: { companyCode: string; batchId: string; tipEarningsCode: string }; adpFileNumbers: Record<string, string> }
interface Period { from: string; to: string; settings: Settings; rule: { overtimeAfterHours: number; workWeekStartName: string; text: string }; people: Person[]; warnings: string[]; totals: { regularHours: number; overtimeHours: number; tipsTotalCents: number; cashInHandCents: number; paycheckTipsCents: number }; adp: { ready: boolean; missing: string[] } }

const shiftDay = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const TH = 'text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 py-2 pr-3';
const TD = 'py-2 pr-3 text-sm text-gray-900 dark:text-slate-100';
const hours = (n: number) => n.toFixed(2);
const FORMATS = [['gusto', 'Gusto'], ['adp', 'ADP'], ['csv', 'Spreadsheet']] as const;

export default function PayrollPage() {
  const may = useMayWrite('bar:manage');
  const today = companyTodayKey();
  const [from, setFrom] = useState(shiftDay(today, -13));
  const [to, setTo] = useState(today);
  const [p, setP] = useState<Period | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const load = useCallback(() => {
    setErr('');
    return api.get(`/api/bar-payroll?from=${from}&to=${to}`).then((x: Period) => setP(x)).catch((e: unknown) => { setP(null); setErr(errorText(e, 'Could not read the pay period.')); });
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const download = async (format: string) => {
    setBusy(format); setErr(''); setNote('');
    try {
      const res: Response = await api.raw(`/api/bar-payroll/file?from=${from}&to=${to}&format=${format}`);
      if (!res.ok) { let m = 'The file could not be made.'; try { m = (await res.json()).error || m; } catch { /* keep the sentence */ } throw new Error(m); }
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || `pay-period-${from}-to-${to}.csv`;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setNote(`${name} is in your downloads.`);
    } catch (e) { setErr(errorText(e, 'The file could not be made.')); } finally { setBusy(''); }
  };

  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Payroll</h1>
      <p className={`text-sm ${MUTED}`}>Hours from the time clock and tips from the nights you closed, for each person, as a file to upload in Gusto or ADP, or open in a spreadsheet. Nothing is sent from here.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="First day of the pay period" type="date" className={`${INPUT} max-w-[11rem]`} value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
        <span className={MUTED}>to</span>
        <input aria-label="Last day of the pay period" type="date" className={`${INPUT} max-w-[11rem]`} value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
      </div>
      <FormError message={err} />
      {note && <p role="status" className="text-sm text-green-800 dark:text-green-300">{note}</p>}
      {!p ? (err ? null : <Loader2 className="w-5 h-5 animate-spin text-gray-500" />) : (
        <>
          <div className={`${CARD} space-y-1`}>
            <p className={LABEL}>The overtime rule used</p>
            <p className="text-sm text-gray-900 dark:text-slate-100">{p.rule.text}</p>
          </div>
          {p.warnings.length > 0 && (
            <div className={`${CARD} space-y-1`} role="region" aria-label="Check before you pay">
              <p className={LABEL}>Check before you pay</p>
              {p.warnings.map((w) => <p key={w} className="text-sm text-gray-900 dark:text-slate-100">{w}</p>)}
            </div>
          )}
          <div className={CARD}>
            <p className={`${LABEL} mb-2`}>{hours(p.totals.regularHours)} regular hours · {hours(p.totals.overtimeHours)} overtime hours · {money(p.totals.tipsTotalCents)} in tips, {money(p.totals.cashInHandCents)} of it already received in cash, {money(p.totals.paycheckTipsCents)} to pay on paychecks</p>
            {p.people.length === 0 ? <p className={`text-sm ${MUTED}`}>Nobody has hours or tips in this pay period.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem]">
                  <thead><tr><th className={TH}>Who</th><th className={TH}>Regular</th><th className={TH}>Overtime</th><th className={TH}>Total tips</th><th className={TH}>Cash already received</th><th className={TH}>Tips on paycheck</th><th className={TH}>Tipped out</th><th className={TH}>Got tip-out</th><th className={TH}>Pool share</th></tr></thead>
                  <tbody>
                    {p.people.map((x) => (
                      <tr key={x.userId} className="border-t border-gray-100 dark:border-slate-800">
                        <td className={TD}>{x.name}</td><td className={TD}>{hours(x.regularHours)}</td><td className={TD}>{hours(x.overtimeHours)}</td>
                        <td className={`${TD} font-mono`}>{money(x.tipsTotalCents)}</td><td className={`${TD} font-mono`}>{x.cashInHandCents ? money(x.cashInHandCents) : '—'}</td>
                        <td className={`${TD} font-mono font-bold`}>{x.paycheckTipsCents < 0 ? `−${money(-x.paycheckTipsCents)}` : money(x.paycheckTipsCents)}</td>
                        <td className={`${TD} font-mono`}>{x.tipOutPaidCents ? `−${money(x.tipOutPaidCents)}` : '—'}</td><td className={`${TD} font-mono`}>{x.tipOutReceivedCents ? money(x.tipOutReceivedCents) : '—'}</td><td className={`${TD} font-mono`}>{x.poolShareCents ? money(x.poolShareCents) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className={`text-xs mt-3 ${MUTED}`}>Each person&rsquo;s tips are counted once. Cash tips rung on the register and cash tips they declared are shown as already received and are taken off what is left to pay.</p>
          </div>
          <div className={`${CARD} space-y-3`}>
            <p className={LABEL}>Download</p>
            <div className="flex flex-wrap gap-2">
              {FORMATS.map(([k, l]) => <button key={k} type="button" className={`${BTN} ${OFF} inline-flex items-center gap-2`} disabled={!!busy || p.people.length === 0} onClick={() => download(k)}>{busy === k ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{l}</button>)}
            </div>
            {!p.adp.ready && <p className={`text-sm ${MUTED}`}>ADP&rsquo;s file needs {p.adp.missing.join(' and ')}. Add {p.adp.missing.length === 1 ? 'it' : 'them'} below.</p>}
            <p className={`text-xs ${MUTED}`}>Gusto and ADP read these files by their column names. The columns follow what each company publishes, but the first file should be tried in Gusto or ADP before you rely on it.</p>
          </div>
          <SettingsCard may={may} settings={p.settings} people={p.people} onSaved={load} />
        </>
      )}
    </div>
  );
}

function SettingsCard({ may, settings, people, onSaved }: { may: boolean; settings: Settings; people: Person[]; onSaved: () => void }) {
  const [ot, setOt] = useState(String(settings.overtimeAfterHours));
  const [adp, setAdp] = useState(settings.adp);
  const [files, setFiles] = useState<Record<string, string>>(settings.adpFileNumbers);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(''); setSaved(false);
    try {
      await api.put('/api/bar-payroll/settings', { overtimeAfterHours: ot, adp, adpFileNumbers: Object.fromEntries(people.map((x) => [x.userId, files[x.userId] || ''])) });
      setSaved(true); onSaved();
    } catch (e) { setErr(errorText(e, 'The settings did not save.')); } finally { setBusy(false); }
  };
  return (
    <div className={`${CARD} space-y-3`}>
      <p className={LABEL}>Settings</p>
      <div>
        <label className={LABEL} htmlFor="otafter">Overtime starts after (hours in a work week)</label>
        <input id="otafter" inputMode="decimal" className={`${INPUT} max-w-[8rem]`} disabled={!may} value={ot} onChange={(e) => setOt(e.target.value)} />
        <p className={`text-xs mt-1 ${MUTED}`}>40 is the federal rule. The work week starts on the day set for the business.</p>
      </div>
      <p className={`${LABEL} pt-2`}>ADP</p>
      <p className={`text-sm ${MUTED}`}>ADP&rsquo;s import needs your company code, a batch number and each person&rsquo;s file number from ADP. Tips go in under an earnings code that already exists in ADP; ask ADP which code your tips use.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div><label className={LABEL} htmlFor="adpco">Company code</label><input id="adpco" className={INPUT} disabled={!may} value={adp.companyCode} onChange={(e) => setAdp({ ...adp, companyCode: e.target.value })} /></div>
        <div><label className={LABEL} htmlFor="adpbatch">Batch ID</label><input id="adpbatch" className={INPUT} disabled={!may} value={adp.batchId} onChange={(e) => setAdp({ ...adp, batchId: e.target.value })} /></div>
        <div><label className={LABEL} htmlFor="adptip">Tip earnings code</label><input id="adptip" className={INPUT} disabled={!may} value={adp.tipEarningsCode} onChange={(e) => setAdp({ ...adp, tipEarningsCode: e.target.value })} /></div>
      </div>
      {people.length > 0 && (
        <div className="space-y-2">
          <p className={LABEL}>File numbers in ADP</p>
          {people.map((x, i) => (
            <div key={x.userId} className="flex flex-wrap items-end gap-2">
              <p className="min-w-[10rem] py-2 text-sm text-gray-900 dark:text-slate-100">{x.name}</p>
              <div><label className="sr-only" htmlFor={`adpf${i}`}>File number for {x.name}</label><input id={`adpf${i}`} className={`${INPUT} max-w-[10rem]`} disabled={!may} value={files[x.userId] || ''} onChange={(e) => setFiles({ ...files, [x.userId]: e.target.value })} /></div>
            </div>
          ))}
        </div>
      )}
      <FormError message={err} />
      {saved && <p role="status" className="text-sm text-green-800 dark:text-green-300">Saved.</p>}
      {may && <button type="button" className={`${BTN} ${ON}`} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>}
    </div>
  );
}
