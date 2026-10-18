// Live updates: the event names and the one call every module makes when a record changes (from the CRM templates'
// services/socket.ts). The CRMs pushed these over socket.io; the only screens listening were the lead inbox and the
// "connected" dot. The unified server runs on Bun.serve, which socket.io's Node server doesn't attach to, so the
// transport is not wired yet (CUTOVER_LEDGER, step 3): the calls are made and delivered to in-process listeners,
// and the screens refresh on load as the lead inbox does today.
export const EVENTS = {
  CONTACT_CREATED: 'contact:created',
  CONTACT_UPDATED: 'contact:updated',
  CONTACT_DELETED: 'contact:deleted',
  JOB_CREATED: 'job:created',
  JOB_UPDATED: 'job:updated',
  JOB_DELETED: 'job:deleted',
  JOB_STATUS_CHANGED: 'job:statusChanged',
  QUOTE_CREATED: 'quote:created',
  QUOTE_UPDATED: 'quote:updated',
  QUOTE_SENT: 'quote:sent',
  QUOTE_APPROVED: 'quote:approved',
  INVOICE_CREATED: 'invoice:created',
  INVOICE_UPDATED: 'invoice:updated',
  INVOICE_SENT: 'invoice:sent',
  INVOICE_PAID: 'invoice:paid',
  PAYMENT_RECEIVED: 'payment:received',
  LEAD_CREATED: 'lead:created',
  LEAD_UPDATED: 'lead:updated',
} as const

type Listener = (companyId: string, event: string, data: unknown) => void

export function createRealtime() {
  const listeners = new Set<Listener>()
  return {
    EVENTS,
    /** Tell everyone watching this company that something changed. Never throws into the caller. */
    emitToCompany(companyId: string, event: string, data: unknown) {
      for (const l of listeners) { try { l(companyId, event, data) } catch { /* a listener's failure is its own */ } }
    },
    /** For the transport (and tests): called with every event. Returns the unsubscribe. */
    listen(l: Listener) { listeners.add(l); return () => { listeners.delete(l) } },
  }
}

export type Realtime = ReturnType<typeof createRealtime>
