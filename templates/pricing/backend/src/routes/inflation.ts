import { Hono } from 'hono';
import { authenticate } from '../middleware/auth';
import { getInflationData, getChartData } from '../services/inflation';
import { logger } from '../services/logger';

const app = new Hono();

app.use('*', authenticate);

// GET /current
app.get('/current', async (c) => {
  try {
    const data = await getInflationData();
    return c.json({ inflation: data });
  } catch (err) {
    logger.error('Failed to fetch inflation data', { error: (err as Error).message });
    return c.json({ error: 'Failed to fetch inflation data' }, 500);
  }
});

// GET /chart-data
app.get('/chart-data', async (c) => {
  try {
    const data = await getChartData();
    return c.json({ chartData: data });
  } catch (err) {
    logger.error('Failed to fetch chart data', { error: (err as Error).message });
    return c.json({ error: 'Failed to fetch chart data' }, 500);
  }
});

export default app;
