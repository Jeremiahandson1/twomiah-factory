// Keeping credentials out of error text. (Security review S5-10, 2026-11-13)
//
// A failed build's error is logged, kept on the build job, shown in the dashboard and mailed to staff. The code push carries
// the Factory's GitHub token as an `http.extraHeader` argument, and the failed command was printed WITH its arguments — and
// that text was also emailed to the customer (notifyDeployFailed). One failed push would have mailed a customer the token to
// every business's repository. So: the header is never part of an error, anything shaped like a credential is taken out of a
// tool's own words, and the customer's email carries no internal error at all (services/email.ts).

/** A command's arguments as they may be printed: the auth header hidden. */
export function argsForError(args: string[]): string {
  return args.map((a) => (/^http\.extraHeader=/i.test(a) ? 'http.extraHeader=[hidden]' : a)).join(' ')
}

/** Text with anything shaped like a credential taken out: an Authorization header, a GitHub token, a password inside an address. */
export function withoutCredentials(text: unknown): string {
  return String(text ?? '')
    .replace(/(Authorization:\s*(?:Basic|Bearer|token)\s+)[A-Za-z0-9+/=._-]+/gi, '$1[hidden]')
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[hidden]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[hidden]@')
    .replace(/\b(sk_(?:live|test)_|rk_(?:live|test)_|whsec_|re_|rnd_|SG\.)[A-Za-z0-9_.-]{16,}/g, '$1[hidden]')
}
