// What changed between two versions of a catalogue record, for its audit row — the template's audit.diff with its
// `keys` (templates/crm-store/backend/src/services/audit.ts diff): only the fields the request sent, never a secret or
// a bookkeeping column. The app's own diff (core/audit.ts) compares every field, which on an edit of one box would name
// the timestamps the write itself moved.
const SKIP = new Set(['id', 'companyId', 'createdAt', 'updatedAt', 'passwordHash', 'refreshToken', 'resetToken', 'resetTokenExp', 'credentialsEnc'])

export function changedKeys(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, keys?: string[]): Record<string, { old: unknown; new: unknown }> | null {
  if (!before || !after) return null
  const out: Record<string, { old: unknown; new: unknown }> = {}
  for (const k of keys ?? Object.keys(after)) {
    if (SKIP.has(k)) continue
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) out[k] = { old: before[k] ?? null, new: after[k] ?? null }
  }
  return Object.keys(out).length ? out : null
}
