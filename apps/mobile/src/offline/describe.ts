/**
 * What the "waiting to send" list says about a queued save, in plain words — and where "tap to fix" leads.
 * Pure (tests/mobile/job-flow.test.ts). The list screen is app/(details)/waiting.tsx.
 */
import type { ItemView } from './engine'

export interface ItemLine {
  id: string
  title: string
  /** 'Waiting to send' | "Couldn't send — tap to fix" | 'Waiting for the one before it' | 'Sending…' */
  headline: string
  /** The server's own words for a refusal; the last problem for a send that keeps failing. */
  detail: string | null
  failed: boolean
  /** A screen to open to fix it, or null (then the list offers Try again / Discard). */
  open: string | null
}

const KINDS: Array<[RegExp, string]> = [
  [/\/dispatch$/, 'On my way'], [/\/start$/, 'Arrived'], [/\/complete$/, 'Completed'],
  [/\/checklists\/job\/[^/]+\/submit$/, 'Checklist'], [/\/checklists\/submissions\/[^/]+\/sign$/, 'Customer signature'],
  [/\/clock-in$|\/clock\/in$/, 'Clock in'], [/\/clock-out$|\/clock\/out$/, 'Clock out'], [/\/tips\/declared\/mine$/, 'Cash tips'],
]

/** The record this save is about, as a screen: a job's saves lead to the job. */
export const openFor = (item: Pick<ItemView, 'recordKey' | 'path'>): string | null => {
  const m = /^job:(.+)$/.exec(item.recordKey || '')
  return m ? `/(details)/job/${m[1]}` : null
}

export function describeItem(item: ItemView): ItemLine {
  const kind = KINDS.find(([re]) => re.test(item.path))?.[1]
  const title = item.label || (kind ? kind : `${item.method} ${item.path}`)
  const failed = item.state === 'failed'
  const headline = failed ? "Couldn't send — tap to fix"
    : item.blocked ? 'Waiting for the one before it'
    : item.state === 'sending' ? 'Sending…'
    : 'Waiting to send'
  const detail = failed ? (item.refusal?.message || item.lastError || null) : item.lastError || null
  return { id: item.id, title, headline, detail, failed, open: failed ? openFor(item) : null }
}

/** Failed first (they need a person), then the order they were made. */
export const orderForList = (items: ItemView[]): ItemView[] =>
  [...items].sort((a, b) => Number(b.state === 'failed') - Number(a.state === 'failed'))
