// Turn a mail-transport failure into something the person who pressed Send can act on.
//
// Sending an invoice to an address that does not exist used to answer with the provider's own reply, verbatim:
// "550 5.1.1 <x@example.com>: Recipient address rejected: User unknown in virtual mailbox table". That is
// accurate and useless — it names a mailbox table, and it tells the owner nothing about what to do next.
// The raw text belongs in the server log, where support can read it; the screen gets a sentence.
// (Contractor T14 L4)

/** The reason, in words, for why a message did not go out. Never contains provider text. */
export function mailFailureReason(err: unknown): string {
  const raw = String((err as any)?.message ?? err ?? '')
  const has = (re: RegExp) => re.test(raw)
  // an SMTP code (550) or an enhanced status (5.1.1) — 4xx is temporary, 5xx is permanent
  const code = raw.match(/\b([45])\d\d\b/)?.[1] || ''
  const status = raw.match(/\b([45])\.\d{1,3}\.\d{1,3}\b/)?.[1] || ''
  const temporary = code === '4' || status === '4'

  // our own setup problems first — these are the ones the owner can actually fix
  if (has(/not configured|no (mail )?transport|missing .*(smtp|api ?key)|SENDGRID_API_KEY|SMTP_HOST/i)) {
    return 'Email has not been set up for this account yet.'
  }
  if (has(/\b535\b|auth\w*|credential|invalid login|username and password/i)) {
    return 'The mail server rejected the sending account — its details need checking.'
  }
  if (temporary || has(/timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|temporar|try again|greylist/i)) {
    return 'The mail server did not accept the message just now. Try again in a few minutes.'
  }
  // A full mailbox is ALSO reported as "Recipient address rejected", so it has to be recognised before the
  // unknown-address rule — otherwise a real mailbox gets called non-existent and someone deletes a good address.
  if (has(/mailbox (is )?full|over quota|insufficient (system )?storage|\b5\.2\.2\b|\b552\b/i)) {
    return "The recipient's mailbox is full."
  }
  if (has(/user unknown|does not exist|no such (user|mailbox)|unknown user|recipient (address )?(rejected|unknown)|mailbox (unavailable|not found)|\b5\.1\.[0-9]\b|\b550\b/i)) {
    return 'That email address does not exist. Check the address on the contact.'
  }
  if (has(/spam|blocked|blacklist|reputation|policy|\b5\.7\.\d+\b/i)) {
    return "The recipient's mail server refused the message — it may have been treated as spam."
  }
  return 'The message could not be delivered.'
}

/** Whether it is worth telling the caller to try again. */
export const mailFailureIsTemporary = (err: unknown) =>
  /did not accept the message just now/.test(mailFailureReason(err))
