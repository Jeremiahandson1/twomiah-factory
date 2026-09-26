/**
 * Weather API Service (Drizzle)
 *
 * Uses OpenWeatherMap API (free tier: 1000 calls/day)
 * Auto-populates weather data for daily logs
 */

import { db } from '../../db/index.ts';
import { job, project, dailyLog } from '../../db/schema.ts';
import { eq } from 'drizzle-orm';

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

// Cache weather data for 30 minutes
const weatherCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Get current weather by coordinates
 */
export async function getCurrentWeather(lat: number, lng: number) {
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = weatherCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `${OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lng}&units=imperial&appid=${OPENWEATHER_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    const weather = formatWeatherData(data);

    weatherCache.set(cacheKey, { data: weather, timestamp: Date.now() });
    return weather;
  } catch (error) {
    console.error('Weather API error:', error);
    return null;
  }
}

/**
 * Get weather by city name
 */
export async function getWeatherByCity(city: string, state: string = '', country: string = 'US') {
  const location = [city, state, country].filter(Boolean).join(',');
  const cacheKey = location.toLowerCase();
  const cached = weatherCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `${OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(location)}&units=imperial&appid=${OPENWEATHER_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    const weather = formatWeatherData(data);

    weatherCache.set(cacheKey, { data: weather, timestamp: Date.now() });
    return weather;
  } catch (error) {
    console.error('Weather API error:', error);
    return null;
  }
}

/**
 * Get weather by zip code
 */
export async function getWeatherByZip(zip: string, country: string = 'US') {
  const cacheKey = `${zip},${country}`;
  const cached = weatherCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `${OPENWEATHER_BASE_URL}/weather?zip=${zip},${country}&units=imperial&appid=${OPENWEATHER_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    const weather = formatWeatherData(data);

    weatherCache.set(cacheKey, { data: weather, timestamp: Date.now() });
    return weather;
  } catch (error) {
    console.error('Weather API error:', error);
    return null;
  }
}

/**
 * Get 5-day forecast
 */
export async function getForecast(lat: number, lng: number) {
  try {
    const url = `${OPENWEATHER_BASE_URL}/forecast?lat=${lat}&lon=${lng}&units=imperial&appid=${OPENWEATHER_API_KEY}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();

    // Group by day
    const dailyForecasts: Record<string, any[]> = {};
    data.list.forEach((item: any) => {
      const date = new Date(item.dt * 1000).toDateString();
      if (!dailyForecasts[date]) {
        dailyForecasts[date] = [];
      }
      dailyForecasts[date].push(item);
    });

    // Get daily summary
    return Object.entries(dailyForecasts).slice(0, 5).map(([date, items]) => {
      const temps = items.map((i: any) => i.main.temp);
      const conditions = items.map((i: any) => i.weather[0]);
      const mostCommonCondition = getMostCommon(conditions.map((c: any) => c.main));

      return {
        date,
        high: Math.round(Math.max(...temps)),
        low: Math.round(Math.min(...temps)),
        condition: mostCommonCondition,
        icon: conditions.find((c: any) => c.main === mostCommonCondition)?.icon,
        precipitation: items.some((i: any) => i.pop > 0.3)
          ? Math.round(Math.max(...items.map((i: any) => i.pop)) * 100)
          : 0,
      };
    });
  } catch (error) {
    console.error('Forecast API error:', error);
    return null;
  }
}

/**
 * Get weather for a job site
 */
export async function getWeatherForJob(jobId: string) {
  const [jobRow] = await db.select({
    lat: job.lat,
    lng: job.lng,
    city: job.city,
    state: job.state,
    zip: job.zip,
  }).from(job).where(eq(job.id, jobId)).limit(1);

  if (!jobRow) return null;

  if (jobRow.lat && jobRow.lng) {
    return getCurrentWeather(jobRow.lat, jobRow.lng);
  }

  if (jobRow.zip) {
    return getWeatherByZip(jobRow.zip);
  }

  if (jobRow.city) {
    return getWeatherByCity(jobRow.city, jobRow.state ?? '');
  }

  return null;
}

/**
 * Get weather for a project
 */
export async function getWeatherForProject(projectId: string) {
  const [projectRow] = await db.select({
    lat: project.lat,
    lng: project.lng,
    city: project.city,
    state: project.state,
    zip: project.zip,
  }).from(project).where(eq(project.id, projectId)).limit(1);

  if (!projectRow) return null;

  if (projectRow.lat && projectRow.lng) {
    return getCurrentWeather(projectRow.lat, projectRow.lng);
  }

  if (projectRow.zip) {
    return getWeatherByZip(projectRow.zip);
  }

  if (projectRow.city) {
    return getWeatherByCity(projectRow.city, projectRow.state ?? '');
  }

  return null;
}

/**
 * Auto-populate weather for daily log
 *
 * dailyLog schema columns for weather: weather (text), conditions (text), temperature (integer)
 */
export async function populateDailyLogWeather(dailyLogId: string) {
  const [log] = await db.select({
    id: dailyLog.id,
    projectId: dailyLog.projectId,
  }).from(dailyLog).where(eq(dailyLog.id, dailyLogId)).limit(1);

  if (!log) return null;

  // Get location from project
  const [projectRow] = await db.select({
    lat: project.lat,
    lng: project.lng,
    city: project.city,
    state: project.state,
    zip: project.zip,
  }).from(project).where(eq(project.id, log.projectId)).limit(1);

  if (!projectRow) return null;

  let weather = null;

  if (projectRow.lat && projectRow.lng) {
    weather = await getCurrentWeather(projectRow.lat, projectRow.lng);
  } else if (projectRow.zip) {
    weather = await getWeatherByZip(projectRow.zip);
  } else if (projectRow.city) {
    weather = await getWeatherByCity(projectRow.city, projectRow.state ?? '');
  }

  if (weather) {
    await db.update(dailyLog)
      .set({
        weather: weather.condition,
        conditions: weather.description,
        temperature: weather.temperature,
        updatedAt: new Date(),
      })
      .where(eq(dailyLog.id, dailyLogId));
  }

  return weather;
}

/**
 * Format raw weather data
 */
function formatWeatherData(data: any) {
  return {
    condition: data.weather[0]?.main || 'Unknown',
    description: data.weather[0]?.description || '',
    icon: data.weather[0]?.icon,
    iconUrl: data.weather[0]?.icon
      ? `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`
      : null,
    temperature: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    tempMin: Math.round(data.main.temp_min),
    tempMax: Math.round(data.main.temp_max),
    humidity: data.main.humidity,
    pressure: data.main.pressure,
    windSpeed: Math.round(data.wind.speed),
    windDirection: data.wind.deg,
    visibility: data.visibility ? Math.round(data.visibility / 1609.34) : null, // miles
    clouds: data.clouds?.all,
    sunrise: data.sys?.sunrise ? new Date(data.sys.sunrise * 1000).toISOString() : null,
    sunset: data.sys?.sunset ? new Date(data.sys.sunset * 1000).toISOString() : null,
    location: {
      city: data.name,
      country: data.sys?.country,
      lat: data.coord?.lat,
      lng: data.coord?.lon,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get most common item in array
 */
function getMostCommon(arr: string[]): string | undefined {
  const counts: Record<string, number> = {};
  arr.forEach(item => counts[item] = (counts[item] || 0) + 1);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * Weather condition helpers
 */
export const WeatherConditions = {
  CLEAR: 'Clear',
  CLOUDS: 'Clouds',
  RAIN: 'Rain',
  DRIZZLE: 'Drizzle',
  THUNDERSTORM: 'Thunderstorm',
  SNOW: 'Snow',
  MIST: 'Mist',
  FOG: 'Fog',
  HAZE: 'Haze',
} as const;

export function isWorkableWeather(weather: any): boolean {
  if (!weather) return true; // Assume workable if unknown

  const badConditions = ['Thunderstorm', 'Snow', 'Extreme'];
  const badTemp = weather.temperature < 20 || weather.temperature > 100;
  const badWind = weather.windSpeed > 25;

  return !badConditions.includes(weather.condition) && !badTemp && !badWind;
}

export default {
  getCurrentWeather,
  getWeatherByCity,
  getWeatherByZip,
  getForecast,
  getWeatherForJob,
  getWeatherForProject,
  populateDailyLogWeather,
  WeatherConditions,
  isWorkableWeather,
};
