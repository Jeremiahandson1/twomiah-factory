import { useState, useEffect, useCallback } from 'react';
import { Loader2, BellRing, Phone, Mail, Check, ArrowRightCircle } from 'lucide-react';
import api from '../../services/api';

/**
 * Service-to-Sales Alerts — when a customer with an open sales lead checks
 * into service, the salesperson gets pinged. Backed by /api/alerts.
 */

interface AlertRow {
  alert: {
    id: string;
    alertMessage?: string | null;
    dismissedAt?: string | null;
    convertedToLead?: boolean;
    alertedAt?: string | null;
  };
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  roNumber?: string | null;
  roStatus?: string | null;
  unitYear?: number | null;
  unitMake?: string | null;
  unitModel?: string | null;
}

function unitDesc(row: AlertRow): string {
  return [row.unitYear, row.unitMake, row.unitModel].filter(Boolean).join(' ') || 'a unit';
}

export default function AlertsPage() {
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [showAll, setShowAll] = useState<boolean>(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/alerts?all=${showAll}&limit=200`);
      setRows(res.data || []);
    } catch (error) {
      console.error('Failed to load alerts:', error);
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => { load(); }, [load]);

  const dismiss = async (id: string) => {
    try {
      await api.post(`/api/alerts/${id}/dismiss`, {});
      load();
    } catch {
      alert('Failed to dismiss alert');
    }
  };

  const convert = async (id: string) => {
    try {
      await api.post(`/api/alerts/${id}/convert`, {});
      load();
    } catch {
      alert('Failed to convert alert');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Alerts</h1>
          <p className="text-gray-500 dark:text-slate-400">Service-to-sales opportunities</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 dark:text-slate-400">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="w-4 h-4 rounded text-orange-500" />
          Show dismissed
        </label>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900">No alerts right now</div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => {
            const dismissed = !!row.alert.dismissedAt;
            return (
              <div key={row.alert.id} className={`bg-white rounded-xl border p-4 flex items-start gap-4 ${dismissed ? 'opacity-60' : ''}`}>
                <div className="mt-0.5">
                  <BellRing className={`w-6 h-6 ${dismissed ? 'text-gray-300' : 'text-amber-500'}`} />
                </div>
                <div className="flex-1 space-y-1">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{row.customerName || 'A customer'} checked into service</p>
                  <p className="text-sm text-gray-600 dark:text-slate-400">
                    {row.alert.alertMessage || `Last interested in ${unitDesc(row)}.`}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap pt-1">
                    {row.roNumber && <span>RO {row.roNumber}{row.roStatus ? ` · ${row.roStatus.replace('_', ' ')}` : ''}</span>}
                    {row.customerPhone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {row.customerPhone}</span>}
                    {row.customerEmail && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {row.customerEmail}</span>}
                  </div>
                </div>
                {!dismissed && (
                  <div className="flex flex-col gap-2">
                    <button onClick={() => convert(row.alert.id)} className="flex items-center gap-1 text-sm px-3 py-1.5 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
                      <ArrowRightCircle className="w-4 h-4" /> Convert
                    </button>
                    <button onClick={() => dismiss(row.alert.id)} className="flex items-center gap-1 text-sm px-3 py-1.5 border rounded-lg hover:bg-gray-50">
                      <Check className="w-4 h-4" /> Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
