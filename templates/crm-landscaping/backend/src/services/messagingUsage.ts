// Best-effort per-message usage report to the Twomiah factory (debits the tenant's
// at-cost wallet) PLUS a cached wallet balance for the pre-send hard-gate.
// reportSmsUsage NEVER throws / NEVER blocks a send.

let _balanceCents: number | null = null  // last known wallet balance
let _at = 0                              // when we last learned it

function cfg() {
  return { url: process.env.FACTORY_URL, key: process.env.FACTORY_SYNC_KEY, tenantId: process.env.TENANT_ID }
}

export function reportSmsUsage(segments: number, twilioSid?: string): void {
  const { url, key, tenantId } = cfg()
  const seg = Math.max(1, Math.round(Number(segments) || 1))
  if (!url || !key || !tenantId) return
  fetch(`${url}/api/v1/factory/internal/messaging/usage/${tenantId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Factory-Key': key },
    body: JSON.stringify({ segments: seg, twilioSid }),
    signal: AbortSignal.timeout(5000),
  }).then(r => (r.ok ? r.json() : null)).then(d => {
    if (d && typeof d.balance === 'number') { _balanceCents = d.balance; _at = Date.now() }
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
