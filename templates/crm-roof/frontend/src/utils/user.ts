/**
 * How a person's name is written on screen.
 *
 * L5: six places did `u.name || u.email`, and the user table has no `name` column — it has firstName
 * and lastName. So the fallback was not a fallback; it was the only branch, and Reports listed sales
 * reps as qa.manager@example.com.
 *
 * Three of the six tried `u.name || u.firstName + ' ' + u.lastName || u.email`, which is worse than
 * it looks: string concatenation is always truthy, so a user with no last name renders as
 * "Bob undefined" and the email fallback can never be reached.
 */
export function displayName(u: { firstName?: string | null; lastName?: string | null; name?: string | null; email?: string | null } | null | undefined): string {
  if (!u) return 'Unknown'
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim()
  return full || (u.name ?? '').trim() || u.email || 'Unknown'
}
