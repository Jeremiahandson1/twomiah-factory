/**
 * Two-factor, on the Security tab. (T57)
 *
 * The screen half of the port. Without it the enrolment routes would be a server feature with no way
 * in — which is the state the dispensary was found in from the other direction (screens over a
 * sign-in that ignored them), and it is the same mistake either way round.
 *
 * ── what the design has to get right ────────────────────────────────────────────────────────────
 *
 * THE SEED IS SHOWN AS TEXT, not only as a QR code. There is no QR library in this bundle and adding
 * one for this is not worth it — every authenticator app takes a typed key, and a code somebody can
 * read is also a code they can get into a password manager.
 *
 * THE RECOVERY CODES ARE A STOPPING POINT. They exist once, in the response to `verify`, and are
 * never retrievable; so the card refuses to leave that state until the person has actually copied or
 * downloaded them. A dialog they can dismiss by reflex is how somebody ends up locked out with a
 * phone they have since replaced.
 *
 * TURNING IT OFF ASKS FOR A CODE, because an open session is what a stolen laptop has.
 */
import React, { useCallback, useEffect, useState } from 'react'

interface MfaApi {
  mfa: {
    devices: () => Promise<any>
    setup: () => Promise<any>
    verify: (deviceId: string, code: string) => Promise<any>
    newRecoveryCodes: (code: string) => Promise<any>
    remove: (deviceId: string, code: string) => Promise<any>
  }
}

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export function TwoFactorCard({ api, toast }: { api: MfaApi; toast: { success: (m: string) => void; error: (m: string) => void } }) {
  const [devices, setDevices] = useState<any[] | null>(null)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  /** Enrolment in flight: the seed we were given, waiting for the code that proves the phone has it. */
  const [enrolling, setEnrolling] = useState<{ deviceId: string; secret: string; otpauthUrl: string } | null>(null)
  const [code, setCode] = useState('')
  /** Shown once, and the card will not move on until they are taken. */
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [kept, setKept] = useState(false)
  const [offCode, setOffCode] = useState('')
  const [showOff, setShowOff] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await api.mfa.devices()
      setDevices(r?.devices || [])
      setActive(r?.active === true)
    } catch { setDevices([]) }
  }, [api])
  useEffect(() => { load() }, [load])

  const authenticator = (devices || []).find((d) => d.type === 'totp' && d.verified)
  const codesLeft = (devices || []).find((d) => d.type === 'backup_codes')?.codesLeft

  const start = async () => {
    setBusy(true)
    try {
      const r = await api.mfa.setup()
      setEnrolling({ deviceId: r.deviceId, secret: r.secret, otpauthUrl: r.otpauthUrl })
      setCode('')
    } catch (e) { toast.error(errMsg(e, 'Could not start')) } finally { setBusy(false) }
  }

  /**
   * CANCEL REMOVES THE PENDING DEVICE, it does not just forget about it. (T41)
   *
   * This used to be `setEnrolling(null)` and nothing else, so the row that `setup()` had already
   * created stayed on the server for ever. T41 found it on every tenant it tested: "Cancelling
   * two-factor setup leaves an unverified device behind. Deleting it needs a code, so it can't be
   * cleaned up" — and the code it wanted was from an authenticator the person had just decided not
   * to use. Sign-in was unaffected, because the gate counts only verified devices, which is exactly
   * why the litter accumulated unnoticed.
   *
   * The server now lets an unverified device be deleted with no code (mfaRoutes DELETE /devices/:id),
   * so this can simply ask. If that call fails the local state is still cleared — leaving the person
   * stuck on a dead enrolment screen would be worse than leaving a row behind — but the failure is
   * surfaced rather than swallowed, so it is not silent litter twice.
   */
  const cancelEnrolment = async () => {
    const pending = enrolling
    setEnrolling(null)
    setCode('')
    if (!pending) return
    setBusy(true)
    try {
      await api.mfa.remove(pending.deviceId, '')
      await load()
    } catch (e) {
      toast.error(errMsg(e, 'Setup was cancelled, but the pending device could not be removed'))
    } finally { setBusy(false) }
  }

  const finish = async () => {
    if (!enrolling) return
    setBusy(true)
    try {
      const r = await api.mfa.verify(enrolling.deviceId, code.trim())
      setEnrolling(null)
      setCode('')
      setRecoveryCodes(Array.isArray(r?.recoveryCodes) ? r.recoveryCodes : [])
      setKept(false)
      toast.success('Two-factor is on')
      await load()
    } catch (e) { toast.error(errMsg(e, 'That code was not accepted')) } finally { setBusy(false) }
  }

  const turnOff = async () => {
    if (!authenticator) return
    setBusy(true)
    try {
      await api.mfa.remove(authenticator.id, offCode.trim())
      setShowOff(false)
      setOffCode('')
      toast.success('Two-factor is off')
      await load()
    } catch (e) { toast.error(errMsg(e, 'Could not turn it off')) } finally { setBusy(false) }
  }

  const freshCodes = async () => {
    setBusy(true)
    try {
      const r = await api.mfa.newRecoveryCodes(offCode.trim())
      setOffCode('')
      setRecoveryCodes(Array.isArray(r?.recoveryCodes) ? r.recoveryCodes : [])
      setKept(false)
      await load()
    } catch (e) { toast.error(errMsg(e, 'Could not make new codes')) } finally { setBusy(false) }
  }

  const copyCodes = async () => {
    const text = (recoveryCodes || []).join('\n')
    try { await navigator.clipboard.writeText(text); setKept(true); toast.success('Copied') }
    catch { toast.error('Could not copy — select them and copy by hand') }
  }

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 dark:border-slate-700 dark:text-slate-100 dark:bg-slate-800'
  const btn = 'px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50'

  // ── the recovery codes stop everything until they are taken ──────────────────────────────────
  if (recoveryCodes) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-900 rounded-lg p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Your recovery codes</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">
            Keep these somewhere safe — <strong>they are shown once</strong>. Each one signs you in a single
            time if you lose your phone.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm text-gray-900 dark:text-slate-100">
          {recoveryCodes.map((c) => <li key={c} className="px-3 py-1.5 bg-gray-50 dark:bg-slate-800 rounded">{c}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={copyCodes} className={`${btn} bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100`}>Copy all</button>
          <button
            type="button"
            onClick={() => { if (kept) { setRecoveryCodes(null) } else { toast.error('Copy them first — this is the only time they are shown') } }}
            className={`${btn} bg-orange-600 text-white hover:bg-orange-700`}
          >
            I have saved them
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-slate-900 border dark:border-slate-800 rounded-lg p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Two-factor authentication</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-slate-400 max-w-prose">
            A six-digit code from your phone, on top of your password. This account can reach the client
            list, the contract values and the money — the password is the only thing in front of it today.
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${active
          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200'
          : 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-200'}`}>
          {active ? 'On' : 'Off'}
        </span>
      </div>

      {devices === null && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}

      {/* ── enrolling ── */}
      {enrolling && (
        <div className="space-y-3 border-t dark:border-slate-800 pt-4">
          <p className="text-sm text-gray-700 dark:text-slate-200">
            Add this key to your authenticator app, then enter the six digits it shows.
          </p>
          <div className="p-3 bg-gray-50 dark:bg-slate-800 rounded-lg">
            <p className="text-xs text-gray-500 dark:text-slate-400 mb-1">Setup key</p>
            <p className="font-mono text-sm break-all text-gray-900 dark:text-slate-100">{enrolling.secret}</p>
          </div>
          <div className="max-w-xs">
            <label htmlFor="mfa-code" className="block text-sm font-medium text-gray-700 mb-1 dark:text-slate-200">Code from the app</label>
            <input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code"
              inputMode="numeric" placeholder="123456" className={`${inputCls} font-mono tracking-widest`} />
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={finish} disabled={busy || !code.trim()} className={`${btn} bg-orange-600 text-white hover:bg-orange-700`}>
              {busy ? 'Checking…' : 'Turn it on'}
            </button>
            <button type="button" onClick={cancelEnrolment} disabled={busy} className={`${btn} bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100`}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── off, and not enrolling ── */}
      {!enrolling && devices !== null && !active && (
        <button type="button" onClick={start} disabled={busy} className={`${btn} bg-orange-600 text-white hover:bg-orange-700`}>
          {busy ? 'Starting…' : 'Turn on two-factor'}
        </button>
      )}

      {/* ── on ── */}
      {!enrolling && active && (
        <div className="space-y-3 border-t dark:border-slate-800 pt-4">
          <p className="text-sm text-gray-700 dark:text-slate-200">
            An authenticator app is set up{typeof codesLeft === 'number' ? `, with ${codesLeft} recovery code${codesLeft === 1 ? '' : 's'} left` : ''}.
          </p>
          {showOff ? (
            <div className="space-y-2 max-w-xs">
              <label htmlFor="mfa-off" className="block text-sm font-medium text-gray-700 dark:text-slate-200">Code from your app</label>
              <input id="mfa-off" value={offCode} onChange={(e) => setOffCode(e.target.value)} autoComplete="one-time-code"
                inputMode="text" placeholder="123456" className={`${inputCls} font-mono tracking-widest`} />
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={turnOff} disabled={busy || !offCode.trim()} className={`${btn} bg-red-600 text-white hover:bg-red-700`}>Turn off two-factor</button>
                <button type="button" onClick={freshCodes} disabled={busy || !offCode.trim()} className={`${btn} bg-gray-100 text-gray-800 dark:bg-slate-700 dark:text-slate-100`}>New recovery codes</button>
                <button type="button" onClick={() => { setShowOff(false); setOffCode('') }} className={`${btn} text-gray-600 dark:text-slate-300`}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setShowOff(true)} className={`${btn} bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-100`}>
              Turn off, or get new recovery codes
            </button>
          )}
        </div>
      )}
    </div>
  )
}
