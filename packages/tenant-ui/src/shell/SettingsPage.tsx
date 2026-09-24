// Settings: company info + billing defaults, profile, password, users (seat management), and links to
// the feature / billing / email / integrations / import sub-pages. One implementation for every CRM.
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, User, Lock, Users, CreditCard, Plug, Upload, ArrowRightLeft, ToggleLeft, AtSign, Globe, Inbox } from 'lucide-react'
import { Button, Field, inputCls, errMsg } from '../invoicing/ui'
import { DEFAULT_ROLES, ROLE_LABELS } from './types'
import type { SettingsPageProps, RoleOption } from './types'
import { useConfirm } from '../ui/ConfirmProvider'

interface CompanyForm { name: string; email: string; phone: string; address: string; city: string; state: string; zip: string; website: string; licenseNumber: string; defaultTaxRate: string; paymentTermsDays: string; logo: string; primaryColor: string }
/** The colour the portal header and the Stripe payment form fall back to when a tenant has not set one. */
const DEFAULT_BRAND = '#f97316'
interface NewUserForm { firstName: string; lastName: string; email: string; password: string; role: RoleOption['value'] }

const SUB_PAGES = [
  { to: '/crm/settings/features', label: 'Features', icon: ToggleLeft },
  { to: '/crm/settings/billing', label: 'Billing', icon: CreditCard },
  { to: '/crm/settings/email', label: 'Branded Email', icon: AtSign },
  { to: '/crm/settings/email-domain', label: 'Email Domain', icon: Globe },
  { to: '/crm/settings/email-inbox', label: 'Email Inbox', icon: Inbox },
  { to: '/crm/settings/integrations', label: 'Integrations', icon: Plug },
  { to: '/crm/settings/migration', label: 'Migrate Data', icon: ArrowRightLeft },
  { to: '/crm/settings/import', label: 'Import from CSV', icon: Upload },
]
const emptyUser = (): NewUserForm => ({ firstName: '', lastName: '', email: '', password: '', role: 'field' })

export function SettingsPage({ api, auth, toast, config }: SettingsPageProps) {
  const confirm = useConfirm()
  const navigate = useNavigate()
  const { user, company, updateCompany } = auth
  const roles = config?.roles && config.roles.length ? config.roles : DEFAULT_ROLES
  const showLicense = config?.licenseNumber !== false
  const [tab, setTab] = useState('company')
  const [form, setForm] = useState<CompanyForm>({ name: '', email: '', phone: '', address: '', city: '', state: '', zip: '', website: '', licenseNumber: '', defaultTaxRate: '', paymentTermsDays: '30', logo: '', primaryColor: '' })
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
    }
    loadUsers()
  }, [company]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user) setProfileForm({ firstName: user.firstName || '', lastName: user.lastName || '', phone: user.phone || '' })
  }, [user])

  const loadUsers = async () => {
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
    setSaving(true)
    try {
      const settings = { ...(company?.settings || {}), defaultTaxRate: taxNum, paymentTermsDays: termsNum }
      const payload: any = { ...fields, settings }
      if (!showLicense) delete payload.licenseNumber
      const updated = await api.put('/api/company', payload)
      updateCompany(updated)
      toast.success('Company updated')
    } catch (err) { toast.error(errMsg(err, 'Failed to save')) } finally { setSaving(false) }
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
      await api.put('/api/auth/password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword })
      toast.success('Password changed')
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err) { toast.error(errMsg(err, 'Failed to change password')) } finally { setSaving(false) }
  }

  // Adding a teammate is what makes the seat-based plan real. The admin sets the first password and
  // passes it along — no invite email, because tenant outbound mail isn't guaranteed.
  const addUser = async () => {
    if (!newUser.firstName.trim() || !newUser.lastName.trim()) { toast.error('First and last name are required'); return }
    if (!newUser.email.trim()) { toast.error('Email is required'); return }
    if (newUser.password.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setAddingUser(true)
    try { await api.post('/api/company/users', newUser); toast.success('User added'); setAddUserOpen(false); setNewUser(emptyUser()); loadUsers() }
    catch (err) { toast.error(errMsg(err, 'Could not add the user')) } finally { setAddingUser(false) }
  }
  // Revoking access is a deactivation, not a delete — jobs and quotes point at this user, and the seat
  // count is of ACTIVE users, so this is also what frees a seat.
  const toggleAccess = async (id: string, active: boolean) => {
    if (active && !(await confirm('Revoke access for this user? They will not be able to sign in, and their seat is freed.', { title: 'Revoke access', confirmText: 'Revoke it' }))) return
    try { await api.put(`/api/company/users/${id}`, { isActive: !active }); toast.success(active ? 'Access revoked' : 'Access restored'); loadUsers() }
    catch (err) { toast.error(errMsg(err, 'Could not change access')) }
  }
  // Owner-only grant: who may see the login-user list besides the owner. (Wrench QA decision)
  const toggleUserListGrant = async (u: any) => {
    const has = ((u.extraPermissions as string[]) || []).includes('users:read')
    try { await api.put(`/api/company/users/${u.id}`, { extraPermissions: has ? [] : ['users:read'] }); toast.success(has ? 'User list access removed' : 'User list access granted'); loadUsers() }
    catch (err) { toast.error(errMsg(err, 'Could not change permissions')) }
  }

  const tabs = [
    { id: 'company', label: 'Company', icon: Building2 },
    { id: 'profile', label: 'Profile', icon: User },
    { id: 'security', label: 'Security', icon: Lock },
    { id: 'users', label: 'Users', icon: Users },
  ]
  const set = (k: keyof CompanyForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })
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
          <div className="border-t dark:border-slate-800 my-3 pt-3">
            {SUB_PAGES.map((p) => (
              <button type="button" key={p.to} onClick={() => navigate(p.to)} className={sideBtn}><p.icon className="w-5 h-5" />{p.label}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
          {tab === 'company' && (
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
                  payment form and your invoices already use them — there was simply nowhere to set them. (T14 M8) */}
              <h3 className="text-md font-semibold pt-2 text-gray-900 dark:text-white">Branding</h3>
              <p className="text-sm text-gray-500 -mt-2 dark:text-slate-400">What your customers see: the portal header, the payment form and your invoices.</p>
              <Field label="Logo URL" hint="A direct link to your logo image. Leave blank to show your company name instead.">
                <input value={form.logo} onChange={set('logo')} className={inputCls} placeholder="https://example.com/logo.png" />
              </Field>
              {form.logo.trim() !== '' && (
                <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-slate-400">
                  <span>Preview</span>
                  <img src={form.logo} alt="Company logo preview" className="h-10 max-w-[200px] object-contain border border-gray-200 rounded p-1 dark:border-slate-700" />
                </div>
              )}
              <Field label="Brand Colour" hint="A 6-digit hex value. Leave blank to use the default.">
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
              <h3 className="text-md font-semibold pt-2 text-gray-900 dark:text-white">Billing Defaults</h3>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Default Sales Tax Rate (%)" hint="Applied to new quotes and invoices. Leave 0 if you do not collect sales tax."><input type="number" step="0.01" min="0" max="100" value={form.defaultTaxRate} onChange={set('defaultTaxRate')} className={inputCls} placeholder="e.g. 7.5" /></Field>
                <Field label="Invoice Payment Terms (days)" hint="Sets the due date when a quote is converted to an invoice."><input type="number" min="0" value={form.paymentTermsDays} onChange={set('paymentTermsDays')} className={inputCls} placeholder="30" /></Field>
              </div>
              <Button onClick={saveCompany} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
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
                <p><span className="font-medium">Role:</span> {ROLE_LABELS[user?.role] || user?.role}</p>
                <p className="text-sm text-gray-500 dark:text-slate-400">Your email address and role are set by an administrator under Settings › Users.</p>
              </div>
              <Button onClick={saveProfile} disabled={saving}>{saving ? 'Saving...' : 'Save Profile'}</Button>
            </div>
          )}

          {tab === 'security' && (
            <div className="space-y-4 max-w-xl">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Change Password</h2>
              <Field label="Current Password"><input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className={inputCls} /></Field>
              <Field label="New Password"><input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={inputCls} /></Field>
              <Field label="Confirm Password"><input type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} className={inputCls} /></Field>
              <Button onClick={changePassword} disabled={saving}>{saving ? 'Changing...' : 'Change Password'}</Button>
            </div>
          )}

          {tab === 'users' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Users</h2>
                {canManageUsers && <Button onClick={() => { setNewUser(emptyUser()); setAddUserOpen(true) }}>Add User</Button>}
              </div>
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
                        <td className="px-4 py-3">{ROLE_LABELS[u.role] || u.role}</td>
                        <td className="px-4 py-3">{u.isActive ? <span className="text-green-600">Active</span> : <span className="text-gray-500 dark:text-slate-400">Inactive</span>}</td>
                        <td className="px-4 py-3 text-right">
                          {u.id === myId ? <span className="text-xs text-gray-500 dark:text-slate-400">You</span> : canManageUsers ? (
                            <>
                              {isOwner && u.role !== 'owner' && (
                                <label className="inline-flex items-center gap-1 text-xs text-gray-500 mr-3 dark:text-slate-400" title="Lets this person see the list of logins under Settings › Users">
                                  <input type="checkbox" checked={((u.extraPermissions as string[]) || []).includes('users:read')} onChange={() => toggleUserListGrant(u)} /> can view user list
                                </label>
                              )}
                              <button type="button" onClick={() => toggleAccess(u.id, !!u.isActive)} className={`text-xs font-medium ${u.isActive ? 'text-red-600 hover:text-red-700 dark:hover:text-red-300' : 'text-green-600 hover:text-green-700 dark:hover:text-green-300'}`}>{u.isActive ? 'Revoke access' : 'Restore access'}</button>
                            </>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500 dark:text-slate-400">No users to show</td></tr>}
                  </tbody>
                </table>
              </div>

              {addUserOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setAddUserOpen(false)}>
                  <div role="dialog" aria-modal="true" aria-label="Add User" className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
                    <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Add User</h3>
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="First name *"><input value={newUser.firstName} onChange={(e) => setNewUser({ ...newUser, firstName: e.target.value })} className={inputCls} /></Field>
                        <Field label="Last name *"><input value={newUser.lastName} onChange={(e) => setNewUser({ ...newUser, lastName: e.target.value })} className={inputCls} /></Field>
                      </div>
                      <Field label="Email *"><input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className={inputCls} /></Field>
                      <Field label="Temporary password *" hint="Share this with them — they can change it after signing in."><input type="password" autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder="At least 8 characters" className={inputCls} /></Field>
                      <Field label="Access Role">
                        <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value as RoleOption['value'] })} className={inputCls}>
                          {roles.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.description}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                      <Button variant="secondary" onClick={() => setAddUserOpen(false)}>Cancel</Button>
                      <Button onClick={addUser} disabled={addingUser}>{addingUser ? 'Adding...' : 'Add User'}</Button>
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
