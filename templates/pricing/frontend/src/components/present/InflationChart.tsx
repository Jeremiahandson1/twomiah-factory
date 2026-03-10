import React, { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { api } from '../../services/api';

interface ChartDataPoint {
  year: number;
  materials: number;
  labor: number;
}

interface InflationChartProps {
  annotation?: string;
}

export default function InflationChart({ annotation }: InflationChartProps) {
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalIncrease, setTotalIncrease] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get('/api/inflation/chart-data');
        const points: ChartDataPoint[] = res.data.data_points || res.data;
        setData(points);
        if (points.length >= 2) {
          const first = points[0];
          const last = points[points.length - 1];
          const matIncrease = ((last.materials - first.materials) / first.materials * 100).toFixed(1);
          setTotalIncrease(`+${matIncrease}% over ${last.year - first.year} years`);
        }
      } catch (err) {
        console.error('Failed to load inflation data', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="w-full h-80 bg-gray-800/50 rounded-2xl flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="w-full h-80">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 40, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="year"
              stroke="rgba(255,255,255,0.7)"
              tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 16 }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.7)"
              tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 14 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(0,0,0,0.8)',
                border: 'none',
                borderRadius: '12px',
                color: '#fff',
                fontSize: 16,
              }}
            />
            <Legend
              wrapperStyle={{ color: '#fff', fontSize: 16, paddingTop: 10 }}
            />
            <Line
              type="monotone"
              dataKey="materials"
              name="Materials"
              stroke="#f97316"
              strokeWidth={3}
              dot={{ fill: '#f97316', r: 5 }}
              activeDot={{ r: 8 }}
            />
            <Line
              type="monotone"
              dataKey="labor"
              name="Labor"
              stroke="#3b82f6"
              strokeWidth={3}
              dot={{ fill: '#3b82f6', r: 5 }}
              activeDot={{ r: 8 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Annotation */}
      {(annotation || totalIncrease) && (
        <p className="text-center text-2xl font-bold text-white mt-4">
          {annotation || totalIncrease}
        </p>
      )}

      {/* Citation */}
      <p className="text-center text-sm text-white/50 mt-6">
        Source: U.S. Bureau of Labor Statistics
      </p>
    </div>
  );
}
