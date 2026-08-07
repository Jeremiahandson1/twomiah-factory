import { useEffect, useState } from 'react'
import { Save, KeyRound, ShieldCheck, ShieldOff, Smartphone, Mail, Copy, AlertTriangle, Monitor, LogOut as LogOutIcon } from 'lucide-react'
import QRCode from 'qrcode'
import { api } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { Label } from '../components/Field'

export function AccountPage() {
  const { user, refresh } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null); setOkMsg(null)
    if (next.length < 10) { setError('New password must be at least 10 characters.'); return }
    if (!/[A-Za-z]/.test(next) || !/[\d\W_]/.test(next)) { setError('New password must contain letters and at least one number or symbol.'); return }
    if (next !== confirm) { setError("New password and confirmation don't match."); return }
    setSaving(true)
    try {
      await api.post<{ ok: true }>('/api/admin/password', { currentPassword: current, newPassword: next })
      setOkMsg('Password updated.')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err: any) { setError(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-6">
      <div className="mb-2">
        <h1 className="text-3xl text-ink">Account</h1>
        <p className="text-muted text-sm mt-1">Signed in as <span className="font-mono">{user?.email}</span></p>
      </div>

      <EmailVerificationCard />
      <TwoFactorCard />
      <SessionsCard />

      <section className="card card-padding">
        <div className="flex items-center gap-2 mb-4">
          <KeyRound className="w-4 h-4 text-ink-soft" />
          <h2 className="text-lg text-ink">Change password</h2>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Current password</Label>
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required className="input" />
          </div>
          <div>
            <Label>New password</Label>
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={10} required className="input" />
            <p className="text-xs text-muted mt-1">At least 10 characters, mixing letters with a number or symbol.</p>
          </div>
          <div>
            <Label>Confirm new password</Label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required className="input" />
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

  function SessionsCard() {
    interface Session {
      id: string
      ip: string | null
      userAgent: string | null
      createdAt: string
      lastSeenAt: string
      isCurrent: boolean
    }
    const [sessions, setSessions] = useState<Session[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [working, setWorking] = useState(false)

    const load = () => {
      setLoading(true)
      api.get<{ sessions: Session[] }>('/api/admin/sessions')
        .then(({ sessions }) => setSessions(sessions))
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false))
    }
    useEffect(load, [])

    const revoke = async (id: string) => {
      setWorking(true); setError(null)
      try { await api.post('/api/admin/sessions/' + id + '/revoke'); load() }
      catch (e: any) { setError(e.message) }
      finally { setWorking(false) }
    }
    const revokeAll = async () => {
      if (!window.confirm('Sign out everywhere except this device?')) return
      setWorking(true); setError(null)
      try { await api.post('/api/admin/sessions/revoke-all'); load() }
      catch (e: any) { setError(e.message) }
      finally { setWorking(false) }
    }

    const describe = (ua: string | null) => {
      if (!ua) return 'Unknown device'
      const u = ua.toLowerCase()
      const browser = u.includes('chrome') ? 'Chrome' : u.includes('firefox') ? 'Firefox' : u.includes('safari') ? 'Safari' : u.includes('edge') ? 'Edge' : 'Browser'
      const os = u.includes('windows') ? 'Windows' : u.includes('mac os') || u.includes('macintosh') ? 'macOS' : u.includes('iphone') ? 'iPhone' : u.includes('ipad') ? 'iPad' : u.includes('android') ? 'Android' : u.includes('linux') ? 'Linux' : ''
      return browser + (os ? ' · ' + os : '')
    }

    return (
      <section className="card card-padding">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Monitor className="w-4 h-4 text-ink-soft" />
            <h2 className="text-lg text-ink">Active sessions</h2>
          </div>
          {sessions.length > 1 && (
            <button onClick={revokeAll} disabled={working} className="btn-secondary btn-sm text-red-600 inline-flex items-center gap-1.5">
              <LogOutIcon className="w-3.5 h-3.5" />
              Sign out everywhere else
            </button>
          )}
        </div>
        {loading && <div className="text-muted text-sm">Loading…</div>}
        {error && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">{error}</div>}
        {!loading && (
          <ul className="divide-y divide-line">
            {sessions.map(s => (
              <li key={s.id} className="py-3 flex items-center gap-3">
                <Monitor className="w-4 h-4 text-ink-soft" />
                <div className="flex-1">
                  <div className="text-sm text-ink">
                    {describe(s.userAgent)}
                    {s.isCurrent && <span className="ml-2 text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">This device</span>}
                  </div>
                  <div className="text-xs text-muted font-mono">
                    {s.ip || 'unknown'} · last active {new Date(s.lastSeenAt).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>
                {!s.isCurrent && (
                  <button onClick={() => revoke(s.id)} disabled={working} className="btn-secondary btn-sm text-red-600">Revoke</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  function EmailVerificationCard() {
    const [sending, setSending] = useState(false)
    const [msg, setMsg] = useState<string | null>(null)
    if (user?.emailVerified) {
      return (
        <section className="card card-padding flex items-center gap-3">
          <Mail className="w-5 h-5 text-green-700" />
          <div>
            <div className="text-sm font-semibold text-ink">Email verified</div>
            <div className="text-xs text-muted">{user?.email}</div>
          </div>
        </section>
      )
    }
    return (
      <section className="card card-padding">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
          <div className="flex-1">
            <h2 className="text-lg text-ink">Confirm your email</h2>
            <p className="text-sm text-muted mt-1">We use your email for password resets and security alerts. Confirming proves the address is yours and reachable.</p>
            {msg && <div className="text-green-800 text-sm bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-3">{msg}</div>}
            <button
              onClick={async () => {
                setSending(true); setMsg(null)
                try {
                  await api.post('/api/admin/verify-email/send')
                  setMsg('Confirmation email sent. Check your inbox.')
                } catch (e: any) { setMsg(e?.message) }
                finally { setSending(false) }
              }}
              disabled={sending}
              className="btn-secondary btn-sm mt-3 disabled:opacity-40"
            >
              {sending ? 'Sending…' : 'Send confirmation email'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  function TwoFactorCard() {
    const [setup, setSetup] = useState<{ secret: string; otpauthUri: string; qrDataUrl: string } | null>(null)
    const [code, setCode] = useState('')
    const [working, setWorking] = useState(false)
    const [twoFaError, setTwoFaError] = useState<string | null>(null)
    const [codes, setCodes] = useState<string[] | null>(null)
    const [disableOpen, setDisableOpen] = useState(false)
    const [disablePassword, setDisablePassword] = useState('')

    const beginSetup = async () => {
      setWorking(true); setTwoFaError(null)
      try {
        const res = await api.post<{ secret: string; otpauthUri: string }>('/api/admin/2fa/setup')
        const qrDataUrl = await QRCode.toDataURL(res.otpauthUri, { width: 220, margin: 1 })
        setSetup({ secret: res.secret, otpauthUri: res.otpauthUri, qrDataUrl })
      } catch (e: any) { setTwoFaError(e?.message) }
      finally { setWorking(false) }
    }

    const confirmEnable = async (e: React.FormEvent) => {
      e.preventDefault()
      setWorking(true); setTwoFaError(null)
      try {
        const res = await api.post<{ ok: true; recoveryCodes: string[] }>('/api/admin/2fa/enable', { code: code.trim() })
        setCodes(res.recoveryCodes)
        setSetup(null); setCode('')
        await refresh()
      } catch (e: any) { setTwoFaError(e?.message) }
      finally { setWorking(false) }
    }

    const disable = async (e: React.FormEvent) => {
      e.preventDefault()
      setWorking(true); setTwoFaError(null)
      try {
        await api.post('/api/admin/2fa/disable', { password: disablePassword })
        setDisableOpen(false); setDisablePassword('')
        await refresh()
      } catch (e: any) { setTwoFaError(e?.message) }
      finally { setWorking(false) }
    }

    const regenCodes = async () => {
      const pw = prompt('Re-enter your password to generate new recovery codes:')
      if (!pw) return
      setWorking(true); setTwoFaError(null)
      try {
        const res = await api.post<{ recoveryCodes: string[] }>('/api/admin/2fa/recovery-codes/regenerate', { password: pw })
        setCodes(res.recoveryCodes)
        await refresh()
      } catch (e: any) { setTwoFaError(e?.message) }
      finally { setWorking(false) }
    }

    if (codes) {
      return (
        <section className="card card-padding">
          <h2 className="text-lg text-ink mb-1">Save your recovery codes</h2>
          <p className="text-sm text-muted mb-4">Each code works once if you lose access to your authenticator. Store them somewhere safe — we can't show them again.</p>
          <div className="bg-paper rounded-lg p-4 font-mono text-sm grid grid-cols-2 gap-2 mb-4">
            {codes.map((c) => <div key={c}>{c}</div>)}
          </div>
          <div className="flex gap-2">
            <button onClick={() => { navigator.clipboard.writeText(codes.join('\n')); }} className="btn-secondary btn-sm inline-flex items-center gap-1.5">
              <Copy className="w-3.5 h-3.5" /> Copy all
            </button>
            <button onClick={() => setCodes(null)} className="btn-primary btn-sm">I've saved them</button>
          </div>
        </section>
      )
    }

    if (user?.totpEnabled) {
      return (
        <section className="card card-padding">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-green-700 mt-0.5" />
            <div className="flex-1">
              <h2 className="text-lg text-ink">Two-factor authentication on</h2>
              <p className="text-sm text-muted mt-1">You'll be asked for a code from your authenticator each time you sign in. {(user?.recoveryCodesRemaining ?? 0)} recovery codes remaining.</p>
              {twoFaError && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{twoFaError}</div>}
              <div className="flex gap-2 mt-3">
                <button onClick={regenCodes} disabled={working} className="btn-secondary btn-sm">Generate new recovery codes</button>
                <button onClick={() => setDisableOpen(true)} disabled={working} className="btn-secondary btn-sm text-red-600 inline-flex items-center gap-1.5">
                  <ShieldOff className="w-3.5 h-3.5" /> Turn off
                </button>
              </div>
              {disableOpen && (
                <form onSubmit={disable} className="mt-4 space-y-3 border-t border-line pt-4">
                  <Label>Confirm with your password</Label>
                  <input type="password" required value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} className="input" autoFocus />
                  <div className="flex gap-2">
                    <button type="submit" disabled={working} className="btn-primary btn-sm">Disable 2FA</button>
                    <button type="button" onClick={() => setDisableOpen(false)} className="btn-secondary btn-sm">Cancel</button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </section>
      )
    }

    return (
      <section className="card card-padding">
        <div className="flex items-start gap-3">
          <Smartphone className="w-5 h-5 text-ink-soft mt-0.5" />
          <div className="flex-1">
            <h2 className="text-lg text-ink">Two-factor authentication</h2>
            <p className="text-sm text-muted mt-1">Adds a one-time code from an app like Google Authenticator or 1Password every time you sign in. Strongest protection against stolen passwords.</p>
            {twoFaError && <div className="text-red-700 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-3">{twoFaError}</div>}
            {!setup ? (
              <button onClick={beginSetup} disabled={working} className="btn-primary btn-sm mt-3 disabled:opacity-40">
                {working ? 'Generating…' : 'Turn on 2FA'}
              </button>
            ) : (
              <form onSubmit={confirmEnable} className="mt-4 space-y-4">
                <div>
                  <div className="text-sm font-semibold text-ink mb-2">1. Scan this QR code with your authenticator app</div>
                  <img src={setup.qrDataUrl} alt="2FA QR code" className="bg-white p-2 rounded border border-line" />
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer">Can't scan? Enter the secret manually</summary>
                    <code className="block mt-1 bg-paper p-2 rounded font-mono break-all">{setup.secret}</code>
                  </details>
                </div>
                <div>
                  <div className="text-sm font-semibold text-ink mb-2">2. Enter the 6-digit code your app shows</div>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="input font-mono tracking-widest text-lg max-w-[180px]"
                    placeholder="123456"
                    autoFocus
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={working} className="btn-primary btn-sm">Verify & enable</button>
                  <button type="button" onClick={() => { setSetup(null); setCode('') }} className="btn-secondary btn-sm">Cancel</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>
    )
  }
}
