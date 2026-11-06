// Every home care report as a file (rows 11 and 12): the same CSV or PDF whether the office downloads it now (marginReports.ts,
// reportBuilder.ts routes) or a scheduled report email delivers it (core/reportSchedules.ts). Pure over the report's reply.
import { toCSV, tablePdf, centsNumber, centsText, slug, type Col } from './reportFiles.ts'

export interface ReportFile { body: Buffer; contentType: string; fileName: string }
export type Format = 'csv' | 'pdf'
const pctText = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v}%`)
const csvFile = (name: string, text: string): ReportFile => ({ body: Buffer.from(text, 'utf8'), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv` })
const pdfFile = (name: string, buf: Buffer): ReportFile => ({ body: buf, contentType: 'application/pdf', fileName: `${name}.pdf` })
export const fileBase = (agency: string, kind: string, start: string, end: string) => `${slug(agency)}-${kind}-${start}-to-${end}`

export async function renderClientMargin(report: any, agency: string, format: Format): Promise<ReportFile> {
  const { start, end } = report.period
  const name = fileBase(agency, 'client-margin', start, end)
  if (format === 'csv') {
    const rows = report.clients.map((x: any) => ({
      client: x.clientName, branch: x.branchName ?? '', department: x.department ?? '', referralSource: x.referralSourceName ?? '', payer: x.payerName ?? '',
      hoursWorked: x.hours, hoursInvoiced: x.hoursInvoiced, overtimeHours: x.overtimeHours, billRate: x.rate ?? '',
      billed: centsNumber(x.billedCents), caregiverPay: x.pay.toFixed(2), mileage: x.mileage.toFixed(2), cost: centsNumber(x.costCents), margin: centsNumber(x.marginCents), marginPercent: x.marginPercent ?? '',
    }))
    return csvFile(name, toCSV(rows, [
      { key: 'client', label: 'Client' }, { key: 'branch', label: 'Branch' }, { key: 'department', label: 'Department' }, { key: 'referralSource', label: 'Referral source' }, { key: 'payer', label: 'Payer' },
      { key: 'hoursWorked', label: 'Hours worked' }, { key: 'hoursInvoiced', label: 'Hours invoiced' }, { key: 'overtimeHours', label: 'Overtime hours' }, { key: 'billRate', label: 'Bill rate' },
      { key: 'billed', label: 'Billed' }, { key: 'caregiverPay', label: 'Caregiver pay' }, { key: 'mileage', label: 'Mileage' }, { key: 'cost', label: 'Cost' }, { key: 'margin', label: 'Margin' }, { key: 'marginPercent', label: 'Margin %' },
    ]))
  }
  const t = report.totals
  return pdfFile(name, await tablePdf({
    agency, title: 'Client margin', period: `${start} to ${end}`,
    summary: [`Billed ${centsText(t.billedCents)} · caregiver cost ${centsText(t.costCents)} · margin ${centsText(t.marginCents)} (${pctText(t.marginPercent)}) over ${t.hours} hours worked, ${t.hoursInvoiced} invoiced`,
      ...(t.clientsWithoutRate ? [`${t.clientsWithoutRate} client(s) have no bill rate, so no margin is shown for them.`] : [])],
    columns: [{ key: 'client', label: 'Client', width: 110 }, { key: 'branch', label: 'Branch', width: 60 }, { key: 'payer', label: 'Payer', width: 70 }, { key: 'hoursWorked', label: 'Worked', width: 42 }, { key: 'hoursInvoiced', label: 'Invoiced', width: 44 },
      { key: 'billedText', label: 'Billed', width: 60 }, { key: 'costText', label: 'Cost', width: 60 }, { key: 'marginText', label: 'Margin', width: 60 }, { key: 'marginPercent', label: '%' }],
    rows: report.clients.map((x: any) => ({ client: x.clientName, branch: x.branchName, payer: x.payerName, hoursWorked: x.hours, hoursInvoiced: x.hoursInvoiced, billedText: centsText(x.billedCents), costText: centsText(x.costCents), marginText: centsText(x.marginCents), marginPercent: pctText(x.marginPercent) })),
    footnote: 'Pay is the same figure payroll uses (overtime goes on the visits that went past 40 hours in a week). Paid travel time and double time are included when Pay rules are on.',
  }))
}

export async function renderVisitMargin(report: any, agency: string, format: Format): Promise<ReportFile> {
  const { start, end } = report.period
  const name = fileBase(agency, 'visit-margin', start, end)
  if (format === 'csv') {
    const rows = report.visits.map((v: any) => ({ date: v.date, client: v.clientName, caregiver: v.caregiverName, hours: v.hours, overtimeHours: v.overtimeHours, billed: centsNumber(v.billedCents), pay: centsNumber(v.payCents), margin: centsNumber(v.marginCents), marginPercent: v.marginPercent ?? '' }))
    return csvFile(name, toCSV(rows, [{ key: 'date', label: 'Date' }, { key: 'client', label: 'Client' }, { key: 'caregiver', label: 'Caregiver' }, { key: 'hours', label: 'Hours' }, { key: 'overtimeHours', label: 'Overtime hours' }, { key: 'billed', label: 'Billed' }, { key: 'pay', label: 'Caregiver pay' }, { key: 'margin', label: 'Margin' }, { key: 'marginPercent', label: 'Margin %' }]))
  }
  const t = report.totals
  return pdfFile(name, await tablePdf({
    agency, title: 'Margin per visit', period: `${start} to ${end}`,
    summary: [`${t.visits} visits, ${t.hours} hours · billed ${centsText(t.billedCents)} · pay ${centsText(t.payCents)} · margin ${centsText(t.marginCents)}`],
    columns: [{ key: 'date', label: 'Date', width: 62 }, { key: 'client', label: 'Client', width: 120 }, { key: 'caregiver', label: 'Caregiver', width: 120 }, { key: 'hours', label: 'Hours', width: 40 }, { key: 'billedText', label: 'Billed' }, { key: 'payText', label: 'Pay' }, { key: 'marginText', label: 'Margin' }],
    rows: report.visits.map((v: any) => ({ date: v.date, client: v.clientName, caregiver: v.caregiverName, hours: v.hours, billedText: centsText(v.billedCents), payText: centsText(v.payCents), marginText: centsText(v.marginCents) })),
  }))
}

export async function renderTurnover(report: any, agency: string, format: Format): Promise<ReportFile> {
  const { start, end } = report.period
  const name = fileBase(agency, 'caregiver-turnover', start, end)
  const h = report.hiring, p = report.payrollAccuracy
  const summary = [
    `Caregivers at start ${report.headcountStart}, at end ${report.headcountEnd} · hired ${report.hires} · left ${report.departures} · turnover ${pctText(report.turnoverPercent)} · retention ${pctText(report.retentionPercent)}`,
    `Kept 90 days: ${report.hiresKept90Days} of ${report.hiresWith90Days} (${pctText(report.ninetyDayRetentionPercent)}) · average stay of those who left: ${report.averageTenureDaysOfDeparted ?? '—'} days`,
    `Applicants ${h.applicants}, hired ${h.applicantsHired} (${h.applicantToHireRatio === null ? '—' : `${h.applicantToHireRatio} to 1`}) · hire to first shift ${h.hireToFirstShiftDays ?? '—'} days · cost per hire ${centsText(h.costPerHireCents)}`,
    `Payroll accuracy ${pctText(p.accuracyPercent)}: ${p.reviewed} shifts reviewed, ${p.corrected} corrected, ${p.disputed} pay period(s) disputed`,
  ]
  if (format === 'csv') {
    const rows = [
      ...report.departed.map((x: any) => ({ section: 'Left', name: x.name, hired: x.hired, leftOn: x.leftOn, exact: x.exact ? 'yes' : 'last visit', reason: x.leftReason ?? '', tenureDays: x.tenureDays, branch: x.branchName ?? '', team: x.team ?? '', manager: x.managerName ?? '', absences: '', cancelledVisits: '', missedVisits: '' })),
      ...report.reliability.map((x: any) => ({ section: 'Reliability', name: x.name, hired: '', leftOn: '', exact: '', reason: '', tenureDays: '', branch: '', team: '', manager: '', absences: x.absences, cancelledVisits: x.cancelledVisits, missedVisits: x.missedVisits })),
    ]
    const head = summary.map((s) => `# ${s}`).join('\n') + '\n'
    return csvFile(name, head + toCSV(rows, [{ key: 'section', label: 'Section' }, { key: 'name', label: 'Caregiver' }, { key: 'hired', label: 'Hired' }, { key: 'leftOn', label: 'Left on' }, { key: 'exact', label: 'Leaving date from' }, { key: 'reason', label: 'Reason' }, { key: 'tenureDays', label: 'Stayed (days)' }, { key: 'branch', label: 'Branch' }, { key: 'team', label: 'Team' }, { key: 'manager', label: 'Manager' }, { key: 'absences', label: 'Call-outs' }, { key: 'cancelledVisits', label: 'Visits cancelled' }, { key: 'missedVisits', label: 'Visits missed' }]))
  }
  return pdfFile(name, await tablePdf({
    agency, title: 'Caregiver turnover', period: `${start} to ${end}`, summary,
    columns: [{ key: 'name', label: 'Left', width: 130 }, { key: 'hired', label: 'Hired', width: 64 }, { key: 'leftOn', label: 'Left on', width: 64 }, { key: 'from', label: 'Date from', width: 60 }, { key: 'reason', label: 'Reason' }, { key: 'tenureDays', label: 'Days', width: 40 }],
    rows: report.departed.map((x: any) => ({ name: x.name, hired: x.hired, leftOn: x.leftOn, from: x.exact ? 'stored' : 'last visit', reason: x.leftReason, tenureDays: x.tenureDays })),
    footnote: report.reliability.length ? 'Call-outs and missed visits: ' + report.reliability.map((x: any) => `${x.name} ${x.absences + x.cancelledVisits} call-out(s), ${x.missedVisits} missed`).join('; ') : undefined,
  }))
}

/** A cell of a built report as the file prints it: cents as dollars, yes/no, a dash for nothing. */
const cell = (v: unknown, type: string, forCsv: boolean) => {
  if (v === null || v === undefined || v === '') return forCsv ? '' : '—'
  if (type === 'cents') return forCsv ? centsNumber(Number(v)) : centsText(Number(v))
  if (type === 'bool') return v ? 'yes' : 'no'
  return String(v)
}
export async function renderSavedReport(run: any, reportName: string, agency: string, format: Format): Promise<ReportFile> {
  const { start, end } = run.period
  const name = fileBase(agency, slug(reportName), start, end)
  const cols: (Col & { type: string })[] = run.columns.map((c: any) => ({ key: c.key, label: c.label, type: c.type }))
  const rows = run.rows.map((r: any) => Object.fromEntries(cols.map((c) => [c.key, cell(r[c.key], c.type, format === 'csv')])))
  if (format === 'csv') return csvFile(name, toCSV(rows, cols))
  const summary = [`${run.count} visit(s)`, ...(run.groups ? run.groups.map((g: any) => `${g.label}: ${g.rows} visit(s)`) : [])]
  return pdfFile(name, await tablePdf({ agency, title: reportName, period: `${start} to ${end}`, summary, columns: cols.map((c) => ({ key: c.key, label: c.label })), rows }))
}

export async function renderDailyManager(report: any, agency: string, format: Format): Promise<ReportFile> {
  const name = fileBase(agency, 'daily-manager', report.date, report.date)
  const v = report.visits, a = report.attention
  const lines: [string, string][] = [
    ['Visits scheduled', `${v.scheduled} (${v.scheduledHours} hours, ${v.unassigned} with nobody assigned)`], ['Completed', String(v.completed)], ['In progress', String(v.inProgress)], ['Hours clocked', String(v.clockedHours)],
    ['Late clock-ins', String(v.lateClockIns)], ['Missed (no-show)', `${v.missed} (${v.missedStillOpen} still open)`], ['Cancelled', `${v.cancelled} (${v.caregiverCallouts} caregiver call-outs)`], ['Never clocked', String(v.notClocked)],
    ['Open shifts unfilled', String(a.openShiftsUnfilled)], ['Incidents', String(a.incidents)], ['New applicants', String(a.newApplicants)], ['Family requests open', String(a.familyRequestsOpen)],
    ['Punches awaiting approval', String(a.punchesAwaitingApproval)], ['Authorizations ending in 14 days', String(a.authorizationsEndingIn14Days)], ['Credentials expiring in 14 days', String(a.credentialsExpiringIn14Days)],
    ...(report.money ? [['Billed', centsText(report.money.billedCents)], ['Caregiver pay', centsText(report.money.payCents)], ['Margin', centsText(report.money.marginCents)]] as [string, string][] : []),
  ]
  if (format === 'csv') {
    const text = toCSV(lines.map(([item, value]) => ({ item, value })), [{ key: 'item', label: 'Item' }, { key: 'value', label: 'Value' }])
      + '\n' + toCSV(report.notClocked, [{ key: 'start', label: 'Start' }, { key: 'end', label: 'End' }, { key: 'caregiverName', label: 'Caregiver' }, { key: 'clientName', label: 'Client' }])
    return csvFile(name, text)
  }
  return pdfFile(name, await tablePdf({
    agency, title: 'Daily manager report', period: report.date, summary: lines.map(([k, val]) => `${k}: ${val}`),
    columns: [{ key: 'start', label: 'Start', width: 60 }, { key: 'end', label: 'End', width: 60 }, { key: 'caregiverName', label: 'Caregiver', width: 180 }, { key: 'clientName', label: 'Client' }],
    rows: report.notClocked, footnote: report.notClocked.length ? 'Scheduled visits that were never clocked.' : 'Every scheduled visit was clocked.',
  }))
}

export async function renderPerformance(report: any, agency: string, format: Format): Promise<ReportFile> {
  const { start, end } = report.period
  const name = fileBase(agency, 'caregiver-performance', start, end)
  const cols: Col[] = [
    { key: 'name', label: 'Caregiver' }, { key: 'visitsScheduled', label: 'Scheduled' }, { key: 'visitsCompleted', label: 'Completed' }, { key: 'visitsMissed', label: 'Missed' }, { key: 'visitsCancelled', label: 'Cancelled (call-out)' },
    { key: 'lateClockIns', label: 'Late clock-ins' }, { key: 'lateClockOuts', label: 'Late clock-outs' }, { key: 'onTimePercent', label: 'On time %' }, { key: 'adlCompletionPercent', label: 'ADL completion %' }, { key: 'formCompletionPercent', label: 'Form completion %' },
    { key: 'signedPercent', label: 'Signed %' }, { key: 'averageRating', label: 'Client rating' }, { key: 'ratings', label: 'Ratings' }, { key: 'hoursWorked', label: 'Hours' },
  ]
  if (format === 'csv') return csvFile(name, toCSV(report.caregivers, cols))
  return pdfFile(name, await tablePdf({
    agency, title: 'Caregiver performance', period: `${start} to ${end}`,
    summary: [`${report.totals.visitsCompleted} visits completed · ${report.totals.visitsMissed} missed · ${report.totals.visitsCancelled} cancelled by a call-out · ${report.totals.lateClockIns} late clock-ins (more than ${report.graceMinutes} minutes)`],
    columns: [{ key: 'name', label: 'Caregiver', width: 110 }, { key: 'visitsCompleted', label: 'Done', width: 36 }, { key: 'visitsMissed', label: 'Missed', width: 42 }, { key: 'visitsCancelled', label: 'Cancel', width: 42 }, { key: 'lateClockIns', label: 'Late in', width: 44 }, { key: 'lateClockOuts', label: 'Late out', width: 48 }, { key: 'onTimePercent', label: 'On time', width: 48 }, { key: 'adlCompletionPercent', label: 'ADL %', width: 44 }, { key: 'formCompletionPercent', label: 'Forms %', width: 48 }, { key: 'averageRating', label: 'Rating' }],
    rows: report.caregivers.map((c: any) => ({ ...c, onTimePercent: pctText(c.onTimePercent), adlCompletionPercent: pctText(c.adlCompletionPercent), formCompletionPercent: pctText(c.formCompletionPercent), averageRating: c.averageRating ?? '—' })),
  }))
}

export async function renderWorkforce(report: any, agency: string, format: Format): Promise<ReportFile> {
  const { start, end } = report.period
  const name = fileBase(agency, 'workforce', start, end)
  const cols: Col[] = [
    { key: 'name', label: 'Caregiver' }, { key: 'branchName', label: 'Branch' }, { key: 'team', label: 'Team' }, { key: 'hoursWorked', label: 'Hours worked' }, { key: 'hoursPerWeek', label: 'Hours a week' }, { key: 'hoursWanted', label: 'Hours wanted' },
    { key: 'maxHoursPerWeek', label: 'Most hours' }, { key: 'utilisationPercent', label: 'Utilisation %' }, { key: 'status', label: 'Status' }, { key: 'visitsWorked', label: 'Visits' }, { key: 'callouts', label: 'Call-outs' }, { key: 'missedVisits', label: 'Missed' },
  ]
  if (format === 'csv') return csvFile(name, toCSV(report.caregivers, cols))
  const s = report.summary
  return pdfFile(name, await tablePdf({
    agency, title: 'Workforce', period: `${start} to ${end}`,
    summary: [`${s.caregivers} caregivers · ${s.hoursWorked} hours worked · ${s.underused} underused · ${s.overloaded} over their most hours · ${s.cancelled} visits cancelled (${s.cancelledByCaregiver} by a caregiver)`],
    columns: [{ key: 'name', label: 'Caregiver', width: 120 }, { key: 'hoursWorked', label: 'Hours', width: 48 }, { key: 'hoursPerWeek', label: 'A week', width: 48 }, { key: 'hoursWanted', label: 'Wanted', width: 48 }, { key: 'maxHoursPerWeek', label: 'Most', width: 44 }, { key: 'utilisationPercent', label: 'Util %', width: 48 }, { key: 'status', label: 'Status' }],
    rows: report.caregivers.map((c: any) => ({ ...c, utilisationPercent: pctText(c.utilisationPercent) })),
  }))
}
