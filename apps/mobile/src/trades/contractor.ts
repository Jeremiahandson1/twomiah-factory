/**
 * THE CONTRACTOR'S PROJECTS ON THE PHONE (contractor parity row 11; docs/parity/contractor-phone.md; Buildertrend / JobTread mobile;
 * contractor_phone, not ready). Written as data for the trade kit (./kit.ts): a project, and from it today's daily log, the
 * project's daily logs with their photos, its punch list and its to-dos — each save kept on the phone with no signal (the queue is
 * at-least-once, so every offline save here is safe to send twice: the daily log is "my log for today", a new punch item names its
 * own id, completing is the same answer twice, a photo upload is named from the save).
 */
import { type ScreenSpec, type Row, words, join, dayOnly, photosBody } from './kit'

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
]
