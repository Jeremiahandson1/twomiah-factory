import { useState, useEffect } from 'react';
import { 
  Navigation, MapPin, Clock, Fuel, TrendingDown, 
  ExternalLink, Loader2, RefreshCw, Calendar, Users
} from 'lucide-react';
import api from '../../services/api';

/**
 * Route Optimization Component
 * Can be used standalone or embedded in schedule view
 */
export default function RouteOptimizer({ date = new Date(), userId = null }) {
  const [loading, setLoading] = useState(true);
  const [routeData, setRouteData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadRoute();
  }, [date, userId]);

  const loadRoute = async () => {
    setLoading(true);
    setError(null);
    try {
      const dateStr = date instanceof Date ? date.toISOString().split('T')[0] : date;
      const params = userId ? `?date=${dateStr}&userId=${userId}` : `?date=${dateStr}`;
      const data = await api.get(`/routing/optimize-day${params}`);
      setRouteData(data);
    } catch (error) {
      console.error('Failed to load route:', error);
      setError('Failed to optimize route');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-red-50 text-red-600 rounded-lg">
        {error}
      </div>
    );
  }

  if (!routeData?.optimizedRoute) {
    return (
      <div className="p-8 text-center text-gray-500">
        <Navigation className="w-12 h-12 mx-auto mb-3 opacity-50" />
        <p>{routeData?.message || 'No jobs with coordinates to optimize'}</p>
      </div>
    );
  }

  const { optimizedRoute, jobs, googleMapsUrl } = routeData;

  return (
    <div className="space-y-4">
      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          icon={MapPin}
          label="Total Stops"
          value={optimizedRoute.optimizedOrder.length}
          color="blue"
        />
        <StatCard
          icon={Navigation}
          label="Total Miles"
          value={`${optimizedRoute.totalDistanceMiles.toFixed(1)} mi`}
          color="green"
        />
        <StatCard
          icon={Clock}
          label="Drive Time"
          value={`${optimizedRoute.totalDurationMinutes} min`}
          color="purple"
        />
        <StatCard
          icon={Fuel}
          label="Est. Fuel"
          value={`$${optimizedRoute.fuelCost?.cost || 0}`}
          color="orange"
        />
      </div>

      {/* Savings */}
      {optimizedRoute.savings?.percentDistance > 0 && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2 text-green-700">
            <TrendingDown className="w-5 h-5" />
            <span className="font-medium">Route optimized!</span>
          </div>
          <p className="text-sm text-green-600 mt-1">
            Saving {optimizedRoute.savings.distanceMiles.toFixed(1)} miles 
            ({optimizedRoute.savings.percentDistance}%) and {optimizedRoute.savings.timeMinutes} minutes
          </p>
        </div>
      )}

      {/* Optimized Order */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-medium text-gray-900">Optimized Route</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={loadRoute}
              className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-50"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {googleMapsUrl && (
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                <ExternalLink className="w-4 h-4" />
                Open in Maps
              </a>
            )}
          </div>
        </div>

        <div className="divide-y">
          {optimizedRoute.optimizedOrder.map((stop, index) => (
            <StopItem
              key={stop.id || index}
              stop={stop}
              index={index}
              isFirst={index === 0}
              isLast={index === optimizedRoute.optimizedOrder.length - 1}
              leg={optimizedRoute.legs?.[index]}
            />
          ))}
        </div>
      </div>

      {/* Leg Details */}
      {optimizedRoute.legs?.length > 0 && (
        <div className="bg-white rounded-xl border overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="font-medium text-gray-900">Route Legs</h3>
          </div>
          <div className="divide-y">
            {optimizedRoute.legs.map((leg, index) => (
              <div key={index} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">
                      {leg.from.name || 'Stop ' + (index + 1)} → {leg.to.name || 'Stop ' + (index + 2)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium">{leg.distanceMiles.toFixed(1)} mi</p>
                  <p className="text-sm text-gray-500">{leg.durationMinutes} min</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <div className={`p-4 rounded-xl ${colors[color]}`}>
      <Icon className="w-5 h-5 mb-2" />
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm opacity-75">{label}</p>
    </div>
  );
}

function StopItem({ stop, index, isFirst, isLast, leg }) {
  return (
    <div className="p-4 flex items-start gap-4">
      {/* Timeline */}
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
          isFirst ? 'bg-green-500 text-white' :
          isLast ? 'bg-red-500 text-white' :
          'bg-orange-500 text-white'
        }`}>
          {index + 1}
        </div>
        {!isLast && (
          <div className="w-0.5 h-8 bg-gray-200 mt-2" />
        )}
      </div>

      {/* Stop Info */}
      <div className="flex-1">
        <p className="font-medium text-gray-900">{stop.name || `Stop ${index + 1}`}</p>
        {stop.address && (
          <p className="text-sm text-gray-500 mt-0.5">{stop.address}</p>
        )}
        {stop.scheduledTime && (
          <p className="text-sm text-gray-400 mt-0.5">
            Scheduled: {new Date(stop.scheduledTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </div>

      {/* Distance to next */}
      {leg && !isLast && (
        <div className="text-right text-sm text-gray-500">
          <p>{leg.distanceMiles.toFixed(1)} mi</p>
          <p>{leg.durationMinutes} min</p>
        </div>
      )}
    </div>
  );
}

/**
 * Team Routes View for Dispatchers
 */
export function TeamRoutesPage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [teamRoutes, setTeamRoutes] = useState(null);

  useEffect(() => {
    loadTeamRoutes();
  }, [date]);

  const loadTeamRoutes = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/routing/team-routes?date=${date}`);
      setTeamRoutes(data);
    } catch (error) {
      console.error('Failed to load team routes:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Routes</h1>
          <p className="text-gray-500">Optimized routes for all field techs</p>
        </div>
        <div className="flex items-center gap-4">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-4 py-2 border rounded-lg"
          />
          <button
            onClick={loadTeamRoutes}
            className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary */}
      {teamRoutes && (
        <div className="grid grid-cols-3 gap-4">
          <StatCard icon={Users} label="Active Techs" value={teamRoutes.routes.length} color="blue" />
          <StatCard icon={MapPin} label="Total Jobs" value={teamRoutes.totalJobs} color="green" />
          <StatCard icon={Navigation} label="Total Miles" value={`${teamRoutes.totalMiles.toFixed(0)} mi`} color="purple" />
        </div>
      )}

      {/* Team Members */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : teamRoutes?.routes.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No scheduled jobs for this date
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {teamRoutes?.routes.map(route => (
            <div key={route.user.id} className="bg-white rounded-xl border overflow-hidden">
              <div className="p-4 border-b bg-gray-50">
                <h3 className="font-medium text-gray-900">
                  {route.user.firstName} {route.user.lastName}
                </h3>
                <p className="text-sm text-gray-500">
                  {route.jobs?.length || 0} jobs • 
                  {route.optimizedRoute ? ` ${route.optimizedRoute.totalDistanceMiles.toFixed(1)} mi` : ' No route'}
                </p>
              </div>
              {route.optimizedRoute ? (
                <div className="p-4">
                  <div className="space-y-2">
                    {route.optimizedRoute.optimizedOrder.slice(0, 5).map((stop, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="w-5 h-5 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center text-xs">
                          {i + 1}
                        </span>
                        <span className="truncate">{stop.name}</span>
                      </div>
                    ))}
                    {route.optimizedRoute.optimizedOrder.length > 5 && (
                      <p className="text-sm text-gray-400">
                        +{route.optimizedRoute.optimizedOrder.length - 5} more stops
                      </p>
                    )}
                  </div>
                  {route.googleMapsUrl && (
                    <a
                      href={route.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 flex items-center justify-center gap-2 w-full py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Open in Maps
                    </a>
                  )}
                </div>
              ) : (
                <div className="p-4 text-center text-gray-500">
                  {route.message || 'No route data'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
