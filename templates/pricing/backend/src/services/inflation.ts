import { logger } from './logger';

const BLS_API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const BLS_API_KEY = process.env.BLS_API_KEY || '';

const MATERIALS_SERIES = 'WPUID61'; // Construction materials PPI
const LABOR_SERIES = 'CES2000000003'; // Construction average hourly earnings

interface BLSDataPoint {
  year: string;
  period: string;
  periodName: string;
  value: string;
}

interface CachedData {
  data: InflationData;
  timestamp: number;
}

interface InflationData {
  materials1yr: number;
  materials3yr: number;
  materials5yr: number;
  labor1yr: number;
  labor3yr: number;
  labor5yr: number;
}

interface ChartDataPoint {
  year: number;
  materials: number;
  labor: number;
}

let inflationCache: CachedData | null = null;
let chartDataCache: { data: ChartDataPoint[]; timestamp: number } | null = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchBLSData(
  seriesId: string,
  startYear: number,
  endYear: number
): Promise<BLSDataPoint[]> {
  try {
    const body: any = {
      seriesid: [seriesId],
      startyear: String(startYear),
      endyear: String(endYear),
    };
    if (BLS_API_KEY) {
      body.registrationkey = BLS_API_KEY;
    }

    const response = await fetch(BLS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`BLS API returned ${response.status}`);
    }

    const json = await response.json();

    if (json.status !== 'REQUEST_SUCCEEDED') {
      throw new Error(`BLS API error: ${json.message?.join(', ') || 'Unknown error'}`);
    }

    const series = json.Results?.series?.[0];
    if (!series || !series.data) {
      return [];
    }

    return series.data as BLSDataPoint[];
  } catch (err) {
    logger.error('BLS API fetch failed', {
      error: (err as Error).message,
      seriesId,
    });
    throw err;
  }
}

function calculateInflationRate(data: BLSDataPoint[], years: number): number {
  if (data.length < 2) return 0;

  // Sort by year desc, period desc
  const sorted = [...data].sort((a, b) => {
    const yearDiff = parseInt(b.year) - parseInt(a.year);
    if (yearDiff !== 0) return yearDiff;
    return b.period.localeCompare(a.period);
  });

  const latest = parseFloat(sorted[0].value);
  const targetYear = parseInt(sorted[0].year) - years;

  // Find closest data point to target year
  const older = sorted.find(
    (d) => parseInt(d.year) <= targetYear && d.period === sorted[0].period
  );

  if (!older) {
    // Fallback: use the oldest available
    const oldest = sorted[sorted.length - 1];
    const oldVal = parseFloat(oldest.value);
    if (oldVal === 0) return 0;
    const totalYears = parseInt(sorted[0].year) - parseInt(oldest.year);
    if (totalYears === 0) return 0;
    const totalRate = ((latest - oldVal) / oldVal) * 100;
    return Math.round((totalRate / totalYears) * years * 100) / 100;
  }

  const oldVal = parseFloat(older.value);
  if (oldVal === 0) return 0;
  return Math.round(((latest - oldVal) / oldVal) * 100 * 100) / 100;
}

export async function getInflationData(): Promise<InflationData> {
  if (inflationCache && Date.now() - inflationCache.timestamp < CACHE_TTL) {
    return inflationCache.data;
  }

  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 6;

  const [materialsData, laborData] = await Promise.all([
    fetchBLSData(MATERIALS_SERIES, startYear, currentYear),
    fetchBLSData(LABOR_SERIES, startYear, currentYear),
  ]);

  const data: InflationData = {
    materials1yr: calculateInflationRate(materialsData, 1),
    materials3yr: calculateInflationRate(materialsData, 3),
    materials5yr: calculateInflationRate(materialsData, 5),
    labor1yr: calculateInflationRate(laborData, 1),
    labor3yr: calculateInflationRate(laborData, 3),
    labor5yr: calculateInflationRate(laborData, 5),
  };

  inflationCache = { data, timestamp: Date.now() };
  logger.info('Inflation data cached', data);
  return data;
}

export async function getChartData(): Promise<ChartDataPoint[]> {
  if (chartDataCache && Date.now() - chartDataCache.timestamp < CACHE_TTL) {
    return chartDataCache.data;
  }

  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 10;

  const [materialsData, laborData] = await Promise.all([
    fetchBLSData(MATERIALS_SERIES, startYear, currentYear),
    fetchBLSData(LABOR_SERIES, startYear, currentYear),
  ]);

  const materialsByYear = new Map<number, number>();
  const laborByYear = new Map<number, number>();

  for (const d of materialsData) {
    if (d.period === 'M13' || d.period === 'M12') {
      materialsByYear.set(parseInt(d.year), parseFloat(d.value));
    }
  }
  // If no annual average, use latest month per year
  for (const d of materialsData) {
    const yr = parseInt(d.year);
    if (!materialsByYear.has(yr)) {
      materialsByYear.set(yr, parseFloat(d.value));
    }
  }

  for (const d of laborData) {
    if (d.period === 'M13' || d.period === 'M12') {
      laborByYear.set(parseInt(d.year), parseFloat(d.value));
    }
  }
  for (const d of laborData) {
    const yr = parseInt(d.year);
    if (!laborByYear.has(yr)) {
      laborByYear.set(yr, parseFloat(d.value));
    }
  }

  const years = Array.from(
    new Set([...materialsByYear.keys(), ...laborByYear.keys()])
  ).sort();

  const chartData: ChartDataPoint[] = years.map((year) => ({
    year,
    materials: materialsByYear.get(year) || 0,
    labor: laborByYear.get(year) || 0,
  }));

  chartDataCache = { data: chartData, timestamp: Date.now() };
  return chartData;
}
