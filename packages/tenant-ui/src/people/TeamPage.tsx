// Team roster — ONE page for every CRM (vendored into each template as ../shared). Talks to the shared /api/team routes.
// Before: three copies (typed / untyped / salon label). Login accounts shown as the fallback roster (`_source: 'user'`)
// used to get Edit/Delete actions that hit the team_member table and 404'd — they are read-only here with a pointer to
// Settings → Users.
import React, { useState, useEffect, useCallback } from 'react'
import { Plus, Edit, Trash2, Users } from 'lucide-react'
import { DataTable, PageHeader, Button, Modal, ConfirmModal, Field, inputCls, errMsg } from '../invoicing/ui'
import { useAuth } from '../auth/AuthContext'
import { meetsRole } from '../shell/types'
import type { Pagination } from '../invoicing/ui'
import { ROLE_LABELS } from '../shell/types'
import type { PeopleApi, PeopleToast, TeamConfig } from './types'
import { useMayWrite, usePermissions } from '../auth/PermissionsContext'
import { money } from '../money'

interface Member { id: string; name: string; email?: string | null; phone?: string | null; role?: string | null; department?: string | null; hourlyRate?: string | number | null; locationId?: string | null; active: boolean; assignedJobs?: number; hasLogin?: boolean; _source?: 'user' }
const EMPTY = { name: '', email: '', phone: '', role: '', department: '', hourlyRate: '', locationId: '' }

export function TeamPage({ api, toast, config }: { api: PeopleApi; toast: PeopleToast; config?: TeamConfig }) {
  // team:create / team:update are admin-and-up on the server, so the page has to agree: a manager was
  // shown "Add Member" and got a 403 for pressing it. (Salon T29 L1)
  const { user: signedIn } = useAuth()
  const canManageRoster = meetsRole((signedIn as any)?.role, 'admin')
  const roleLabel = config?.roleLabel || 'Job Title / Trade'
  const rolePlaceholder = config?.rolePlaceholder || 'e.g. Lead Technician'
  // What the roster holds, in this vertical's words (TeamConfig): a department and an hourly rate unless it says it has none.
  const showDepartment = config?.department !== false
  const showRate = config?.hourlyRate !== false
  const [data, setData] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const [form, setForm] = useState(EMPTY)
  /** Branches, where the tenant runs several — the template's OWN feature check, never assumed on. */
  const hasBranches = !!config?.hasFeature?.('multi_location')
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  useEffect(() => {
    if (!hasBranches) { setBranches([]); return }
    api.get('/api/locations', { active: 'true' }).then((r: any) => setBranches(r?.data || [])).catch(() => setBranches([]))
  }, [hasBranches]) // eslint-disable-line react-hooks/exhaustive-deps
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [toDelete, setToDelete] = useState<Member | null>(null)
  // What this vertical calls the work a member holds. A contractor holds jobs, a stylist holds appointments —
  // this page used to tell a salon its stylist's "jobs" would be left unassigned. (Salon T27 N14)
  const [workLabel, setWorkLabel] = useState({ one: 'job', many: 'jobs' })
  /**
   * The logins on each roster crew, and the logins that can be put on one (config.crewLogins): a crew's jobs reach the
   * phones of the logins on it (crew scope, 2026-10-24). Set by whoever may edit the roster (team:update, as the server).
   */
  const crewLogins = !!config?.crewLogins
  const [linked, setLinked] = useState<Record<string, Array<{ id: string; name: string }>>>({})
  const [logins, setLogins] = useState<Array<{ id: string; name: string }>>([])
  const [pickedLogins, setPickedLogins] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/team', { page, limit: 25 }); setData(res?.data || []); setPagination(res?.pagination || null); if (res?.workLabel?.one) setWorkLabel(res.workLabel)
      if (crewLogins) { const l = await api.get('/api/team/logins').catch(() => null); setLinked(Object.fromEntries((l?.data || []).map((r: any) => [r.teamMemberId, r.logins || []]))) }
    }
    catch (e) { toast.error(errMsg(e, 'Failed to load team')) }
    finally { setLoading(false) }
  }, [api, page, crewLogins])
  useEffect(() => { load() }, [load])

  const fromLogins = data.length > 0 && data.every((m) => m._source === 'user')

  const handleSave = async () => {
    if (!form.name.trim()) { setFormError('Name is required'); return }
    if (showRate && form.hourlyRate !== '' && Number(form.hourlyRate) < 0) { setFormError('Hourly rate cannot be negative'); return }
    setSaving(true); setFormError('')
    try {
      // A box this vertical does not show is not sent, so saving never blanks what another screen or an earlier save put there.
      const payload = { name: form.name.trim(), email: form.email.trim() || null, phone: form.phone.trim() || null, role: form.role.trim() || null, ...(showDepartment ? { department: form.department.trim() || null } : {}), ...(showRate ? { hourlyRate: form.hourlyRate === '' ? null : Number(form.hourlyRate) } : {}), ...(hasBranches ? { locationId: form.locationId || null } : {}) }
      // A login account is shown here on loan from the user table, under ITS id — so PUT /api/team/:id has
      // nothing to update and answered 404, which left the row menu doing nothing and six of seven people on
      // this tenant with no way to hold a pay rate. Saving one creates their roster card instead: the roster
      // is "the people you schedule and pay", the user row is the login, and the list matches the two by
      // email so they stop appearing twice. (Contractor T29 M2)
      let savedId: string | undefined
      if (editing && editing._source !== 'user') { await api.put(`/api/team/${editing.id}`, payload); savedId = editing.id; toast.success('Team member updated') }
      else { const made = await api.post('/api/team', payload); savedId = made?.id; toast.success(editing ? `${payload.name} added to the roster` : 'Team member added') }
      // The logins on this crew, when the roster takes them and the person may edit it (team:update on the server too).
      if (crewLogins && mayEditRoster && savedId) await api.put(`/api/team/${savedId}/logins`, { userIds: pickedLogins })
      setModalOpen(false); load()
    } catch (e) { setFormError(errMsg(e, 'Failed to save team member')) }
    finally { setSaving(false) }
  }
  const handleDelete = async () => {
    if (!toDelete) return
    try {
      // Say what it cost. Removing someone sets their jobs back to unassigned, which used to happen silently.
      const res: any = await api.delete('/api/team', toDelete.id)
      const freed = Number(res?.unassignedJobs || 0)
      const noun = res?.unassignedLabel?.one ? res.unassignedLabel : workLabel
      toast.success(freed > 0 ? `Team member removed — ${freed} ${freed === 1 ? noun.one + ' is' : noun.many + ' are'} now unassigned` : 'Team member removed')
      setToDelete(null); load()
    }
    catch (e) { toast.error(errMsg(e, 'Failed to remove team member')) }
  }
  const loadLogins = () => {
    if (!crewLogins || !mayEditRoster) return
    api.get('/api/team/assignable').then((r: any) => setLogins((r?.data || []).filter((u: any) => u.kind === 'user').map((u: any) => ({ id: u.id, name: u.name })))).catch(() => setLogins([]))
  }
  const openCreate = () => { setEditing(null); setForm(EMPTY); setPickedLogins([]); loadLogins(); setFormError(''); setModalOpen(true) }
  // A login row's `role` is their PERMISSION role (owner, field), not a trade — so it is not carried into the
  // Job Title field, which would suggest "field" is what they do. Everything else comes across. (T29 M2)
  const openEdit = (m: Member) => { setEditing(m); setPickedLogins(m._source === 'user' ? [] : (linked[m.id] || []).map((l) => l.id)); loadLogins(); setForm({ name: m.name || '', email: m.email || '', phone: m.phone || '', role: m._source === 'user' ? '' : (m.role || ''), department: m.department || '', hourlyRate: m.hourlyRate == null ? '' : String(m.hourlyRate), locationId: m.locationId || '' }); setFormError(''); setModalOpen(true) }

  const columns = [
    // The badge says "this person can sign in", so it follows the login — not which table the row came from.
    // Giving someone a roster card used to take their badge away while their login carried on working. (T30 N3)
    { key: 'name', label: 'Name', render: (v: any, row: Member) => <span className="font-medium">{v}{(row.hasLogin || row._source === 'user') && <span className="ml-2 text-xs font-normal text-gray-500 dark:text-slate-400">login</span>}</span> },
    // Two different things share this column: a roster member's job title is free text they typed, but a login
    // account's is a permission role, and that was printing the stored slug — "field" and "user" on a page whose
    // own Settings › Users calls them Staff. ROLE_LABELS is the one vocabulary for that. (Contractor T14 M10)
    { key: 'role', label: roleLabel, render: (v: any, row: Member) => (row._source === 'user' ? ROLE_LABELS[String(v)] || v || '-' : v || '-') },
    ...(showDepartment ? [{ key: 'department', label: 'Department', render: (v: any) => v || '-' }] : []),
    { key: 'email', label: 'Email', render: (v: any) => v || '-' },
    { key: 'phone', label: 'Phone', render: (v: any) => v || '-' },
    // Who signs in as this crew: its jobs are on their phones (crew scope).
    ...(crewLogins ? [{ key: 'crewLogins', label: 'Crew logins', render: (_v: any, row: Member) => (row._source === 'user' ? '-' : (linked[row.id] || []).map((l) => l.name).join(', ') || '-') }] : []),
    // a rate is money: 28.5 is $28.50 an hour (T14 L2)
    ...(showRate ? [{ key: 'hourlyRate', label: 'Rate', render: (v: any) => (v != null && v !== '' && Number.isFinite(Number(v)) ? `${money(Number(v))}/hr` : '-') }] : []),
    // "Invite sent" until their login is taken up — the server's word (team.ts), the same as Settings › Users.
    { key: 'active', label: 'Status', render: (v: any, row: Member) => (!v ? <span className="text-gray-500 dark:text-slate-400">Inactive</span> : (row as any).invitePending ? <span className="text-amber-700 dark:text-amber-300">Invite sent</span> : <span className="text-green-700 dark:text-green-400">Active</span>) },
  ]
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  /**
   * Add Member was already gated (canManageRoster); Edit and Delete on the rows were not. (T42)
   *
   * PUT /api/team/:id asks `team:update` and DELETE asks `team:delete` — admin and up. `viewer` and
   * the field rung hold `team:read`, which is right: a roster with pay rates on it is something a
   * crew may need to look at and nobody below admin may change.
   */
  const mayEditRoster = useMayWrite('team:update')
  /**
   * "The Team help text still points to Settings, which the manager can't open." (Salon T42, T60)
   * Point at Settings › Users only for someone the Settings page shows that tab to — the owner, an
   * admin, or a person granted users:read (SettingsPage.tsx's own rule). Everyone else is told who
   * manages logins instead of being sent to a door that is locked.
   */
  const { can, known } = usePermissions()
  const mayOpenUsers = !known || ['owner', 'admin'].includes(String((signedIn as any)?.role)) || can('users:read')
  const loginsWhere = mayOpenUsers ? 'Login access is set under Settings → Users.' : 'An owner or admin manages who can sign in.'
  const mayRemoveFromRoster = useMayWrite('team:delete')
  // The sentences that name what a roster card holds follow what this vertical shows of it (TeamConfig). Both shown — the
  // trades' — is the original wording, word for word.
  const both = showDepartment && showRate
  const bannerHolds = both ? 'roles, departments and rates' : showRate ? 'roles and rates' : showDepartment ? 'roles and departments' : 'roles'
  const cardHolds = both ? 'is where a trade, department and pay rate live' : `holds their ${[roleLabel.toLowerCase(), showDepartment && 'department', showRate && 'pay rate'].filter(Boolean).join(' and ')}`

  return (
    <div data-testid="team-page-shared">
      <PageHeader title="Team" subtitle={`${config?.subtitle ?? 'The people you schedule and pay.'} ${loginsWhere}`} action={canManageRoster ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline" />Add Member</Button> : undefined} />
      {fromLogins && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <Users className="w-4 h-4 mt-0.5 shrink-0" />
          <span>No roster yet — these are your login users (read-only here{mayOpenUsers ? ', managed under Settings → Users' : ', managed by an owner or admin'}).{canManageRoster ? ` Add a member to start your own roster with ${bannerHolds}.` : ''}</span>
        </div>
      )}
      <DataTable<Member> data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} emptyMessage="No team members yet."
        actions={[
          // Everyone can be edited — for a login account that means giving them a roster card, which is the
          // only place a pay rate, trade or department lives. Delete stays off those rows: removing a login
          // is Settings › Users' job, not this page's. (T29 M2)
          { label: 'Edit', icon: Edit, onClick: openEdit, show: () => mayEditRoster },
          { label: 'Delete', icon: Trash2, onClick: (r) => setToDelete(r), className: 'text-red-600', show: (r) => mayRemoveFromRoster && r._source !== 'user' },
        ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? (editing._source === 'user' ? 'Add to the roster' : 'Edit Member') : 'Add Member'} size="md">
        <div className="space-y-4">
          {formError && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{formError}</div>}
          {editing?._source === 'user' && (
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
              This person can sign in but has no roster card, which {cardHolds}. Saving creates one. Their login is unchanged, under Settings › Users.
            </p>
          )}
          <Field label="Name *"><input value={form.name} onChange={set('name')} className={inputCls} /></Field>
          <div className={showDepartment ? 'grid grid-cols-2 gap-4' : ''}>
            <Field label={roleLabel}><input placeholder={rolePlaceholder} value={form.role} onChange={set('role')} className={inputCls} /></Field>
            {showDepartment && <Field label="Department"><input value={form.department} onChange={set('department')} className={inputCls} /></Field>}
          </div>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} className={inputCls} /></Field>
          <Field label="Phone"><input value={form.phone} onChange={set('phone')} className={inputCls} /></Field>
          {branches.length > 0 && <Field label="Branch"><select value={form.locationId} onChange={set('locationId')} className={inputCls}><option value="">No branch</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>}
          {showRate && <Field label="Hourly Rate"><input type="number" min="0" step="0.01" value={form.hourlyRate} onChange={set('hourlyRate')} className={inputCls} /></Field>}
          {crewLogins && mayEditRoster && editing?._source !== 'user' && (
            <Field label="Logins on this crew">
              <p className="mb-2 text-xs text-gray-500 dark:text-slate-400">Each login ticked here sees this crew's jobs on its own list and phone.</p>
              {logins.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400">No logins can be put on a crew yet.</p> : (
                <div className="max-h-40 space-y-1 overflow-y-auto" data-testid="crew-logins">
                  {logins.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-200">
                      <input type="checkbox" checked={pickedLogins.includes(l.id)} onChange={(e) => setPickedLogins((p) => e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id))} />
                      {l.name}
                    </label>
                  ))}
                </div>
              )}
            </Field>
          )}
        </div>
        <div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      {/* The warning belongs BEFORE the click, not in a toast afterwards: their jobs go back to unassigned. (T26 L2) */}
      <ConfirmModal
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Remove Member"
        message={`Remove ${toDelete?.name || 'this member'} from the roster?${
          Number(toDelete?.assignedJobs || 0) > 0
            ? ` ${toDelete!.assignedJobs} ${Number(toDelete!.assignedJobs) === 1 ? workLabel.one : workLabel.many} assigned to them will be left unassigned.`
            : ''
        }`}
        confirmText="Remove"
      />
    </div>
  )
}
