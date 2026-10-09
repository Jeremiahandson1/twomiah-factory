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
 */
import React, { useState } from 'react'
import { ShieldCheck, User, Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { TwoFactorCard } from '../auth/TwoFactorCard'
import { Button, Field, inputCls, errMsg } from '../invoicing/ui'

export function MyAccountPage({ api, toast }: { api: any; toast: { success: (m: string) => void; error: (m: string) => void } }) {
  const { user } = useAuth() as any
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [saving, setSaving] = useState(false)

  // The same checks and the same call as Settings › Security, so the two doors cannot disagree.
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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
          <User className="w-6 h-6 text-orange-600 dark:text-orange-300" aria-hidden="true" />My account
        </h1>
        <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">
          How you sign in. These settings are yours alone — changing them affects nobody else and nothing about the business.
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
        <Field label="Current password"><input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className={inputCls} /></Field>
        <Field label="New password"><input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={inputCls} /></Field>
        <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} className={inputCls} /></Field>
        <Button onClick={changePassword} disabled={saving}>{saving ? 'Changing…' : 'Change password'}</Button>
      </section>
    </div>
  )
}
