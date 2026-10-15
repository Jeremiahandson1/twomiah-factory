/**
 * Sandata EVV prompts — the decisions, no UI.
 *
 * Until an agency's CRM is a certified alternate EVV system, every visit for a client who is in
 * Sandata must ALSO be checked in and out on Sandata Mobile Connect (SMC) at the client's home.
 * This app can only remind the caregiver and open SMC; it cannot check them in.
 *
 * Who is "in Sandata" is the SERVER's call: GET /api/sandata/caregiver-context returns the
 * caregiver's own clients with `in_sandata` (payer requires Sandata EVV + a Medicaid ID on file,
 * never private pay) and a Medicaid ID only for those clients. Nothing about the state, the
 * agency's Sandata ID or its payers is hard-coded here.
 *
 * Pure — no React Native imports.
 */

export interface SandataClient {
  id: string
  first_name?: string | null
  last_name?: string | null
  in_sandata?: boolean | null
  medicaid_id?: string | null
}

export interface SandataContext {
  sandataAgencyId: string | null
  clients: SandataClient[]
  activeVisit: { time_entry_id: string; client_id: string; sandata_required: boolean | null } | null
}

// Sandata Mobile Connect's store listings ("Sandata Mobile Connect", dark blue logo). These are
// Sandata's own app ids, the same in every Sandata state.
export const SMC_ANDROID_PACKAGE = 'com.sandata.smc.prod'
export const SMC_PLAY_URL = `https://play.google.com/store/apps/details?id=${SMC_ANDROID_PACKAGE}`
export const SMC_MARKET_URL = `market://details?id=${SMC_ANDROID_PACKAGE}`
export const SMC_APP_STORE_URL = 'https://apps.apple.com/us/app/sandata-mobile-connect/id6451209985'

export function needsSandata(client: SandataClient | null | undefined): boolean {
  return !!client && client.in_sandata === true
}

/**
 * Does THIS visit go to Sandata? The server decides at clock-in from the client's weekly EVV
 * allowance and returns `sandata_required`:
 *   false → this week's EVV hours are already met; no Sandata for this visit
 *   true  → send it
 *   null / undefined → no answer (offline clock-in, timeout): prompt anyway — the safe side.
 */
export function visitNeedsSandata(client: SandataClient | null | undefined, sandataRequired: boolean | null | undefined): boolean {
  if (sandataRequired === false) return false
  return needsSandata(client)
}

/** For the "no Sandata this visit" notice: a Sandata client whose weekly EVV hours are done. */
export function evvWeekMet(client: SandataClient | null | undefined, sandataRequired: boolean | null | undefined): boolean {
  return sandataRequired === false && needsSandata(client)
}

/** The client's Medicaid ID, for pasting into Sandata when starting the visit. */
export function medicaidIdOf(client: SandataClient | null | undefined): string | null {
  const v = String((client && client.medicaid_id) || '').trim()
  return /^\d{10,12}$/.test(v) ? v : null
}

export type SandataAfterPunch =
  | { type: 'prompt'; kind: 'in' | 'out'; clientId: string; clientName: string }
  | { type: 'week_met'; clientId: string; clientName: string }
  | null

/** What to show after a clock-in / clock-out (the web caregiver page's promptSandata). */
export function sandataAfterPunch(kind: 'in' | 'out', client: SandataClient | null | undefined, sandataRequired: boolean | null | undefined): SandataAfterPunch {
  if (!client) return null
  const clientName = `${client.first_name || ''} ${client.last_name || ''}`.trim()
  if (visitNeedsSandata(client, sandataRequired)) return { type: 'prompt', kind, clientId: client.id, clientName }
  if (kind === 'in' && evvWeekMet(client, sandataRequired)) return { type: 'week_met', clientId: client.id, clientName }
  return null
}

/** Show the one-time "Sandata EVV is required" notice? Only to caregivers with a client in Sandata. */
export function showSandataNotice(ctx: SandataContext | null | undefined, alreadyDismissed: boolean): boolean {
  return !alreadyDismissed && !!ctx && Array.isArray(ctx.clients) && ctx.clients.some(needsSandata)
}

/**
 * Where "Open the Sandata app" goes. A phone can't launch another app by package name from here,
 * so it opens SMC's store page — which shows "Open" when SMC is installed and "Install" when not.
 */
export function smcLinks(platform: string): string[] {
  if (platform === 'ios') return [SMC_APP_STORE_URL]
  if (platform === 'android') return [SMC_MARKET_URL, SMC_PLAY_URL]
  return [SMC_PLAY_URL]
}
