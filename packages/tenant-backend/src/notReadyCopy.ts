// Generated website copy never names a feature that is not ready (owner, 2026-10-23: nothing advertises financing to a
// business or its customers until financing is live and switched on). The words are the registry's own
// (FeatureDef.words, notReadyPattern()), so a feature that launches stops being scrubbed without a change here.
//
// One rule for every writer of copy a customer reads — the Factory's section composer and template content generator
// (apps/api sectionComposer.ts, contentGenerator.ts) and the unified app's AI drafts: a sentence that names a not-ready
// feature is taken out of the string it is in, and a list item that names one is taken out of its list. What is left
// of the copy keeps its shape.
import { notReadyPattern } from './featureRegistry'

/** camelCase keys and values read as words ("showFinancing" is "show Financing"). */
const spaced = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2')

/** Does this value, anywhere inside it, name a not-ready feature? */
export function mentionsNotReady(v: unknown, words: RegExp | null = notReadyPattern()): boolean {
  if (!words) return false
  if (typeof v === 'string') return words.test(spaced(v))
  if (Array.isArray(v)) return v.some((x) => mentionsNotReady(x, words))
  if (v && typeof v === 'object') return Object.entries(v).some(([k, x]) => words.test(spaced(k)) || mentionsNotReady(x, words))
  return false
}

/** The text without its sentences (and lines) that name a not-ready feature. */
export function withoutNotReadySentences(text: string, words: RegExp | null = notReadyPattern()): string {
  if (!words || !words.test(spaced(text))) return text
  const out: string[] = []
  for (const line of text.split('\n')) {
    if (!words.test(spaced(line))) { out.push(line); continue }
    // Sentences end at . ! ? followed by a space; each keeps its own ending. A line left with nothing goes.
    const kept = (line.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)\s*/g) || [line]).filter((s) => !words.test(spaced(s))).join('').trim()
    if (kept) out.push(kept)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * Copy with every mention of a not-ready feature taken out: strings lose the sentences that name one, and a key named
 * for one (showFinancing) goes. In a list, an item is dropped when it was ABOUT the feature — a string, or a field of
 * an object (an FAQ's question), left with nothing — and otherwise kept without the sentence (a service's description).
 * `dropEmpty`: a string left empty is removed from its object (the composer — its facts check then drops a section left
 * without what it needs); otherwise it stays as '' (the content generator's fixed shape).
 */
export function withoutNotReadyCopy<T>(data: T, o: { dropEmpty?: boolean } = {}): T {
  const words = notReadyPattern()
  if (!words) return data
  /** A string, or a top-level string field of an object, that had words and has none left. */
  const emptied = (before: any, after: any) => typeof before === 'string'
    ? before.trim() !== '' && after === ''
    : !!before && typeof before === 'object' && !Array.isArray(before) && Object.entries(before).some(([k, x]) => typeof x === 'string' && x.trim() !== '' && (words.test(spaced(k)) || !after?.[k]))
  const walk = (v: any): any => {
    if (typeof v === 'string') return withoutNotReadySentences(v, words)
    if (Array.isArray(v)) return v.map((x) => [x, walk(x)]).filter(([x, w]) => !emptied(x, w)).map(([, w]) => w)
    if (v && typeof v === 'object') {
      const out: Record<string, any> = {}
      for (const [k, x] of Object.entries(v)) {
        if (words.test(spaced(k))) continue
        const w = walk(x)
        if (o.dropEmpty && typeof x === 'string' && x !== '' && w === '') continue
        out[k] = w
      }
      return out
    }
    return v
  }
  return walk(data)
}
