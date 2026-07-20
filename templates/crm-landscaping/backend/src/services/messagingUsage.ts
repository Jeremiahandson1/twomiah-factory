// Best-effort per-message usage report to the Twomiah factory, which debits the
// tenant's at-cost messaging wallet ($0.0x/segment). NEVER throws and NEVER
// blocks the SMS send — a lost report is a tiny undercharge, not a failure.
export function reportSmsUsage(segments: number, twilioSid?: string): void {
  const url = process.env.FACTORY_URL
  const key = process.env.FACTORY_SYNC_KEY
  const tenantId = process.env.TENANT_ID
  const seg = Math.max(1, Math.round(Number(segments) || 1))
  if (!url || !key || !tenantId) return
  fetch(`${url}/api/v1/factory/internal/messaging/usage/${tenantId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Factory-Key': key },
    body: JSON.stringify({ segments: seg, twilioSid }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {})
}
