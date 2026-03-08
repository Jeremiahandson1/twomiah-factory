import { useState, useEffect, useCallback } from 'react'
import { supabase, API_URL } from '../supabase'
import { User, Users, Plug, Save, Trash2, Plus, Shield, Eye, Pencil, Crown, Check, X, RefreshCw, Key } from 'lucide-react'

type Tab = 'profile' | 'team' | 'integrations'

interface FactoryUser {
  id: string
  auth_id: string
  email: string
  name: string | null
  role: string
  created_at: string
}

interface Integration {
  configured: boolean
  label: string
}

const ROLE_HIERARCHY = ['owner', 'admin', 'editor', 'viewer'] as const
const ROLE_ICONS: Record<string, typeof Crown> = { owner: Crown, admin: Shield, editor: Pencil, viewer: Eye }
const ROLE_COLORS: Record<string, string> = {
  owner: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  admin: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  editor: 'bg-green-500/20 text-green-400 border-green-500/30',
  viewer: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

async function apiFetch(path: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}/api/v1/factory${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}`, ...opts.headers },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'Request failed')
  return json
}

// ─── Role Badge ──────────────────────────────────────────────────────────────
function RoleBadge({ role }: { role: string }) {
  const Icon = ROLE_ICONS[role] || Eye
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${ROLE_COLORS[role] || ROLE_COLORS.viewer}`}>
      <Icon size={12} />
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  )
}

// ─── Profile Tab ─────────────────────────────────────────────────────────────
function ProfileTab() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Password
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    apiFetch('/settings/profile').then((data) => {
      setName(data.name || '')
      setEmail(data.email || '')
      setRole(data.role || 'viewer')
    }).catch(() => {})
  }, [])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await apiFetch('/settings/profile', { method: 'PATCH', body: JSON.stringify({ name }) })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordChange = async () => {
    setPwMsg(null)
    if (newPassword !== confirmPassword) {
      setPwMsg({ type: 'error', text: 'Passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      setPwMsg({ type: 'error', text: 'Password must be at least 8 characters' })
      return
    }
    setPwSaving(true)
    try {
      // Supabase updateUser only needs the new password when the user is already signed in
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setPwMsg({ type: 'success', text: 'Password updated successfully' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: any) {
      setPwMsg({ type: 'error', text: err.message })
    } finally {
      setPwSaving(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Profile Info */}
      <div className="bg-[#181c2e] rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold mb-6">Profile Information</h3>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input type="email" value={email} disabled className="w-full bg-gray-800/50 border border-gray-700 rounded-lg px-4 py-2.5 text-gray-400 cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Role</label>
            <div className="mt-1"><RoleBadge role={role} /></div>
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
            {saved ? <Check size={16} /> : <Save size={16} />}
            {saving ? 'Saving...' : saved ? 'Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Change Password */}
      <div className="bg-[#181c2e] rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold mb-6 flex items-center gap-2"><Key size={18} /> Change Password</h3>
        <div className="space-y-4 max-w-md">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Current Password</label>
            <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">New Password</label>
            <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Confirm New Password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          {pwMsg && <p className={pwMsg.type === 'error' ? 'text-red-400 text-sm' : 'text-green-400 text-sm'}>{pwMsg.text}</p>}
          <button onClick={handlePasswordChange} disabled={pwSaving || !newPassword} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
            <Key size={16} />
            {pwSaving ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── Team Tab ────────────────────────────────────────────────────────────────
function TeamTab() {
  const [users, setUsers] = useState<FactoryUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviting, setInviting] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRole, setEditRole] = useState('')

  const loadUsers = useCallback(async () => {
    try {
      const data = await apiFetch('/settings/users')
      setUsers(data)
      setError('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const handleInvite = async () => {
    if (!inviteEmail) return
    setInviting(true)
    setError('')
    try {
      await apiFetch('/settings/users', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole }) })
      setInviteEmail('')
      setInviteRole('viewer')
      await loadUsers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setInviting(false)
    }
  }

  const handleRoleChange = async (userId: string) => {
    try {
      await apiFetch(`/settings/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role: editRole }) })
      setEditingId(null)
      await loadUsers()
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleRemove = async (userId: string) => {
    if (!confirm('Remove this team member?')) return
    try {
      await apiFetch(`/settings/users/${userId}`, { method: 'DELETE' })
      await loadUsers()
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (loading) return <div className="text-gray-400 p-8">Loading team members...</div>

  return (
    <div className="space-y-6">
      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">{error}</div>}

      {/* Invite Form */}
      <div className="bg-[#181c2e] rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Plus size={18} /> Invite Team Member</h3>
        <div className="flex gap-3 items-end flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@company.com" className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div className="w-40">
            <label className="block text-sm text-gray-400 mb-1">Role</label>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="w-full bg-[#0f1117] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors appearance-none">
              <option value="admin">Admin</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
          <button onClick={handleInvite} disabled={inviting || !inviteEmail} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors whitespace-nowrap">
            <Plus size={16} />
            {inviting ? 'Inviting...' : 'Invite'}
          </button>
        </div>
      </div>

      {/* Users List */}
      <div className="bg-[#181c2e] rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800">
          <h3 className="text-lg font-semibold flex items-center gap-2"><Users size={18} /> Team Members ({users.length})</h3>
        </div>
        <div className="divide-y divide-gray-800">
          {users.map(u => (
            <div key={u.id} className="px-6 py-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-white font-medium truncate">{u.name || u.email}</p>
                {u.name && <p className="text-gray-500 text-sm truncate">{u.email}</p>}
                <p className="text-gray-600 text-xs mt-0.5">Joined {new Date(u.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-3">
                {editingId === u.id ? (
                  <div className="flex items-center gap-2">
                    <select value={editRole} onChange={e => setEditRole(e.target.value)} className="bg-[#0f1117] border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white appearance-none">
                      {ROLE_HIERARCHY.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                    <button onClick={() => handleRoleChange(u.id)} className="p-1.5 rounded-lg bg-green-600 hover:bg-green-700 transition-colors"><Check size={14} /></button>
                    <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 transition-colors"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <button onClick={() => { setEditingId(u.id); setEditRole(u.role) }} title="Change role">
                      <RoleBadge role={u.role} />
                    </button>
                    <button onClick={() => handleRemove(u.id)} className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Remove user">
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {users.length === 0 && <div className="px-6 py-8 text-center text-gray-500">No team members found</div>}
        </div>
      </div>
    </div>
  )
}


// ─── Integrations Tab ────────────────────────────────────────────────────────
function IntegrationsTab() {
  const [integrations, setIntegrations] = useState<Record<string, Integration>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch('/settings/integrations').then(setIntegrations).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const refresh = () => {
    setLoading(true)
    apiFetch('/settings/integrations').then(setIntegrations).catch(() => {}).finally(() => setLoading(false))
  }

  if (loading) return <div className="text-gray-400 p-8">Checking integrations...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2"><Plug size={18} /> Connected Services</h3>
        <button onClick={refresh} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(integrations).map(([key, integration]) => (
          <div key={key} className="bg-[#181c2e] rounded-xl border border-gray-800 p-5 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${integration.configured ? 'bg-green-500/10 text-green-400' : 'bg-gray-800 text-gray-600'}`}>
              {integration.label.charAt(0)}
            </div>
            <div className="flex-1">
              <p className="text-white font-medium">{integration.label}</p>
              <p className={`text-xs mt-0.5 ${integration.configured ? 'text-green-400' : 'text-gray-500'}`}>
                {integration.configured ? 'Configured' : 'Not configured'}
              </p>
            </div>
            <div className={`w-3 h-3 rounded-full ${integration.configured ? 'bg-green-500' : 'bg-gray-600'}`} />
          </div>
        ))}
      </div>
      {Object.keys(integrations).length === 0 && (
        <div className="text-center text-gray-500 py-8">No integrations data available</div>
      )}
    </div>
  )
}


// ─── Settings Page ───────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('profile')
  const [userRole, setUserRole] = useState<string>('viewer')

  useEffect(() => {
    apiFetch('/settings/profile').then(data => setUserRole(data.role || 'viewer')).catch(() => {})
  }, [])

  const isOwnerOrAdmin = userRole === 'owner' || userRole === 'admin'

  const tabs: { id: Tab; label: string; icon: typeof User; show: boolean }[] = [
    { id: 'profile', label: 'Profile', icon: User, show: true },
    { id: 'team', label: 'Team', icon: Users, show: isOwnerOrAdmin },
    { id: 'integrations', label: 'Integrations', icon: Plug, show: true },
  ]

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-8">Settings</h1>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-8 bg-[#181c2e] rounded-xl p-1 w-fit border border-gray-800">
        {tabs.filter(t => t.show).map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              <Icon size={16} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {tab === 'profile' && <ProfileTab />}
      {tab === 'team' && isOwnerOrAdmin && <TeamTab />}
      {tab === 'integrations' && <IntegrationsTab />}
    </div>
  )
}
