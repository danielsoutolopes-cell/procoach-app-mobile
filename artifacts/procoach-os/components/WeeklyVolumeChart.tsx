import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Line, Rect, Text as SvgText } from "react-native-svg";
import { getPhase, getPhaseColor, getWeeklyVolume } from "../utils/training";

interface ChartData {
  week: number;
  km: number;
  targetKm: number;
  fill: string;
}

interface WeeklyVolumeChartProps {
  weeklyCompleted: Record<number, number>;
  onWeekSelect?: (week: number | null) => void;
  selectedWeek?: number | null;
}

export const WeeklyVolumeChart: React.FC<WeeklyVolumeChartProps> = ({ weeklyCompleted, onWeekSelect, selectedWeek }) => {
  const data = useMemo(() => {
    return Array.from({ length: 16 }, (_, i) => {
      const weekNum = i + 1;
      const km = weeklyCompleted[weekNum] || 0;
      const targetKm = getWeeklyVolume(weekNum);
      return {
        week: weekNum,
        km: Math.round(km),
        targetKm: targetKm,
        fill: getPhaseColor(getPhase(weekNum)),
      };
    });
  }, [weeklyCompleted]);

  const width = 320;
  const height = 200;
  const paddingLeft = 34;
  const paddingRight = 10;
  const paddingTop = 12;
  const paddingBottom = 34;
  const innerWidth = width - paddingLeft - paddingRight;
  const innerHeight = height - paddingTop - paddingBottom;

  const maxY = Math.max(
    1,
    ...data.map((d) => Math.max(d.km ?? 0, d.targetKm ?? 0))
  );

  const xStep = innerWidth / data.length;
  const barWidth = Math.min(14, xStep * 0.7);

  const yFor = (val: number) =>
    paddingTop + innerHeight - (val / maxY) * innerHeight;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>VOLUME SEMANAL (KM)</Text>

      <Svg width={width} height={height}>
        <Line
          x1={paddingLeft}
          y1={paddingTop + innerHeight}
          x2={width - paddingRight}
          y2={paddingTop + innerHeight}
          stroke="#333"
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const cx = paddingLeft + i * xStep + xStep / 2;
          const x = cx - barWidth / 2;
          const y = yFor(d.km);
          const h = paddingTop + innerHeight - y;
          const opacity =
            selectedWeek && d.week !== selectedWeek ? 0.3 : 1;
          const fill = d.week === selectedWeek ? "#FFFFFF" : d.fill;

          return (
            <Rect
              key={d.week}
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(0, h)}
              rx={4}
              fill={fill}
              opacity={opacity}
              onPress={() =>
                onWeekSelect?.(d.week === selectedWeek ? null : d.week)
              }
            />
          );
        })}

        {data.map((d, i) => {
          const x1 = paddingLeft + i * xStep + xStep / 2;
          const y1 = yFor(d.targetKm);
          const x2 =
            paddingLeft + (i + 1) * xStep + xStep / 2;
          const y2 =
            i + 1 < data.length ? yFor(data[i + 1]!.targetKm) : y1;

          return (
            <Line
              key={`t-${d.week}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#444"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          );
        })}

        {[1, 4, 8, 12, 16].map((w) => {
          const i = w - 1;
          const x = paddingLeft + i * xStep + xStep / 2;
          return (
            <SvgText
              key={`x-${w}`}
              x={x}
              y={height - 14}
              fill="#999"
              fontSize={10}
              textAnchor="middle"
            >
              {`S${w}`}
            </SvgText>
          );
        })}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#111",
    borderRadius: 12,
    padding: 16,
    marginVertical: 10,
  },
  title: {
    color: "#FF5F00",
    fontSize: 12,
    fontWeight: "bold",
    letterSpacing: 1,
    marginBottom: 10,
  },
  center: {
    height: 200,
    justifyContent: "center",
    alignItems: "center",
  }
});
