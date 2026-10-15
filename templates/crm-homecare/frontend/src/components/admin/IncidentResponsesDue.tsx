// Dashboard action item: payer incident responses due within 3 days (or overdue) and not yet sent.
// Renders nothing when there are none, or when the endpoint is not reachable.
import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { formatDate } from '../../utils/date';
import { incidentsApi } from '../../utils/incidentOptions';

export default function IncidentResponsesDue({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { token } = useAuth();
  const [due, setDue] = useState<{ today: string; count: number; items: any[] } | null>(null);

  useEffect(() => {
    incidentsApi(token)('/responses-due').then((r) => setDue(r || null)).catch(() => setDue(null));
  }, [token]);

  if (!due || !due.count) return null;
  return (
    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-red-800 dark:text-red-200">
          ⚠️ {due.count} incident response{due.count === 1 ? '' : 's'} due within 3 days or overdue
        </span>
        <button
          onClick={() => onNavigate && onNavigate('incidents')}
          className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500"
        >
          Open Incidents →
        </button>
      </div>
      <ul className="mt-2 space-y-1 text-sm text-red-900 dark:text-red-100">
        {due.items.slice(0, 5).map((i) => (
          <li key={i.id}>
            {i.incident_number} · {i.client_name || 'Unknown client'} · due {formatDate(i.response_due_date_ymd)}
            {i.response_due_date_ymd < due.today ? ' (overdue)' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
