/**
 * ROOFING — a crew member's work orders in the phone app (roofing parity row 29; AccuLynx Crew App; crew_app, not ready).
 *
 * A seat on a crew (its crew login, set on the Crews page) sees that crew's work orders (GET /api/crew-orders — apps/unified
 * server/crm/roof/crewOrders.ts). Each answer goes through the crew link's own routes (/api/crew-link/:token/accept | reject | arrive |
 * leave | check | complete), the same rules as the no-sign-in page, and is kept on the phone with no signal under the order's key.
 * Photos are added on the order's page (it opens in the browser, signed in by its link).
 */
import { type ScreenSpec, type Row, words, join } from './kit'

const maps = (address?: string | null) => (address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : '')
const day = (v?: string | null) => (v ? new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : undefined)
const tone = (s: string): Row['tone'] => (s === 'in_progress' ? 'info' : s === 'accepted' ? 'success' : s === 'sent' ? 'warning' : 'neutral')

export const orderRow = (o: any): Row & { id: string } => ({
  id: o.id, key: o.id, title: o.title || 'Work order', subtitle: join(o.address, day(o.startDate)),
  badge: words(o.status === 'in_progress' ? 'in progress' : o.status === 'sent' ? 'needs your answer' : o.status), tone: tone(o.status),
})

const key = (d: any) => `wo:${d.id}`

export const ROOF_CREW: ScreenSpec[] = [
  {
    id: 'roof-crew-orders', title: 'My work orders', any: ['jobs:read'], feature: 'crew_app',
    list: { path: '/api/crew-orders' }, rows: orderRow,
    empty: { title: 'No work orders', body: 'Work orders sent to your crew show here. If you are on a crew and see none, ask the office to add you to it on the Crews page.' },
    detail: {
      path: (id) => `/api/crew-orders/${id}`, title: (d) => d.title || 'Work order', subtitle: (d) => join(d.address, day(d.startDate)),
      badge: (d) => words(d.status === 'in_progress' ? 'in progress' : d.status),
      sections: [
        { links: (d) => [
          ...(d.address ? [{ label: `Directions to ${d.address}`, url: maps(d.address), icon: 'navigate', directions: d.address }] : []),
          ...(d.company?.phone ? [{ label: `Call ${d.company.name || 'the office'}`, url: `tel:${d.company.phone}`, icon: 'call' }] : []),
          ...(d.linkUrl && d.can?.photos ? [{ label: 'Add photos (opens the work order page)', url: d.linkUrl, icon: 'camera' }] : []),
        ] },
        { fields: [{ label: 'Scope', get: (d) => d.scope }, { label: 'Start', get: (d) => day(d.startDate) }, { label: 'Note', get: (d) => d.completionNote }] },
        { title: 'Materials', rows: (d) => (d.materials || []).map((m: any, i: number) => ({ key: `m${i}`, title: m.description, meta: `${m.qty} ${m.unit}` })), empty: 'No materials listed.' },
        { title: 'Checklist', rows: (d) => (d.checklist || []).map((c: any) => ({ key: c.id, title: c.text, badge: d.checks?.[c.id] ? 'done' : undefined, tone: d.checks?.[c.id] ? 'success' as const : undefined })) },
      ],
      actions: [
        { id: 'accept', label: 'Accept', icon: 'checkmark', any: ['jobs:read'], when: (d) => !!d.can?.accept,
          inputs: [{ id: 'name', label: 'Your full name', required: true, initial: (d) => d.recipientName || '' }],
          offline: (d) => ({ key: key(d), label: `${d.title} · accepted` }),
          request: (d, v) => ({ method: 'POST', path: `/api/crew-link/${d.id}/accept`, body: { name: v.name } }), done: 'Accepted' },
        { id: 'arrive', label: 'I’m here', icon: 'location', any: ['jobs:read'], feature: 'crew_scheduling', when: (d) => !!d.can?.arrive && (d.status !== 'in_progress' || !!d.leftAt),
          offline: (d) => ({ key: key(d), label: `${d.title} · on site` }),
          request: (d) => ({ method: 'POST', path: `/api/crew-link/${d.id}/arrive`, body: {} }), done: 'The office knows you are there' },
        { id: 'check', label: 'Tick off a checklist item', icon: 'checkbox', any: ['jobs:read'], feature: 'crew_scheduling', when: (d) => !!d.can?.complete && (d.checklist || []).some((c: any) => !d.checks?.[c.id]),
          inputs: [{ id: 'item', label: 'Which one?', required: true, options: { path: (d) => `/api/crew-orders/${d.id}`, pick: (b) => (b?.checklist || []).filter((c: any) => !b?.checks?.[c.id]), label: (c) => c.text, value: (c) => c.id, none: 'Everything is ticked.', loading: 'Loading the checklist…' } }],
          offline: (d) => ({ key: key(d), label: `${d.title} · checklist` }),
          request: (d, v) => ({ method: 'POST', path: `/api/crew-link/${d.id}/check`, body: { itemId: v.item, done: true } }), done: 'Ticked' },
        { id: 'leave', label: 'Leaving for now', icon: 'exit', any: ['jobs:read'], feature: 'crew_scheduling', when: (d) => !!d.can?.leave && !d.leftAt,
          offline: (d) => ({ key: key(d), label: `${d.title} · left for now` }),
          request: (d) => ({ method: 'POST', path: `/api/crew-link/${d.id}/leave`, body: {} }), done: 'The office knows you left' },
        { id: 'complete', label: 'Mark this work done', icon: 'checkmark-circle', any: ['jobs:read'], when: (d) => !!d.can?.complete,
          confirm: { title: 'Mark this work done?', body: () => 'The office is told the work is finished. Add your photos on the work order page first.', button: 'Done' },
          inputs: [{ id: 'note', label: 'Anything the office should know (optional)', kind: 'multiline' }],
          offline: (d) => ({ key: key(d), label: `${d.title} · done` }),
          request: (d, v) => ({ method: 'POST', path: `/api/crew-link/${d.id}/complete`, body: { note: v.note || undefined } }), done: 'Marked done' },
        { id: 'reject', label: 'I can’t take this', icon: 'close-circle', any: ['jobs:read'], when: (d) => !!d.can?.reject,
          inputs: [{ id: 'name', label: 'Your full name', required: true, initial: (d) => d.recipientName || '' }, { id: 'reason', label: 'Why not?', kind: 'multiline', required: true }],
          request: (d, v) => ({ method: 'POST', path: `/api/crew-link/${d.id}/reject`, body: { name: v.name, reason: v.reason } }), done: 'The office is told' },
      ],
    },
  },
]
