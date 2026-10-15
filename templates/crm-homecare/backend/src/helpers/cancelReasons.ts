// Why an occurrence was cancelled — stored in schedule_exceptions.cancel_reason. Client-side reasons
// are the ones a caregiver may record from the phone; the rest are office/system-only. One list,
// shared by the caregiver endpoint, the scheduler's cancel path and the billing review's "not billed"
// list, so the labels never drift. frontend/src/utils/cancelReasons.ts mirrors it — keep them equal.

export const CLIENT_UNAVAILABLE_REASONS: Record<string, string> = {
  client_refused: 'Client refused services',
  client_not_home: 'Client not home / not answering',
  client_hospital: 'Client in hospital or facility',
  client_cancelled: 'Client cancelled ahead of time',
  other: 'Other',
}

export const CANCEL_REASONS: Record<string, string> = {
  ...CLIENT_UNAVAILABLE_REASONS,
  caregiver_callout: 'Caregiver called out',
  admin_cancelled: 'Cancelled by office',
}
