// Moved from templates/crm-homecare/frontend/src/components/admin/IncidentResponsesDue.tsx.
// Dashboard action item: payer incident responses due within 3 days (or overdue) and not yet sent.
// Renders nothing when there are none, or when the endpoint is not reachable (a seat without care-compliance:read).
//   · GET /api/incidents/responses-due answers { today, count, items } with camelCase rows (incidentNumber,
//     clientName, responseDueDateYmd — server/data/homecareOffice.ts incidentResponsesDue); the template read snake_case.
//   · "Open Incidents" goes to /crm/incidents (the template switched the dashboard's section).
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate } from '../lib/date';
import { incidentsApi } from '../lib/incidentOptions';

interface ResponseDue {
  id: string;
  incidentNumber?: string | null;
  clientName?: string | null;
  responseDueDateYmd: string;
}

interface ResponsesDueReply {
  today: string;
  count: number;
  items: ResponseDue[];
}

export default function IncidentResponsesDue() {
  const navigate = useNavigate();
  const [due, setDue] = useState<ResponsesDueReply | null>(null);

  useEffect(() => {
    let live = true;
    incidentsApi('/responses-due')
      .then((r: ResponsesDueReply | null) => { if (live) setDue(r || null); })
      .catch(() => { if (live) setDue(null); });
    return () => { live = false; };
  }, []);

  if (!due || !due.count) return null;
  return (
    <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-red-800 dark:text-red-200">
          ⚠️ {due.count} incident response{due.count === 1 ? '' : 's'} due within 3 days or overdue
        </span>
        <button
          type="button"
          onClick={() => navigate('/crm/incidents')}
          className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-500"
        >
          Open Incidents →
        </button>
      </div>
      <ul className="mt-2 space-y-1 text-sm text-red-900 dark:text-red-100">
        {(due.items || []).slice(0, 5).map((i) => (
          <li key={i.id}>
            {i.incidentNumber} · {i.clientName || 'Unknown client'} · due {formatDate(i.responseDueDateYmd)}
            {i.responseDueDateYmd < due.today ? ' (overdue)' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
