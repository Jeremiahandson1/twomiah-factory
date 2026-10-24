/**
 * My account — the person's OWN sign-in security, reachable by every role. (T60)
 *
 *   Manager: "Salon: … the manager has no way to reach 2FA." (still open from T42)
 *
 * The Two-Factor card and Change Password lived on Settings › Security, and Settings is the owner's and
 * the admins' — company configuration, correctly locked. So on every CRM that runs this shell, nobody
 * below admin could turn two-factor on, or change their own password: controls that belong to a PERSON
 * were filed under the SHOP. crm-dispensary found and fixed exactly this in T41 with its own My Account
 * page; this is that page, shared, so the other verticals stop carrying the same hole.
 *
 * NO role gate, on purpose: everyone who can sign in can manage how they sign in, and nothing here can
 * affect anybody else or the business's configuration. PUT /api/auth/password and the MFA routes act on
 * the session's own user for the same reason. Settings › Security keeps both, for owners and admins.
 *
 * PROFILE & SECURITY: your own name and phone as well. (Live role check, 2026-10-23)
 *
 *   A manager, a member of staff, a caregiver and a viewer could not correct their own name or phone: that form was
 *   Settings › Profile, and Settings is the owner's and the admins'. PUT /api/auth/profile was always open to any
 *   signed-in person, for themselves only (shared auth.ts) — the screen was the missing half. Every pro CRM puts these
 *   four (name, phone, password, two-factor) on one personal page off the user menu; this is that page. Email and role
 *   stay an admin's (Settings › Users), as the server already draws it.
 */
import React, { useEffect, useState } from 'react'
import { ShieldCheck, User, Lock, UserCog } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { TwoFactorCard } from '../auth/TwoFactorCard'
import { Button, Field, inputCls, errMsg } from '../invoicing/ui'
import { PasswordInput } from '../ui/PasswordInput'

export function MyAccountPage({ api, toast }: { api: any; toast: { success: (m: string) => void; error: (m: string) => void } }) {
  const { user, updateUser } = useAuth() as any
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState({ firstName: '', lastName: '', phone: '' })
  const [savingProfile, setSavingProfile] = useState(false)
  useEffect(() => {
    if (user) setProfile({ firstName: user.firstName || '', lastName: user.lastName || '', phone: user.phone || '' })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // The same checks and the same call as Settings › Profile (shell/SettingsPage.tsx), so the two doors cannot disagree.
  const saveProfile = async () => {
    if (!profile.firstName.trim()) { toast.error('First name is required'); return }
    if (!profile.lastName.trim()) { toast.error('Last name is required'); return }
    setSavingProfile(true)
    try {
      const res: any = await api.put('/api/auth/profile', { firstName: profile.firstName.trim(), lastName: profile.lastName.trim(), phone: profile.phone.trim() || null })
      if (res?.user) updateUser?.(res.user)
      toast.success('Profile saved')
    } catch (err) { toast.error(errMsg(err, 'Failed to save your profile')) } finally { setSavingProfile(false) }
  }

  // The same checks and the same call as Settings › Security, so the two doors cannot disagree.
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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <User className="w-6 h-6 text-orange-600 dark:text-orange-200" aria-hidden="true" />Profile &amp; Security
        </h1>
        <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">
          Your name, phone and how you sign in. These are yours alone — changing them affects nobody else and nothing about the business.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 dark:bg-slate-900 dark:border-slate-700">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-600 dark:text-slate-400">Signed in as</span>
          <span className="text-gray-900 font-medium dark:text-slate-100">{user?.email}</span>
        </div>
        <div className="flex items-center justify-between text-sm mt-2">
          <span className="text-gray-600 dark:text-slate-400">Your role</span>
          {/* roleLabel is the vertical's own word for the rung (a salon's "Stylist"), never the raw id. */}
          <span className="text-gray-900 dark:text-slate-100">{user?.roleLabel || user?.role}</span>
        </div>
      </div>

      <section aria-labelledby="acct-profile" className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 dark:bg-slate-900 dark:border-slate-700">
        <h2 id="acct-profile" className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <UserCog className="w-5 h-5 text-gray-600 dark:text-slate-400" aria-hidden="true" />Your profile
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="First name"><input autoComplete="given-name" value={profile.firstName} onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))} className={inputCls} /></Field>
          <Field label="Last name"><input autoComplete="family-name" value={profile.lastName} onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))} className={inputCls} /></Field>
        </div>
        <Field label="Phone"><input type="tel" autoComplete="tel" value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} className={inputCls} /></Field>
        <p className="text-xs text-gray-600 dark:text-slate-400">Your email address and role are set by the account owner or an admin.</p>
        <Button onClick={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving…' : 'Save profile'}</Button>
      </section>

      <section aria-labelledby="acct-2fa">
        <h2 id="acct-2fa" className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2 mb-3">
          <ShieldCheck className="w-5 h-5 text-gray-600 dark:text-slate-400" aria-hidden="true" />Two-factor sign-in
        </h2>
        <TwoFactorCard api={api} toast={toast} />
      </section>

      <section aria-labelledby="acct-pw" className="bg-white rounded-xl border border-gray-200 p-4 space-y-4 dark:bg-slate-900 dark:border-slate-700">
        <h2 id="acct-pw" className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <Lock className="w-5 h-5 text-gray-600 dark:text-slate-400" aria-hidden="true" />Change password
        </h2>
        <Field label="Current password"><PasswordInput autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw((prev) => ({ ...prev, currentPassword: e.target.value }))} className={inputCls} /></Field>
        <Field label="New password"><PasswordInput autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw((prev) => ({ ...prev, newPassword: e.target.value }))} className={inputCls} /></Field>
        <Field label="Confirm new password"><PasswordInput autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw((prev) => ({ ...prev, confirmPassword: e.target.value }))} className={inputCls} /></Field>
        <Button onClick={changePassword} disabled={saving}>{saving ? 'Changing…' : 'Change password'}</Button>
      </section>
    </div>
  )
}
