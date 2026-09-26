import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.ts';
import weather from '../services/weather.ts';

const app = new Hono();
app.use('*', authenticate);

// Get weather by coordinates
app.get('/coords', async (c) => {
  const lat = c.req.query('lat');
  const lng = c.req.query('lng');

  if (!lat || !lng) {
    return c.json({ error: 'lat and lng are required' }, 400);
  }

  const data = await weather.getCurrentWeather(parseFloat(lat), parseFloat(lng));

  if (!data) {
    return c.json({ error: 'Weather data not available' }, 404);
  }

  return c.json(data);
});

// Get weather by city
app.get('/city', async (c) => {
  const city = c.req.query('city');
  const state = c.req.query('state');
  const country = c.req.query('country');

  if (!city) {
    return c.json({ error: 'city is required' }, 400);
  }

  const data = await weather.getWeatherByCity(city, state, country);

  if (!data) {
    return c.json({ error: 'Weather data not available' }, 404);
  }

  return c.json(data);
});

// Get weather by zip code
app.get('/zip/:zip', async (c) => {
  const zip = c.req.param('zip');
  const country = c.req.query('country') || 'US';

  const data = await weather.getWeatherByZip(zip, country);

  if (!data) {
    return c.json({ error: 'Weather data not available' }, 404);
  }

  return c.json(data);
});

// Get forecast
app.get('/forecast', async (c) => {
  const lat = c.req.query('lat');
  const lng = c.req.query('lng');

  if (!lat || !lng) {
    return c.json({ error: 'lat and lng are required' }, 400);
  }

  const data = await weather.getForecast(parseFloat(lat), parseFloat(lng));

  if (!data) {
    return c.json({ error: 'Forecast data not available' }, 404);
  }

  return c.json(data);
});

// Get weather for a job
app.get('/job/:jobId', async (c) => {
  const data = await weather.getWeatherForJob(c.req.param('jobId'));

  if (!data) {
    return c.json({ error: 'Weather data not available for this job' }, 404);
  }

  return c.json(data);
});

// Get weather for a project
app.get('/project/:projectId', async (c) => {
  const data = await weather.getWeatherForProject(c.req.param('projectId'));

  if (!data) {
    return c.json({ error: 'Weather data not available for this project' }, 404);
  }

  return c.json(data);
});

// Auto-populate weather for daily log
app.post('/daily-log/:dailyLogId/populate', async (c) => {
  const data = await weather.populateDailyLogWeather(c.req.param('dailyLogId'));

  if (!data) {
    return c.json({ error: 'Could not populate weather data' }, 404);
  }

  return c.json(data);
});

export default app;
