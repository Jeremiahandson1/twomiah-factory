// Live updates: the event names and the one call every module makes when a record changes (from the CRM templates'
// services/socket.ts). Delivered to the screens over a WebSocket by http/live.ts (the CRMs used socket.io, which does not
// attach to Bun.serve); in-process listeners (tests) receive them too.
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
  // "Something in this list changed, read it again" ({ entity }), and a service-to-sales alert for one salesperson
  // (templates/crm-rv services/socket.ts).
  REFRESH: 'data:refresh',
  ALERT_CREATED: 'alert:created',
} as const

/** `userId` is set when the event is for one person rather than the whole company. */
type Listener = (companyId: string, event: string, data: unknown, userId?: string) => void

export function createRealtime() {
  const listeners = new Set<Listener>()
  return {
    EVENTS,
    /** Tell everyone watching this company that something changed. Never throws into the caller. */
    emitToCompany(companyId: string, event: string, data: unknown) {
      for (const l of listeners) { try { l(companyId, event, data) } catch { /* a listener's failure is its own */ } }
    },
    /** Tell one person (their screens only), e.g. the salesperson whose customer just checked into service. */
    emitToUser(companyId: string, userId: string, event: string, data: unknown) {
      for (const l of listeners) { try { l(companyId, event, data, userId) } catch { /* a listener's failure is its own */ } }
    },
    /** For the transport (and tests): called with every event. Returns the unsubscribe. */
    listen(l: Listener) { listeners.add(l); return () => { listeners.delete(l) } },
  }
}

export type Realtime = ReturnType<typeof createRealtime>
