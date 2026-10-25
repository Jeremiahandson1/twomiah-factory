// Whose chairs this seat sees in The Book (server crm/salon/bookScope.ts, GET /api/appointments/book-settings). The
// owner's "Stylists see only their own appointments" switch, and this seat's answer to it — the server applies the same
// answer to every read and write, so the screen only follows it: one chair's book, a picker that offers only that chair.
import { api } from '../../../api'

export interface BookScope {
  /** The owner's switch (company setting). Off by default. */
  stylistsSeeOwnBookOnly: boolean
  /** True when THIS seat is narrowed to its own chair. */
  ownOnly: boolean
  /** The ids that are this seat's chair (its login, and roster cards that are the same person). Empty when not narrowed. */
  ownStylistIds: string[]
}

export const WHOLE_BOOK: BookScope = { stylistsSeeOwnBookOnly: false, ownOnly: false, ownStylistIds: [] }

/** The seat's scope; the whole book when it cannot be read (the server still narrows, so nothing is shown that isn't sent). */
export async function fetchBookScope(): Promise<BookScope> {
  try {
    const r = (await api.get('/api/appointments/book-settings')) as Partial<BookScope> | null
    return { stylistsSeeOwnBookOnly: !!r?.stylistsSeeOwnBookOnly, ownOnly: !!r?.ownOnly, ownStylistIds: Array.isArray(r?.ownStylistIds) ? r!.ownStylistIds! : [] }
  } catch {
    return WHOLE_BOOK
  }
}
