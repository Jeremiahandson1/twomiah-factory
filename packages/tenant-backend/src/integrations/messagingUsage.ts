// Best-effort per-message usage report to the Twomiah factory (debits the tenant's
// at-cost wallet) PLUS a cached wallet balance for the pre-send hard-gate.
// reportSmsUsage NEVER throws / NEVER blocks a send.

let _balanceCents: number | null = null  // last known wallet balance
let _at = 0                              // when we last learned it

function cfg() {
  return { url: process.env.FACTORY_URL, key: process.env.FACTORY_SYNC_KEY, tenantId: process.env.TENANT_ID }
}

/** `carrier` (AT&T, T-Mobile, Verizon) is passed only when the caller knows it; the Factory prices an unnamed one at the blended rate. */
export function reportSmsUsage(segments: number, twilioSid?: string, carrier?: string): void {
  const { url, key, tenantId } = cfg()
  const seg = Math.max(1, Math.round(Number(segments) || 1))
  if (!url || !key || !tenantId) return
  fetch(`${url}/api/v1/factory/internal/messaging/usage/${tenantId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Factory-Key': key },
    body: JSON.stringify({ segments: seg, twilioSid, carrier }),
    signal: AbortSignal.timeout(5000),
  }).then(r => (r.ok ? r.json() : null)).then(d => {
    if (d && typeof d.balance === 'number') { _balanceCents = d.balance; _at = Date.now() }
  }).catch(() => {})
}

/**
 * Best-effort AI token-usage report to the factory, which debits the same at-cost wallet. NEVER throws / NEVER
 * blocks. Every CRM copy but the base one carried this as services/aiUsage.ts (templates/crm-basic et al.).
 */
export function reportAiUsage(inputTokens: number, outputTokens: number, model?: string): void {
  const { url, key, tenantId } = cfg()
  const inTok = Math.max(0, Math.round(Number(inputTokens) || 0))
  const outTok = Math.max(0, Math.round(Number(outputTokens) || 0))
  if (!url || !key || !tenantId || (inTok === 0 && outTok === 0)) return
  fetch(`${url}/api/v1/factory/internal/ai/usage/${tenantId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Factory-Key': key },
    body: JSON.stringify({ inputTokens: inTok, outputTokens: outTok, model }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}

async function fetchBalance(): Promise<number | null> {
  const { url, key, tenantId } = cfg()
  if (!url || !key || !tenantId) return null
  try {
    const r = await fetch(`${url}/api/v1/factory/internal/messaging/balance/${tenantId}`, {
      headers: { 'X-Factory-Key': key }, signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return null
    const d = await r.json()
    return typeof d?.walletCents === 'number' ? d.walletCents : null
  } catch { return null }
}

// Pre-send gate. Returns false ONLY when we can confirm the wallet is empty (<= 0).
// Fails OPEN on any uncertainty (unknown balance, factory unreachable, billing not
// wired) so a factory hiccup never blocks a tenant's texts. Re-checks the factory
// when the cached balance is empty or stale (>60s) so a top-up unblocks within a minute.
export async function walletSufficient(): Promise<boolean> {
  const { url, key, tenantId } = cfg()
  if (!url || !key || !tenantId) return true
  const stale = Date.now() - _at > 60_000
  if (_balanceCents === null || _balanceCents <= 0 || stale) {
    const b = await fetchBalance()
    if (b !== null) { _balanceCents = b; _at = Date.now() }
  }
  return _balanceCents === null ? true : _balanceCents > 0
}
