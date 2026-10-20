/**
 * The person's own location switches (top of the Alerts tab): "Share my location while working" and,
 * under it, "Clock me in and out at job sites". Both are off until THEY turn them on — the server's
 * default is off and nothing else in the app turns them on. Saving is PUT /api/geofencing/settings
 * (their own row), then the native task is started or stopped (src/location/tracking.ts).
 *
 * Shown only where it is offered (src/location/policy.ts trackingOffered): a trade business with
 * gps_tracking, in a build that declares background location.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, AppState, Linking, Platform, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { get, put } from '../api/client'
import { useTheme } from '../theme/ThemeContext'
import { ERROR_INK, SETTINGS_OFF, readSettings, settingsChange, type LocationSettings } from './policy'
import { permissionState, requestPermission, startTracking, stopTracking } from './tracking'
import { useTrackingOffered } from './useTrackingSync'

const ALWAYS_HOW =
  Platform.OS === 'ios'
    ? 'To share your location while the app is closed, open Settings, tap Location, and choose "Always".'
    : 'To share your location while the app is closed, open Settings, tap Permissions, then Location, and choose "Allow all the time".'

export function LocationCard() {
  const offered = useTrackingOffered()
  if (!offered) return null
  return <LocationCardBody />
}

function LocationCardBody() {
  const t = useTheme()
  const [settings, setSettings] = useState<LocationSettings | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [always, setAlways] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** They tapped the switch and the phone did not give "Always". */
  const [refused, setRefused] = useState(false)
  const errorInk = t.isDark ? ERROR_INK.dark : ERROR_INK.light

  const load = useCallback(async () => {
    const res = await get('/api/geofencing/settings')
    const s = res.ok ? readSettings(res.data) : null
    setSettings(s)
    setLoadFailed(!s)
    setAlways((await permissionState().catch(() => 'denied')) === 'always')
  }, [])

  useEffect(() => { load() }, [load])

  // Back from phone settings: read the permission again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') permissionState().then((p) => setAlways(p === 'always')).catch(() => {})
    })
    return () => sub.remove()
  }, [])

  const save = async (change: { locationTrackingEnabled: boolean } | { autoClockEnabled: boolean }) => {
    const current = settings || SETTINGS_OFF
    const body = settingsChange(current, change)
    if (!body) return
    setError(null)
    setSaving(true)
    try {
      if (body.locationTrackingEnabled === true) {
        // Ask only now, from their tap. Without "Always" nothing is saved as on.
        const verdict = await requestPermission()
        setAlways(verdict === 'always')
        setRefused(verdict !== 'always')
        if (verdict !== 'always') return
      }
      const res = await put('/api/geofencing/settings', body)
      const saved = res.ok ? readSettings(res.data) : null
      if (!saved) { setError('Could not save. Check your connection and try again.'); return }
      setSettings(saved)
      if (saved.locationTrackingEnabled) {
        const started = await startTracking().catch(() => false)
        if (!started) {
          // On in the server but not running here would report nothing — put the switch back.
          const back = await put('/api/geofencing/settings', { locationTrackingEnabled: false, autoClockEnabled: false })
          setSettings(readSettings(back.data) || SETTINGS_OFF)
          setError('Location could not be started on this phone, so sharing stays off.')
        }
      } else {
        await stopTracking()
      }
    } finally {
      setSaving(false)
    }
  }

  const tracking = !!settings?.locationTrackingEnabled
  const autoClock = !!settings?.autoClockEnabled

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <View style={styles.head}>
        <Ionicons name="location-outline" size={18} color={t.text} />
        <Text style={[styles.heading, { color: t.text }]}>Location</Text>
        {saving || (!settings && !loadFailed) ? <ActivityIndicator size="small" color={t.textSecondary} /> : null}
      </View>

      {loadFailed ? (
        <TouchableOpacity onPress={load} accessibilityRole="button">
          <Text style={{ color: errorInk, fontSize: 13 }}>Could not load your location settings. Tap to try again.</Text>
        </TouchableOpacity>
      ) : (
        <>
          <Row
            title="Share my location while working"
            detail="Your business sees where you are while this is on, and the phone shows a notice while it runs."
            value={tracking}
            disabled={saving || !settings}
            onChange={(v) => save({ locationTrackingEnabled: v })}
          />
          <Row
            title="Clock me in and out at job sites"
            detail={tracking ? 'Clocks you in when you arrive at a job site and out when you leave.' : 'Turn on location sharing first.'}
            value={autoClock}
            disabled={saving || !tracking}
            onChange={(v) => save({ autoClockEnabled: v })}
          />
        </>
      )}

      {!always && (refused || tracking) ? (
        <View style={[styles.notice, { backgroundColor: t.surfaceAlt, borderColor: t.border }]}>
          <Text style={{ color: t.text, fontSize: 13, lineHeight: 18 }}>
            {tracking ? 'This phone only lets the app use your location while it is open. ' : ''}{ALWAYS_HOW}
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
            style={[styles.button, { borderColor: t.text }]}
          >
            <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>Open phone settings</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {error ? <Text style={{ color: errorInk, fontSize: 13, marginTop: 8 }}>{error}</Text> : null}
    </View>
  )
}

function Row({ title, detail, value, disabled, onChange }: {
  title: string
  detail: string
  value: boolean
  disabled: boolean
  onChange: (v: boolean) => void
}) {
  const t = useTheme()
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: t.text }]}>{title}</Text>
        <Text style={[styles.detail, { color: t.textSecondary }]}>{detail}</Text>
      </View>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: t.primary, false: t.border }}
        accessibilityLabel={title}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 16, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontSize: 15, fontWeight: '700', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { fontSize: 14, fontWeight: '600' },
  detail: { fontSize: 12, marginTop: 2, lineHeight: 17 },
  notice: { borderRadius: 10, borderWidth: 1, padding: 12, gap: 10 },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
})
