// A pitch gauge on the roofer's phone, as the stand-alone pitch apps do it: the phone's own tilt sensor reads the slope.
// Two ways to hold it, and the gauge tells which it is seeing from which way gravity pulls:
//   · from the ground, phone upright facing a gable end: turn the phone until the line across the screen runs along the
//     roof's edge (the back camera shows behind the line where the phone allows it);
//   · on the roof (or on a rafter): lay the phone flat on the slope.
// The reading is the roof's rise over 12. A computer has no tilt sensor; there the gauge says so and the pitch is typed.
import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  title: string
  onUse: (pitchOver12: number) => void
  onClose: () => void
}

/** Rise over 12 for a slope angle in degrees, to the half. */
const overTwelve = (deg: number) => Math.round(Math.tan((deg * Math.PI) / 180) * 12 * 2) / 2

export default function PitchGauge({ title, onUse, onClose }: Props) {
  const [state, setState] = useState<'ask' | 'reading' | 'none'>('ask')
  const [deg, setDeg] = useState<number | null>(null)
  const [flat, setFlat] = useState(false)
  const [held, setHeld] = useState<number | null>(null)
  const video = useRef<HTMLVideoElement>(null)
  const smooth = useRef<number | null>(null)

  const start = async () => {
    try {
      // iPhones ask the person before a page may read the tilt sensor.
      const ask = (window.DeviceMotionEvent as any)?.requestPermission
      if (typeof ask === 'function' && (await ask()) !== 'granted') { setState('none'); return }
    } catch { setState('none'); return }
    if (!('DeviceMotionEvent' in window)) { setState('none'); return }
    setState('reading')
    // The camera is a help for sighting, never a requirement.
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      if (stream && video.current) { video.current.srcObject = stream; await video.current.play().catch(() => {}) }
    } catch { /* no camera: a plain background behind the line */ }
  }

  useEffect(() => {
    if (state !== 'reading') return
    let seen = false
    const onMotion = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity
      if (!g || g.x == null || g.y == null || g.z == null) return
      const total = Math.hypot(g.x, g.y, g.z)
      if (total < 1) return
      seen = true
      // Lying on the slope: gravity is mostly through the screen, and the slope is how far the screen is off level.
      // Held upright: gravity is mostly in the screen's plane, and the slope is how far the phone is turned from plumb.
      const lying = Math.abs(g.z) / total > 0.75
      let angle = lying ? (Math.acos(Math.min(1, Math.abs(g.z) / total)) * 180) / Math.PI : Math.abs((Math.atan2(g.x, g.y) * 180) / Math.PI)
      if (!lying) { if (angle > 90) angle = 180 - angle; if (angle > 45 && Math.abs(g.x) > Math.abs(g.y)) angle = 90 - angle }
      smooth.current = smooth.current == null ? angle : smooth.current * 0.8 + angle * 0.2
      setFlat(lying)
      setDeg(smooth.current)
    }
    window.addEventListener('devicemotion', onMotion)
    const noSensor = window.setTimeout(() => { if (!seen) setState('none') }, 2500)
    return () => { window.removeEventListener('devicemotion', onMotion); window.clearTimeout(noSensor) }
  }, [state])

  useEffect(() => () => {
    const stream = video.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach((t) => t.stop())
  }, [])

  const shown = held ?? deg
  const pitch = shown == null ? null : overTwelve(shown)

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden dark:bg-slate-900">
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-slate-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100"><X className="w-4 h-4" /></button>
        </div>

        {state === 'ask' && (
          <div className="p-5 space-y-4">
            <p className="text-sm text-gray-700 dark:text-slate-200">Measure the pitch with this phone's tilt sensor.</p>
            <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 dark:text-slate-400">
              <li>From the ground: face a gable end, hold the phone upright and turn it until the line runs along the roof's edge.</li>
              <li>On the roof: lay the phone flat on the slope.</li>
            </ul>
            <button type="button" onClick={start} className="w-full px-4 py-2.5 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700">Start</button>
          </div>
        )}

        {state === 'none' && (
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-700 dark:text-slate-200">This device has no tilt sensor to read, or it was not allowed. Open this report on a phone to measure, or type the pitch in.</p>
            <button type="button" onClick={onClose} className="w-full px-4 py-2.5 border text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800">Close</button>
          </div>
        )}

        {state === 'reading' && (
          <div>
            <div className="relative h-64 bg-slate-800 overflow-hidden">
              <video ref={video} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
              {!flat && <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-white shadow" />}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white drop-shadow">
                <span className="text-6xl font-bold">{pitch == null ? '—' : pitch}<span className="text-2xl font-semibold">/12</span></span>
                <span className="text-lg">{shown == null ? '' : `${shown.toFixed(1)}°`}</span>
              </div>
            </div>
            <p className="px-4 pt-3 text-xs text-gray-600 dark:text-slate-400">
              {flat ? 'Lying flat: reading the slope the phone is resting on.' : 'Held upright: turn the phone until the white line runs along the roof\'s edge.'}
            </p>
            <div className="p-4 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setHeld(held == null ? deg : null)} disabled={deg == null}
                className="px-4 py-2.5 border text-sm font-medium rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800">
                {held == null ? 'Hold reading' : 'Read again'}
              </button>
              <button type="button" onClick={() => pitch != null && onUse(pitch)} disabled={pitch == null}
                className="px-4 py-2.5 bg-green-700 text-white text-sm font-semibold rounded-lg hover:bg-green-800 disabled:opacity-50">
                Use {pitch == null ? '' : `${pitch}/12`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
