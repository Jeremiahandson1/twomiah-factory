import { View, Text, useWindowDimensions } from 'react-native';
import {
  VictoryChart,
  VictoryLine,
  VictoryAxis,
  VictoryLegend,
  VictoryVoronoiContainer,
  VictoryTooltip,
} from 'victory-native';

const materialData = [
  { x: 2018, y: 100 },
  { x: 2019, y: 102 },
  { x: 2020, y: 108 },
  { x: 2021, y: 128 },
  { x: 2022, y: 142 },
  { x: 2023, y: 148 },
  { x: 2024, y: 155 },
];

const laborData = [
  { x: 2018, y: 100 },
  { x: 2019, y: 104 },
  { x: 2020, y: 107 },
  { x: 2021, y: 114 },
  { x: 2022, y: 122 },
  { x: 2023, y: 130 },
  { x: 2024, y: 137 },
];

export function InflationChart() {
  const { width: screenWidth } = useWindowDimensions();
  const chartWidth = Math.min(screenWidth - 64, 600);
  const chartHeight = 280;

  return (
    <View className="items-center">
      <VictoryChart
        width={chartWidth}
        height={chartHeight}
        containerComponent={
          <VictoryVoronoiContainer
            labels={({ datum }: { datum: { x: number; y: number } }) =>
              `${datum.x}: ${datum.y}`
            }
            labelComponent={
              <VictoryTooltip
                flyoutStyle={{ fill: '#1e3a5f', stroke: 'none' }}
                style={{ fill: '#ffffff', fontSize: 12 }}
                cornerRadius={6}
                flyoutPadding={{ top: 6, bottom: 6, left: 10, right: 10 }}
              />
            }
          />
        }
      >
        <VictoryAxis
          tickValues={[2018, 2019, 2020, 2021, 2022, 2023, 2024]}
          style={{
            axis: { stroke: 'rgba(255,255,255,0.2)' },
            tickLabels: { fill: 'rgba(255,255,255,0.6)', fontSize: 11 },
            grid: { stroke: 'rgba(255,255,255,0.05)' },
          }}
        />
        <VictoryAxis
          dependentAxis
          style={{
            axis: { stroke: 'rgba(255,255,255,0.2)' },
            tickLabels: { fill: 'rgba(255,255,255,0.6)', fontSize: 11 },
            grid: { stroke: 'rgba(255,255,255,0.08)' },
          }}
        />
        <VictoryLine
          data={materialData}
          style={{
            data: { stroke: '#f59e0b', strokeWidth: 3 },
          }}
          interpolation="monotoneX"
        />
        <VictoryLine
          data={laborData}
          style={{
            data: { stroke: '#3b82f6', strokeWidth: 3 },
          }}
          interpolation="monotoneX"
        />
        <VictoryLegend
          x={chartWidth / 2 - 100}
          y={10}
          orientation="horizontal"
          gutter={20}
          style={{
            labels: { fill: 'rgba(255,255,255,0.8)', fontSize: 12 },
          }}
          data={[
            { name: 'Materials', symbol: { fill: '#f59e0b' } },
            { name: 'Labor', symbol: { fill: '#3b82f6' } },
          ]}
        />
      </VictoryChart>
      <Text className="text-xs text-white/40 mt-1">
        Index: 2018 = 100. Source: Bureau of Labor Statistics (BLS)
      </Text>
    </View>
  );
}
