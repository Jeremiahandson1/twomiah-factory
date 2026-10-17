// My account — every seat's own sign-in security, whatever its role. (Launch list, 10/17)
//
// Two-factor and the password are a person's own, not the company's. The shared MyAccountPage reads the shared auth
// context, which roofing does not mount (it forks its own), so this is roofing's page with the same two parts.
import { useState } from 'react'
import { ShieldCheck, User, Lock } from 'lucide-react'
import { TwoFactorCard } from '../shared'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import api from '../services/api'
import { mfaApi } from '../services/mfaApi'

const inputCls = 'mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:border-slate-700'

export default function AccountPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [saving, setSaving] = useState(false)

  const changePassword = async () => {
    if (pw.newPassword !== pw.confirmPassword) { toast.error('Passwords do not match'); return }
    if (pw.newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return }
    setSaving(true)
    try {
      await api.request('/api/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword: pw.currentPassword, newPassword: pw.newPassword }) })
      toast.success('Password changed')
      setPw({ currentPassword: '', newPassword: '', confirmPassword: '' })
    } catch (err: any) { toast.error(err?.message || 'Failed to change password') } finally { setSaving(false) }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100">
          <User className="w-6 h-6 text-gray-400" aria-hidden="true" />My account
        </h1>
        <p className="text-sm text-gray-600 mt-1 dark:text-slate-400">How you sign in. These settings are yours alone — changing them affects nobody else.</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 text-sm flex items-center justify-between dark:bg-slate-900 dark:border-slate-700">
        <span className="text-gray-600 dark:text-slate-400">Signed in as</span>
        <span className="text-gray-900 font-medium dark:text-slate-100">{user?.email}</span>
      </div>
      <section aria-labelledby="acct-2fa">
        <h2 id="acct-2fa" className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-3 dark:text-slate-100">
          <ShieldCheck className="w-5 h-5 text-gray-500 dark:text-slate-400" aria-hidden="true" />Two-factor sign-in
        </h2>
        <TwoFactorCard api={mfaApi} toast={toast} />
      </section>
      <section aria-labelledby="acct-pw" className="bg-white rounded-xl border border-gray-200 p-6 space-y-3 dark:bg-slate-900 dark:border-slate-700">
        <h2 id="acct-pw" className="text-lg font-semibold text-gray-900 flex items-center gap-2 dark:text-slate-100">
          <Lock className="w-5 h-5 text-gray-500 dark:text-slate-400" aria-hidden="true" />Change password
        </h2>
        <label className="block text-sm text-gray-700 dark:text-slate-200">Current password
          <input type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-sm text-gray-700 dark:text-slate-200">New password
          <input type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} className={inputCls} />
        </label>
        <label className="block text-sm text-gray-700 dark:text-slate-200">Confirm new password
          <input type="password" autoComplete="new-password" value={pw.confirmPassword} onChange={(e) => setPw({ ...pw, confirmPassword: e.target.value })} className={inputCls} />
        </label>
        <button onClick={changePassword} disabled={saving || !pw.currentPassword || !pw.newPassword} className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </section>
    </div>
  )
}
