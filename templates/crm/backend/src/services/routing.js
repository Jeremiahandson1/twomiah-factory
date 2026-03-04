/**
 * Route Optimization Service
 * 
 * Optimize driving routes for field techs:
 * - Multi-stop route optimization
 * - Travel time estimation
 * - Distance calculations
 * - Fuel cost estimates
 * - Integration with Google Maps
 */

// Using OSRM (free) or Google Maps Directions API
const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;

/**
 * Calculate distance and duration between two points
 */
export async function getRoute(origin, destination) {
  if (GOOGLE_MAPS_KEY) {
    return getGoogleRoute(origin, destination);
  }
  return getOsrmRoute(origin, destination);
}

/**
 * OSRM route calculation (free, no API key)
 */
async function getOsrmRoute(origin, destination) {
  const url = `${OSRM_URL}/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error('Route calculation failed');
  }

  const route = data.routes[0];
  return {
    distance: route.distance, // meters
    distanceMiles: route.distance * 0.000621371,
    duration: route.duration, // seconds
    durationMinutes: Math.round(route.duration / 60),
    geometry: route.geometry,
  };
}

/**
 * Google Maps route calculation
 */
async function getGoogleRoute(origin, destination) {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&key=${GOOGLE_MAPS_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK' || !data.routes?.[0]) {
    throw new Error(`Route calculation failed: ${data.status}`);
  }

  const route = data.routes[0].legs[0];
  return {
    distance: route.distance.value, // meters
    distanceMiles: route.distance.value * 0.000621371,
    duration: route.duration.value, // seconds
    durationMinutes: Math.round(route.duration.value / 60),
    polyline: data.routes[0].overview_polyline?.points,
  };
}

/**
 * Optimize route for multiple stops
 * Uses nearest neighbor algorithm with 2-opt improvement
 */
export async function optimizeRoute(stops, startLocation = null) {
  if (stops.length < 2) {
    return {
      optimizedOrder: stops,
      totalDistance: 0,
      totalDuration: 0,
      savings: { distance: 0, time: 0 },
    };
  }

  // Build distance matrix
  const allPoints = startLocation ? [startLocation, ...stops] : stops;
  const distanceMatrix = await buildDistanceMatrix(allPoints);

  // Get original order stats
  const originalStats = calculateRouteStats(
    startLocation ? [0, ...stops.map((_, i) => i + 1)] : stops.map((_, i) => i),
    distanceMatrix
  );

  // Optimize using nearest neighbor + 2-opt
  const optimizedOrder = nearestNeighbor(distanceMatrix, startLocation ? 0 : null);
  const improvedOrder = twoOpt(optimizedOrder, distanceMatrix);

  // Calculate optimized stats
  const optimizedStats = calculateRouteStats(improvedOrder, distanceMatrix);

  // Map back to original stops (excluding start if present)
  const orderedStops = startLocation
    ? improvedOrder.filter(i => i !== 0).map(i => stops[i - 1])
    : improvedOrder.map(i => stops[i]);

  return {
    optimizedOrder: orderedStops,
    originalOrder: stops,
    totalDistance: optimizedStats.distance,
    totalDistanceMiles: optimizedStats.distance * 0.000621371,
    totalDuration: optimizedStats.duration,
    totalDurationMinutes: Math.round(optimizedStats.duration / 60),
    savings: {
      distanceMeters: originalStats.distance - optimizedStats.distance,
      distanceMiles: (originalStats.distance - optimizedStats.distance) * 0.000621371,
      timeSeconds: originalStats.duration - optimizedStats.duration,
      timeMinutes: Math.round((originalStats.duration - optimizedStats.duration) / 60),
      percentDistance: originalStats.distance > 0
        ? Math.round((1 - optimizedStats.distance / originalStats.distance) * 100)
        : 0,
      percentTime: originalStats.duration > 0
        ? Math.round((1 - optimizedStats.duration / originalStats.duration) * 100)
        : 0,
    },
    legs: await getRouteLegs(orderedStops, startLocation),
  };
}

/**
 * Build distance matrix between all points
 */
async function buildDistanceMatrix(points) {
  const n = points.length;
  const matrix = Array(n).fill(null).map(() => Array(n).fill(null));

  // Calculate distances between all pairs
  for (let i = 0; i < n; i++) {
    matrix[i][i] = { distance: 0, duration: 0 };
    for (let j = i + 1; j < n; j++) {
      try {
        const route = await getRoute(points[i], points[j]);
        matrix[i][j] = { distance: route.distance, duration: route.duration };
        matrix[j][i] = { distance: route.distance, duration: route.duration };
      } catch (error) {
        // Use Haversine as fallback
        const dist = haversineDistance(points[i], points[j]);
        const duration = dist / 13.4; // ~30mph average
        matrix[i][j] = { distance: dist, duration };
        matrix[j][i] = { distance: dist, duration };
      }
    }
  }

  return matrix;
}

/**
 * Haversine distance between two points (meters)
 */
function haversineDistance(p1, p2) {
  const R = 6371000; // Earth radius in meters
  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;

  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Nearest neighbor algorithm
 */
function nearestNeighbor(matrix, startIndex = 0) {
  const n = matrix.length;
  const visited = new Set([startIndex ?? 0]);
  const order = [startIndex ?? 0];

  while (visited.size < n) {
    const current = order[order.length - 1];
    let nearest = -1;
    let minDist = Infinity;

    for (let i = 0; i < n; i++) {
      if (!visited.has(i) && matrix[current][i].distance < minDist) {
        minDist = matrix[current][i].distance;
        nearest = i;
      }
    }

    if (nearest !== -1) {
      visited.add(nearest);
      order.push(nearest);
    }
  }

  return order;
}

/**
 * 2-opt improvement algorithm
 */
function twoOpt(route, matrix) {
  let improved = true;
  let best = [...route];

  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 2; i++) {
      for (let j = i + 1; j < best.length - 1; j++) {
        const delta = calculateSwapDelta(best, i, j, matrix);
        if (delta < 0) {
          // Reverse segment between i and j
          const newRoute = [
            ...best.slice(0, i),
            ...best.slice(i, j + 1).reverse(),
            ...best.slice(j + 1),
          ];
          best = newRoute;
          improved = true;
        }
      }
    }
  }

  return best;
}

function calculateSwapDelta(route, i, j, matrix) {
  const a = route[i - 1];
  const b = route[i];
  const c = route[j];
  const d = route[j + 1];

  const currentDist = matrix[a][b].distance + matrix[c][d].distance;
  const newDist = matrix[a][c].distance + matrix[b][d].distance;

  return newDist - currentDist;
}

function calculateRouteStats(order, matrix) {
  let distance = 0;
  let duration = 0;

  for (let i = 0; i < order.length - 1; i++) {
    distance += matrix[order[i]][order[i + 1]].distance;
    duration += matrix[order[i]][order[i + 1]].duration;
  }

  return { distance, duration };
}

/**
 * Get detailed legs for optimized route
 */
async function getRouteLegs(stops, startLocation) {
  const legs = [];
  const allPoints = startLocation ? [startLocation, ...stops] : stops;

  for (let i = 0; i < allPoints.length - 1; i++) {
    try {
      const route = await getRoute(allPoints[i], allPoints[i + 1]);
      legs.push({
        from: allPoints[i],
        to: allPoints[i + 1],
        distance: route.distance,
        distanceMiles: route.distanceMiles,
        duration: route.duration,
        durationMinutes: route.durationMinutes,
      });
    } catch (error) {
      // Fallback
      const dist = haversineDistance(allPoints[i], allPoints[i + 1]);
      legs.push({
        from: allPoints[i],
        to: allPoints[i + 1],
        distance: dist,
        distanceMiles: dist * 0.000621371,
        duration: dist / 13.4,
        durationMinutes: Math.round(dist / 13.4 / 60),
      });
    }
  }

  return legs;
}

/**
 * Get optimized route for a user's jobs for a day
 */
export async function optimizeDayRoute(companyId, userId, date, prisma) {
  // Get jobs for the day
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      assignedTo: { some: { userId } },
      scheduledDate: { gte: startOfDay, lte: endOfDay },
      status: { in: ['scheduled', 'in_progress'] },
    },
    include: {
      contact: { select: { address: true } },
    },
  });

  // Extract locations
  const stops = jobs
    .filter(j => j.lat && j.lng)
    .map(j => ({
      id: j.id,
      name: j.title,
      lat: j.lat,
      lng: j.lng,
      address: j.address || j.contact?.address,
      scheduledTime: j.scheduledDate,
    }));

  if (stops.length < 2) {
    return { jobs, optimizedRoute: null, message: 'Need at least 2 jobs with coordinates' };
  }

  // Get user's start location (could be their home address or office)
  // For now, use first job as start
  const optimizedRoute = await optimizeRoute(stops);

  return {
    jobs,
    optimizedRoute,
    googleMapsUrl: generateGoogleMapsUrl(optimizedRoute.optimizedOrder),
  };
}

/**
 * Generate Google Maps URL for navigation
 */
export function generateGoogleMapsUrl(stops) {
  if (stops.length === 0) return null;
  
  const waypoints = stops.slice(1, -1).map(s => `${s.lat},${s.lng}`).join('|');
  const origin = stops[0];
  const destination = stops[stops.length - 1];
  
  let url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}`;
  
  if (waypoints) {
    url += `&waypoints=${encodeURIComponent(waypoints)}`;
  }
  
  return url;
}

/**
 * Calculate fuel cost for route
 */
export function calculateFuelCost(distanceMiles, mpg = 20, fuelPricePerGallon = 3.50) {
  const gallons = distanceMiles / mpg;
  return {
    gallons: Math.round(gallons * 100) / 100,
    cost: Math.round(gallons * fuelPricePerGallon * 100) / 100,
    distanceMiles,
    mpg,
    fuelPrice: fuelPricePerGallon,
  };
}

export default {
  getRoute,
  optimizeRoute,
  optimizeDayRoute,
  generateGoogleMapsUrl,
  calculateFuelCost,
};
