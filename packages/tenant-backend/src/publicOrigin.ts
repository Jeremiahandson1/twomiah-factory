/**
 * This tenant's own public address, for links and callbacks that come back to it (a text's delivery report, a review
 * request's click, an email's pixel and unsubscribe link). The Factory sets API_URL and BACKEND_URL on every tenant
 * (services/deploy.ts platformIntegrationEnv, unified/build.ts tenantEnv) and nothing sets API_BASE_URL — which is what
 * the texting read alone, so every text went to Twilio with the delivery-report address "/api/sms/webhook/status" and
 * was refused (live, test tenant two, 2026-10-20). One answer for all of them; '' when none is set.
 */
export function publicApiBase(env: Record<string, string | undefined> = process.env): string {
  return String(env.API_URL || env.BACKEND_URL || env.API_BASE_URL || env.FRONTEND_URL || '').replace(/\/+$/, '')
}
