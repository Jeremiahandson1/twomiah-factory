import { useState } from 'react'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { useAuth } from '../contexts/AuthContext'
import { TwoFactorCard } from '../shared'

/**
 * My account — how THIS person signs in: their password and their two-factor. Every seat opens it (no permission on
 * the route or the link), because it is a person's own security and not the shop's settings — the rule the rest of the
 * fleet's /crm/account follows (T60: a manager once had no way to reach two-factor at all).
 *
 * The Two-Factor card is the fleet's shared one (packages/tenant-ui/src/auth/TwoFactorCard.tsx), over the store's own
 * client (services/api.ts `mfa`), which calls /api/auth/mfa-devices — the shared enrolment routes, mounted for the store.
 */
export default function AccountPage() {
  const { toast } = useToast()
  const { user } = useAuth()
  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwSaving, setPwSaving] = useState(false)

  const changePassword = async () => {
    setPwSaving(true)
    try {
      await api.changePassword(pw.current, pw.next)
      setPw({ current: '', next: '' })
      toast('Password changed')
    } catch (e: any) { toast(e?.message || 'Could not change password', 'error') } finally { setPwSaving(false) }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">My account</h1>
        {user?.email && <p className="text-sm text-gray-500 dark:text-slate-400">Signed in as {user.email}</p>}
      </div>

      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-900 dark:text-slate-100">Change password</h2>
        <div><label className="label">Current password</label><input className="input" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></div>
        <div><label className="label">New password</label><input className="input" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="At least 8 characters" /></div>
        <button onClick={changePassword} className="btn-secondary" disabled={pwSaving || !pw.current || pw.next.length < 8}>{pwSaving ? 'Saving…' : 'Update password'}</button>
      </div>

      <TwoFactorCard api={api as any} toast={{ success: (m: string) => toast(m), error: (m: string) => toast(m, 'error') }} />
    </div>
  )
}
