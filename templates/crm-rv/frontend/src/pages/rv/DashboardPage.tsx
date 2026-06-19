import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2,
  Truck,
  TrendingUp,
  Wrench,
  Users,
  ArrowUpRight,
} from 'lucide-react';
import api from '../../services/api';

/**
 * RV / Powersports dealership dashboard.
 *
 * Backed by:
 *   GET /api/dashboard/stats           — inventory / sales / service KPIs
 *   GET /api/dashboard/recent-activity — recent units, leads, repair orders
 *
 * Every field is guarded for null/undefined so a brand-new dealer (all zeros)
 * renders cleanly.
 */

interface DashboardStats {
  contacts?: number;
  inventory?: {
    total?: number;
    available?: number;
    byStatus?: Partial<Record<string, number>>;
    byCategory?: Partial<Record<string, number>>;
  };
  sales?: {
    openLeads?: number;
    leadsThisMonth?: number;
    closedWonThisMonth?: number;
    closeRate?: number;
  };
  service?: {
    openRepairOrders?: number;
    repairOrdersThisMonth?: number;
    revenueThisMonth?: number;
  };
}

interface RecentUnit {
  id: string;
  year?: number | null;
  make?: string | null;
  modelName?: string | null;
  status?: string | null;
  category?: string | null;
  updatedAt?: string | null;
}
interface RecentLead {
  id: string;
  stage?: string | null;
  source?: string | null;
  updatedAt?: string | null;
}
interface RecentRepairOrder {
  id: string;
  roNumber?: string | null;
  status?: string | null;
  updatedAt?: string | null;
}
interface RecentActivity {
  recentUnits?: RecentUnit[];
  recentLeads?: RecentLead[];
  recentRepairOrders?: RecentRepairOrder[];
}

const CATEGORY_LABELS: Record<string, string> = {
  motorhome: 'Motorhomes',
  towable: 'Towables',
  motorcycle: 'Motorcycles',
  atv: 'ATVs',
  utv: 'UTVs',
  sxs: 'Side-by-Sides',
  pwc: 'PWC',
  snowmobile: 'Snowmobiles',
  boat: 'Boats',
};
const CATEGORY_ORDER = [
  'motorhome', 'towable', 'motorcycle', 'atv', 'utv', 'sxs', 'pwc', 'snowmobile', 'boat',
];

function num(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function money(v: number | null | undefined): string {
  return `$${num(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pct(v: number | null | undefined): string {
  return `${num(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}%`;
}

function unitLabel(u: RecentUnit): string {
  return [u.year, u.make, u.modelName].filter(Boolean).join(' ') || 'Unit';
}

function prettyStatus(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<RecentActivity | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, activityRes] = await Promise.all([
        api.get('/api/dashboard/stats'),
        api.get('/api/dashboard/recent-activity'),
      ]);
      setStats(statsRes || {});
      setActivity(activityRes || {});
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const inventory = stats?.inventory || {};
  const sales = stats?.sales || {};
  const service = stats?.service || {};
  const byCategory = inventory.byCategory || {};

  const recentUnits = activity?.recentUnits || [];
  const recentLeads = activity?.recentLeads || [];
  const recentRepairOrders = activity?.recentRepairOrders || [];

  const categoryRows = CATEGORY_ORDER
    .map((key) => ({ key, label: CATEGORY_LABELS[key], count: num(byCategory[key]) }))
    .filter((r) => r.count > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-500">Inventory, sales & service at a glance</p>
      </div>

      {/* KPI stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* Inventory */}
        <Link
          to="/crm/units"
          className="group bg-white rounded-xl border p-5 hover:border-orange-300 hover:shadow-sm transition"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-500">
              <Truck className="w-5 h-5 text-orange-500" />
              <span className="text-sm font-medium">Inventory</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-orange-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900">{num(inventory.total)}</div>
          <p className="text-sm text-gray-500 mt-1">
            <span className="font-medium text-green-600">{num(inventory.available)}</span> available
          </p>
        </Link>

        {/* Sales Pipeline */}
        <Link
          to="/crm/sales-pipeline"
          className="group bg-white rounded-xl border p-5 hover:border-orange-300 hover:shadow-sm transition"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-500">
              <TrendingUp className="w-5 h-5 text-orange-500" />
              <span className="text-sm font-medium">Sales Pipeline</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-orange-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900">{num(sales.openLeads)}</div>
          <p className="text-sm text-gray-500 mt-1">open leads</p>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="font-semibold text-gray-900">{num(sales.leadsThisMonth)}</div>
              <div className="text-gray-400">new (mo)</div>
            </div>
            <div>
              <div className="font-semibold text-gray-900">{num(sales.closedWonThisMonth)}</div>
              <div className="text-gray-400">won (mo)</div>
            </div>
            <div>
              <div className="font-semibold text-gray-900">{pct(sales.closeRate)}</div>
              <div className="text-gray-400">close</div>
            </div>
          </div>
        </Link>

        {/* Service */}
        <Link
          to="/crm/service"
          className="group bg-white rounded-xl border p-5 hover:border-orange-300 hover:shadow-sm transition"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-500">
              <Wrench className="w-5 h-5 text-orange-500" />
              <span className="text-sm font-medium">Service</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-orange-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900">{num(service.openRepairOrders)}</div>
          <p className="text-sm text-gray-500 mt-1">open repair orders</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-center text-xs">
            <div>
              <div className="font-semibold text-gray-900">{num(service.repairOrdersThisMonth)}</div>
              <div className="text-gray-400">ROs (mo)</div>
            </div>
            <div>
              <div className="font-semibold text-gray-900">{money(service.revenueThisMonth)}</div>
              <div className="text-gray-400">rev (mo)</div>
            </div>
          </div>
        </Link>

        {/* Contacts */}
        <Link
          to="/crm/contacts"
          className="group bg-white rounded-xl border p-5 hover:border-orange-300 hover:shadow-sm transition"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-gray-500">
              <Users className="w-5 h-5 text-orange-500" />
              <span className="text-sm font-medium">Contacts</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-gray-300 group-hover:text-orange-400" />
          </div>
          <div className="mt-3 text-3xl font-bold text-gray-900">{num(stats?.contacts)}</div>
          <p className="text-sm text-gray-500 mt-1">total contacts</p>
        </Link>
      </div>

      {/* Inventory by category + Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Inventory by category */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">Inventory by category</h2>
            <Link to="/crm/units" className="text-xs text-orange-600 hover:underline">View all</Link>
          </div>
          {categoryRows.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No units in stock yet</p>
          ) : (
            <div className="space-y-2">
              {categoryRows.map((row) => (
                <div key={row.key} className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{row.label}</span>
                  <span className="font-semibold text-gray-900">{row.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent activity */}
        <div className="bg-white rounded-xl border p-5 lg:col-span-2">
          <h2 className="font-semibold text-gray-900 mb-4">Recent activity</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Recent units */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">Units</h3>
              {recentUnits.length === 0 ? (
                <p className="text-sm text-gray-400">No recent units</p>
              ) : (
                <ul className="space-y-2">
                  {recentUnits.map((u) => (
                    <li key={u.id} className="text-sm">
                      <div className="font-medium text-gray-800 truncate">{unitLabel(u)}</div>
                      <div className="text-xs text-gray-400">{prettyStatus(u.status)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent leads */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">Leads</h3>
              {recentLeads.length === 0 ? (
                <p className="text-sm text-gray-400">No recent leads</p>
              ) : (
                <ul className="space-y-2">
                  {recentLeads.map((l) => (
                    <li key={l.id} className="text-sm">
                      <div className="font-medium text-gray-800">{prettyStatus(l.stage)}</div>
                      <div className="text-xs text-gray-400">{l.source ? prettyStatus(l.source) : '—'}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent repair orders */}
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-2">Repair Orders</h3>
              {recentRepairOrders.length === 0 ? (
                <p className="text-sm text-gray-400">No recent ROs</p>
              ) : (
                <ul className="space-y-2">
                  {recentRepairOrders.map((r) => (
                    <li key={r.id} className="text-sm">
                      <div className="font-medium text-gray-800">{r.roNumber || `RO ${r.id.slice(0, 6)}`}</div>
                      <div className="text-xs text-gray-400">{prettyStatus(r.status)}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
