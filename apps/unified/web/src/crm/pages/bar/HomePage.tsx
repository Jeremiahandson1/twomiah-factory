// Moved from templates/crm-bar/frontend/src/pages/bar/HomePage.tsx.
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Flame, ChevronRight } from 'lucide-react'
import { api } from '../../../api'
import { useAuth } from '../../../shared'
// The private-events dashboard is the restaurant's screen (crm/pages/restaurant), which the bar shares as it shares
// /api/dashboard's events answer (CrmSettings.dashboard 'events').
import EventsDashboardPage from '../restaurant/DashboardPage'

/**
 * The bar's home (/crm/dashboard, screens.home 'bar'): tonight at a glance (what the website is saying right now)
 * above the private-party book and the money owed on it (the events dashboard). The Tonight strip is shown to anyone
 * who can read the bar (every role); its controls live on the Tonight page.
 */

interface Live { kitchen: { isOpen: boolean; short: string }; bar: { isOpen: boolean; short: string }; room: { label: string }; note: string | null; special: { title: string } | null }

export default function HomePage() {
  const { hasFeature } = useAuth() as { hasFeature: (id: string) => boolean };
  const tonightOn = hasFeature('bar_tonight');
  const [live, setLive] = useState<Live | null>(null);

  useEffect(() => {
    if (!tonightOn) return;
    api.get('/api/bar/tonight').then((t: { live: Live }) => setLive(t.live)).catch(() => setLive(null));
  }, [tonightOn]);

  const pill = (open: boolean) => `text-xs font-semibold px-2 py-0.5 rounded-full ${open ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200'}`;

  return (
    <div className="space-y-6">
      {tonightOn && live && (
        <Link to="/crm/tonight" className="block bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-4 hover:border-orange-300 dark:hover:border-orange-700">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Flame className="w-5 h-5 text-orange-600 dark:text-orange-200" /> Tonight</p>
            <ChevronRight className="w-5 h-5 text-gray-400 dark:text-slate-500" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><p className="text-gray-500 dark:text-slate-400">Kitchen</p><p className="flex items-center gap-2 text-gray-900 dark:text-slate-100"><span className={pill(live.kitchen.isOpen)}>{live.kitchen.isOpen ? 'Open' : 'Closed'}</span> {live.kitchen.short}</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">Bar</p><p className="flex items-center gap-2 text-gray-900 dark:text-slate-100"><span className={pill(live.bar.isOpen)}>{live.bar.isOpen ? 'Open' : 'Closed'}</span> {live.bar.short}</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">How busy</p><p className="text-gray-900 dark:text-slate-100">{live.room.label}</p></div>
            <div><p className="text-gray-500 dark:text-slate-400">Special</p><p className="text-gray-900 dark:text-slate-100 truncate">{live.special?.title || 'None posted'}</p></div>
          </div>
          {live.note && <p className="mt-2 text-sm text-gray-700 dark:text-slate-200">“{live.note}”</p>}
        </Link>
      )}
      <EventsDashboardPage />
    </div>
  );
}
