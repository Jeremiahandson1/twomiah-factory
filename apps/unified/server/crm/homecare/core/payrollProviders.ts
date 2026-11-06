// Live pushes of a pay run to a payroll provider (row 21, care_payroll_providers): ADP Workforce Now, Paychex Flex, Gusto, and the
// embedded full-service provider (Gusto Embedded: it files the taxes and pays the caregivers). Each is an adapter behind a config
// the owner fills in (Pay rules › Providers); until the config is there the push answers with the owner's step and what WOULD be
// sent, and nothing leaves. Every push, sent or refused by the provider, is a payroll_push row.
//
// The owner's outside steps — none of these can be finished from inside the product:
//   ADP      an ADP Marketplace developer account, an app registered for the client's ADP Workforce Now, its client id and secret,
//            and the mutual-TLS certificate ADP issues; the sandbox is ADP's UAT (uat-api.adp.com). The payload below follows ADP's
//            Payroll Data Input API (payroll.payDataInput.modify) as published; confirm it against the sandbox before a live run.
//   Paychex  a Paychex Flex developer account with an app approved for the client (client id and secret, OAuth client credentials),
//            the Flex company id; Paychex's sandbox is sandbox.api.paychex.com.
//   Gusto    a Gusto developer account (demo company at api.gusto-demo.com), the OAuth access token for the agency's company and
//            its company uuid; caregivers matched to Gusto employees (Payroll › Gusto › Sync employees).
//   Embedded the Gusto Embedded Payroll partner agreement (Gusto signs partners, not the agency), the partner's API token, and the
//            agency onboarded as a partner-managed company (its uuid). Same demo host for the sandbox.
import { and, eq, inArray } from 'drizzle-orm'
import { company, gustoEmployeeMap, payrollPush } from '../../../db/schema/index.ts'
import type { CrmDeps } from '../../deps.ts'
import { encrypt, decrypt } from './encryption.ts'
import type { PayrollLine } from './payrollPay.ts'

export const PAYROLL_PROVIDERS_FEATURE = 'care_payroll_providers'
export type ProviderId = 'adp' | 'paychex' | 'gusto' | 'embedded'
export const PROVIDER_IDS: ProviderId[] = ['adp', 'paychex', 'gusto', 'embedded']
export const PROVIDER_LABELS: Record<ProviderId, string> = { adp: 'ADP Workforce Now', paychex: 'Paychex Flex', gusto: 'Gusto', embedded: 'Full-service payroll (Gusto Embedded)' }

/** Each provider's fields: which are secrets (encrypted at rest, masked on read) and which are plain. */
export const PROVIDER_FIELDS: Record<ProviderId, { plain: string[]; secret: string[] }> = {
  adp: { plain: ['clientId', 'sandbox'], secret: ['clientSecret', 'certificatePem', 'privateKeyPem'] },
  paychex: { plain: ['clientId', 'companyId', 'sandbox'], secret: ['clientSecret'] },
  gusto: { plain: ['companyUuid', 'sandbox'], secret: ['accessToken'] },
  embedded: { plain: ['companyUuid', 'sandbox', 'autoSubmit'], secret: ['partnerToken'] },
}
export const OWNER_STEPS: Record<ProviderId, string> = {
  adp: 'Register an app for this agency in the ADP Marketplace developer portal (ADP Workforce Now, Payroll Data Input API), then enter its client id, client secret and the mutual-TLS certificate and key ADP issued. Test against ADP\'s UAT sandbox first.',
  paychex: 'Create a Paychex Flex developer app approved for this agency, then enter its client id, client secret and the Flex company id. Test against Paychex\'s sandbox first.',
  gusto: 'Create a Gusto developer account, connect this agency\'s Gusto company (OAuth) and enter the access token and company uuid; match caregivers to Gusto employees under Payroll › Gusto. Test against Gusto\'s demo company first.',
  embedded: 'Sign the Gusto Embedded Payroll partner agreement, then enter the partner API token and the agency\'s partner-managed company uuid once it is onboarded. Until then the pay run is prepared but nothing is filed or paid.',
}

export interface ProviderConfig { [k: string]: string | boolean | null }

const HOSTS = {
  adp: (sandbox: boolean) => (sandbox ? 'https://uat-api.adp.com' : 'https://api.adp.com'),
  adpAuth: (sandbox: boolean) => (sandbox ? 'https://uat-accounts.adp.com' : 'https://accounts.adp.com'),
  paychex: (sandbox: boolean) => (sandbox ? 'https://sandbox.api.paychex.com' : 'https://api.paychex.com'),
  gusto: (sandbox: boolean) => (sandbox ? 'https://api.gusto-demo.com' : 'https://api.gusto.com'),
}

/** The outside calls; a test swaps this for a stand-in. */
export const providerTransport: { fetch: (url: string, init: any) => Promise<Response> } = { fetch: (url, init) => fetch(url, init) }

export interface PushPerson {
  caregiverId: string; firstName: string | null; lastName: string | null; workerId: string | null
  regularHours: number; overtimeHours: number; doubleTimeHours: number; holidayHours: number
  bonusDollars: number; reimbursementDollars: number; otherPayDollars: number
}

/** A person's hours and amounts as every push sends them, from a pay run line and the period's mileage. */
export function pushPerson(l: PayrollLine, workerId: string | null, mileageDollars: number): PushPerson {
  return {
    caregiverId: l.caregiverId, firstName: l.firstName, lastName: l.lastName, workerId,
    regularHours: Math.max(0, Math.round((l.regularHours - (l.holidayHours ?? 0)) * 100) / 100), overtimeHours: l.overtimeHours, doubleTimeHours: l.doubleTimeHours, holidayHours: l.holidayHours ?? 0,
    bonusDollars: l.bonusPay ?? 0, reimbursementDollars: mileageDollars,
    otherPayDollars: Math.round(((l.holidayExtraPay ?? 0) + (l.breakPremiumPay ?? 0) + (l.sleepoverPay ?? 0)) * 100) / 100,
  }
}

export function createPayrollProviders(d: CrmDeps) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, PAYROLL_PROVIDERS_FEATURE)

  async function allStored(companyId: string): Promise<Record<ProviderId, ProviderConfig>> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const raw = ((row?.settings as any)?.payrollProviders ?? {}) as Record<string, ProviderConfig>
    const out = {} as Record<ProviderId, ProviderConfig>
    for (const p of PROVIDER_IDS) out[p] = raw[p] ?? {}
    return out
  }

  /** The config with secrets decrypted (for a push). */
  async function config(companyId: string, provider: ProviderId): Promise<ProviderConfig> {
    const c = (await allStored(companyId))[provider]
    const out: ProviderConfig = { ...c }
    for (const k of PROVIDER_FIELDS[provider].secret) out[k] = typeof c[k] === 'string' ? decrypt(c[k] as string) : null
    return out
  }

  const isConfigured = (provider: ProviderId, c: ProviderConfig) => [...PROVIDER_FIELDS[provider].plain.filter((k) => k !== 'sandbox' && k !== 'autoSubmit'), ...PROVIDER_FIELDS[provider].secret].every((k) => typeof c[k] === 'string' && (c[k] as string).length > 0)

  /** What the office sees: plain fields, secrets masked to their last 4 characters, and whether the push can go. */
  async function view(companyId: string) {
    const all = await allStored(companyId)
    const out: Record<string, any> = {}
    for (const p of PROVIDER_IDS) {
      const c = all[p]
      const masked: Record<string, any> = {}
      for (const k of PROVIDER_FIELDS[p].plain) masked[k] = c[k] ?? (k === 'sandbox' ? true : k === 'autoSubmit' ? false : null)
      for (const k of PROVIDER_FIELDS[p].secret) { const v = typeof c[k] === 'string' ? decrypt(c[k] as string) : null; masked[k] = v ? `••••${v.slice(-4)}` : null }
      out[p] = { label: PROVIDER_LABELS[p], fields: masked, configured: isConfigured(p, await config(companyId, p)), ownerStep: OWNER_STEPS[p] }
    }
    return out
  }

  /** Save what was sent for one provider: a masked secret (••••) sent back unchanged is kept; empty clears it. */
  async function save(companyId: string, provider: ProviderId, input: any): Promise<void> {
    const all = await allStored(companyId)
    const cur = { ...all[provider] }
    for (const k of PROVIDER_FIELDS[provider].plain) {
      if (input?.[k] === undefined) continue
      cur[k] = k === 'sandbox' || k === 'autoSubmit' ? input[k] === true : (input[k] === null || String(input[k]).trim() === '' ? null : String(input[k]).trim().slice(0, 4000))
    }
    for (const k of PROVIDER_FIELDS[provider].secret) {
      if (input?.[k] === undefined) continue
      const v = input[k] === null ? '' : String(input[k])
      if (v.startsWith('••••')) continue
      cur[k] = v.trim() === '' ? null : encrypt(v.trim())
    }
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    await d.db.update(company).set({ settings: { ...((row?.settings as object) || {}), payrollProviders: { ...((row?.settings as any)?.payrollProviders ?? {}), [provider]: cur } } as any, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  }

  const sandboxOf = (c: ProviderConfig) => c.sandbox !== false
  const mdy = (ymd: string) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`

  // ---- payloads, one per provider: what the push sends (and what the preview shows before the config is there)
  function adpPayload(c: ProviderConfig, start: string, end: string, people: PushPerson[], codes: { doubleTime: string | null; holiday: string | null; mileage: string | null; bonus: string | null; otherPay: string | null; companyCode: string | null }) {
    const batch = end.slice(2, 4) + end.slice(5, 7) + end.slice(8, 10)
    return {
      events: [{
        eventNameCode: { codeValue: 'payroll.payDataInput.modify' },
        data: {
          eventContext: { payDataInput: { payrollGroupCode: { codeValue: codes.companyCode }, batchID: batch } },
          transform: {
            payDataInput: {
              payrollRegionCode: 'USA', payrollGroupCode: { codeValue: codes.companyCode }, batchID: batch,
              payPeriod: { startDate: start, endDate: end },
              payDataInputs: people.map((p) => ({
                payrollFileNumber: p.workerId,
                payrollProfilePayDataInput: {
                  payDataInputEntries: [
                    { earningCode: { codeValue: 'REG' }, hours: p.regularHours },
                    ...(p.overtimeHours > 0 ? [{ earningCode: { codeValue: 'OT' }, hours: p.overtimeHours }] : []),
                    ...(p.doubleTimeHours > 0 ? [{ earningCode: { codeValue: codes.doubleTime }, hours: p.doubleTimeHours }] : []),
                    ...(p.holidayHours > 0 ? [{ earningCode: { codeValue: codes.holiday }, hours: p.holidayHours }] : []),
                    ...(p.reimbursementDollars > 0 ? [{ earningCode: { codeValue: codes.mileage }, amount: { amountValue: p.reimbursementDollars, currencyCode: 'USD' } }] : []),
                    ...(p.bonusDollars > 0 ? [{ earningCode: { codeValue: codes.bonus }, amount: { amountValue: p.bonusDollars, currencyCode: 'USD' } }] : []),
                    ...(p.otherPayDollars > 0 ? [{ earningCode: { codeValue: codes.otherPay }, amount: { amountValue: p.otherPayDollars, currencyCode: 'USD' } }] : []),
                  ],
                },
              })),
            },
          },
        },
      }],
    }
  }

  function paychexChecks(start: string, end: string, people: PushPerson[], comp: Record<string, string>) {
    return people.map((p) => ({
      workerId: p.workerId,
      checkDate: mdy(end), periodStartDate: start, periodEndDate: end,
      earnings: [
        { name: comp.regular, hours: p.regularHours },
        ...(p.overtimeHours > 0 ? [{ name: comp.overtime, hours: p.overtimeHours }] : []),
        ...(p.doubleTimeHours > 0 ? [{ name: comp.doubleTime, hours: p.doubleTimeHours }] : []),
        ...(p.holidayHours > 0 ? [{ name: comp.holiday, hours: p.holidayHours }] : []),
        ...(p.reimbursementDollars > 0 ? [{ name: comp.mileage, amount: p.reimbursementDollars }] : []),
        ...(p.bonusDollars > 0 ? [{ name: comp.bonus, amount: p.bonusDollars }] : []),
        ...(p.otherPayDollars > 0 ? [{ name: comp.otherPay, amount: p.otherPayDollars }] : []),
      ],
    }))
  }

  function gustoCompensations(people: PushPerson[], uuids: Map<string, string>) {
    return people.map((p) => ({
      employee_uuid: uuids.get(p.caregiverId) ?? null,
      hourly_compensations: [
        { name: 'Regular Hours', hours: p.regularHours.toFixed(2) },
        ...(p.overtimeHours > 0 ? [{ name: 'Overtime', hours: p.overtimeHours.toFixed(2) }] : []),
        ...(p.doubleTimeHours > 0 ? [{ name: 'Double overtime', hours: p.doubleTimeHours.toFixed(2) }] : []),
        ...(p.holidayHours > 0 ? [{ name: 'Holiday', hours: p.holidayHours.toFixed(2) }] : []),
      ],
      fixed_compensations: [
        ...(p.bonusDollars > 0 ? [{ name: 'Bonus', amount: p.bonusDollars.toFixed(2) }] : []),
        ...(p.reimbursementDollars > 0 ? [{ name: 'Reimbursement', amount: p.reimbursementDollars.toFixed(2) }] : []),
        ...(p.otherPayDollars > 0 ? [{ name: 'Other Earnings', amount: p.otherPayDollars.toFixed(2) }] : []),
      ],
    }))
  }

  async function json(res: Response) { try { return await res.json() } catch { return null } }

  /**
   * Push the period to a provider. Answers { configured:false, ownerStep, preview } without sending when the config is not there
   * (and nothing is recorded); otherwise sends, records a payroll_push row and answers it.
   */
  async function push(companyId: string, provider: ProviderId, start: string, end: string, people: PushPerson[], opts: { userId?: string | null; codes?: any; paychexComponents?: Record<string, string> } = {}) {
    const c = await config(companyId, provider)
    const codes = { doubleTime: null, holiday: null, mileage: null, bonus: null, otherPay: null, companyCode: null, ...(opts.codes ?? {}) }
    const comp = { regular: 'Hourly', overtime: 'Overtime', doubleTime: 'Double Time', holiday: 'Holiday', mileage: 'Mileage', bonus: 'Bonus', otherPay: 'Other Pay', ...(opts.paychexComponents ?? {}) }
    const uuids = new Map<string, string>()
    if (provider === 'gusto' || provider === 'embedded') {
      const maps = people.length ? await d.db.select({ userId: gustoEmployeeMap.userId, uuid: gustoEmployeeMap.gustoUuid }).from(gustoEmployeeMap).where(and(eq(gustoEmployeeMap.companyId, companyId), inArray(gustoEmployeeMap.userId, people.map((p) => p.caregiverId)))) : []
      for (const m of maps) if (m.uuid) uuids.set(String(m.userId), String(m.uuid))
    }
    const preview = provider === 'adp' ? adpPayload(c, start, end, people, codes) : provider === 'paychex' ? { checks: paychexChecks(start, end, people, comp) } : { employee_compensations: gustoCompensations(people, uuids) }
    if (!isConfigured(provider, c)) return { configured: false, sent: false, ownerStep: OWNER_STEPS[provider], preview, people: people.length }
    const sandbox = sandboxOf(c)
    let status = 'sent', response: any = null, error: string | null = null
    try {
      if (provider === 'adp') {
        const tls = c.certificatePem && c.privateKeyPem ? { tls: { cert: String(c.certificatePem), key: String(c.privateKeyPem) } } : {}
        const tok = await providerTransport.fetch(`${HOSTS.adpAuth(sandbox)}/auth/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=client_credentials&client_id=${encodeURIComponent(String(c.clientId))}&client_secret=${encodeURIComponent(String(c.clientSecret))}`, ...tls })
        const token = (await json(tok))?.access_token
        if (!tok.ok || !token) throw new Error(`ADP refused the sign-in (${tok.status})`)
        const res = await providerTransport.fetch(`${HOSTS.adp(sandbox)}/events/payroll/v1/pay-data-input.modify`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(preview), ...tls })
        response = await json(res); if (!res.ok) throw new Error(`ADP refused the pay data (${res.status})`)
        status = 'accepted'
      } else if (provider === 'paychex') {
        const tok = await providerTransport.fetch(`${HOSTS.paychex(sandbox)}/auth/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=client_credentials&client_id=${encodeURIComponent(String(c.clientId))}&client_secret=${encodeURIComponent(String(c.clientSecret))}` })
        const token = (await json(tok))?.access_token
        if (!tok.ok || !token) throw new Error(`Paychex refused the sign-in (${tok.status})`)
        const periods = await providerTransport.fetch(`${HOSTS.paychex(sandbox)}/companies/${encodeURIComponent(String(c.companyId))}/payperiods?status=CURRENT`, { headers: { Authorization: `Bearer ${token}` } })
        const period = ((await json(periods))?.content ?? [])[0]
        if (!periods.ok || !period?.payPeriodId) throw new Error('Paychex has no current pay period to receive the hours')
        const results: any[] = []
        for (const check of (preview as any).checks) {
          const res = await providerTransport.fetch(`${HOSTS.paychex(sandbox)}/companies/${encodeURIComponent(String(c.companyId))}/payperiods/${encodeURIComponent(String(period.payPeriodId))}/checks`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(check) })
          const body = await json(res); results.push({ workerId: check.workerId, status: res.status, body })
          if (!res.ok) throw new Error(`Paychex refused the check for worker ${check.workerId} (${res.status})`)
        }
        response = { payPeriodId: period.payPeriodId, results }
        status = 'accepted'
      } else {
        const token = String(provider === 'gusto' ? c.accessToken : c.partnerToken)
        const missing = people.filter((p) => !uuids.has(p.caregiverId))
        if (missing.length) throw new Error(`${missing.length} caregiver(s) are not matched to a Gusto employee: ${missing.map((p) => `${p.firstName} ${p.lastName}`).join(', ')}`)
        const base = `${HOSTS.gusto(sandbox)}/v1/companies/${encodeURIComponent(String(c.companyUuid))}/payrolls`
        const list = await providerTransport.fetch(`${base}?start_date=${start}&end_date=${end}&processed=false`, { headers: { Authorization: `Bearer ${token}`, 'X-Gusto-API-Version': '2024-04-01' } })
        const listed = await json(list)
        const payrolls: any[] = Array.isArray(listed) ? listed : []
        const payroll = payrolls.find((p: any) => p?.pay_period?.start_date === start && p?.pay_period?.end_date === end) ?? payrolls[0]
        if (!list.ok || !payroll?.payroll_uuid) throw new Error(`Gusto has no unprocessed payroll for ${start} to ${end}`)
        const res = await providerTransport.fetch(`${base}/${payroll.payroll_uuid}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Gusto-API-Version': '2024-04-01' }, body: JSON.stringify({ version: payroll.version, ...(preview as any) }) })
        response = await json(res); if (!res.ok) throw new Error(`Gusto refused the hours (${res.status})`)
        status = 'accepted'
        if (provider === 'embedded') {
          // full service: Gusto calculates, and submits when the agency said so — then it files the taxes and pays the caregivers
          const calc = await providerTransport.fetch(`${base}/${payroll.payroll_uuid}/calculate`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'X-Gusto-API-Version': '2024-04-01' } })
          if (!calc.ok) throw new Error(`Gusto could not calculate the payroll (${calc.status})`)
          if (c.autoSubmit === true) {
            const sub = await providerTransport.fetch(`${base}/${payroll.payroll_uuid}/submit`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'X-Gusto-API-Version': '2024-04-01' } })
            if (!sub.ok) throw new Error(`Gusto could not submit the payroll (${sub.status})`)
            status = 'submitted'
          } else status = 'calculated'
        }
      }
    } catch (e: any) { status = 'failed'; error = e?.message || 'The provider did not answer' }
    const [row] = await d.db.insert(payrollPush).values({ companyId, provider, periodStart: start, periodEnd: end, status, people: people.length, request: preview as any, response, error, createdById: opts.userId ?? null }).returning()
    return { configured: true, sent: status !== 'failed', status, error, pushId: row.id, people: people.length, response, preview }
  }

  return { enabled, view, save, config, push, isConfigured }
}
export type PayrollProviders = ReturnType<typeof createPayrollProviders>
