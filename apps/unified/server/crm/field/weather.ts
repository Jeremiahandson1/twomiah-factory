// /api/weather: current weather by coordinates, city or zip, the forecast, a job's or project's weather, and the
// weather written onto a daily log. Moved from the CRM template's routes/weather.ts (templates/crm/backend/src/routes).
// The registry signs the person in; the template gated no feature and no screen calls it, so it is ungated. Reads
// check no permission (as the template); writing onto a daily log is daily-logs:update (T68).
import { Hono } from 'hono'
import type { AppEnv } from '../../http/env.ts'
import { fail, list, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'
import { createWeatherService } from './weatherService.ts'

export function createWeatherRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const weather = createWeatherService(d)
  const app = new Hono<AppEnv>()

  app.get('/coords', async (c) => {
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    if (!lat || !lng) return fail(c, 400, 'lat and lng are required')
    const data = await weather.getCurrentWeather(parseFloat(lat), parseFloat(lng))
    if (!data) return fail(c, 404, 'Weather data not available')
    return one(c, data)
  })

  app.get('/city', async (c) => {
    const city = c.req.query('city')
    if (!city) return fail(c, 400, 'city is required')
    const data = await weather.getWeatherByCity(city, c.req.query('state'), c.req.query('country'))
    if (!data) return fail(c, 404, 'Weather data not available')
    return one(c, data)
  })

  app.get('/zip/:zip', async (c) => {
    const data = await weather.getWeatherByZip(c.req.param('zip'), c.req.query('country') || 'US')
    if (!data) return fail(c, 404, 'Weather data not available')
    return one(c, data)
  })

  // Five days, one entry each: a list.
  app.get('/forecast', async (c) => {
    const lat = c.req.query('lat')
    const lng = c.req.query('lng')
    if (!lat || !lng) return fail(c, 400, 'lat and lng are required')
    const data = await weather.getForecast(parseFloat(lat), parseFloat(lng))
    if (!data) return fail(c, 404, 'Forecast data not available')
    return list(c, data, { page: 1, limit: data.length, total: data.length })
  })

  app.get('/job/:jobId', async (c) => {
    const data = await weather.getWeatherForJob(c.req.param('jobId'), c.get('user').companyId)
    if (!data) return fail(c, 404, 'Weather data not available for this job')
    return one(c, data)
  })

  app.get('/project/:projectId', async (c) => {
    const data = await weather.getWeatherForProject(c.req.param('projectId'), c.get('user').companyId)
    if (!data) return fail(c, 404, 'Weather data not available for this project')
    return one(c, data)
  })

  app.post('/daily-log/:dailyLogId/populate', requirePermission('daily-logs:update'), async (c) => {
    const data = await weather.populateDailyLogWeather(c.req.param('dailyLogId'), c.get('user').companyId)
    if (!data) return fail(c, 404, 'Could not populate weather data')
    return one(c, data)
  })

  return app
}
