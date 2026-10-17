import { useEffect, useState } from 'react'
import { UserPlus, Trash2, X } from 'lucide-react'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Label } from '../components/Field'

interface AdminUser {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'editor'
  lastLoginAt: string | null
  createdAt: string
}

export function UsersPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  const refresh = () => {
    setLoading(true)
    api.get<{ users: AdminUser[] }>('/api/admin/users')
      .then(({ users }) => setUsers(users))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  const changeRole = async (id: string, role: 'admin' | 'editor') => {
    setError(null)
    try {
      const { user } = await api.patch<{ user: AdminUser }>(`/api/admin/users/${id}`, { role })
      setUsers((rows) => rows.map((u) => u.id === id ? user : u))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const remove = async (u: AdminUser) => {
    if (!confirm(`Remove ${u.email}? They'll lose admin access immediately.`)) return
    setError(null)
    try {
      await api.delete<{ ok: true }>(`/api/admin/users/${u.id}`)
      setUsers((rows) => rows.filter((r) => r.id !== u.id))
    } catch (e: any) {
      setError(e.message)
    }
  }

  if (me?.role !== 'admin') {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-3xl text-ink">Users</h1>
        <div className="card card-padding mt-6 text-muted">
          Only admins can manage users. Ask an admin to upgrade your role if you need this.
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl text-ink">Users</h1>
          <p className="text-muted text-sm mt-1">Invite teammates and manage their access.</p>
        </div>
        <button onClick={() => setShowInvite(true)} className="btn-primary btn-md inline-flex items-center gap-1.5">
          <UserPlus className="w-4 h-4" />
          Invite user
        </button>
      </div>

      {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</div>}

      {loading ? (
        <div className="text-muted text-sm">Loading…</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-paper border-b border-line">
              <tr className="text-left text-ink-soft text-xs uppercase tracking-wider">
                <th className="px-5 py-3 font-semibold">Email</th>
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Last login</th>
                <th className="px-5 py-3 font-semibold w-px"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {users.map((u) => {
                const isMe = u.id === me?.id
                return (
                  <tr key={u.id} className="hover:bg-paper/50">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-ink">{u.email}</div>
                      {isMe && <div className="text-xs text-muted mt-0.5">You</div>}
                    </td>
                    <td className="px-5 py-4 text-ink-soft">{u.name || <span className="text-muted">—</span>}</td>
                    <td className="px-5 py-4">
                      <select
                        value={u.role}
                        onChange={(e) => changeRole(u.id, e.target.value as 'admin' | 'editor')}
                        disabled={isMe}
                        className="input"
                        title={isMe ? "You can't change your own role. Ask another admin." : ''}
                      >
                        <option value="admin">Admin</option>
                        <option value="editor">Editor</option>
                      </select>
                    </td>
                    <td className="px-5 py-4 text-muted text-xs">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                        : 'Never'}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button
                        onClick={() => remove(u)}
                        disabled={isMe}
                        className="btn-secondary btn-sm text-red-600 disabled:opacity-30"
                        title={isMe ? "You can't delete yourself." : ''}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showInvite && (
        <InviteModal
          onClose={() => setShowInvite(false)}
          onCreated={(u) => { setUsers((rows) => [...rows, u]); setShowInvite(false) }}
        />
      )}
    </div>
  )
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (u: AdminUser) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<'admin' | 'editor'>('editor')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const { user } = await api.post<{ user: AdminUser }>('/api/admin/users', {
        email: email.trim().toLowerCase(),
        password,
        name: name.trim() || null,
        role,
      })
      onCreated(user)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="card card-padding w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xl text-ink">Invite user</h2>
          <button onClick={onClose} className="text-muted hover:text-ink">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Email</Label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="input" autoFocus />
          </div>
          <div>
            <Label>Initial password</Label>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
              className="input"
            />
            <p className="text-xs text-muted mt-1">At least 10 characters, mixing letters with a number or symbol. They can change it after first login.</p>
          </div>
          <div>
            <Label>Name (optional)</Label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="input" />
          </div>
          <div>
            <Label>Role</Label>
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'editor')} className="input">
              <option value="editor">Editor — edit pages, photos, settings, leads</option>
              <option value="admin">Admin — everything + manage users</option>
            </select>
          </div>

          {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary btn-md">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary btn-md disabled:opacity-40">
              {submitting ? 'Inviting…' : 'Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
