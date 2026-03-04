/**
 * Weather API Service
 * 
 * Uses OpenWeatherMap API (free tier: 1000 calls/day)
 * Auto-populates weather data for daily logs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5';

// Cache weather data for 30 minutes
const weatherCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Get current weather by coordinates
 */
export async function getCurrentWeather(lat, lng) {
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
export async function getWeatherByCity(city, state = '', country = 'US') {
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
export async function getWeatherByZip(zip, country = 'US') {
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
export async function getForecast(lat, lng) {
  try {
    const url = `${OPENWEATHER_BASE_URL}/forecast?lat=${lat}&lon=${lng}&units=imperial&appid=${OPENWEATHER_API_KEY}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }

    const data = await response.json();
    
    // Group by day
    const dailyForecasts = {};
    data.list.forEach(item => {
      const date = new Date(item.dt * 1000).toDateString();
      if (!dailyForecasts[date]) {
        dailyForecasts[date] = [];
      }
      dailyForecasts[date].push(item);
    });

    // Get daily summary
    return Object.entries(dailyForecasts).slice(0, 5).map(([date, items]) => {
      const temps = items.map(i => i.main.temp);
      const conditions = items.map(i => i.weather[0]);
      const mostCommonCondition = getMostCommon(conditions.map(c => c.main));
      
      return {
        date,
        high: Math.round(Math.max(...temps)),
        low: Math.round(Math.min(...temps)),
        condition: mostCommonCondition,
        icon: conditions.find(c => c.main === mostCommonCondition)?.icon,
        precipitation: items.some(i => i.pop > 0.3) ? Math.round(Math.max(...items.map(i => i.pop)) * 100) : 0,
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
export async function getWeatherForJob(jobId) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { lat: true, lng: true, city: true, state: true, zip: true },
  });

  if (!job) return null;

  // Try coordinates first
  if (job.lat && job.lng) {
    return getCurrentWeather(job.lat, job.lng);
  }

  // Try zip code
  if (job.zip) {
    return getWeatherByZip(job.zip);
  }

  // Try city/state
  if (job.city) {
    return getWeatherByCity(job.city, job.state);
  }

  return null;
}

/**
 * Get weather for a project
 */
export async function getWeatherForProject(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { lat: true, lng: true, city: true, state: true, zip: true },
  });

  if (!project) return null;

  if (project.lat && project.lng) {
    return getCurrentWeather(project.lat, project.lng);
  }

  if (project.zip) {
    return getWeatherByZip(project.zip);
  }

  if (project.city) {
    return getWeatherByCity(project.city, project.state);
  }

  return null;
}

/**
 * Auto-populate weather for daily log
 */
export async function populateDailyLogWeather(dailyLogId) {
  const log = await prisma.dailyLog.findUnique({
    where: { id: dailyLogId },
    include: {
      job: { select: { lat: true, lng: true, city: true, state: true, zip: true } },
      project: { select: { lat: true, lng: true, city: true, state: true, zip: true } },
    },
  });

  if (!log) return null;

  // Get location from job or project
  const location = log.job || log.project;
  if (!location) return null;

  let weather = null;

  if (location.lat && location.lng) {
    weather = await getCurrentWeather(location.lat, location.lng);
  } else if (location.zip) {
    weather = await getWeatherByZip(location.zip);
  } else if (location.city) {
    weather = await getWeatherByCity(location.city, location.state);
  }

  if (weather) {
    await prisma.dailyLog.update({
      where: { id: dailyLogId },
      data: {
        weatherCondition: weather.condition,
        weatherTemp: weather.temperature,
        weatherHumidity: weather.humidity,
        weatherWind: weather.windSpeed,
        weatherData: weather,
      },
    });
  }

  return weather;
}

/**
 * Format raw weather data
 */
function formatWeatherData(data) {
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
function getMostCommon(arr) {
  const counts = {};
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
};

export function isWorkableWeather(weather) {
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
