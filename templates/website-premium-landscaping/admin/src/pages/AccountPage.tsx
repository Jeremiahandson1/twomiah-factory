import { useState } from 'react'
import { Save, KeyRound } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Label } from '../components/Field'

export function AccountPage() {
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setOkMsg(null)
    if (next.length < 8) { setError('New password must be at least 8 characters.'); return }
    if (next !== confirm) { setError('New password and confirmation don\'t match.'); return }
    setSaving(true)
    try {
      await api.post<{ ok: true }>('/api/admin/password', { currentPassword: current, newPassword: next })
      setOkMsg('Password updated.')
      setCurrent('')
      setNext('')
      setConfirm('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl text-ink">Account</h1>
        <p className="text-muted text-sm mt-1">Signed in as <span className="font-mono">{user?.email}</span></p>
      </div>

      <section className="card card-padding">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="w-4 h-4 text-ink-soft" />
          <h2 className="text-lg text-ink">Change password</h2>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Current password</Label>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
              className="input"
            />
          </div>
          <div>
            <Label>New password</Label>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
              className="input"
            />
            <p className="text-xs text-muted mt-1">At least 8 characters.</p>
          </div>
          <div>
            <Label>Confirm new password</Label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
              className="input"
            />
          </div>

          {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          {okMsg && <div className="text-green-800 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2">{okMsg}</div>}

          <button type="submit" disabled={saving} className="btn-primary btn-md inline-flex items-center gap-1.5 disabled:opacity-40">
            <Save className="w-4 h-4" />
            {saving ? 'Saving…' : 'Update password'}
          </button>
        </form>
      </section>
    </div>
  )
}
