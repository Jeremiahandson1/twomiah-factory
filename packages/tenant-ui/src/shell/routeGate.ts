// Which menu/route entry blocks the current URL, if any — pure, so it can be tested without React.
// `matches` are the feature-gated entries whose path covers the URL, longest path first. The URL is allowed when any
// entry for that longest path has an enabled feature: several menu entries can open the same page under different
// features (RV: Marketing on email_marketing, Follow-Up on follow_up_sequences). (RV T19 M6)
// `alwaysOn` are the paths an entry with no feature opens: one vertical's always-on page can share its address with
// another vertical's gated one (home care's Clients and the salon's, at /crm/clients) — the salon's entry, off for an
// agency, blocked the agency's own Clients page (found in the browser, 2026-10-19). Only the same address counts: an
// always-on page under a switched-off module's address stays behind it.
export function blockedRoute<T extends { to: string; features?: string[] }>(matches: T[], hasFeature: (f: string) => boolean, alwaysOn: ReadonlySet<string> = new Set()): T | null {
  const match = matches[0]
  if (!match || alwaysOn.has(match.to)) return null
  const samePath = matches.filter((i) => i.to === match.to)
  return samePath.some((i) => (i.features || []).some((f) => hasFeature(f))) ? null : match
}
