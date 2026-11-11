// "Check before you book" on roofing's own job forms (live test 11/11): the server answers a job put on one of the business's
// days off with a 409 the shared Schedule already reads (tenant-ui schedule/crew.tsx isTravelWarning). Here: say it, and if
// the office books anyway, send the same request again with bookAnyway: true. Anything else is the caller's to show.
import { isTravelWarning, BOOK_ANYWAY_TITLE } from '@twomiah/tenant-ui/src/schedule/crew'

type Ask = (message: string, opts: { title: string; confirmText: string }) => Promise<boolean>

/** Runs `send(false)`; on a days-off warning asks, and runs `send(true)` when the office books anyway. null when it did not. */
export async function sendBookingAnyway<T>(send: (bookAnyway: boolean) => Promise<T>, ask: Ask): Promise<T | null> {
  try {
    return await send(false)
  } catch (err) {
    if (!isTravelWarning(err)) throw err
    const said = (err as any)?.data?.error || (err as Error)?.message || 'The business is closed that day.'
    if (!(await ask(said, { title: BOOK_ANYWAY_TITLE, confirmText: 'Book anyway' }))) return null
    return send(true)
  }
}
