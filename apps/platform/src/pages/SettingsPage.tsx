import { useState, useEffect, useCallback } from 'react'
import { supabase, API_URL } from '../supabase'
import { User, Users, Plug, Save, Trash2, Plus, Shield, Eye, Pencil, Crown, Check, X, RefreshCw, Key, Download, Monitor, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'

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


// ─── QB Desktop Setup Card ──────────────────────────────────────────────────
function QbDesktopCard({ configured }: { configured: boolean }) {
  const [showSetup, setShowSetup] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [qbStatus, setQbStatus] = useState<any>(null)

  useEffect(() => {
    fetch(`${API_URL}/api/v1/qbwc/status`, {
      headers: { Authorization: `Bearer ${sessionToken}` },
    }).then(r => r.json()).then(setQbStatus).catch(() => {})
  }, [])

  const handleDownloadQwc = async () => {
    setDownloading(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/api/v1/qbwc/qwc`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'TwomiahFactory.qwc'
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* */ } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="bg-[#181c2e] rounded-xl border border-gray-800 p-6 col-span-full">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl font-bold ${configured ? 'bg-green-500/10 text-green-400' : 'bg-blue-500/10 text-blue-400'}`}>
            <Monitor size={24} />
          </div>
          <div>
            <p className="text-white font-semibold text-lg">QuickBooks Desktop</p>
            <p className={`text-sm mt-0.5 ${configured ? 'text-green-400' : 'text-yellow-400'}`}>
              {configured ? 'Configured — QB Desktop will sync on schedule' : 'Set QBWC_PASSWORD env var to enable'}
            </p>
            {qbStatus?.syncs && (
              <p className="text-xs text-gray-500 mt-1">Syncs: {qbStatus.syncs.join(', ')} every {qbStatus.syncInterval}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {configured && (
            <button onClick={handleDownloadQwc} disabled={downloading} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg text-sm font-medium transition-colors">
              <Download size={14} />
              {downloading ? 'Downloading...' : 'Download .qwc'}
            </button>
          )}
          <button onClick={() => setShowSetup(!showSetup)} className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm font-medium text-gray-300 transition-colors">
            <BookOpen size={14} />
            Setup Guide
            {showSetup ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {showSetup && (
        <div className="mt-6 bg-[#0f1117] rounded-lg border border-gray-800 p-5 text-sm text-gray-300 space-y-4">
          <h4 className="text-white font-semibold text-base">QuickBooks Web Connector Setup</h4>
          <p className="text-gray-400">
            The QB Web Connector (QBWC) is a free Intuit utility that runs on the same Windows machine as QuickBooks Desktop.
            It polls this server on a schedule and pushes customers, invoices, and payments into your QB company file.
          </p>

          <div className="space-y-3">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <p className="text-white font-medium">Set the QBWC_PASSWORD environment variable</p>
                <p className="text-gray-400 mt-1">Add <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-300">QBWC_PASSWORD</code> to your Render environment variables. Choose a strong password — this is the shared secret between the Web Connector and this server.</p>
                <p className="text-gray-500 mt-1">Optional: set <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-300">QBWC_USERNAME</code> (default: <code className="bg-gray-800 px-1.5 py-0.5 rounded text-gray-400">twomiah</code>)</p>
              </div>
            </div>

            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <p className="text-white font-medium">Install QuickBooks Web Connector</p>
                <p className="text-gray-400 mt-1">Download QBWC from <span className="text-blue-400">developer.intuit.com</span> and install it on the same Windows PC where QuickBooks Desktop is running. Works with QB Desktop 2006 and later.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <p className="text-white font-medium">Download and import the .qwc file</p>
                <p className="text-gray-400 mt-1">Click "Download .qwc" above, then open the file with QBWC (File → Add an Application). QBWC will ask you to authorize access — click Yes and select your company file.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">4</span>
              <div>
                <p className="text-white font-medium">Enter the password in QBWC</p>
                <p className="text-gray-400 mt-1">QBWC will prompt for a password. Enter the same password you set in <code className="bg-gray-800 px-1.5 py-0.5 rounded text-blue-300">QBWC_PASSWORD</code>. Check "Save password" so it doesn't ask again.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs font-bold">5</span>
              <div>
                <p className="text-white font-medium">Sync runs automatically</p>
                <p className="text-gray-400 mt-1">QBWC will sync every 30 minutes. You can also click "Update Selected" in QBWC to sync immediately. QuickBooks must be open for sync to work.</p>
              </div>
            </div>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mt-4">
            <p className="text-yellow-300 text-xs font-medium">Note: QuickBooks Desktop must be running on the same machine as the Web Connector. QBWC runs as a Windows system tray application. The computer must be on and connected to the internet for scheduled syncs.</p>
          </div>

          <div className="bg-gray-800/50 rounded-lg p-3 mt-2">
            <p className="text-gray-400 text-xs"><strong className="text-gray-300">What gets synced:</strong> New factory customers → QB Customers. Paid Stripe invoices (last 30 days) → QB Invoices + Payments. One-way push — changes in QB Desktop are not synced back.</p>
          </div>
        </div>
      )}
    </div>
  )
}

// Session token helper for QB Desktop card
let sessionToken = ''
supabase.auth.getSession().then(({ data: { session } }) => {
  sessionToken = session?.access_token || ''
})
supabase.auth.onAuthStateChange((_, session) => {
  sessionToken = session?.access_token || ''
})

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

  const qbDesktop = integrations.qb_desktop
  const otherIntegrations = Object.entries(integrations).filter(([key]) => key !== 'qb_desktop')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2"><Plug size={18} /> Connected Services</h3>
        <button onClick={refresh} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {otherIntegrations.map(([key, integration]) => (
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

        {/* QB Desktop gets its own expanded card */}
        {qbDesktop && <QbDesktopCard configured={qbDesktop.configured} />}
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
