/**
 * Strip comments from source — WITHOUT mistaking a string for one.
 *
 * Nearly every guard in this directory carried its own one-liner regex that replaced everything from
 * a slash-star to the next star-slash. That cannot tell a comment opener from the same two characters
 * inside a STRING literal — and there are two such strings in the shared backend:
 * `app.get('/file/*', …)` in files/documents.ts, and the media route in jobs/jobs.ts. Both are real
 * route patterns, which leaves documents.ts with one more opener than closer.
 *
 * For a long time that was harmless by luck. The regex is non-greedy, found no closer after the
 * unbalanced opener, matched nothing, and the guard read the file intact. Then T32 M12 added a
 * doc-comment a few lines below that route — and its closer became the first one after the
 * unbalanced opener, so the strip ate the whole handler. check-document-fidelity.ts then failed on
 * code that was correct, asserting two lines it could no longer see.
 *
 * A false FAILURE is the lucky outcome. The same bug one line further along deletes the code a guard
 * is looking for and the guard PASSES — a guard that has quietly stopped guarding.
 *
 * (Writing this file had the same hazard: a comment explaining the trap, containing the trap. Which
 * is the point — the sequence is unremarkable in prose and in a regex, and that is exactly why a
 * regex is the wrong tool for it.)
 *
 * So: a scanner that walks the source, tracks string and template literals, and removes only what is
 * actually a comment. Shared, because five guards strip one of those two files, and fixing one of
 * five is how this comes back.
 *
 *   import { stripComments } from './lib/stripComments.ts'
 */
export function stripComments(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]

    // A string or template literal: copied through verbatim, escapes honoured. Template literals can
    // contain `${…}` with nested quotes; copying the whole literal through is enough for every guard
    // here, none of which cares what is inside one.
    /*
     * AN APOSTROPHE IN JSX PROSE IS NOT A STRING. (T35)
     *
     * This treated every quote as a literal opener and scanned forward until it found the partner,
     * wherever that was. JSX TEXT is not code, and English is full of apostrophes:
     *
     *     above the sheet's measured cost.
     *
     * That lone `'` opened a "string" that ran on for thirty lines, copying a block comment through
     * verbatim on the way — and check-light-card-dark-text.ts then matched `bg-white` inside the
     * COMMENT that exists to explain the bg-white rule, and failed on correct code. The same class
     * of fault this file was written for, from the other direction: here the scanner saw a string
     * where there was none.
     *
     * A single- or double-quoted string in this repo never spans a line (anything multi-line uses a
     * template literal, below). So: scan for the partner on THIS LINE only. No partner means the
     * quote was prose — emit it and carry on reading code, which is what the stripper must do if the
     * comments after it are to be found at all.
     */
    if (ch === '"' || ch === "'") {
      const nl = src.indexOf('\n', i)
      const lineEnd = nl < 0 ? n : nl
      let j = i + 1
      let closed = -1
      while (j < lineEnd) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === ch) { closed = j; break }
        j++
      }
      if (closed < 0) { out += ch; i++; continue }   // prose, not a literal
      out += src.slice(i, closed + 1)
      i = closed + 1
      continue
    }

    // Template literals DO span lines, and `${…}` inside one may contain anything; copy it through.
    if (ch === '`') {
      out += ch
      i++
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue }
        out += src[i]
        if (src[i] === '`') { i++; break }
        i++
      }
      continue
    }

    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      i = end < 0 ? n : end + 2
      // Keep a newline so line-anchored patterns in the caller do not join two statements together.
      out += '\n'
      continue
    }
    if (ch === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i)
      i = end < 0 ? n : end
      continue
    }

    out += ch
    i++
  }
  return out
}

/** The same, with CRLF normalised first — which is what most callers actually want on this repo. */
export const stripSource = (src: string) => stripComments(src.replace(/\r\n/g, '\n'))
