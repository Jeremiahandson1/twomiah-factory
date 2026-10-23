// Settings: company info + billing defaults, profile, password, users (seat management), and links to
// the feature / billing / email / integrations / import sub-pages. One implementation for every CRM.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, User, Lock, Users, CreditCard, Plug, Upload, ArrowRightLeft, ToggleLeft, AtSign, Globe, Inbox } from 'lucide-react'
import { Button, Field, inputCls, errMsg } from '../invoicing/ui'
import { meetsRole, DEFAULT_ROLES, ROLE_LABELS } from './types'
import type { SettingsPageProps, RoleOption } from './types'
import { useConfirm } from '../ui/ConfirmProvider'
import { TwoFactorCard } from '../auth/TwoFactorCard'
import { PasswordInput } from '../ui/PasswordInput'

interface CompanyForm { name: string; email: string; phone: string; address: string; city: string; state: string; zip: string; website: string; licenseNumber: string; defaultTaxRate: string; paymentTermsDays: string; logo: string; primaryColor: string }
/** The colour the portal header and the Stripe payment form fall back to when a tenant has not set one. */
const DEFAULT_BRAND = '#f97316'
/**
 * Opening hours (live test, 2026-10-22: Settings had no business hours). Kept on the company, settings.businessHours —
 * { monday: { open: '09:00', close: '17:00' }, sunday: { closed: true } } — which the website reads (its contact section
 * and the urgent-care bar) and the server checks (packages/tenant-backend company/businessHours.ts, the same day list).
 * A day left as "—" is not said at all, so an owner who never opens this saves no hours.
 */
const WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
type DayState = { state: '' | 'open' | 'closed'; open: string; close: string }
type HoursForm = Record<typeof WEEK[number], DayState>
const hoursFrom = (saved: any): HoursForm => Object.fromEntries(WEEK.map((d) => {
  const h = saved && typeof saved === 'object' ? saved[d] : null
  const state: DayState['state'] = !h ? '' : h.closed ? 'closed' : 'open'
  return [d, { state, open: h?.open || '09:00', close: h?.close || '17:00' }]
})) as HoursForm
const hoursToSave = (f: HoursForm) => {
  const out: Record<string, any> = {}
  for (const d of WEEK) {
    if (f[d].state === 'closed') out[d] = { closed: true }
    else if (f[d].state === 'open') out[d] = { open: f[d].open, close: f[d].close }
  }
  return Object.keys(out).length ? out : null
}
const dayLabel = (d: string) => d[0].toUpperCase() + d.slice(1)
/** The US zones, by the names an owner uses (config.timeZone). A zone saved some other way is offered too, as itself. */
const US_ZONES: Array<[string, string]> = [
  ['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'], ['America/Phoenix', 'Arizona (no daylight saving)'],
  ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii'],
]
const zoneName = (z?: string | null) => (z ? (US_ZONES.find(([id]) => id === z)?.[1] || z.replace(/_/g, ' ')) : '')
/** How a new teammate signs in the first time: a password the admin sets now, or an emailed invite. Asked, never assumed. */
type SignInWay = '' | 'password' | 'invite'
interface NewUserForm { firstName: string; lastName: string; email: string; password: string; role: RoleOption['value']; way: SignInWay }
interface EditUserForm { id: string; firstName: string; lastName: string; phone: string; role: string; email: string; isOwner: boolean }

/**
 * The side links, each with the lowest rung its own page will serve. Every one of these was shown to
 * everybody: a manager could open Billing and Integrations and was offered Stripe "Disconnect" and
 * "Save Twilio Config" on pages the API refuses them. A link that leads to a refusal is not a link.
 * `needs` is a RANK here, not a permission, because these pages are gated on rank server-side
 * (requireAdmin / owner-only billing) — where the server asks for a permission, so does the screen.
 * (Field Service T30 M-R1)
 */
const SUB_PAGES = [
  { to: '/crm/settings/features', label: 'Features', icon: ToggleLeft, needs: 'admin' },
  { to: '/crm/settings/billing', label: 'Billing', icon: CreditCard, needs: 'admin' },
  { to: '/crm/settings/email', label: 'Branded Email', icon: AtSign, needs: 'admin' },
  { to: '/crm/settings/email-domain', label: 'Email Domain', icon: Globe, needs: 'admin' },
  { to: '/crm/settings/email-inbox', label: 'Email Inbox', icon: Inbox, needs: 'admin' },
  { to: '/crm/settings/integrations', label: 'Integrations', icon: Plug, needs: 'admin' },
  { to: '/crm/settings/migration', label: 'Migrate Data', icon: ArrowRightLeft, needs: 'admin' },
  { to: '/crm/settings/import', label: 'Import from CSV', icon: Upload, needs: 'admin' },
]
const emptyUser = (): NewUserForm => ({ firstName: '', lastName: '', email: '', password: '', role: 'field', way: '' })
/** Never signed in: the seat a first password may still be set for, and an invite resent to (company.ts). */
const neverSignedIn = (u: any) => !!u?.isActive && !u?.lastLogin && u?.role !== 'owner'

export function SettingsPage({ api, auth, toast, config }: SettingsPageProps) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user, company, updateCompany, updateUser } = auth
  // May this person change the company? The server answers company:update (requireAdmin on PUT
  // /api/company), and until now the screen never asked — so a manager filled the form in and learned
  // the answer from Save. A template that has not been rewired hands us no `can`, and keeps today's
  // behaviour. (T30 M-R1)
  const can = (auth as any).can as ((permission: string) => boolean) | undefined
  const editsCompany = can ? can('company:update') : true
  const hasFeature = (auth as any).hasFeature as ((f: string) => boolean) | undefined
  const subPages = [
    ...SUB_PAGES.filter((sp) => meetsRole((user as any)?.role, sp.needs) && (!config?.subPages || config.subPages.includes(sp.to))),
    ...(config?.extraSubPages || []).filter((sp) => (!sp.permission || !can || can(sp.permission)) && (!sp.feature || !hasFeature || hasFeature(sp.feature))),
  ]
  const roles = config?.roles && config.roles.length ? config.roles : DEFAULT_ROLES
  /**
   * What this vertical calls a rung. The table used the fleet-wide ROLE_LABELS ("field" → "Staff") while
   * the picker directly beside it used config.roles and the API answers roleLabel — three names for one
   * thing on one page. The vertical's own word wins; `user` is the stored form of `field`.
   * (Salon T30 L5)
   */
  const roleWord = (role?: string) => {
    const id = role === 'user' ? 'field' : String(role || '')
    return roles.find((r) => r.value === id)?.label || ROLE_LABELS[id] || ROLE_LABELS[String(role || '')] || role || '—'
  }
  const showLicense = config?.licenseNumber !== false
  // Land on something you can use. Company is the right first tab for the person who runs the
  // business and a dead end for everyone else.
  const [tab, setTab] = useState(() => (((auth as any).can?.('company:update') ?? true) ? 'company' : 'profile'))
  const [form, setForm] = useState<CompanyForm>({ name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', website: '', licenseNumber: '', defaultTaxRate: '', paymentTermsDays: '30', logo: '', primaryColor: '' })
  const [hours, setHours] = useState<HoursForm>(() => hoursFrom(null))
  // The business's clock (config.timeZone): '' = its state's. Every vertical shows it beside the hours (live test 10/22:
  // the contractor's was only under Booking settings).
  const showZone = !!config?.timeZone
  const [zone, setZone] = useState('')
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [profile, setProfileForm] = useState({ firstName: '', lastName: '', phone: '' })
  const [users, setUsers] = useState<any[]>([])
  // Blank is fine — it means "use the default". Anything else has to be a colour the portal header, the
  // Stripe payment form and the invoice PDF can all actually paint. (T26 L5)
  const brandInvalid = form.primaryColor.trim() !== '' && !/^#[0-9a-fA-F]{6}$/.test(form.primaryColor.trim())
  const [saving, setSaving] = useState(false)
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [addingUser, setAddingUser] = useState(false)
  const [newUser, setNewUser] = useState<NewUserForm>(emptyUser())
  const [addUserError, setAddUserError] = useState('')
  const [editUser, setEditUser] = useState<EditUserForm | null>(null)
  const [editError, setEditError] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [pwFor, setPwFor] = useState<any>(null)
  const [firstPw, setFirstPw] = useState('')
  const [pwError, setPwError] = useState('')
  const [settingPw, setSettingPw] = useState(false)

  // Mirrors the server: requireAdmin = admin|owner; grants are the owner's alone.
  const isOwner = user?.role === 'owner'
  const canManageUsers = isOwner || user?.role === 'admin'
  const myId = user?.id || user?.userId

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name || '', email: company.email || '', phone: company.phone || '', address: company.address || '', city: company.city || '',
        state: company.state || '', zip: company.zip || '', website: company.website || '', licenseNumber: company.licenseNumber || '',
        logo: company.logo || '', primaryColor: company.primaryColor || '',
        defaultTaxRate: company.settings?.defaultTaxRate != null ? String(company.settings.defaultTaxRate) : '',
        paymentTermsDays: company.settings?.paymentTermsDays != null ? String(company.settings.paymentTermsDays) : '30',
      })
      setHours(hoursFrom(company.settings?.businessHours))
      setZone(typeof company.timezone === 'string' ? company.timezone : '')
    }
    loadUsers()
  }, [company]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) setProfileForm({ firstName: user.firstName || '', lastName: user.lastName || '', phone: user.phone || '' })
  }, [user])

  const loadUsers = async () => {
    // Asked only of a seat the roster answers — GET /api/company/users is users:read OR team:read. Staff hold
    // neither, so the page fired a refused request on every open. (T62: "Background 403 calls from Settings.")
    // Skipped only when the list is KNOWN — `can` says no while it is still loading, and an admin must not lose
    // the roster to a race. Unknown → ask, which is the old behaviour and the server still answers.
    const known = Array.isArray((auth as any).permissions) && (auth as any).permissions.length > 0
    if (can && known && !can('users:read') && !can('team:read')) return
    try { const data = await api.get('/api/company/users'); setUsers(Array.isArray(data) ? data : (data?.data ?? [])) } catch { /* a staff user has no users:read — the tab just stays empty */ }
  }

  const saveCompany = async () => {
    // Billing defaults live in company.settings (used by quotes/invoices). (Wrench QA W-5 / W-8)
    const { defaultTaxRate, paymentTermsDays, ...fields } = form
    // Validate and REFUSE bad money input — don't silently clamp it to a default. Clamping turned a typo
    // like -5 into 0 (Math.max(0, …)) and saved it with a success toast, quietly destroying the stored
    // 7.5% rate / net-30 terms (FS + RV tax-rate finding). Blank = the sensible default (no tax / net 30).
    const taxRaw = String(defaultTaxRate).trim()
    const taxNum = taxRaw === '' ? 0 : Number(taxRaw)
    if (!Number.isFinite(taxNum) || taxNum < 0 || taxNum > 100) { toast.error('Enter a sales tax rate between 0 and 100 (leave blank for none).'); return }
    const termsRaw = String(paymentTermsDays).trim()
    const termsNum = termsRaw === '' ? 30 : Number(termsRaw)
    if (!Number.isFinite(termsNum) || !Number.isInteger(termsNum) || termsNum < 0 || termsNum > 365) { toast.error('Payment terms must be a whole number of days between 0 and 365.'); return }
    // Refuse a colour we cannot use rather than storing it: it goes straight into the portal header and the
    // Stripe payment form, where a bad value paints nothing at all. Blank means "use the default". (T14 M8)
    const colour = String(fields.primaryColor || '').trim()
    if (colour && !/^#[0-9a-fA-F]{6}$/.test(colour)) { toast.error('Brand colour must be a 6-digit hex value like #f97316 (leave blank for the default).'); return }
    fields.primaryColor = colour
    const badDay = WEEK.find((d) => hours[d].state === 'open' && !(hours[d].open && hours[d].close && hours[d].close > hours[d].open))
    if (badDay) { toast.error(`${dayLabel(badDay)}: closing time must be after opening time.`); return }
    setSaving(true)
    try {
      const settings = { ...(company?.settings || {}), defaultTaxRate: taxNum, paymentTermsDays: termsNum, businessHours: hoursToSave(hours) }
      const payload: any = { ...fields, settings }
      if (!showLicense) delete payload.licenseNumber
      if (showZone) payload.timezone = zone || null
      const updated = await api.put('/api/company', payload)
      updateCompany(updated)
      toast.success('Company updated')
    } catch (err) { toast.error(errMsg(err, 'Failed to save')) } finally { setSaving(false) }
  }

  // The logo FILE (POST /api/company/logo, owner and admins): the server stores a web-safe copy and sets company.logo
  // to its address, so the website, portal and invoices show it at once. The Logo URL box stays for a hosted logo.
  const uploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !api.upload) return
    setUploadingLogo(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const r = await api.upload('/api/company/logo', fd)
      const logo = r?.logo || ''
      setForm((f) => ({ ...f, logo }))
      if (company) updateCompany({ ...company, logo })
      toast.success('Logo uploaded')
    } catch (err) { toast.error(errMsg(err, 'Could not upload the logo')) } finally { setUploadingLogo(false) }
  }

  const setProfile = (k: keyof typeof profile) => (e: React.ChangeEvent<HTMLInputElement>) => setProfileForm({ ...profile, [k]: e.target.value })
  const saveProfile = async () => {
    if (!profile.firstName.trim()) { toast.error('First name is required'); return }
    if (!profile.lastName.trim()) { toast.error('Last name is required'); return }
    setSaving(true)
    try {
      const res = await api.put('/api/auth/profile', { firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), phone: profile.phone.trim() || null })
      // The header greets you by name, so reflect it now rather than at the next reload.
      auth.updateUser?.(res?.user || res)
      toast.success('Profile updated')
    } catch (err) { toast.error(errMsg(err, 'Failed to save profile')) } finally { setSaving(false) }
  }

  const changePassword = async () => {
    if (pw.newPassword !== pw.confirmPassword) { toast.error('Passwords do not match'); return }
    if (pw.newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      // The server says what happened, e.g. that every other device was signed out (shared auth PUT /password).
      const res: any = await api.put('/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword })
      toast.success(typeof res?.message === 'string' && res.message ? res.message : 'Password changed')
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) { toast.error(errMsg(err, 'Failed to change password')) } finally { setSaving(false) }
  }

  // Adding a teammate is what makes the seat-based plan real. The admin CHOOSES how they sign in the first time: a
  // password set now and handed over (they can sign in at once), or an emailed link to choose their own (7 days, once).
  // It defaulted to the invite behind a tick-box, so the testers' manager and staff sat at "Invite sent" (live tests 10/22).
  const addUser = async () => {
    setAddUserError('')
    const fail = (m: string) => { setAddUserError(m); toast.error(m) }
    if (!newUser.firstName.trim() || !newUser.lastName.trim()) return fail('First and last name are required.')
    if (!newUser.email.trim()) return fail('Email is required.')
    if (!newUser.way) return fail('Choose how they will sign in: set a password now, or email them an invite.')
    if (newUser.way === 'password' && newUser.password.length < 8) return fail('The password needs at least 8 characters.')
    // Said here, before the round trip, when the list in hand already shows it; the server refuses it either way.
    const email = newUser.email.trim().toLowerCase()
    const taken = users.find((u) => String(u.email || '').toLowerCase() === email)
    if (taken) return fail(`${email} already has a login here (${[taken.firstName, taken.lastName].filter(Boolean).join(' ')}).${taken.isActive ? ' Each person needs their own email address.' : ' That login is switched off — reactivate it from the list instead of adding it again.'}`)
    setAddingUser(true)
    try {
      const { way, password, ...person } = newUser
      const created: any = await api.post('/api/company/users', way === 'invite' ? { ...person, email } : { ...person, email, password })
      if (!created?.invited) toast.success(`${person.firstName} can sign in now with ${email} and the password you set.`)
      else if (created.inviteSent) toast.success(`Invite sent to ${email}`)
      else toast.error(`${person.firstName} was added, but the invite email could not be sent. Use Resend invite, or Set password instead.`)
      setAddUserOpen(false); setNewUser(emptyUser()); loadUsers()
    }
    catch (err) { fail(errMsg(err, 'Could not add the user')) } finally { setAddingUser(false) }
  }
  // Change a teammate's name, phone or role (PUT /users/:id). Their email is their login and is not edited.
  const saveEdit = async () => {
    if (!editUser) return
    setEditError('')
    const fail = (m: string) => { setEditError(m); toast.error(m) }
    if (!editUser.firstName.trim() || !editUser.lastName.trim()) return fail('First and last name are required.')
    const before = users.find((u) => u.id === editUser.id)
    const body: Record<string, unknown> = { firstName: editUser.firstName.trim(), lastName: editUser.lastName.trim(), phone: editUser.phone.trim() || null }
    if (!editUser.isOwner && before && editUser.role !== (before.role === 'user' ? 'field' : before.role)) body.role = editUser.role
    setSavingEdit(true)
    try {
      await api.put(`/api/company/users/${editUser.id}`, body)
      toast.success(`${body.firstName} ${body.lastName} saved`)
      setEditUser(null); loadUsers()
    } catch (err) { fail(errMsg(err, 'Could not save the changes')) } finally { setSavingEdit(false) }
  }
  // A first password for someone who has never signed in (POST /users/:id/password). After their first sign-in the
  // password is theirs, and Forgot password is the way back in.
  const setFirstPassword = async () => {
    if (!pwFor) return
    setPwError('')
    if (firstPw.length < 8) { setPwError('The password needs at least 8 characters.'); return }
    setSettingPw(true)
    try {
      await api.post(`/api/company/users/${pwFor.id}/password`, { password: firstPw })
      toast.success(`${pwFor.firstName} can sign in now with ${pwFor.email} and that password.`)
      setPwFor(null); setFirstPw(''); loadUsers()
    } catch (err) { const m = errMsg(err, 'Could not set the password'); setPwError(m); toast.error(m) } finally { setSettingPw(false) }
  }
  const resendInvite = async (u: any) => {
    try {
      const r: any = await api.post(`/api/company/users/${u.id}/invite`, {})
      if (r?.inviteSent) toast.success(`A new invite is on its way to ${u.email}`)
      else toast.error('The invite email could not be sent. Try again in a moment.')
    } catch (err) { toast.error(errMsg(err, 'Could not resend the invite')) }
  }
  // Deactivating is not a delete — jobs and quotes point at this user, and the seat count is of ACTIVE users, so this is
  // also what frees a seat. Called "Revoke access" until the live test of 10/22 looked for "deactivate" and found nothing.
  const toggleAccess = async (u: any) => {
    const active = !!u.isActive
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
    if (active && !(await confirm(`Deactivate ${name}? They can't sign in until you reactivate them, and their seat is freed. Their jobs and records stay.`, { title: 'Deactivate user', confirmText: 'Deactivate' }))) return
    try { await api.put(`/api/company/users/${u.id}`, { isActive: !active }); toast.success(active ? `${name} is deactivated` : `${name} is active again`); loadUsers() }
    catch (err) { toast.error(errMsg(err, active ? 'Could not deactivate them' : 'Could not reactivate them')) }
  }
  // Owner-only grant: who may see the login-user list besides the owner. (Wrench QA decision)
  /**
   * HAND THE COMPANY OVER — and recover one that has lost its owner. (T32 B6)
   *
   * POST /api/company/transfer-ownership has existed since B6 with no screen, so the endpoint that
   * stops ownership becoming permanent was itself only reachable with a curl. The case that made it
   * urgent is worse: ctrtest finished the T32 round with NO owner, and the report's conclusion was
   * "it cannot be restored through the app; it needs a direct database update". A product whose
   * recovery path is somebody with database access has not recovered from the fault.
   *
   * Offered in two situations, worded differently for each: an owner moving the company on, and an
   * ADMIN recovering a company that has no owner at all.
   */
  const ownerExists = users.some((u: any) => u.role === 'owner')
  const mayTransfer = isOwner || (canManageUsers && !ownerExists)
  const [transferTo, setTransferTo] = useState<any>(null)
  const [transferring, setTransferring] = useState(false)
  const transferOwnership = async (u: any) => {
    setTransferring(true)
    try {
      const res: any = await api.post('/api/company/transfer-ownership', { userId: u.id })
      toast.success(`${u.firstName} ${u.lastName} is now the owner`)
      setTransferTo(null)
      await loadUsers()
      // The signed-in person's OWN role has very likely just changed — owner → admin on a handover,
      // admin → owner on a recovery — and every gate on this page reads it. The server returns the
      // rows it touched, so the new role is already in hand; `updateUser` is how this page refreshes
      // the session without a reload (and is optional, hence the prompt when it is absent).
      const mine = (res?.users || []).find((r: any) => r.id === myId)
      if (mine?.role && updateUser) updateUser({ role: mine.role })
      else if (mine?.role) toast.success('Your own role changed — reload the page to pick it up')
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : 'Could not transfer ownership') }
    finally { setTransferring(false) }
  }

  const toggleUserListGrant = async (u: any) => {
    const has = ((u.extraPermissions as string[]) || []).includes('users:read')
    try { await api.put(`/api/company/users/${u.id}`, { extraPermissions: has ? [] : ['users:read'] }); toast.success(has ? 'User list access removed' : 'User list access granted'); loadUsers() }
    catch (err) { toast.error(errMsg(err, 'Could not change permissions')) }
  }

  const tabs = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Lock },
    // The Users tab answered 403 for a field technician and for a manager — offered, then refused.
    // `canManageUsers` is admin|owner, which mirrors requireAdmin on the routes behind it; a
    // per-user `users:read` grant also opens it, which is what that grant is for. (T32 M8)
    ...(canManageUsers || (user?.extraPermissions || []).includes('users:read') ? [{ id: 'users', label: 'Users', icon: Users }] : []),
  ]
  const set = (k: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const sideBtn = 'w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800'

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">Settings</h1>
      <div className="flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-48 space-y-1">
          {tabs.map((t) => (
            <button type="button" key={t.id} onClick={() => setTab(t.id)} className={`w-full flex items-center gap-3 px-4 py-2 rounded-lg text-left ${tab === t.id ? 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-200' : 'text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-800'}`}>
              <t.icon className="w-5 h-5" />{t.label}
            </button>
          ))}
          {subPages.length > 0 && (
          <div className="border-t dark:border-slate-800 my-3 pt-3">
            {subPages.map((p) => (
              <button type="button" key={p.to} onClick={() => navigate(p.to)} className={sideBtn}><p.icon className="w-5 h-5" />{p.label}</button>
            ))}
          </div>
          )}
        </div>

        {/* `min-w-0`: a flex item's default minimum is its CONTENT's minimum, so this pane refused
            to shrink to the space left beside the nav and pushed the page sideways instead —
            measured on Settings › Users at 820px, pane 659px wide in a 572px slot, page
            scrollWidth 848. (T41 "Settings › Users overflows at 820px") */}
        <div className="flex-1 min-w-0 bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
          {tab === 'company' && editsCompany && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Company Information</h2>
              <Field label="Company Name"><input value={form.name} onChange={set('name')} className={inputCls} /></Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email"><input type="email" value={form.email} onChange={set('email')} className={inputCls} /></Field>
                <Field label="Phone"><input value={form.phone} onChange={set('phone')} className={inputCls} /></Field>
              </div>
              <Field label="Address"><input value={form.address} onChange={set('address')} className={inputCls} /></Field>
              <div className="grid grid-cols-3 gap-4">
                <Field label="City"><input value={form.city} onChange={set('city')} className={inputCls} /></Field>
                <Field label="State"><input value={form.state} onChange={set('state')} className={inputCls} /></Field>
                <Field label="ZIP"><input value={form.zip} onChange={set('zip')} className={inputCls} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Website"><input value={form.website} onChange={set('website')} className={inputCls} /></Field>
                {showLicense && <Field label="License #"><input value={form.licenseNumber} onChange={set('licenseNumber')} className={inputCls} /></Field>}
              </div>
              {/* The company row has carried logo and primaryColor all along, and the portal header, the Stripe
                  payment form and your invoices already use them — there was simply nowhere to set them. (T14 M8)
                  The colour also paints this CRM's own screens now: the shell sets the brand palette from it at
                  runtime (useBrandPalette), so this line no longer says "the portal and invoices only". */}
              <h3 className="text-md font-semibold pt-2 text-gray-900 dark:text-white">Branding</h3>
              <p className="text-sm text-gray-500 -mt-2 dark:text-slate-400">Your colour across this CRM — its buttons, links and menus — and on what your customers see: the portal header, the payment form and your invoices.</p>
              {api.upload && (
                <Field label="Logo" hint="PNG, JPG, WebP, GIF or SVG, up to 5 MB.">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800">
                    <Upload className="w-4 h-4" />{uploadingLogo ? 'Uploading…' : form.logo ? 'Upload a new logo' : 'Upload your logo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={uploadLogo} disabled={uploadingLogo} className="sr-only" />
                  </label>
                </Field>
              )}
              <Field label="Logo URL" hint="Or a direct link to your logo image. Leave blank to show your company name instead.">
                <input value={form.logo} onChange={set('logo')} className={inputCls} placeholder="https://example.com/logo.png" />
              </Field>
              {form.logo.trim() !== '' && (
                <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-slate-400">
                  <span>Preview</span>
                  <img src={form.logo} alt="Company logo preview" className="h-10 max-w-[200px] object-contain border border-gray-200 rounded p-1 dark:border-slate-700" />
                </div>
              )}
              <Field label="Brand Colour" hint="A 6-digit hex value. Leave blank to use the default. A very light colour is darkened where white text sits on it, so buttons stay readable.">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label="Pick brand colour"
                    value={/^#[0-9a-fA-F]{6}$/.test(form.primaryColor) ? form.primaryColor : DEFAULT_BRAND}
                    onChange={set('primaryColor')}
                    className="h-10 w-12 shrink-0 rounded border border-gray-300 bg-white dark:border-slate-700 dark:bg-slate-800"
                  />
                  <input value={form.primaryColor} onChange={set('primaryColor')} className={inputCls} placeholder={DEFAULT_BRAND} aria-invalid={brandInvalid || undefined} />
                </div>
                {/* An <input type="color"> cannot display a value it cannot parse, so it falls back to
                    DEFAULT_BRAND — and DEFAULT_BRAND is orange. Typing "notahex" therefore painted the swatch
                    a confident orange, which reads as "accepted, and your brand is orange" rather than
                    "unusable". The refusal existed, but only at Save. Say it where it is typed. (T26 L5) */}
                {brandInvalid && (
                  <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-300">
                    That is not a 6-digit hex value — the swatch is showing the default until this is fixed. Use something like {DEFAULT_BRAND}, or leave it blank.
                  </p>
                )}
              </Field>
              <h3 className="text-md font-semibold pt-2 text-gray-900 dark:text-white">Business Hours</h3>
              <p className="text-sm text-gray-500 -mt-2 dark:text-slate-400">Shown on your website. Leave a day as “—” to say nothing about it.</p>
              <div className="space-y-2">
                {WEEK.map((d) => (
                  <div key={d} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-sm text-gray-700 dark:text-slate-200">{dayLabel(d)}</span>
                    <select aria-label={`${dayLabel(d)} hours`} value={hours[d].state} onChange={(e) => { const state = e.target.value as DayState['state']; setHours((h) => ({ ...h, [d]: { ...h[d], state } })) }} className={inputCls} style={{ width: "7rem" }}>
                      <option value="">—</option>
                      <option value="open">Open</option>
                      <option value="closed">Closed</option>
                    </select>
                    {hours[d].state === 'open' && (
                      <>
                        <input type="time" aria-label={`${dayLabel(d)} opens`} value={hours[d].open} onChange={(e) => { const open = e.target.value; setHours((h) => ({ ...h, [d]: { ...h[d], open } })) }} className={inputCls} style={{ width: "8rem" }} />
                        <span className="text-sm text-gray-500 dark:text-slate-400">to</span>
                        <input type="time" aria-label={`${dayLabel(d)} closes`} value={hours[d].close} onChange={(e) => { const close = e.target.value; setHours((h) => ({ ...h, [d]: { ...h[d], close } })) }} className={inputCls} style={{ width: "8rem" }} />
                      </>
                    )}
                  </div>
                ))}
              </div>
              {showZone && (
                <Field label="Time zone" hint="Your hours, reports, invoices and timesheets count days on this clock. Online bookings keep their own under Booking settings.">
                  <select aria-label="Time zone" value={zone} onChange={(e) => setZone(e.target.value)} className={inputCls}>
                    <option value="">From your state{!zone && (company?.effectiveTimezone || company?.timeZone) ? ` (${zoneName(company.effectiveTimezone || company.timeZone)})` : ''}</option>
                    {US_ZONES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    {zone && !US_ZONES.some(([id]) => id === zone) && <option value={zone}>{zoneName(zone)}</option>}
                  </select>
                </Field>
              )}
              <h3 className="text-md font-semibold pt-2 text-gray-900 dark:text-white">Billing Defaults</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Default Sales Tax Rate (%)" hint="Applied to new quotes and invoices. Leave 0 if you do not collect sales tax."><input type="number" step="0.01" min="0" max="100" value={form.defaultTaxRate} onChange={set('defaultTaxRate')} className={inputCls} placeholder="e.g. 7.5" /></Field>
                <Field label="Invoice Payment Terms (days)" hint="Sets the due date when a quote is converted to an invoice."><input type="number" min="0" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} className={inputCls} placeholder="30" /></Field>
              </div>
              <Button onClick={saveCompany} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          )}

          {/* Your company's own details are not a secret from the people who work there — what they are
              not is yours to change. Read-only beats a form that refuses on Save, and beats hiding the
              page, which is how a stylist lost the ability to change their own password. (T30 M-R1) */}
          {tab === 'company' && !editsCompany && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Company Information</h2>
              <p className="text-sm text-gray-500 dark:text-slate-400">Company details are set by an admin or the account owner. Ask them if something here needs changing — your own name and password are under Profile and Security.</p>
              <dl className="divide-y divide-gray-200 dark:divide-slate-800 text-sm">
                {[
                  ['Company Name', form.name],
                  ['Email', form.email],
                  ['Phone', form.phone],
                  ['Address', [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ')],
                  ['Website', form.website],
                  ...(showZone ? [['Time zone', zoneName(zone || company?.effectiveTimezone || company?.timeZone)]] : []),
                ].map(([label, value]) => (
                  <div key={label} className="py-2 flex gap-4">
                    <dt className="w-40 shrink-0 text-gray-500 dark:text-slate-400">{label}</dt>
                    <dd className="text-gray-900 dark:text-slate-100 break-words">{value || <span className="text-gray-500 dark:text-slate-400">Not set</span>}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {tab === 'profile' && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Profile</h2>
              {/* This was read-only: correcting your own misspelled name meant asking an admin, and an owner
                  had nobody to ask. Email and Role stay fixed — email is the login identity with no
                  re-verification flow, and role is an admin's to set under Users. (T14 M7) */}
              <div className="grid grid-cols-2 gap-4">
                <Field label="First Name"><input value={profile.firstName} onChange={setProfile('firstName')} className={inputCls} /></Field>
                <Field label="Last Name"><input value={profile.lastName} onChange={setProfile('lastName')} className={inputCls} /></Field>
              </div>
              <Field label="Phone"><input value={profile.phone} onChange={setProfile('phone')} className={inputCls} /></Field>
              <div className="p-4 bg-gray-50 rounded-lg dark:bg-slate-800 text-gray-900 dark:text-slate-100 space-y-1">
                <p><span className="font-medium">Email:</span> {user?.email}</p>
                <p><span className="font-medium">Role:</span> {roleWord(user?.role)}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">Your email address and role are set by an administrator under Settings › Users.</p>
              </div>
              <Button onClick={saveProfile} disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</Button>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-6 max-w-xl">
              {/* Two-factor first: it is the stronger of the two things on this tab. (T57) */}
              <TwoFactorCard api={api as any} toast={toast} />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Change Password</h2>
              <Field label="Current Password"><PasswordInput autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw((prev) => ({ ...prev, currentPassword: e.target.value }))} className={inputCls} /></Field>
              <Field label="New Password"><PasswordInput autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw((prev) => ({ ...prev, newPassword: e.target.value }))} className={inputCls} /></Field>
              <Field label="Confirm Password"><PasswordInput autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw((prev) => ({ ...prev, confirmPassword: e.target.value }))} className={inputCls} /></Field>
              <Button onClick={changePassword} disabled={saving}>{saving ? 'Changing...' : 'Change Password'}</Button>
            </div>
          )}

          {tab === 'users' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Users</h2>
                {canManageUsers && <Button onClick={() => { setNewUser(emptyUser()); setAddUserError(''); setAddUserOpen(true) }}>Add User</Button>}
              </div>
              {!ownerExists && users.length > 0 && canManageUsers && (
                <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <p className="font-medium">This company has no owner.</p>
                  <p className="mt-1">Some settings are owner-only and cannot be reached until somebody holds the role. An administrator can claim it, or hand it to a colleague, from the table below.</p>
                </div>
              )}
              <div className="border dark:border-slate-800 rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-slate-800/60"><tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Email</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Access Role</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-slate-400">Status</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 dark:text-slate-400">Access</th>
                  </tr></thead>
                  <tbody className="divide-y dark:divide-slate-800 text-gray-900 dark:text-slate-100">
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td className="px-4 py-3">{u.firstName} {u.lastName}</td>
                        <td className="px-4 py-3">{u.email}</td>
                        <td className="px-4 py-3">{roleWord(u.role)}</td>
                        {/* "Active" for someone who has not yet opened their invite was not true (invite re-test, 10/14). */}
                        <td className="px-4 py-3">{!u.isActive ? <span className="text-gray-500 dark:text-slate-400">Deactivated</span> : u.invitePending ? <span className="text-amber-700 dark:text-amber-300">Invite sent</span> : <span className="text-green-700 dark:text-green-300">Active</span>}</td>
                        <td className="px-4 py-3 text-right">
                          {u.id === myId ? (
                            <>
                              {/* An admin recovering an ownerless company is usually claiming it for
                                  themselves, and their own row is the one place the normal actions
                                  are hidden. */}
                              {!ownerExists && canManageUsers && (
                                <button type="button" onClick={() => setTransferTo(u)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 mr-3 dark:text-indigo-300 dark:hover:text-indigo-200">Claim ownership</button>
                              )}
                              <span className="text-xs text-gray-500 dark:text-slate-400">You</span>
                            </>
                          ) : u.role === 'owner' && !isOwner ? (
                            /*
                             * THE OWNER'S ROW OFFERS AN ADMIN NOTHING. (T35 N5)
                             *
                             * The server has refused this since T32 B6 — "Only the owner can change
                             * the owner's account", 403, covering the role AND the access flag — and
                             * the suite proves it. The SCREEN still drew "Revoke access" here, so an
                             * admin was being offered a button that could only fail, on the one
                             * account whose loss cannot be recovered from inside the product.
                             *
                             * The same rule as Bills and Bids after T32 M9: only offer what the route
                             * will actually allow, and say why the gap is there rather than leaving a
                             * blank cell that reads as a missing feature.
                             */
                            <span className="text-xs text-gray-500 dark:text-slate-400">Only the owner can change this account</span>
                          ) : canManageUsers ? (
                            <>
                              {isOwner && u.role !== 'owner' && (
                                <label className="inline-flex items-center gap-1 text-xs text-gray-500 mr-3 dark:text-slate-400" title="Lets this person see the list of logins under Settings › Users">
                                  <input type="checkbox" checked={((u.extraPermissions as string[]) || []).includes('users:read')} onChange={() => toggleUserListGrant(u)} /> can view user list
                                </label>
                              )}
                              {mayTransfer && u.role !== 'owner' && u.isActive && (
                                <button type="button" onClick={() => setTransferTo(u)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 mr-3 dark:text-indigo-300 dark:hover:text-indigo-200">Make owner</button>
                              )}
                              {/* Name, phone and role. The owner's row is the owner's (above); their role moves by transfer. */}
                              <button type="button" onClick={() => { setEditError(''); setEditUser({ id: u.id, firstName: u.firstName || '', lastName: u.lastName || '', phone: u.phone || '', role: u.role === 'user' ? 'field' : String(u.role || ''), email: u.email, isOwner: u.role === 'owner' }) }} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 mr-3 dark:text-indigo-300 dark:hover:text-indigo-200">Edit</button>
                              {/* Never signed in: set their first password, or send the invite again (it may have expired or gone to spam). */}
                              {neverSignedIn(u) && (
                                <button type="button" onClick={() => { setPwFor(u); setFirstPw(''); setPwError('') }} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 mr-3 dark:text-indigo-300 dark:hover:text-indigo-200">Set password</button>
                              )}
                              {neverSignedIn(u) && (
                                <button type="button" onClick={() => resendInvite(u)} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 mr-3 dark:text-indigo-300 dark:hover:text-indigo-200">{u.invitePending ? 'Resend invite' : 'Send invite'}</button>
                              )}
                              <button type="button" onClick={() => toggleAccess(u)} className={`text-xs font-medium ${u.isActive ? 'text-red-600 hover:text-red-700 dark:hover:text-red-300 dark:text-red-400' : 'text-green-700 hover:text-green-800 dark:hover:text-green-300 dark:text-green-300'}`}>{u.isActive ? 'Deactivate' : 'Reactivate'}</button>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 dark:text-slate-400">No users to show</td></tr>}
                  </tbody>
                </table>
              </div>

              {transferTo && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setTransferTo(null)}>
                  <div role="dialog" aria-modal="true" aria-label="Transfer ownership" className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
                      {transferTo.id === myId ? 'Claim ownership' : 'Transfer ownership'}
                    </h3>
                    {transferTo.id === myId ? (
                      <p className="text-sm text-gray-600 dark:text-slate-300">You will become the owner of this company. Nobody holds the role at the moment, which is why this is offered.</p>
                    ) : (
                      <p className="text-sm text-gray-600 dark:text-slate-300">
                        <strong>{transferTo.firstName} {transferTo.lastName}</strong> will become the owner of this company.
                        {isOwner ? ' You will become an administrator.' : ''}
                      </p>
                    )}
                    <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">
                      There is only ever one owner. {isOwner ? 'They can hand it back to you the same way.' : 'They will be able to hand it on the same way.'}
                    </p>
                    <div className="mt-5 flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => setTransferTo(null)}>Cancel</Button>
                      <Button onClick={() => transferOwnership(transferTo)} disabled={transferring}>
                        {transferring ? 'Transferring…' : transferTo.id === myId ? 'Claim ownership' : 'Transfer ownership'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {addUserOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddUserOpen(false)}>
                  <div role="dialog" aria-modal="true" aria-label="Add User" className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Add User</h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="First name *"><input value={newUser.firstName} onChange={(e) => setNewUser((prev) => ({ ...prev, firstName: e.target.value }))} className={inputCls} /></Field>
                        <Field label="Last name *"><input value={newUser.lastName} onChange={(e) => setNewUser((prev) => ({ ...prev, lastName: e.target.value }))} className={inputCls} /></Field>
                      </div>
                      <Field label="Email *"><input type="email" value={newUser.email} onChange={(e) => setNewUser((prev) => ({ ...prev, email: e.target.value }))} className={inputCls} /></Field>
                      <fieldset className="space-y-2">
                        <legend className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">How will they sign in? *</legend>
                        <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-2 text-sm text-gray-700 dark:border-slate-700 dark:text-slate-200">
                          <input type="radio" name="sign-in-way" className="mt-0.5" checked={newUser.way === 'password'} onChange={() => setNewUser((prev) => ({ ...prev, way: 'password' }))} />
                          <span>Set a password for them now<span className="block text-xs text-gray-500 dark:text-slate-400">They can sign in straight away. Tell them the password; they can change it under Settings › Security.</span></span>
                        </label>
                        <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-2 text-sm text-gray-700 dark:border-slate-700 dark:text-slate-200">
                          <input type="radio" name="sign-in-way" className="mt-0.5" checked={newUser.way === 'invite'} onChange={() => setNewUser((prev) => ({ ...prev, way: 'invite', password: '' }))} />
                          <span>Email them an invite<span className="block text-xs text-gray-500 dark:text-slate-400">They choose their own password from the link. It works once, for 7 days.</span></span>
                        </label>
                      </fieldset>
                      {newUser.way === 'password' && (
                        <Field label="Password *" hint="At least 8 characters."><PasswordInput autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser((prev) => ({ ...prev, password: e.target.value }))} placeholder="At least 8 characters" className={inputCls} /></Field>
                      )}
                      <Field label="Access Role">
                        <select value={newUser.role} onChange={(e) => setNewUser((prev) => ({ ...prev, role: e.target.value as RoleOption['value'] }))} className={inputCls}>
                          {roles.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)}
                        </select>
                      </Field>
                    </div>
                    {addUserError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{addUserError}</p>}
                    <div className="flex justify-end gap-2 mt-6">
                      <Button variant="secondary" onClick={() => setAddUserOpen(false)}>Cancel</Button>
                      <Button onClick={addUser} disabled={addingUser}>{addingUser ? 'Adding...' : newUser.way === 'invite' ? 'Send invite' : 'Add User'}</Button>
                    </div>
                  </div>
                </div>
              )}

              {editUser && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setEditUser(null)}>
                  <div role="dialog" aria-modal="true" aria-label="Edit user" className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-1 text-gray-900 dark:text-white">Edit user</h3>
                    <p className="text-sm text-gray-500 mb-4 dark:text-slate-400">Signs in as {editUser.email}</p>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="First name *"><input value={editUser.firstName} onChange={(e) => setEditUser((p) => p && ({ ...p, firstName: e.target.value }))} className={inputCls} /></Field>
                        <Field label="Last name *"><input value={editUser.lastName} onChange={(e) => setEditUser((p) => p && ({ ...p, lastName: e.target.value }))} className={inputCls} /></Field>
                      </div>
                      <Field label="Phone"><input type="tel" value={editUser.phone} onChange={(e) => setEditUser((p) => p && ({ ...p, phone: e.target.value }))} className={inputCls} /></Field>
                      {!editUser.isOwner && (
                        <Field label="Access Role">
                          <select value={editUser.role} onChange={(e) => setEditUser((p) => p && ({ ...p, role: e.target.value }))} className={inputCls}>
                            {roles.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)}
                          </select>
                        </Field>
                      )}
                    </div>
                    {editError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{editError}</p>}
                    <div className="flex justify-end gap-2 mt-6">
                      <Button variant="secondary" onClick={() => setEditUser(null)}>Cancel</Button>
                      <Button onClick={saveEdit} disabled={savingEdit}>{savingEdit ? 'Saving...' : 'Save'}</Button>
                    </div>
                  </div>
                </div>
              )}

              {pwFor && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPwFor(null)}>
                  <div role="dialog" aria-modal="true" aria-label="Set password" className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-1 text-gray-900 dark:text-white">Set a password for {pwFor.firstName}</h3>
                    <p className="text-sm text-gray-600 mb-4 dark:text-slate-300">They haven&rsquo;t signed in yet. Set their first password and tell them it — they sign in with {pwFor.email}. {pwFor.invitePending ? 'The invite link stops working. ' : ''}After they sign in, the password is theirs to change.</p>
                    <Field label="Password *" hint="At least 8 characters."><PasswordInput autoComplete="new-password" value={firstPw} onChange={(e) => setFirstPw(e.target.value)} placeholder="At least 8 characters" className={inputCls} /></Field>
                    {pwError && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{pwError}</p>}
                    <div className="flex justify-end gap-2 mt-6">
                      <Button variant="secondary" onClick={() => setPwFor(null)}>Cancel</Button>
                      <Button onClick={setFirstPassword} disabled={settingPw}>{settingPw ? 'Saving...' : 'Set password'}</Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
