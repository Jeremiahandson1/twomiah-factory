// Moved from templates/crm-homecare/frontend/src/components/caregiver/CaregiverHelp.tsx — the caregiver's mobile-first
// help guide (full screen).
//
// Changes from the template: the words are the template's. Each topic's colour was one raw ink and one raw ground,
// light only; it is now a tone with its light and dark pair (ground, line, ink, the step dot white on a 700 shade in
// both themes), and the first topic's is the brand (the frame's tokens, where the template printed {{PRIMARY_COLOR}}).
import { useState } from 'react'

type Tone = 'brand' | 'red' | 'indigo' | 'amber' | 'violet' | 'emerald' | 'slate' | 'gray'

interface Topic {
  id: string
  icon: string
  title: string
  tone: Tone
  steps: { step: string; text: string }[] | null
  faq?: { q: string; a: string }[]
  tips: string[]
  warning: string | null
}

/** Each tone: the card ground + line, the title ink, the step dot (white on it). */
const TONES: Record<Exclude<Tone, 'brand'>, { card: string; ink: string; dot: string }> = {
  red: { card: 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900', ink: 'text-red-700 dark:text-red-300', dot: 'bg-red-700' },
  indigo: { card: 'bg-indigo-50 border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900', ink: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-700' },
  amber: { card: 'bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900', ink: 'text-amber-800 dark:text-amber-300', dot: 'bg-amber-800' },
  violet: { card: 'bg-violet-50 border-violet-200 dark:bg-violet-950/40 dark:border-violet-900', ink: 'text-violet-700 dark:text-violet-300', dot: 'bg-violet-700' },
  emerald: { card: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900', ink: 'text-emerald-800 dark:text-emerald-300', dot: 'bg-emerald-700' },
  slate: { card: 'bg-slate-50 border-slate-200 dark:bg-slate-800 dark:border-slate-700', ink: 'text-slate-700 dark:text-slate-300', dot: 'bg-slate-700' },
  gray: { card: 'bg-gray-50 border-gray-200 dark:bg-slate-800 dark:border-slate-700', ink: 'text-gray-700 dark:text-slate-300', dot: 'bg-gray-700' },
}

const TOPICS: Topic[] = [
  {
    id: 'clockin',
    icon: '⏰',
    title: 'How to Clock In',
    tone: 'brand',
    steps: [
      { step: '1', text: 'Arrive at the client\'s home first — clock in from inside or just outside, not from your car.' },
      { step: '2', text: 'Open the app and look for "Ready to Start a Shift?" on the home screen.' },
      { step: '3', text: 'Tap the "Select Client" dropdown and choose your client\'s name.' },
      { step: '4', text: 'Wait until you see "GPS Active" — this confirms your location is recorded.' },
      { step: '5', text: 'Tap the green "▶️ Clock In" button.' },
      { step: '6', text: 'You\'ll get a push notification confirming you\'re clocked in. You\'re good to go!' },
    ],
    tips: ['Always clock in from the client\'s home — GPS records where you are.', 'If GPS shows "unavailable," you can still clock in — just let your supervisor know.'],
    warning: 'Do not clock in before you arrive at the client\'s home.',
  },
  {
    id: 'clockout',
    icon: '🛑',
    title: 'How to Clock Out',
    tone: 'red',
    steps: [
      { step: '1', text: 'When your shift is complete, go back to the home screen.' },
      { step: '2', text: 'You\'ll see a red "🛑 Clock Out" button and a timer showing how long you\'ve been working.' },
      { step: '3', text: 'Tap "Clock Out."' },
      { step: '4', text: 'You\'ll get a push notification confirming your clock-out with your total hours for the shift.' },
    ],
    tips: ['Always clock out as soon as your shift ends — don\'t wait until you get home.', 'If you forgot to clock out, call your supervisor right away.'],
    warning: 'Leaving a shift open affects your payroll and triggers an alert for supervisors.',
  },
  {
    id: 'missreport',
    icon: '🚨',
    title: 'I Can\'t Make My Shift',
    tone: 'red',
    steps: [
      { step: '1', text: 'Tap the red "🚨 Miss Report" card on your home screen as soon as you know you can\'t make it.' },
      { step: '2', text: 'If your upcoming shifts are shown, tap the one you can\'t make to auto-fill the date.' },
      { step: '3', text: 'Select your reason from the dropdown.' },
      { step: '4', text: 'Add any notes if helpful (optional).' },
      { step: '5', text: 'Tap "🚨 Submit Miss Report." Your supervisor is notified immediately.' },
    ],
    tips: ['Submit as early as possible — give your supervisor at least 2 hours if you can.', 'Follow up by phone if you don\'t hear back within 30 minutes.'],
    warning: 'Submitting a miss report does not guarantee approval. Always follow up if you\'re unsure.',
  },
  {
    id: 'schedule',
    icon: '📅',
    title: 'Viewing My Schedule',
    tone: 'indigo',
    steps: [
      { step: '1', text: 'Tap the 📅 Schedule tab at the bottom of the app.' },
      { step: '2', text: 'Your upcoming shifts are listed in order, showing client, date, and time.' },
      { step: '3', text: 'Tap any shift to see the full details including the client\'s address.' },
      { step: '4', text: 'Tap "Select for Clock-In" to pre-load that client on the home screen so it\'s ready when you arrive.' },
    ],
    tips: ['Check your schedule the night before to plan your day.', 'If you see a shift you don\'t recognize, contact your supervisor before that date.'],
    warning: null,
  },
  {
    id: 'openshifts',
    icon: '📋',
    title: 'Picking Up Open Shifts',
    tone: 'amber',
    steps: [
      { step: '1', text: 'Tap "📋 Open Shifts" on the home screen.' },
      { step: '2', text: 'Browse available shifts — each one shows the client, date, time, and duration.' },
      { step: '3', text: 'Tap a shift to see full details.' },
      { step: '4', text: 'Tap "Claim Shift" if you want it.' },
      { step: '5', text: 'Your supervisor will receive a notification and confirm the assignment. You\'ll be notified once it\'s confirmed.' },
    ],
    tips: ['You don\'t have the shift until your supervisor confirms it — don\'t assume it\'s yours just from claiming.'],
    warning: null,
  },
  {
    id: 'availability',
    icon: '🗓️',
    title: 'Setting My Availability',
    tone: 'violet',
    steps: [
      { step: '1', text: 'Tap "⏰ Availability" on the home screen.' },
      { step: '2', text: 'For each day of the week, toggle it on or off depending on whether you\'re available.' },
      { step: '3', text: 'For days you\'re available, set your earliest start time and latest end time.' },
      { step: '4', text: 'Set your maximum hours per week if you want to limit how much you\'re scheduled.' },
      { step: '5', text: 'Tap Save.' },
    ],
    tips: ['Your availability is used when supervisors search for emergency coverage.', 'To request time off, scroll down in the Availability screen to the Time Off section.'],
    warning: 'Approved time off blocks new assignments but does NOT automatically remove existing shifts. Talk to your supervisor about shifts during your time off.',
  },
  {
    id: 'gps',
    icon: '📍',
    title: 'GPS & Location',
    tone: 'emerald',
    steps: null,
    faq: [
      { q: 'Why does the app need my location?', a: 'GPS verifies you\'re at the client\'s home when you clock in and records your route during the shift. This protects you and the client.' },
      { q: 'What does "GPS Active (±Xm)" mean?', a: 'Your location is working. The number is accuracy in meters — lower is better. Under 20m is great.' },
      { q: 'What if GPS shows unavailable?', a: 'Check that Location permissions are set to "Always Allow" for this app in your phone Settings. Try stepping outside. You can still clock in even without GPS.' },
      { q: 'Does GPS run all shift?', a: 'Yes — it records a trail of your movements during the shift, which your supervisor can view as a map. It stops when you clock out.' },
      { q: 'Can I turn off GPS?', a: 'You can, but it may prevent you from clocking in. Your employer requires GPS for compliance.' },
    ],
    tips: [],
    warning: null,
  },
  {
    id: 'mileage',
    icon: '🚗',
    title: 'Mileage Tracking',
    tone: 'slate',
    steps: [
      { step: '1', text: 'Tap the 🚗 Mileage icon or find Mileage in the menu.' },
      { step: '2', text: 'Tap "Start Trip" when you leave home or your previous location.' },
      { step: '3', text: 'Drive to your destination.' },
      { step: '4', text: 'Tap "End Trip" when you arrive. The trip is logged with distance and a map.' },
    ],
    tips: ['Your GPS route during each shift is saved automatically — your supervisor can see it. The mileage tracker is for trips between locations (home to client, client to client, etc.).', 'Talk to your supervisor about what trips qualify for reimbursement.'],
    warning: null,
  },
  {
    id: 'forgot',
    icon: '🔑',
    title: 'Forgot Password / Login Issues',
    tone: 'gray',
    steps: [
      { step: '1', text: 'On the login screen, tap "Forgot Password."' },
      { step: '2', text: 'Enter your email address and tap Send Reset Link.' },
      { step: '3', text: 'Check your email (including spam/junk folder).' },
      { step: '4', text: 'Click the link in the email and enter a new password.' },
      { step: '5', text: 'If you still can\'t log in, contact your supervisor to reset your account.' },
    ],
    tips: ['Make sure you\'re using the email your employer has on file for you.'],
    warning: null,
  },
]

/** The tone's classes, or the brand's tokens for the first topic. */
const toneOf = (t: Topic) => t.tone === 'brand'
  ? { card: 'border', ink: '', dot: '', cardStyle: { background: 'var(--color-teal-light)', borderColor: 'var(--color-teal)' }, inkStyle: { color: 'var(--color-teal-dark)' }, dotStyle: { background: 'var(--hc-brand-deep)' } }
  : { ...TONES[t.tone], card: `border ${TONES[t.tone].card}`, cardStyle: undefined, inkStyle: undefined, dotStyle: undefined }

const CaregiverHelp = ({ onClose }: { onClose: () => void }) => {
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const topic = TOPICS.find((t) => t.id === activeTopic)
  const q = search.toLowerCase()
  const filtered = TOPICS.filter((t) =>
    !search ||
    t.title.toLowerCase().includes(q) ||
    (t.steps || []).some((s) => s.text.toLowerCase().includes(q)) ||
    (t.faq || []).some((f) => f.q.toLowerCase().includes(q)),
  )

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col overflow-y-hidden bg-white text-gray-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="shrink-0 border-b border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-slate-700 dark:bg-slate-900">
        <div className="mb-3 flex items-center gap-3">
          {topic ? (
            <button onClick={() => setActiveTopic(null)} aria-label="Back to topics" className="bg-transparent p-0 text-base font-bold" style={{ color: 'var(--color-teal-dark)' }}>←</button>
          ) : (
            <button onClick={onClose} aria-label="Close help" className="bg-transparent p-0 text-xl text-gray-600 dark:text-slate-300">✕</button>
          )}
          <div className="flex-1">
            <h2 className="m-0 text-lg font-extrabold text-gray-900 dark:text-slate-100">
              {topic ? topic.title : '❓ Help & How-To'}
            </h2>
            {!topic && <p className="m-0 text-xs text-gray-600 dark:text-slate-400">Tap any topic for step-by-step help</p>}
          </div>
        </div>
        {!topic && (
          <input
            placeholder="🔍 Search help topics..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[10px] border border-gray-300 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {topic ? (() => {
          const tone = toneOf(topic)
          return (
            <div>
              <div className={`mb-5 flex items-center gap-4 rounded-[14px] p-5 ${tone.card}`} style={tone.cardStyle}>
                <span className="text-4xl">{topic.icon}</span>
                <div>
                  <h3 className={`m-0 text-lg font-extrabold ${tone.ink}`} style={tone.inkStyle}>{topic.title}</h3>
                  {topic.steps && <p className="m-0 mt-1 text-xs text-gray-700 dark:text-slate-300">{topic.steps.length} steps</p>}
                </div>
              </div>

              {topic.warning && (
                <div className="mb-4 flex items-start gap-2 rounded-[10px] border border-red-300 bg-red-50 px-4 py-3.5 dark:border-red-800 dark:bg-red-950/40">
                  <span className="shrink-0">⚠️</span>
                  <p className="m-0 text-sm font-semibold text-red-800 dark:text-red-200">{topic.warning}</p>
                </div>
              )}

              {topic.steps && (
                <div className="mb-5">
                  {topic.steps.map((s, i) => (
                    <div key={i} className="mb-3.5 flex items-start gap-3.5">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold text-white ${tone.dot}`} style={tone.dotStyle}>{s.step}</div>
                      <p className="m-0 pt-1 text-sm leading-relaxed text-gray-700 dark:text-slate-200">{s.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {topic.faq && (
                <div className="mb-5">
                  {topic.faq.map((f, i) => (
                    <div key={i} className="mb-3.5 rounded-[10px] border border-gray-200 bg-gray-50 px-4 py-3.5 dark:border-slate-700 dark:bg-slate-800">
                      <p className="m-0 mb-1.5 text-sm font-bold text-gray-900 dark:text-slate-100">Q: {f.q}</p>
                      <p className="m-0 text-sm leading-relaxed text-gray-700 dark:text-slate-300">{f.a}</p>
                    </div>
                  ))}
                </div>
              )}

              {topic.tips.length > 0 && (
                <div className="rounded-[10px] border border-emerald-200 bg-emerald-50 px-4 py-3.5 dark:border-emerald-900 dark:bg-emerald-950/40">
                  <p className="m-0 mb-2 text-sm font-bold text-emerald-800 dark:text-emerald-200">💡 Tips</p>
                  {topic.tips.map((tip, i) => (
                    <p key={i} className={`text-sm leading-relaxed text-emerald-800 dark:text-emerald-200 ${i < topic.tips.length - 1 ? 'mb-1.5' : 'm-0'}`}>• {tip}</p>
                  ))}
                </div>
              )}

              <div className="mt-6 rounded-[10px] bg-gray-100 p-4 text-center dark:bg-slate-800">
                <p className="m-0 mb-1 text-sm font-bold text-gray-700 dark:text-slate-200">Still stuck?</p>
                <p className="m-0 text-xs text-gray-600 dark:text-slate-400">Call or text your supervisor directly.</p>
              </div>
            </div>
          )
        })() : (
          <div>
            {filtered.length === 0 ? (
              <div className="px-4 py-12 text-center text-gray-600 dark:text-slate-400">
                <div className="mb-3 text-4xl">🔍</div>
                <p className="m-0 mb-2 font-bold">No results for "{search}"</p>
                <p className="m-0 text-sm">Try different words or scroll through all topics below.</p>
              </div>
            ) : (
              filtered.map((t) => {
                const tone = toneOf(t)
                return (
                  <button key={t.id} onClick={() => setActiveTopic(t.id)}
                    className={`mb-2.5 flex w-full items-center gap-4 rounded-xl p-4 text-left ${tone.card}`} style={tone.cardStyle}>
                    <span className="shrink-0 text-3xl">{t.icon}</span>
                    <div className="flex-1">
                      <div className="mb-0.5 text-[0.95rem] font-bold text-gray-900 dark:text-slate-100">{t.title}</div>
                      <div className="text-xs text-gray-700 dark:text-slate-300">
                        {t.steps ? `${t.steps.length} steps` : t.faq ? `${t.faq.length} questions` : 'Tap to view'}
                      </div>
                    </div>
                    <span className={`text-xl font-bold ${tone.ink}`} style={tone.inkStyle}>›</span>
                  </button>
                )
              })
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default CaregiverHelp
