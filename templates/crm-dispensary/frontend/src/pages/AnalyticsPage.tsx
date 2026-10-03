import { useState, useEffect } from 'react';
import { BarChart3, TrendingUp, Users, Clock, DollarSign, Package, Calendar } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { storeDay } from '../utils/date';
import { money } from '../shared';

export default function AnalyticsPage() {
  const { company } = useAuth();
  const [period, setPeriod] = useState('7d');
  const [metrics, setMetrics] = useState<any>(null);
  // The order mix from /analytics/summary — sales, plus the orders still in the queue.
  const [orderMix, setOrderMix] = useState<any>(null);
  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [productMix, setProductMix] = useState<any[]>([]);
  const [peakHours, setPeakHours] = useState<any[]>([]);
  const [customerMetrics, setCustomerMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    loadAnalytics();
  }, [period, (company as any)?.timeZone]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      // Map period to date range
      const now = new Date();
      const periodDays = period === '1d' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 90;
      // Window is exactly `periodDays` days ending today. Subtracting the full periodDays
      // put startDate a day too early, so "Today" (1d) spanned yesterday+today — the charts
      // plotted two bars under a Today selection. Subtract periodDays-1 so Today = today only
      // and the range matches the selector label + the KPI's single-day summary. (retest#8)
      // The viewer's calendar, not UTC's. toISOString() rolls over at UTC midnight, so from 7pm in
      // Chicago this asked the server for a window a day ahead of the one the selector names — and the
      // Unique Customers tile read 2 while the same endpoint answered 4 for that period. The server
      // already interprets these on the STORE's clock (storeRange); it needs the day a person would
      // write down. (Dispensary T29 L2)
      // ...and the STORE's calendar, not the viewer's. Reading the day off the person's own laptop
      // was still wrong whenever they are not standing in the shop: a manager in Central looking at
      // an Ohio store at 23:10 asked for 2026-09-27 while the till had rolled to the 28th, so Today
      // showed $0.00 from 0 orders beside a dashboard reading $718.75 from 9 sales. (T42 M1)
      const tz = (company as any)?.timeZone;
      const startDate = storeDay(tz, new Date(now.getTime() - (periodDays - 1) * 86400000));
      const endDate = storeDay(tz, now);
      const dateParams = { startDate, endDate };

      const [summaryRes, revenueRes, mixRes, peakRes, customersRes] = await Promise.all([
        api.get('/api/analytics/summary', { startDate, endDate }),
        api.get('/api/analytics/sales', { ...dateParams, period: periodDays <= 7 ? 'day' : 'week' }),
        api.get('/api/analytics/products', dateParams),
        api.get('/api/analytics/peak-hours', dateParams),
        api.get('/api/analytics/customers', dateParams),
      ]);

      // Build metrics from summary response
      const orders = summaryRes?.orders || {};
      // …and keep the mix, which carries the order queue alongside the sales figures.
      setOrderMix(orders);
      setMetrics({
        totalRevenue: Number(orders.revenue || 0),
        // Use completed_orders (matches the completed-only revenue). `||` treated a
        // legitimate 0 (all orders refunded) as missing and fell back to total_orders,
        // so a day of refunds showed "2 orders / $0.00". Nullish-coalesce instead. (retest#7)
        totalOrders: Number(orders.completed_orders ?? orders.total_orders ?? 0),
        avgOrderValue: Number(orders.avg_order_value || 0),
        uniqueCustomers: Number(customersRes?.uniqueCustomers || 0),
      });

      // 30/90-day ranges bucket by week (period='week'), so d.period is the week-start date.
      // Label weekly bars "Wk <date>" so a bar starting e.g. Aug 31 reads as the week it covers,
      // not a single day that looks like it precedes its own data. (retest#13 cosmetic)
      const isWeekly = periodDays > 7;
      const fmt = (s: string) => { const dt = new Date(String(s) + 'T00:00:00'); return isNaN(dt.getTime()) ? String(s) : dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
      const salesData = revenueRes?.data || (Array.isArray(revenueRes) ? revenueRes : []);
      setRevenueData(salesData.map((d: any) => ({ date: d.period, label: (isWeekly ? 'Wk ' : '') + fmt(d.period), revenue: Number(d.revenue || 0) })));

      const prodData = Array.isArray(mixRes) ? mixRes : mixRes?.data || [];
      setProductMix(prodData.map((p: any) => ({ category: p.product_name || p.category, name: p.product_name, revenue: Number(p.total_revenue || 0), count: Number(p.total_sold || 0) })));

      const peakData = peakRes?.data || (Array.isArray(peakRes) ? peakRes : []);
      setPeakHours(peakData.map((h: any) => ({ hour: h.hour, orders: Number(h.order_count || 0) })));

      // Customer insights from /customers (real, range-scoped)
      setCustomerMetrics({
        newCustomers: Number(customersRes?.newCustomers || 0),
        returningCustomers: Number(customersRes?.returningCustomers || 0),
        repeatCustomers: Number(customersRes?.repeatCustomers || 0),
        retentionRate: Number(customersRes?.retentionRate || 0),
        avgVisits: Number(customersRes?.avgVisits || 0),
        lifetimeValue: Number(customersRes?.lifetimeValue || 0),
        // The window the SERVER actually counted, echoed back since T31 — shown on the tile, so nobody
        // has to guess whether a figure covers the same days as the one they are comparing it against.
        // Four runs have read this panel (7 days) against a differently scoped query and called the
        // difference a defect. (T34 L1)
        range: customersRes?.range || null,
      });
    } catch (err: any) {
      // A 403 is not a quiet day. Leaving the tiles on their initial zeros told a budtender the shop
      // took $0.00 while the dashboard beside it showed $3,390 — a false figure is worse than an
      // error, and this is the one screen whose whole job is to be believed. (Dispensary T39 M2)
      if (err?.status === 403) setDenied(true);
      console.error('Failed to load analytics:', err);
    } finally {
      setLoading(false);
    }
  };

  const periods = [
    { value: '1d', label: 'Today' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
  ];

  if (loading) {
    if (denied) return (
    <div className="p-8 text-center">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-100 mb-2">Analytics is not available for your role</h1>
      <p className="text-gray-600 dark:text-slate-400">Ask a manager or the owner if you need these figures.</p>
    </div>
  );

  return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const maxRevenue = Math.max(...revenueData.map(d => d.revenue || 0), 1);
  const maxPeak = Math.max(...peakHours.map(h => h.orders || 0), 1);
  const maxMix = Math.max(...productMix.map(p => p.revenue || p.count || 0), 1);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Analytics</h1>
          <p className="text-gray-600 dark:text-slate-400">{company?.name} performance insights</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 dark:bg-slate-800">
          {periods.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                // Both states sat inside a dark:bg-slate-800 rail with no dark partner of their own: the
                // unselected label stayed gray-600 on slate-800 (measured 1.94:1) and the selected pill
                // stayed a stark white chip. Give each its dark half rather than darkening the light one.
                // (T28 M-f)
                period === p.value
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-700 dark:text-slate-100'
                  : 'text-gray-600 hover:text-gray-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-5 dark:bg-slate-900">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 text-green-700 flex items-center justify-center">
              <DollarSign className="w-5 h-5" />
            </div>
            <span className="text-sm text-gray-500 dark:text-slate-400">Total Revenue</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">
            ${Number(metrics?.totalRevenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
          {metrics?.revenueChange != null && (
            <p className={`text-sm mt-1 ${metrics.revenueChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {metrics.revenueChange >= 0 ? '+' : ''}{Number(metrics.revenueChange).toFixed(1)}% vs prior
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm p-5 dark:bg-slate-900">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Package className="w-5 h-5" />
            </div>
            {/* THE LABEL, NOT THE FIGURE, WAS WRONG. (T41)
                "AOV and 'Sales Today' count refunded orders; analytics 'Total Orders' tile shows
                 completed only."
                Both screens show the same thing and always did: the SETTLED count — completed,
                partially refunded and refunded — because a refunded sale still happened, which
                T23 H1 settled when a dashboard showed 26 sales under revenue drawn from 33 of
                them. The value here is `completed_orders`, which is that set despite its name.
                What made the two tiles look like they disagreed was this word: "Total" promises
                every order, including the cancelled and the still-pending, and the tile has never
                shown those. Named for what it is, it reads the same as the dashboard's Sales
                Today. */}
            <span className="text-sm text-gray-500 dark:text-slate-400" title="Completed, partially refunded and refunded sales. Cancelled and still-pending orders are not sales.">Sales</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{metrics?.totalOrders || 0}</p>
          {metrics?.ordersChange != null && (
            <p className={`text-sm mt-1 ${metrics.ordersChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {metrics.ordersChange >= 0 ? '+' : ''}{Number(metrics.ordersChange).toFixed(1)}% vs prior
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-sm p-5 dark:bg-slate-900">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
              <TrendingUp className="w-5 h-5" />
            </div>
            <span className="text-sm text-gray-500 dark:text-slate-400">Avg Order Value</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">${Number(metrics?.avgOrderValue || 0).toFixed(2)}</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-5 dark:bg-slate-900">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <span className="text-sm text-gray-500 dark:text-slate-400">Unique Customers</span>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-slate-100">{metrics?.uniqueCustomers || 0}</p>
          {customerMetrics?.range && (
            <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">{customerMetrics.range.from} → {customerMetrics.range.to}</p>
          )}
        </div>
      </div>

      {/* The order queue, next to the sales figures rather than mixed into them.
          The server added online_awaiting_count for exactly this, because "Online: 0" beside a list
          of online orders reads as broken and had been filed twice (T46 N21). The figure shipped and
          the panel did not, so it read as broken a third time. A sale is a sale; an order waiting to
          be collected has not been sold yet, and is reported here as what it is. (T49 M1) */}
      {(Number(orderMix?.online_awaiting_count ?? orderMix?.onlineAwaitingCount ?? 0) > 0
        || Number(orderMix?.medical_count ?? 0) > 0) && (
        <div className="rounded-lg bg-white p-5 shadow-sm dark:bg-slate-900">
          <h2 className="mb-3 font-semibold text-gray-900 dark:text-slate-100">Of these orders</h2>
          <div className="flex flex-wrap gap-6 text-sm">
            {Number(orderMix?.online_awaiting_count ?? orderMix?.onlineAwaitingCount ?? 0) > 0 && (
              <div>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">
                  {Number(orderMix?.online_awaiting_count ?? orderMix?.onlineAwaitingCount ?? 0)}
                </p>
                <p className="text-gray-500 dark:text-slate-400">online, waiting to be collected</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">Not counted in the sales above — they have not been sold yet.</p>
              </div>
            )}
            {Number(orderMix?.medical_count ?? 0) > 0 && (
              <div>
                <p className="text-2xl font-bold tabular-nums text-gray-900 dark:text-slate-100">{Number(orderMix.medical_count)}</p>
                <p className="text-gray-500 dark:text-slate-400">medical sales</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
            <BarChart3 className="w-5 h-5 text-green-600" />
            Revenue Over Time
          </h2>
          <div className="space-y-2">
            {revenueData.length > 0 ? revenueData.map((day: any, idx: number) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-16 shrink-0 dark:text-slate-400">{day.label || day.date}</span>
                {/* The amount used to sit INSIDE the bar as white-on-green-500 — about 2.1:1, and wrong in
                    both themes rather than only the dark one, so no dark: partner could have fixed it. It
                    reads as body text beside the bar now, the way the Product Mix chart below already shows
                    its figures. The bar's 40px minimum went with it: that width existed only to keep the
                    label legible, and it overstated small days. (T28 M-f) */}
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden dark:bg-slate-800">
                  <div
                    className="bg-green-500 h-full rounded-full"
                    style={{ width: `${(day.revenue / maxRevenue) * 100}%`, minWidth: day.revenue > 0 ? '4px' : '0' }}
                  />
                </div>
                <span className="text-xs font-medium text-gray-900 w-24 shrink-0 text-right tabular-nums dark:text-slate-100">
                  {/* money(), for the same reason as the portal tile: a bare toLocaleString drops
                      a trailing zero and prints $269.50 as "$269.5". (T47 P23) */}
                  {day.revenue > 0 ? money(day.revenue) : ''}
                </span>
              </div>
            )) : (
              <p className="text-gray-500 text-sm text-center py-8 dark:text-slate-400">No revenue data for this period</p>
            )}
          </div>
        </div>

        {/* Product Mix */}
        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
            <Package className="w-5 h-5 text-purple-600" />
            Product Mix
          </h2>
          {/* Said plainly, because it can never equal the revenue tile above it and a reader with no
              explanation reasonably concludes one of the two is broken. These are goods at the shelf
              price, net of what came back; the headline adds excise and sales tax on top. (T43 H2b) */}
          <p className="text-xs text-gray-500 mb-4 dark:text-slate-400">
            Goods only, before tax and net of refunds — so this will not add up to the revenue above,
            which includes tax.
          </p>
          <div className="space-y-3">
            {productMix.length > 0 ? productMix.slice(0, 8).map((item: any, idx: number) => {
              const colors = ['bg-green-500', 'bg-blue-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-orange-500'];
              return (
                <div key={idx}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-700 capitalize dark:text-slate-200">{item.category || item.name}</span>
                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                      ${Number(item.revenue || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({item.count || 0} sold)
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3 dark:bg-slate-800">
                    <div
                      className={`h-3 rounded-full ${colors[idx % colors.length]}`}
                      style={{ width: `${((item.revenue || item.count || 0) / maxMix) * 100}%` }}
                    />
                  </div>
                </div>
              );
            }) : (
              <p className="text-gray-500 text-sm text-center py-8 dark:text-slate-400">No product data available</p>
            )}
          </div>
        </div>

        {/* Peak Hours */}
        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
            <Clock className="w-5 h-5 text-blue-600" />
            Peak Hours
          </h2>
          <div className="flex items-end gap-1 h-40">
            {peakHours.length > 0 ? peakHours.map((hour: any, idx: number) => (
              // h-full + a flex-1 track: the bar's percentage height needs a parent with a DEFINITE
              // height to resolve against. This column used to size itself to its content, so every
              // bar — 43%, 34%, 100% — fell through to its 4px minimum and the chart drew flat
              // whatever the data said. The row's h-40 was never reaching the bars. (T42 M2)
              <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full">
                <div className="w-full flex-1 min-h-0 flex items-end">
                  <div
                    className="w-full bg-blue-400 rounded-t transition-all hover:bg-blue-500"
                    style={{ height: `${Math.max(0, Math.min(100, (hour.orders / maxPeak) * 100))}%`, minHeight: hour.orders > 0 ? '4px' : '0' }}
                    title={`${hour.orders} orders`}
                  />
                </div>
                <span className="text-xs text-gray-500 dark:text-slate-400">{hour.hour || idx}</span>
              </div>
            )) : (
              <p className="text-gray-500 text-sm text-center w-full py-8 dark:text-slate-400">No peak hour data</p>
            )}
          </div>
        </div>

        {/* Customer Metrics */}
        <div className="bg-white rounded-lg shadow-sm p-6 dark:bg-slate-900">
          <h2 className="font-semibold text-gray-900 mb-4 flex items-center gap-2 dark:text-slate-100">
            <Users className="w-5 h-5 text-amber-600" />
            Customer Insights
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
              <p className="text-sm text-gray-500 dark:text-slate-400">New Customers</p>
              <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{customerMetrics?.newCustomers || 0}</p>
            </div>
            {/* Returning and Repeat answer different questions and both have to be on screen.
                Returning = shopped here before this window opened, and it adds up with New to equal
                Unique. Repeat = came back INSIDE the window, which is what retention is built from.
                Showing only Returning is why "0 returning" sat beside "4.9 visits each" and read as
                a bug. (T42 M4, shipped half-done — T43) */}
            <div className="p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
              <p className="text-sm text-gray-500 dark:text-slate-400" title="Shopped here before this period started">Returning</p>
              <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{customerMetrics?.returningCustomers || 0}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
              <p className="text-sm text-gray-500 dark:text-slate-400" title="Bought more than once inside this period — what Retention Rate is based on">Repeat</p>
              <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{customerMetrics?.repeatCustomers || 0}</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
              <p className="text-sm text-gray-500 dark:text-slate-400">Retention Rate</p>
              <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{Number(customerMetrics?.retentionRate || 0).toFixed(1)}%</p>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
              <p className="text-sm text-gray-500 dark:text-slate-400">Avg Visits/Customer</p>
              <p className="text-xl font-bold text-gray-900 dark:text-slate-100">{Number(customerMetrics?.avgVisits || 0).toFixed(1)}</p>
            </div>
            <div className="col-span-2 p-4 bg-gray-50 rounded-lg dark:bg-slate-900">
              <p className="text-sm text-gray-500 dark:text-slate-400">Customer Lifetime Value</p>
              <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
                ${Number(customerMetrics?.lifetimeValue || 0).toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
