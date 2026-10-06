/**
 * DOES THIS HANDLER SHOW THE USER WHY IT FAILED? (T58d)
 *
 * Five RV guards asserted this, and all five did it by pinning the exact expression —
 * `alert(err?.message || 'Failed to move lead')`. Every one of them failed the moment those refusals
 * moved out of a pop-up and onto the page, which is to say: they failed on a strictly better screen.
 * That is the fourth time this campaign a guard has been written against a shape instead of a rule,
 * so the rule gets a single implementation here rather than a fifth copy.
 *
 * The rule: inside the handler's catch block, the caught binding must reach something that is not
 * the console. HOW it is rendered — a page banner, a form error, a toast — is the screen's business
 * and may change again without this needing to.
 *
 * What it deliberately does NOT do is name an approved renderer. A list of blessed function names is
 * the same pinning one level up: it would have to be edited every time a page picks a different
 * component, and editing a guard to make it pass is how a guard stops meaning anything.
 */

/** The balanced `{...}` starting at or after `from`. */
const blockAt = (src: string, from: number): string => {
  const open = src.indexOf('{', from)
  if (open < 0) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return ''
}

export interface ReasonCheck { ok: boolean; why: string }

/**
 * @param src     the file's source
 * @param anchor  matches the start of the handler, e.g. /const moveTo = async/ or /async function order\(/
 * @param label   what to call it in the failure message
 */
export function surfacesTheReason(src: string, anchor: RegExp, label: string): ReasonCheck {
  const at = src.search(anchor)
  if (at < 0) return { ok: false, why: `${label}: no handler matching ${anchor} — this check is testing nothing` }

  // The first catch inside the handler. Searching forward from the anchor rather than balancing the
  // whole function, because a TS return type's braces close before the body's do and brace-matching
  // from the signature silently returns the type annotation instead. (Learned the hard way.)
  const window = src.slice(at, at + 4000)
  // `catch (err: any)` is as common here as `catch (err)` — the optional type annotation is the
  // reason the first version of this reported "no catch block" on two handlers that have one.
  const m = /catch\s*\(\s*([A-Za-z_$][\w$]*)\s*(?::\s*[^)]*)?\)/.exec(window)
  if (!m) return { ok: false, why: `${label}: has no catch block, so a failure is silent` }

  const caught = m[1]
  const body = blockAt(window, m.index + m[0].length)
  if (!body) return { ok: false, why: `${label}: could not read the catch block` }

  const mentions = new RegExp(`(?<![\\w$])${caught}(?![\\w$])`)
  if (!mentions.test(body)) {
    return { ok: false, why: `${label}: discards the caught error, so the user sees a generic failure instead of the server's reason` }
  }
  // Anything that is only logged is a message to nobody.
  const rendered = body.split('\n').filter((l) => !/^\s*console\./.test(l.trim())).join('\n')
  if (!mentions.test(rendered)) {
    return { ok: false, why: `${label}: only logs the reason to the console — nothing on screen tells the user why it failed` }
  }
  return { ok: true, why: '' }
}

/**
 * …and the same question for a SUCCESS that carries caveats: the server's `warnings` must reach the
 * screen rather than being dropped. The RV inventory form flagged unusual pricing and announced it
 * in an alert() fired a line before the modal closed.
 */
export function surfacesWarnings(src: string, label: string): ReasonCheck {
  if (!/warnings/.test(src)) return { ok: false, why: `${label}: never reads the server's warnings` }
  const onlyLogged = /console\.\w+\([^)]*warnings/.test(src) && !/(set\w*\(|onSave\(|toast)[^\n]*warnings/.test(src)
  if (onlyLogged) return { ok: false, why: `${label}: logs the warnings instead of showing them` }
  return { ok: true, why: '' }
}
