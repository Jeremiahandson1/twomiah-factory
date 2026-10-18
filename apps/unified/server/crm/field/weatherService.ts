// Weather: OpenWeatherMap current conditions and 5-day forecast (OPENWEATHER_API_KEY, imperial units), cached 30
// minutes, for a point, a city, a zip, a job, a project, and written onto a daily log. Moved from the CRM template's
// services/weather.ts (templates/crm/backend/src/services). One change: the job, project and daily-log lookups are
// scoped to the asking company (the template read them by id alone; with one company per database that answers the
// same, and it stays right if a database ever holds more than one).
import { and, eq } from 'drizzle-orm'
import { job, project, dailyLog } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'

const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5'
const CACHE_TTL = 30 * 60 * 1000
const apiKey = () => process.env.OPENWEATHER_API_KEY

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
} as const

/** Workable unless storm/snow/extreme, below 20°F or above 100°F, or wind over 25 mph; unknown counts as workable. */
export function isWorkableWeather(weather: any): boolean {
  if (!weather) return true
  const badConditions = ['Thunderstorm', 'Snow', 'Extreme']
  const badTemp = weather.temperature < 20 || weather.temperature > 100
  const badWind = weather.windSpeed > 25
  return !badConditions.includes(weather.condition) && !badTemp && !badWind
}

function formatWeatherData(data: any) {
  return {
    condition: data.weather[0]?.main || 'Unknown',
    description: data.weather[0]?.description || '',
    icon: data.weather[0]?.icon,
    iconUrl: data.weather[0]?.icon ? `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png` : null,
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
    location: { city: data.name, country: data.sys?.country, lat: data.coord?.lat, lng: data.coord?.lon },
    timestamp: new Date().toISOString(),
  }
}

function getMostCommon(arr: string[]): string | undefined {
  const counts: Record<string, number> = {}
  arr.forEach((item) => { counts[item] = (counts[item] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0]
}

export function createWeatherService(d: CrmDeps) {
  const { db, logger } = d
  const weatherCache = new Map<string, { data: any; timestamp: number }>()

  /** Current conditions from one URL, cached under `cacheKey`; null when the service fails. */
  async function current(cacheKey: string, url: string) {
    const cached = weatherCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Weather API error: ${response.status}`)
      const weather = formatWeatherData(await response.json())
      weatherCache.set(cacheKey, { data: weather, timestamp: Date.now() })
      return weather
    } catch (error: any) {
      logger.error('Weather API error', { error: error?.message })
      return null
    }
  }

  const getCurrentWeather = (lat: number, lng: number) =>
    current(`${lat.toFixed(2)},${lng.toFixed(2)}`, `${OPENWEATHER_BASE_URL}/weather?lat=${lat}&lon=${lng}&units=imperial&appid=${apiKey()}`)

  function getWeatherByCity(city: string, state: string = '', country: string = 'US') {
    const location = [city, state, country].filter(Boolean).join(',')
    return current(location.toLowerCase(), `${OPENWEATHER_BASE_URL}/weather?q=${encodeURIComponent(location)}&units=imperial&appid=${apiKey()}`)
  }

  const getWeatherByZip = (zip: string, country: string = 'US') =>
    current(`${zip},${country}`, `${OPENWEATHER_BASE_URL}/weather?zip=${zip},${country}&units=imperial&appid=${apiKey()}`)

  /** Five days: high, low, the most common condition and its icon, and the chance of rain when over 30%. */
  async function getForecast(lat: number, lng: number) {
    try {
      const response = await fetch(`${OPENWEATHER_BASE_URL}/forecast?lat=${lat}&lon=${lng}&units=imperial&appid=${apiKey()}`)
      if (!response.ok) throw new Error(`Weather API error: ${response.status}`)
      const data: any = await response.json()
      const dailyForecasts: Record<string, any[]> = {}
      data.list.forEach((item: any) => {
        const date = new Date(item.dt * 1000).toDateString()
        if (!dailyForecasts[date]) dailyForecasts[date] = []
        dailyForecasts[date].push(item)
      })
      return Object.entries(dailyForecasts).slice(0, 5).map(([date, items]) => {
        const temps = items.map((i: any) => i.main.temp)
        const conditions = items.map((i: any) => i.weather[0])
        const mostCommonCondition = getMostCommon(conditions.map((c: any) => c.main))
        return {
          date,
          high: Math.round(Math.max(...temps)),
          low: Math.round(Math.min(...temps)),
          condition: mostCommonCondition,
          icon: conditions.find((c: any) => c.main === mostCommonCondition)?.icon,
          precipitation: items.some((i: any) => i.pop > 0.3) ? Math.round(Math.max(...items.map((i: any) => i.pop)) * 100) : 0,
        }
      })
    } catch (error: any) {
      logger.error('Forecast API error', { error: error?.message })
      return null
    }
  }

  /** By coordinates, else zip, else city. */
  async function forPlace(place: { lat: number | null; lng: number | null; city: string | null; state: string | null; zip: string | null }) {
    if (place.lat && place.lng) return getCurrentWeather(place.lat, place.lng)
    if (place.zip) return getWeatherByZip(place.zip)
    if (place.city) return getWeatherByCity(place.city, place.state ?? '')
    return null
  }

  async function getWeatherForJob(jobId: string, companyId: string) {
    const [jobRow] = await db.select({ lat: job.lat, lng: job.lng, city: job.city, state: job.state, zip: job.zip })
      .from(job).where(and(eq(job.id, jobId), eq(job.companyId, companyId))).limit(1)
    if (!jobRow) return null
    return forPlace(jobRow)
  }

  async function getWeatherForProject(projectId: string, companyId: string) {
    const [projectRow] = await db.select({ lat: project.lat, lng: project.lng, city: project.city, state: project.state, zip: project.zip })
      .from(project).where(and(eq(project.id, projectId), eq(project.companyId, companyId))).limit(1)
    if (!projectRow) return null
    return forPlace(projectRow)
  }

  /** The project's weather written onto the daily log (weather, conditions, temperature). */
  async function populateDailyLogWeather(dailyLogId: string, companyId: string) {
    const [log] = await db.select({ id: dailyLog.id, projectId: dailyLog.projectId })
      .from(dailyLog).where(and(eq(dailyLog.id, dailyLogId), eq(dailyLog.companyId, companyId))).limit(1)
    if (!log) return null
    const [projectRow] = await db.select({ lat: project.lat, lng: project.lng, city: project.city, state: project.state, zip: project.zip })
      .from(project).where(eq(project.id, log.projectId)).limit(1)
    if (!projectRow) return null

    const weather = await forPlace(projectRow)
    if (weather) {
      await db.update(dailyLog)
        .set({ weather: weather.condition, conditions: weather.description, temperature: weather.temperature, updatedAt: new Date() })
        .where(eq(dailyLog.id, dailyLogId))
    }
    return weather
  }

  return {
    getCurrentWeather,
    getWeatherByCity,
    getWeatherByZip,
    getForecast,
    getWeatherForJob,
    getWeatherForProject,
    populateDailyLogWeather,
    WeatherConditions,
    isWorkableWeather,
  }
}
