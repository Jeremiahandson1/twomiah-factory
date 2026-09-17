// Which menu/route entry blocks the current URL, if any — pure, so it can be tested without React.
// `matches` are the feature-gated entries whose path covers the URL, longest path first. The URL is allowed when any
// entry for that longest path has an enabled feature: several menu entries can open the same page under different
// features (RV: Marketing on email_marketing, Follow-Up on follow_up_sequences). (RV T19 M6)
export function blockedRoute<T extends { to: string; features?: string[] }>(matches: T[], hasFeature: (f: string) => boolean): T | null {
  const match = matches[0]
  if (!match) return null
  const samePath = matches.filter((i) => i.to === match.to)
  return samePath.some((i) => (i.features || []).some((f) => hasFeature(f))) ? null : match
}
