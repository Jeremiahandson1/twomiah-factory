// Best-effort AI token-usage report to the Twomiah factory, which debits the
// tenant's at-cost usage wallet (shared with SMS). NEVER throws / NEVER blocks.
export function reportAiUsage(inputTokens: number, outputTokens: number, model?: string): void {
  const url = process.env.FACTORY_URL
  const key = process.env.FACTORY_SYNC_KEY
  const tenantId = process.env.TENANT_ID
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
