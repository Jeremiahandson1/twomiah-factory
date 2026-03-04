import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import weather from '../services/weather.js';

const router = Router();
router.use(authenticate);

// Get weather by coordinates
router.get('/coords', async (req, res, next) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const data = await weather.getCurrentWeather(parseFloat(lat), parseFloat(lng));
    
    if (!data) {
      return res.status(404).json({ error: 'Weather data not available' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get weather by city
router.get('/city', async (req, res, next) => {
  try {
    const { city, state, country } = req.query;
    
    if (!city) {
      return res.status(400).json({ error: 'city is required' });
    }

    const data = await weather.getWeatherByCity(city, state, country);
    
    if (!data) {
      return res.status(404).json({ error: 'Weather data not available' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get weather by zip code
router.get('/zip/:zip', async (req, res, next) => {
  try {
    const { zip } = req.params;
    const { country = 'US' } = req.query;

    const data = await weather.getWeatherByZip(zip, country);
    
    if (!data) {
      return res.status(404).json({ error: 'Weather data not available' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get forecast
router.get('/forecast', async (req, res, next) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const data = await weather.getForecast(parseFloat(lat), parseFloat(lng));
    
    if (!data) {
      return res.status(404).json({ error: 'Forecast data not available' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get weather for a job
router.get('/job/:jobId', async (req, res, next) => {
  try {
    const data = await weather.getWeatherForJob(req.params.jobId);
    
    if (!data) {
      return res.status(404).json({ error: 'Weather data not available for this job' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Get weather for a project
router.get('/project/:projectId', async (req, res, next) => {
  try {
    const data = await weather.getWeatherForProject(req.params.projectId);
    
    if (!data) {
      return res.status(404).json({ error: 'Weather data not available for this project' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Auto-populate weather for daily log
router.post('/daily-log/:dailyLogId/populate', async (req, res, next) => {
  try {
    const data = await weather.populateDailyLogWeather(req.params.dailyLogId);
    
    if (!data) {
      return res.status(404).json({ error: 'Could not populate weather data' });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
