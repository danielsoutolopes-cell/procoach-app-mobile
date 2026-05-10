import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAthlete } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";
import { StravaCard } from "@/components/StravaCard";
import { WorkoutEntry, AthleteProfile, Race } from "@/services/schema"; // Importa o tipo do novo arquivo de schema
import { WeeklyVolumeChart } from "@/components/WeeklyVolumeChart";
import {
  formatDistance,
  getPhase,
  getPhaseColor,
  getWeeklyVolume,
} from "@/utils/training";

const CHART_HEIGHT = 180;
const CHART_PADDING_LEFT = 36;
const CHART_PADDING_BOTTOM = 28;
const BAR_RADIUS = 4;

const WORKOUT_LABELS: Record<string, string> = {
  corrida: "Corrida",
  bike: "Bike Indolor",
  regenerativo: "Regenerativo",
  forca: "Força",
  folga: "Descanso",
};

const WORKOUT_ICONS: Record<string, string> = {
  corrida: "activity",
  bike: "wind",
  regenerativo: "heart",
  forca: "zap",
  folga: "moon",
};

const DISTRIBUTION_COLORS = ["#FF5F00", "#2196F3", "#4CAF50", "#9C27B0", "#9E9E9E"];

type ViewMode = "volume" | "cumulativo";

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function donutSlicePath(opts: {
  cx: number;
  cy: number;
  outerR: number;
  innerR: number;
  startAngle: number;
  endAngle: number;
}) {
  const { cx, cy, outerR, innerR, startAngle, endAngle } = opts;
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;

  const x1 = cx + outerR * Math.cos(startAngle);
  const y1 = cy + outerR * Math.sin(startAngle);
  const x2 = cx + outerR * Math.cos(endAngle);
  const y2 = cy + outerR * Math.sin(endAngle);

  const x3 = cx + innerR * Math.cos(endAngle);
  const y3 = cy + innerR * Math.sin(endAngle);
  const x4 = cx + innerR * Math.cos(startAngle);
  const y4 = cy + innerR * Math.sin(startAngle);

  return [
    `M ${x1} ${y1}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

export default function HistoricoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, refreshHistory } = useAthlete();
  const { currentWeek, weeklyCompleted, history, profile } = state;

  const [mode, setMode] = useState<ViewMode>("volume");
  const [chartWidth, setChartWidth] = useState(340);
  const [selectedWeekFilter, setSelectedWeekFilter] = useState<number | null>(null);

  const races = (profile as AthleteProfile)?.races ?? [];
  const p1Race = races.find((r: Race) => r.priority === "P1") ?? races[0];
  const targetPace = p1Race?.targetPaceMinKm ?? 6.0;

  const filteredHistory = useMemo(() => {
    // Convertemos para unknown primeiro para evitar o erro de overlap insuficiente entre o payload e o record do banco
    return (history as unknown as WorkoutEntry[]).filter(
      (e) =>
        (!selectedWeekFilter || e.week === selectedWeekFilter) &&
        e.type === "corrida" &&
        Number(e.distanceKm ?? 0) >= 3
    );
  }, [history, selectedWeekFilter]);

  const distributionData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredHistory.forEach((e: WorkoutEntry) => { counts[e.type] = (counts[e.type] || 0) + 1; });
    return Object.entries(counts).map(([type, count]) => ({
      x: WORKOUT_LABELS[type] || type, y: count, fill: getPhaseColor(getPhase(currentWeek)) // simplificação de cor
    }));
  }, [filteredHistory]);

  const targetVolumes = useMemo(
    () => Array.from({ length: 16 }, (_, i) => getWeeklyVolume(i + 1)),
    []
  );

  const completedVolumes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => weeklyCompleted[i + 1] ?? 0),
    [weeklyCompleted]
  );

  const cumulativeTarget = useMemo(() => {
    let acc = 0;
    return targetVolumes.map((v: number) => (acc += v));
  }, [targetVolumes]);

  const cumulativeCompleted = useMemo(() => {
    let acc = 0;
    return completedVolumes.map((v: number) => (acc += v));
  }, [completedVolumes]);

  const isCumulative = mode === "cumulativo";
  const displayTarget = isCumulative ? cumulativeTarget : targetVolumes;
  const displayCompleted = isCumulative ? cumulativeCompleted : completedVolumes;
  const maxVal = Math.max(...displayTarget, ...displayCompleted, 1);

  const totalCompletedKm = useMemo(
    () => completedVolumes.reduce((a: number, b: number) => a + b, 0),
    [completedVolumes]
  );
  const totalTargetKm = useMemo(
    () => targetVolumes.reduce((a: number, b: number) => a + b, 0),
    [targetVolumes]
  );
  const completedWeeks = useMemo(
    () => Object.keys(weeklyCompleted).length,
    [weeklyCompleted]
  );
  const progressPct = totalTargetKm > 0
    ? Math.round((totalCompletedKm / totalTargetKm) * 100)
    : 0;

  const usableWidth = chartWidth - CHART_PADDING_LEFT - 8;
  const barGroupWidth = usableWidth / 16;
  const barWidth = Math.max(6, barGroupWidth * 0.55);
  const innerHeight = CHART_HEIGHT - CHART_PADDING_BOTTOM;

  const getY = (val: number) =>
    innerHeight - (val / maxVal) * (innerHeight - 12);

  const cumulativePath = useMemo(() => {
    if (!isCumulative) return "";
    const points = displayCompleted
      .map((val: number, i: number) => {
        const x = CHART_PADDING_LEFT + i * barGroupWidth + barGroupWidth / 2;
        const y = getY(val);
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
    return points;
  }, [isCumulative, displayCompleted, barGroupWidth, getY]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top + 16,
      paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
    },
    pageTitle: {
      fontSize: 10,
      letterSpacing: 4,
      color: colors.primary,
      fontWeight: "800" as const,
      marginBottom: 4,
    },
    pageSubtitle: {
      fontSize: 22,
      fontWeight: "800" as const,
      color: colors.foreground,
      letterSpacing: -0.5,
      marginBottom: 20,
    },
    statsRow: {
      flexDirection: "row",
      gap: 8,
      marginBottom: 16,
    },
    statCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
      alignItems: "center",
    },
    statNum: {
      fontSize: 22,
      fontWeight: "800" as const,
      letterSpacing: -1,
    },
    statLabel: {
      fontSize: 8,
      letterSpacing: 2,
      color: colors.mutedForeground,
      marginTop: 2,
      textAlign: "center" as const,
    },
    chartCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 16,
    },
    chartHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14,
    },
    chartTitle: {
      fontSize: 10,
      letterSpacing: 3,
      color: colors.mutedForeground,
      fontWeight: "700" as const,
    },
    modeToggle: {
      flexDirection: "row",
      backgroundColor: colors.secondary,
      borderRadius: 8,
      padding: 2,
      gap: 2,
    },
    modeBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
    },
    modeBtnText: {
      fontSize: 9,
      letterSpacing: 1,
      fontWeight: "700" as const,
    },
    legendRow: {
      flexDirection: "row",
      gap: 16,
      marginTop: 10,
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    legendDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    legendText: {
      fontSize: 9,
      letterSpacing: 1,
      color: colors.mutedForeground,
    },
    progressCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 16,
    },
    progressLabel: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    progressLabelText: {
      fontSize: 10,
      letterSpacing: 2,
      color: colors.mutedForeground,
    },
    progressLabelPct: {
      fontSize: 10,
      letterSpacing: 1,
      color: colors.primary,
      fontWeight: "800" as const,
    },
    progressBarBg: {
      height: 8,
      backgroundColor: colors.border,
      borderRadius: 4,
      overflow: "hidden",
    },
    progressBarFill: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    sectionLabel: {
      fontSize: 10,
      letterSpacing: 3,
      color: colors.mutedForeground,
      marginBottom: 12,
    },
    emptyState: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 32,
      alignItems: "center",
      gap: 10,
    },
    emptyTitle: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: colors.foreground,
      letterSpacing: 1,
    },
    emptyDesc: {
      fontSize: 11,
      color: colors.mutedForeground,
      textAlign: "center" as const,
      lineHeight: 16,
    },
    historyEntry: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    entryIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    entryInfo: { flex: 1 },
    entryType: {
      fontSize: 13,
      fontWeight: "700" as const,
      color: colors.foreground,
      letterSpacing: 0.5,
    },
    entryMeta: {
      fontSize: 10,
      color: colors.mutedForeground,
      letterSpacing: 1,
      marginTop: 2,
    },
    entryKm: {
      alignItems: "flex-end",
    },
    entryKmNum: {
      fontSize: 18,
      fontWeight: "800" as const,
      color: colors.primary,
      letterSpacing: -0.5,
    },
    entryKmUnit: {
      fontSize: 9,
      color: colors.mutedForeground,
      letterSpacing: 2,
    },
    injuryBadge: {
      backgroundColor: "#FF5F0022",
      borderRadius: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      marginTop: 3,
      alignSelf: "flex-start" as const,
    },
    injuryBadgeText: {
      fontSize: 8,
      color: colors.primary,
      fontWeight: "700" as const,
      letterSpacing: 1,
    },
  });

  const formatDateEntry = (iso: string) => {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, "0");
    const months = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    return `${day} ${months[d.getMonth()]} · Sem ${state.currentWeek}`;
  };

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.pageTitle}>HISTÓRICO</Text>
        <Text style={s.pageSubtitle}>Volume Semanal</Text>

        <StravaCard onSyncComplete={refreshHistory} />

        <View style={s.statsRow}>
          <View style={s.statCard}>
            <Text style={[s.statNum, { color: colors.primary }]}>{totalCompletedKm}</Text>
            <Text style={s.statLabel}>KM{"\n"}CONCLUÍDOS</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statNum, { color: "#4CAF50" }]}>{completedWeeks}</Text>
            <Text style={s.statLabel}>SEMANAS{"\n"}ATIVAS</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statNum, { color: "#2196F3" }]}>{history.length}</Text>
            <Text style={s.statLabel}>TREINOS{"\n"}FEITOS</Text>
          </View>
          <View style={s.statCard}>
            <Text style={[s.statNum, { color: "#9C27B0" }]}>{currentWeek}</Text>
            <Text style={s.statLabel}>SEMANA{"\n"}ATUAL</Text>
          </View>
        </View>

        {/* Novo motor de renderização Victory - Telemetria Blindada */}
        <WeeklyVolumeChart 
          weeklyCompleted={weeklyCompleted} 
          selectedWeek={selectedWeekFilter}
          onWeekSelect={setSelectedWeekFilter}
        />

        {selectedWeekFilter && (
          <Pressable 
            onPress={() => setSelectedWeekFilter(null)}
            style={{ alignSelf: 'flex-end', marginBottom: 10, padding: 4 }}
          >
            <Text style={{ color: colors.primary, fontSize: 10, fontWeight: 'bold', letterSpacing: 1 }}>
              LIMPAR FILTRO (SEMANA {selectedWeekFilter}) ✕
            </Text>
          </Pressable>
        )}

        {/* Implementação legada SVG (Pode ser removida após validação) */}
        <View style={s.chartCard}>
          <View style={s.chartHeader}>
            <Text style={s.chartTitle}>KM POR SEMANA — 16 SEMANAS</Text>
            <View style={s.modeToggle}>
              {(["volume", "cumulativo"] as ViewMode[]).map((m) => (
                <Pressable
                  key={m}
                  style={[
                    s.modeBtn,
                    { backgroundColor: mode === m ? colors.primary : "transparent" },
                  ]}
                  onPress={() => setMode(m)}
                >
                  <Text
                    style={[
                      s.modeBtnText,
                      { color: mode === m ? "#000" : colors.mutedForeground },
                    ]}
                  >
                    {m === "volume" ? "SEM" : "ACUM"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View
            style={{ height: CHART_HEIGHT }}
            onLayout={(e) => setChartWidth(e.nativeEvent.layout.width)}
          >
            <Svg width={chartWidth} height={CHART_HEIGHT}>
              <Defs>
                <LinearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#FF5F00" stopOpacity="1" />
                  <Stop offset="1" stopColor="#FF5F00" stopOpacity="0.3" />
                </LinearGradient>
                <LinearGradient id="targetGrad" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#333333" stopOpacity="1" />
                  <Stop offset="1" stopColor="#222222" stopOpacity="1" />
                </LinearGradient>
              </Defs>

              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const y = getY(maxVal * frac);
                const label = Math.round(maxVal * frac);
                return (
                  <React.Fragment key={frac}>
                    <Line
                      x1={CHART_PADDING_LEFT}
                      y1={y}
                      x2={chartWidth - 8}
                      y2={y}
                      stroke="#252525"
                      strokeWidth={1}
                    />
                    <SvgText
                      x={CHART_PADDING_LEFT - 4}
                      y={y + 4}
                      fill="#444"
                      fontSize={8}
                      textAnchor="end"
                    >
                      {label}
                    </SvgText>
                  </React.Fragment>
                );
              })}

              {Array.from({ length: 16 }, (_, i) => {
                const week = i + 1;
                const phase = getPhase(week);
                const phaseColor = getPhaseColor(phase);
                const targetVal = displayTarget[i] ?? 0;
                const completedVal = displayCompleted[i] ?? 0;
                const x = CHART_PADDING_LEFT + i * barGroupWidth + barGroupWidth / 2;
                const targetBarX = x - barWidth / 2;
                const completedBarX = x - barWidth / 2;
                const targetH = Math.max(2, ((targetVal / maxVal) * (innerHeight - 12)));
                const completedH = Math.max(0, ((completedVal / maxVal) * (innerHeight - 12)));
                const targetY = innerHeight - targetH;
                const completedY = innerHeight - completedH;
                const isCurrent = week === currentWeek;
                const showLabel = week === 1 || week % 4 === 0 || isCurrent;

                return (
                  <React.Fragment key={week}>
                    <Rect
                      x={targetBarX}
                      y={targetY}
                      width={barWidth}
                      height={targetH}
                      rx={BAR_RADIUS}
                      fill={isCurrent ? phaseColor + "30" : "#1E1E1E"}
                    />
                    {completedH > 0 && (
                      <Rect
                        x={completedBarX}
                        y={completedY}
                        width={barWidth}
                        height={completedH}
                        rx={BAR_RADIUS}
                        fill={isCurrent ? colors.primary : phaseColor}
                        opacity={isCurrent ? 1 : 0.85}
                      />
                    )}
                    {isCurrent && (
                      <Rect
                        x={targetBarX - 1}
                        y={targetY - 1}
                        width={barWidth + 2}
                        height={targetH + 2}
                        rx={BAR_RADIUS + 1}
                        fill="none"
                        stroke={colors.primary}
                        strokeWidth={1.5}
                      />
                    )}
                    {showLabel && (
                      <SvgText
                        x={x}
                        y={innerHeight + 16}
                        fill={isCurrent ? colors.primary : "#444"}
                        fontSize={8}
                        textAnchor="middle"
                        fontWeight={isCurrent ? "bold" : "normal"}
                      >
                        {week}
                      </SvgText>
                    )}
                  </React.Fragment>
                );
              })}

              {isCumulative && cumulativePath && (
                <Path
                  d={cumulativePath}
                  fill="none"
                  stroke={colors.primary}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {isCumulative &&
                displayCompleted.map((val, i) => {
                  if (val === 0) return null;
                  const x = CHART_PADDING_LEFT + i * barGroupWidth + barGroupWidth / 2;
                  const y = getY(val);
                  return (
                    <Circle
                      key={i}
                      cx={x}
                      cy={y}
                      r={3}
                      fill={i + 1 === currentWeek ? colors.primary : "#FF5F0088"}
                    />
                  );
                })}
            </Svg>
          </View>

          <View style={s.legendRow}>
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: "#1E1E1E", borderWidth: 1, borderColor: "#333" }]} />
              <Text style={s.legendText}>META</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: colors.primary }]} />
              <Text style={s.legendText}>CONCLUÍDO</Text>
            </View>
            <View style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: colors.primary, borderWidth: 1.5, borderColor: colors.primary }]} />
              <Text style={s.legendText}>SEMANA ATUAL</Text>
            </View>
          </View>
        </View>

        <View style={s.progressCard}>
          <View style={s.progressLabel}>
            <Text style={s.progressLabelText}>PROGRESSO TOTAL DO CICLO</Text>
            <Text style={s.progressLabelPct}>{progressPct}%</Text>
          </View>
          <View style={s.progressBarBg}>
            <View style={[s.progressBarFill, { width: `${progressPct}%` }]} />
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={[s.statLabel, { color: colors.primary, fontSize: 10 }]}>
              {totalCompletedKm}km concluídos
            </Text>
            <Text style={[s.statLabel, { fontSize: 10 }]}>
              Meta: {totalTargetKm}km
            </Text>
          </View>
        </View>

        {selectedWeekFilter && distributionData.length > 0 && (
          <View style={{ height: 160, alignItems: 'center', marginBottom: 20 }}>
            <Svg width={160} height={160}>
              {(() => {
                const total = distributionData.reduce((acc, d) => acc + (d.y ?? 0), 0);
                if (total <= 0) return null;

                const cx = 80;
                const cy = 80;
                const outerR = 64;
                const innerR = 38;

                let a = -Math.PI / 2;
                return distributionData.map((d, idx) => {
                  const value = clampNumber(Number(d.y ?? 0), 0, 999999);
                  const slice = (value / total) * Math.PI * 2;
                  const startAngle = a;
                  const endAngle = a + slice;
                  a = endAngle;

                  const path = donutSlicePath({
                    cx,
                    cy,
                    outerR,
                    innerR,
                    startAngle,
                    endAngle,
                  });

                  return (
                    <Path
                      key={`${d.x}-${idx}`}
                      d={path}
                      fill={DISTRIBUTION_COLORS[idx % DISTRIBUTION_COLORS.length]}
                      stroke={colors.background}
                      strokeWidth={2}
                    />
                  );
                });
              })()}
            </Svg>
            <View style={{ position: 'absolute', top: '42%', alignItems: 'center' }}>
               <Text style={{ color: colors.primary, fontSize: 10, fontWeight: '800' }}>MIX</Text>
               <Text style={{ color: colors.mutedForeground, fontSize: 8 }}>S{selectedWeekFilter}</Text>
            </View>
          </View>
        )}

        <Text style={s.sectionLabel}>
          {selectedWeekFilter 
            ? `TREINOS DA SEMANA ${selectedWeekFilter}` 
            : "TREINOS RECENTES"}
        </Text>

        {history.length === 0 ? (
          <View style={s.emptyState}>
            <Feather name="activity" size={32} color={colors.border} />
            <Text style={s.emptyTitle}>SEM HISTÓRICO AINDA</Text>
            <Text style={s.emptyDesc}>
              Complete seu primeiro treino na tela HOJE para começar a registrar seu progresso.
            </Text>
          </View>
        ) : (
          filteredHistory
            .slice(0, 20)
            .map((entry: WorkoutEntry, idx: number) => {
            const phase = getPhase(entry.week);
            const phaseColor = getPhaseColor(phase);
            const icon = WORKOUT_ICONS[entry.type] ?? "activity";
            const label = WORKOUT_LABELS[entry.type] ?? entry.type;
            const showKm = entry.type !== "forca" && entry.type !== "folga" && entry.distanceKm > 0;

            // Comparativo de Pace
            const actualPace = entry.distanceKm > 0 ? entry.durationMin / entry.distanceKm : 0;
            const paceDiff = actualPace - targetPace;
            const isFaster = paceDiff < -0.1; // Mais de 6 seg mais rápido
            const isSlower = paceDiff > 0.1;  // Mais de 6 seg mais lento
            const isOnTarget = !isFaster && !isSlower;

            return (
              <View key={idx} style={s.historyEntry}>
                <View style={[s.entryIcon, { backgroundColor: phaseColor + "22" }]}>
                  <Feather name={icon as any} size={16} color={phaseColor} />
                </View>
                <View style={s.entryInfo}>
                  <Text style={s.entryType}>{label}</Text>
                  <Text style={s.entryMeta}>
                    {formatDateEntry(entry.entryDate)} · {entry.durationMin}min
                  </Text>
                  {showKm && (
                    <Text style={{ fontSize: 9, fontWeight: '700', color: isFaster ? "#4CAF50" : isSlower ? "#FF5F00" : colors.mutedForeground, marginTop: 2 }}>
                      {isFaster ? "⚡ PACE ACIMA DA META" : isSlower ? "🐢 PACE ABAIXO DA META" : "🎯 PACE NA META"}
                    </Text>
                  )}
                  {entry.injuryAlert && (
                    <View style={s.injuryBadge}>
                      <Text style={s.injuryBadgeText}>{entry.injuryAlert.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
                <View style={s.entryKm}>
                  {showKm ? (
                    <>
                      <Text style={s.entryKmNum}>{entry.distanceKm}</Text>
                      <Text style={s.entryKmUnit}>KM</Text>
                    </>
                  ) : (
                    <Feather name={icon as any} size={20} color={colors.border} />
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}
