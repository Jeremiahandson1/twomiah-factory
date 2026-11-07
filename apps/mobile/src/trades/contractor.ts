/**
 * THE CONTRACTOR'S PROJECTS ON THE PHONE (contractor parity row 11; docs/parity/contractor-phone.md; Buildertrend / JobTread mobile;
 * contractor_phone, not ready). Written as data for the trade kit (./kit.ts): a project, and from it today's daily log, the
 * project's daily logs with their photos, its punch list and its to-dos — each save kept on the phone with no signal (the queue is
 * at-least-once, so every offline save here is safe to send twice: the daily log is "my log for today", a new punch item names its
 * own id, completing is the same answer twice, a photo upload is named from the save).
 *
 * Row 11b: the project's change orders (raised on the phone, naming their own id; submitted to the client, who approves and signs in
 * their portal), its selections (ordered / received), its files and plans (opened signed in, in the app's own browser), and its
 * inspections (passed or failed on site — the same result sent twice is that result).
 */
import { type ScreenSpec, type Row, words, join, dayOnly, money, photosBody } from './kit'

const key = (kind: string, id: string) => `${kind}:${id}`
/** What a clock-in names (row 11): the job, or the project and one of its cost codes — only what was chosen. */
export const clockInExtras = (jobId: string | null, projectId: string | null, costCode: string | null) => ({
  ...(jobId ? { jobId } : {}), ...(projectId ? { projectId } : {}), ...(projectId && costCode ? { costCode } : {}),
})
/** A cuid-like id the phone makes for a record it creates, so a second send is the same record (punchLists.ts). */
export const newId = () => `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 32)
const tone = (s: string): Row['tone'] => (s === 'completed' || s === 'verified' ? 'success' : s === 'open' || s === 'pending' ? 'warning' : 'neutral')
const sub = (route: string, d: any, label: string, icon: string) => ({ label, url: '', route: `${route}?projectId=${encodeURIComponent(d.id)}`, icon })

export const CONTRACTOR: ScreenSpec[] = [
  {
    id: 'con-projects', title: 'Projects', any: ['projects:read'], feature: 'contractor_phone',
    list: { path: '/api/projects', query: { status: 'active', limit: '50' } },
    chips: [{ id: 'active', label: 'Active', query: { status: 'active' } }, { id: 'planning', label: 'Planning', query: { status: 'planning' } }, { id: 'all', label: 'All', query: { status: '' } }],
    search: { param: 'search', placeholder: 'Search projects' },
    rows: (p) => ({ id: p.id, key: p.id, title: p.name || p.number || 'Project', subtitle: join(p.number, p.city), badge: words(p.status) }),
    empty: { title: 'No projects', body: 'Projects the office has made show here.' },
    detail: {
      path: (id) => `/api/projects/${id}`,
      title: (d) => d.name || 'Project', subtitle: (d) => join(d.number, d.address, d.city), badge: (d) => words(d.status),
      sections: [
        { links: (d) => [
          sub('/(details)/t/con-daily-logs', d, 'Daily logs', 'journal'),
          sub('/(details)/t/con-punch', d, 'Punch list', 'construct'),
          sub('/(details)/t/con-todos', d, 'To-dos', 'checkbox'),
          sub('/(details)/t/con-change-orders', d, 'Change orders', 'document-text'),
          sub('/(details)/t/con-selections', d, 'Selections', 'color-palette'),
          sub('/(details)/t/con-files', d, 'Files & plans', 'folder-open'),
          sub('/(details)/t/con-inspections', d, 'Inspections', 'clipboard'),
          ...(d.address ? [{ label: `Directions to ${d.address}`, url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([d.address, d.city].filter(Boolean).join(', '))}`, icon: 'navigate', directions: [d.address, d.city].filter(Boolean).join(', ') }] : []),
        ] },
        { fields: [{ label: 'Start', get: (d) => dayOnly(d.startDate) }, { label: 'End', get: (d) => dayOnly(d.endDate) }, { label: 'Progress', get: (d) => (d.progress == null ? undefined : `${d.progress}%`) }] },
      ],
      actions: [
        { id: 'today-log', label: 'Today’s daily log', icon: 'journal', any: ['daily-logs:create'], feature: 'daily_logs',
          inputs: [
            { id: 'weather', label: 'Weather' },
            { id: 'workPerformed', label: 'Work done today', kind: 'multiline', required: true },
            { id: 'crewSize', label: 'How many on site', kind: 'number' },
            { id: 'delays', label: 'Delays (the office only)', kind: 'multiline' },
            { id: 'safetyNotes', label: 'Safety notes (the office only)', kind: 'multiline' },
          ],
          offline: (d) => ({ key: key('log', d.id), label: `${d.name} · today’s log` }),
          request: (d, v) => ({ method: 'PUT', path: `/api/daily-logs/mine/${d.id}/today`, body: {
            ...(v.weather ? { weather: v.weather } : {}), workPerformed: v.workPerformed,
            ...(v.crewSize && Number.isFinite(Number(v.crewSize)) ? { crewSize: Number(v.crewSize) } : {}),
            ...(v.delays ? { delays: v.delays } : {}), ...(v.safetyNotes ? { safetyNotes: v.safetyNotes } : {}),
          } }), done: 'Today’s log is saved' },
        { id: 'add-punch', label: 'Add a punch item', icon: 'add-circle', any: ['punch-lists:create'], feature: 'punch_lists',
          inputs: [
            { id: 'description', label: 'What needs doing', kind: 'multiline', required: true },
            { id: 'location', label: 'Where' },
            { id: 'priority', label: 'How urgent', kind: 'choice', choices: ['low', 'normal', 'high', 'urgent'], initial: () => 'normal' },
          ],
          offline: (d) => ({ key: key('punch', d.id), label: `${d.name} · punch item` }),
          request: (d, v) => ({ method: 'POST', path: '/api/punch-lists', body: { id: newId(), projectId: d.id, description: v.description, ...(v.location ? { location: v.location } : {}), priority: v.priority || 'normal' } }),
          done: 'Added to the punch list' },
        { id: 'add-co', label: 'Raise a change order', icon: 'document-text', any: ['change-orders:create'], feature: 'change_orders',
          inputs: [
            { id: 'title', label: 'What is changing', required: true },
            { id: 'description', label: 'Details for the client', kind: 'multiline' },
            { id: 'amount', label: 'Amount ($; a credit with a minus)', kind: 'number', required: true },
            { id: 'daysAdded', label: 'Days added to the schedule', kind: 'number' },
          ],
          offline: (d) => ({ key: key('co', d.id), label: `${d.name} · change order` }),
          request: (d, v) => ({ method: 'POST', path: '/api/change-orders', body: {
            id: newId(), projectId: d.id, title: v.title, ...(v.description ? { description: v.description } : {}),
            amount: Number(v.amount) || 0, daysAdded: Math.max(0, Math.round(Number(v.daysAdded) || 0)),
          } }), done: 'Change order raised as a draft' },
      ],
    },
  },
  {
    id: 'con-daily-logs', title: 'Daily logs', any: ['daily-logs:read'], feature: 'contractor_phone',
    list: { path: '/api/daily-logs', query: { limit: '50' } },
    rows: (r) => { const l = r.dailyLog ?? r; return { id: l.id, key: l.id, title: dayOnly(l.date) || 'Daily log', subtitle: l.workPerformed ? String(l.workPerformed).slice(0, 80) : undefined, meta: join(l.weather, (l.photos || []).length ? `${l.photos.length} photo${l.photos.length === 1 ? '' : 's'}` : undefined), badge: r.user ? join(r.user.firstName, r.user.lastName) : undefined } },
    empty: { title: 'No daily logs yet', body: 'Write today’s from the project.' },
    detail: {
      path: (id) => `/api/daily-logs/${id}`,
      title: (d) => dayOnly((d.dailyLog ?? d).date) || 'Daily log',
      subtitle: (d) => (d.dailyLog ?? d).weather || undefined,
      sections: [
        { fields: [
          { label: 'Work done', get: (d) => (d.dailyLog ?? d).workPerformed }, { label: 'Crew on site', get: (d) => { const n = (d.dailyLog ?? d).crewSize; return n == null ? undefined : String(n) } },
          { label: 'Delays', get: (d) => (d.dailyLog ?? d).delays }, { label: 'Safety', get: (d) => (d.dailyLog ?? d).safetyNotes },
        ] },
        { title: 'Photos', rows: (d) => ((d.dailyLog ?? d).photos || []).map((p: any) => ({ key: p.id, title: p.caption || p.name || 'Photo', meta: dayOnly(p.uploadedAt) })), empty: 'No photos yet.' },
      ],
      actions: [
        { id: 'add-photos', label: 'Add photos', icon: 'camera', any: ['daily-logs:create', 'daily-logs:update'],
          inputs: [{ id: 'photos', label: 'Photos of the day', kind: 'photos', required: true }, { id: 'caption', label: 'Caption (optional)' }],
          offline: (d) => ({ key: key('logphotos', (d.dailyLog ?? d).id), label: `${dayOnly((d.dailyLog ?? d).date)} · photos` }),
          request: (d, v) => { const id = (d.dailyLog ?? d).id; return { method: 'POST', path: `/api/daily-logs/${id}/photos/saved`, body: photosBody(`/api/daily-logs/${id}/photos/file`, v.photos, v.caption ? { caption: v.caption } : {}) } },
          done: 'Photos added' },
      ],
    },
  },
  {
    id: 'con-punch', title: 'Punch list', any: ['punch-lists:read'], feature: 'contractor_phone',
    list: { path: '/api/punch-lists', query: { limit: '100' } },
    chips: [{ id: 'open', label: 'Open', query: { status: 'open' } }, { id: 'completed', label: 'Done', query: { status: 'completed' } }, { id: 'all', label: 'All', query: { status: '' } }],
    rows: (r) => { const i = r.punchListItem ?? r; return { id: i.id, key: i.id, title: i.description, subtitle: join(i.number, i.location), badge: words(i.status), tone: tone(i.status) } },
    empty: { title: 'Nothing on the punch list', body: 'Add an item from the project.' },
    detail: {
      path: (id) => `/api/punch-lists/${id}`,
      title: (d) => (d.punchListItem ?? d).description, subtitle: (d) => join((d.punchListItem ?? d).number, (d.punchListItem ?? d).location), badge: (d) => words((d.punchListItem ?? d).status),
      sections: [
        { fields: [{ label: 'Priority', get: (d) => words((d.punchListItem ?? d).priority) }, { label: 'Due', get: (d) => dayOnly((d.punchListItem ?? d).dueDate) }] },
        { title: 'Photos', rows: (d) => ((d.punchListItem ?? d).photos || []).map((p: any) => ({ key: p.id, title: p.caption || p.name || 'Photo' })), empty: 'No photos yet.' },
      ],
      actions: [
        { id: 'complete', label: 'Mark done', icon: 'checkmark-circle', any: ['punch-lists:update'], when: (d) => (d.punchListItem ?? d).status === 'open',
          offline: (d) => ({ key: key('punchitem', (d.punchListItem ?? d).id), label: `${(d.punchListItem ?? d).number} · done` }),
          request: (d) => ({ method: 'POST', path: `/api/punch-lists/${(d.punchListItem ?? d).id}/complete`, body: {} }), done: 'Marked done' },
        { id: 'photos', label: 'Add photos', icon: 'camera', any: ['punch-lists:update'],
          inputs: [{ id: 'photos', label: 'Photos', kind: 'photos', required: true }],
          offline: (d) => ({ key: key('punchitem', (d.punchListItem ?? d).id), label: `${(d.punchListItem ?? d).number} · photos` }),
          request: (d, v) => { const id = (d.punchListItem ?? d).id; return { method: 'POST', path: `/api/punch-lists/${id}/photos/saved`, body: photosBody(`/api/punch-lists/${id}/photos/file`, v.photos) } },
          done: 'Photos added' },
      ],
    },
    waitingKey: (d) => key('punchitem', (d.punchListItem ?? d).id),
  },
  {
    id: 'con-todos', title: 'To-dos', any: ['tasks:read'], feature: 'contractor_phone',
    list: { path: '/api/tasks', query: { limit: '100' } },
    chips: [{ id: 'open', label: 'Open', query: { status: 'pending' } }, { id: 'mine', label: 'Mine', query: { mine: 'true' } }, { id: 'done', label: 'Done', query: { status: 'completed' } }],
    rows: (t) => ({ id: t.id, key: t.id, title: t.title, subtitle: join(dayOnly(t.dueDate) ? `Due ${dayOnly(t.dueDate)}` : undefined, t.assignedTo ? join(t.assignedTo.firstName, t.assignedTo.lastName) : undefined), badge: words(t.status), tone: tone(t.status) }),
    empty: { title: 'No to-dos', body: 'To-dos on this project show here.' },
    detail: {
      path: (id) => `/api/tasks/${id}`,
      title: (d) => d.title, subtitle: (d) => (dayOnly(d.dueDate) ? `Due ${dayOnly(d.dueDate)}` : undefined), badge: (d) => words(d.status),
      sections: [
        { fields: [{ label: 'Notes', get: (d) => d.description }, { label: 'Priority', get: (d) => words(d.priority) }] },
        { title: 'Checklist', rows: (d) => (d.checklist || []).map((c: any) => ({ key: c.id || c.text, title: c.text || c.title, badge: c.done || c.completed ? 'done' : undefined, tone: c.done || c.completed ? 'success' as const : undefined })) },
      ],
      actions: [
        { id: 'done', label: 'Mark done', icon: 'checkmark-circle', any: ['tasks:update'], when: (d) => d.status !== 'completed',
          offline: (d) => ({ key: key('task', d.id), label: `${d.title} · done` }),
          request: (d) => ({ method: 'PUT', path: `/api/tasks/${d.id}`, body: { status: 'completed' } }), done: 'Marked done' },
      ],
    },
    waitingKey: (d) => key('task', d.id),
  },
  {
    id: 'con-change-orders', title: 'Change orders', any: ['change-orders:read'], feature: 'contractor_phone',
    list: { path: '/api/change-orders', query: { limit: '100' } },
    rows: (o) => ({ id: o.id, key: o.id, title: o.title, subtitle: join(o.number, o.amount != null ? money(o.amount) : undefined), badge: words(o.status), tone: o.status === 'approved' ? 'success' : o.status === 'rejected' ? 'danger' : o.status === 'submitted' ? 'warning' : 'neutral' }),
    empty: { title: 'No change orders', body: 'Raise one from the project.' },
    detail: {
      path: (id) => `/api/change-orders/${id}`,
      title: (d) => d.title, subtitle: (d) => join(d.number, money(d.amount)), badge: (d) => words(d.status),
      sections: [
        { fields: [{ label: 'Details', get: (d) => d.description }, { label: 'Amount', get: (d) => money(d.amount), money: true }, { label: 'Days added', get: (d) => (d.daysAdded ? String(d.daysAdded) : undefined) }, { label: 'Approved by', get: (d) => d.approvedBy }] },
        { title: 'Lines', rows: (d) => (d.lineItems || []).map((l: any, i: number) => ({ key: l.id || String(i), title: l.description, meta: money(Number(l.quantity) * Number(l.unitPrice)) })) },
      ],
      actions: [
        // Sent to the client, who approves and signs in their portal (Buildertrend). Needs signal: a second send would be refused.
        { id: 'submit', label: 'Send to the client', icon: 'send', any: ['change-orders:update'], when: (d) => d.status === 'draft',
          confirm: { title: 'Send this change order to the client?', body: (d) => `${d.number} goes to the client to approve and sign in their portal.`, button: 'Send' },
          request: (d) => ({ method: 'POST', path: `/api/change-orders/${d.id}/submit`, body: {} }), done: 'Sent to the client' },
      ],
    },
  },
  {
    id: 'con-selections', title: 'Selections', any: ['selections:read'], feature: 'contractor_phone',
    list: { path: '/api/selections/project/{projectId}' },
    rows: (x) => ({ id: x.id, key: x.id, title: x.name, subtitle: join(x.location, x.selectedOption?.name), badge: words(x.status), tone: x.status === 'approved' || x.status === 'received' ? 'success' : x.status === 'pending' ? 'warning' : 'neutral' }),
    empty: { title: 'No selections', body: 'The client’s selections on this project show here.' },
    detail: {
      path: () => null,
      title: (d) => d.name, subtitle: (d) => join(d.location, d.category?.name), badge: (d) => words(d.status),
      sections: [{ fields: [
        { label: 'Chosen', get: (d) => d.selectedOption?.name }, { label: 'Maker', get: (d) => join(d.selectedOption?.manufacturer, d.selectedOption?.model) },
        { label: 'Quantity', get: (d) => (d.quantity ? `${d.quantity} ${d.unit || ''}`.trim() : undefined) }, { label: 'Order number', get: (d) => d.orderNumber },
        { label: 'Expected', get: (d) => dayOnly(d.expectedDelivery) },
      ] }],
      actions: [
        { id: 'ordered', label: 'Mark ordered', icon: 'cart', any: ['selections:update'], when: (d) => d.status === 'approved',
          inputs: [{ id: 'orderNumber', label: 'Order number (optional)' }],
          offline: (d) => ({ key: key('sel', d.id), label: `${d.name} · ordered` }),
          request: (d, v) => ({ method: 'POST', path: `/api/selections/${d.id}/ordered`, body: v.orderNumber ? { orderNumber: v.orderNumber } : {} }), done: 'Marked ordered' },
        { id: 'received', label: 'Mark received on site', icon: 'cube', any: ['selections:update'], when: (d) => d.status === 'ordered',
          inputs: [{ id: 'notes', label: 'Notes (optional)', kind: 'multiline' }],
          offline: (d) => ({ key: key('sel', d.id), label: `${d.name} · received` }),
          request: (d, v) => ({ method: 'POST', path: `/api/selections/${d.id}/received`, body: v.notes ? { notes: v.notes } : {} }), done: 'Marked received' },
      ],
    },
    waitingKey: (d) => key('sel', d.id),
  },
  {
    id: 'con-files', title: 'Files & plans', any: ['documents:read'], feature: 'contractor_phone',
    list: { path: '/api/documents', query: { limit: '100' } },
    rows: (f) => ({ id: f.id, key: f.id, title: f.name, subtitle: join(words(f.type), dayOnly(f.createdAt)) }),
    empty: { title: 'No files', body: 'Plans, contracts and photos filed on this project show here.' },
    detail: {
      path: () => null,
      title: (d) => d.name, subtitle: (d) => join(words(d.type), dayOnly(d.createdAt)),
      sections: [
        // Opened signed in, in the app's own private browser (app/(details)/web.tsx): a plan PDF zooms there.
        { links: (d) => [{ label: 'Open it', url: '', route: `/(details)/web?path=${encodeURIComponent(`/api/documents/${d.id}/file`)}&title=${encodeURIComponent(d.name || 'File')}`, icon: 'open' }] },
        { fields: [{ label: 'Notes', get: (d) => d.description }] },
      ],
    },
  },
  {
    id: 'con-inspections', title: 'Inspections', any: ['inspections:read'], feature: 'contractor_phone',
    list: { path: '/api/inspections', query: { limit: '100' } },
    rows: (i) => ({ id: i.id, key: i.id, title: join(i.number, words(i.type)) || 'Inspection', subtitle: join(dayOnly(i.scheduledDate), i.inspector), badge: words(i.status), tone: i.status === 'passed' ? 'success' : i.status === 'failed' ? 'danger' : 'warning' }),
    empty: { title: 'No inspections', body: 'Inspections on this project show here.' },
    detail: {
      path: () => null,
      title: (d) => join(d.number, words(d.type)) || 'Inspection', subtitle: (d) => join(dayOnly(d.scheduledDate), d.inspector), badge: (d) => words(d.status),
      sections: [{ fields: [{ label: 'Notes', get: (d) => d.notes }, { label: 'Deficiencies', get: (d) => d.deficiencies }, { label: 'Result recorded by', get: (d) => d.resultedBy }] }],
      actions: [
        { id: 'pass', label: 'Passed', icon: 'checkmark-circle', any: ['inspections:update'], when: (d) => d.status !== 'passed' && d.status !== 'failed',
          confirm: { title: 'Record a pass?', body: (d) => `${d.number || 'This inspection'} is recorded as passed. A result is not edited afterwards.`, button: 'Passed' },
          offline: (d) => ({ key: key('insp', d.id), label: `${d.number} · passed` }),
          request: (d) => ({ method: 'POST', path: `/api/inspections/${d.id}/pass`, body: {} }), done: 'Recorded as passed' },
        { id: 'fail', label: 'Failed', icon: 'close-circle', any: ['inspections:update'], when: (d) => d.status !== 'passed' && d.status !== 'failed',
          inputs: [{ id: 'deficiencies', label: 'What failed', kind: 'multiline', required: true }],
          confirm: { title: 'Record a fail?', body: (d) => `${d.number || 'This inspection'} is recorded as failed, with what failed.`, button: 'Failed' },
          offline: (d) => ({ key: key('insp', d.id), label: `${d.number} · failed` }),
          request: (d, v) => ({ method: 'POST', path: `/api/inspections/${d.id}/fail`, body: { deficiencies: v.deficiencies } }), done: 'Recorded as failed' },
      ],
    },
    waitingKey: (d) => key('insp', d.id),
  },
]
