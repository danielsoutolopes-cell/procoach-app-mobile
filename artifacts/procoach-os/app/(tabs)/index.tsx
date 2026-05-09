import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAthlete, PostRaceRecovery } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";
import { RaceModeCard } from "@/components/RaceModeCard";
import { RecoveryBlockCard } from "@/components/RecoveryBlockCard";
import { SpotifyPlaylistCard } from "@/components/SpotifyPlaylistCard";
import { StravaCard } from "@/components/StravaCard";
import { ProCoachAPI } from "@/services/api";
import { Race } from "@/context/AthleteContext";
import {
  formatDistance,
  formatDateBR,
  getDaysUntilRace,
  getPhase,
  getPhaseColor,
  getWeekInBlock,
  getWeeklyVolume,
} from "@/utils/training";
import {
  calcEstimatedTimeMin,
  calcGelCount,
  calcLogisticsTimes,
  formatDuration,
  RACE_ROLE,
} from "@/utils/raceLogistics";

const WORKOUT_ICONS: Record<string, string> = {
  corrida: "activity",
  bike: "wind",
  regenerativo: "heart",
  forca: "zap",
  folga: "moon",
};

const WORKOUT_LABELS: Record<string, string> = {
  corrida: "CORRIDA",
  bike: "BIKE INDOLOR",
  regenerativo: "REGENERATIVO",
  forca: "FORÇA",
  folga: "DESCANSO",
};

function getCalendarDayOffset(finishedAt: string): number {
  const finishDay = finishedAt.slice(0, 10);
  const todayDay = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return Math.round(
    (new Date(todayDay).getTime() - new Date(finishDay).getTime()) / (24 * 60 * 60 * 1000)
  );
}

function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function promptGelUsage(opts: {
  title: string;
  onSelect: (gelsUsed: number) => void;
}) {
  const askLast = (from: number) => {
    Alert.alert(opts.title, "Quantos géis você usou?", [
      { text: String(from), onPress: () => opts.onSelect(from) },
      { text: String(from + 1), onPress: () => opts.onSelect(from + 1) },
      { text: String(from + 2), onPress: () => opts.onSelect(from + 2) },
    ]);
  };
  const ask4Plus = () => {
    Alert.alert(opts.title, "Quantos géis você usou?", [
      { text: "4", onPress: () => opts.onSelect(4) },
      { text: "5", onPress: () => opts.onSelect(5) },
      { text: "6+", onPress: () => askLast(6) },
    ]);
  };
  const ask2Plus = () => {
    Alert.alert(opts.title, "Quantos géis você usou?", [
      { text: "2", onPress: () => opts.onSelect(2) },
      { text: "3", onPress: () => opts.onSelect(3) },
      { text: "4+", onPress: () => ask4Plus() },
    ]);
  };
  Alert.alert(opts.title, "Quantos géis você usou?", [
    { text: "0", onPress: () => opts.onSelect(0) },
    { text: "1", onPress: () => opts.onSelect(1) },
    { text: "2+", onPress: () => ask2Plus() },
  ]);
}

function promptRPE(opts: { onSelect: (rpe: number) => void }) {
  const ask910 = () => {
    Alert.alert("Debrief", "RPE (esforço percebido)?", [
      { text: "9", onPress: () => opts.onSelect(9) },
      { text: "10", onPress: () => opts.onSelect(10) },
      { text: "Voltar", onPress: () => askStrong() },
    ]);
  };
  const askStrong = () => {
    Alert.alert("Debrief", "RPE (esforço percebido)?", [
      { text: "7", onPress: () => opts.onSelect(7) },
      { text: "8", onPress: () => opts.onSelect(8) },
      { text: "9-10", onPress: () => ask910() },
    ]);
  };
  const askMid = () => {
    Alert.alert("Debrief", "RPE (esforço percebido)?", [
      { text: "4", onPress: () => opts.onSelect(4) },
      { text: "5", onPress: () => opts.onSelect(5) },
      { text: "6", onPress: () => opts.onSelect(6) },
    ]);
  };
  const askEasy = () => {
    Alert.alert("Debrief", "RPE (esforço percebido)?", [
      { text: "1", onPress: () => opts.onSelect(1) },
      { text: "2", onPress: () => opts.onSelect(2) },
      { text: "3", onPress: () => opts.onSelect(3) },
    ]);
  };
  Alert.alert("Debrief", "RPE (esforço percebido)?", [
    { text: "Leve (1-3)", onPress: () => askEasy() },
    { text: "Médio (4-6)", onPress: () => askMid() },
    { text: "Forte (7-10)", onPress: () => askStrong() },
  ]);
}

function promptPain(opts: { onSelect: (pain: number) => void }) {
  const ask45 = () => {
    Alert.alert("Debrief", "Dor articular (0–5)?", [
      { text: "4", onPress: () => opts.onSelect(4) },
      { text: "5", onPress: () => opts.onSelect(5) },
      { text: "Voltar", onPress: () => ask23() },
    ]);
  };
  const ask23 = () => {
    Alert.alert("Debrief", "Dor articular (0–5)?", [
      { text: "2", onPress: () => opts.onSelect(2) },
      { text: "3", onPress: () => opts.onSelect(3) },
      { text: "4-5", onPress: () => ask45() },
    ]);
  };
  Alert.alert("Debrief", "Dor articular (0–5)?", [
    { text: "0", onPress: () => opts.onSelect(0) },
    { text: "1", onPress: () => opts.onSelect(1) },
    { text: "2+", onPress: () => ask23() },
  ]);
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    state, markWorkoutComplete, regenerateWorkout,
    recoveryBlock, setRecoveryBlock, clearRecoveryBlock,
  } = useAthlete();
  const { todayWorkout, currentWeek, hrv, painLevel, profile, aiLoading } = state;

  const [dayWeather, setDayWeather] = React.useState<{
    emoji: string;
    minC: number;
    maxC: number;
    windKmH: number;
    rainPct: number;
  } | null>(null);
  const [dayWeatherLoading, setDayWeatherLoading] = React.useState(false);
  const [planToday, setPlanToday] = React.useState<null | {
    session_date: string;
    day_name: string | null;
    activity: string;
    pace_target: string | null;
    treadmill_speed: string | null;
    rest_interval: string | null;
    structure: string | null;
    planned_km?: number;
  }>(null);
  const [planTodayLoading, setPlanTodayLoading] = React.useState(false);

  // Race happening today (day of race — race mode)
  const todayRace = React.useMemo(() => {
    const races = profile.races ?? [];
    return races.find((r) => getDaysUntilRace(r.date) === 0) ?? null;
  }, [profile.races]);

  // Races happening within 2 days (pre-race banners, excludes today since todayRace handles that)
  const upcomingRaces = React.useMemo(() => {
    const races = profile.races ?? [];
    return races.filter((r) => {
      const d = getDaysUntilRace(r.date);
      return d >= 1 && d <= 2;
    });
  }, [profile.races]);

  // ── Recovery block state ───────────────────────────────────────────────────
  const recoveryDayOffset = recoveryBlock ? getCalendarDayOffset(recoveryBlock.finishedAt) : 0;
  const isInRecovery = recoveryBlock !== null && recoveryDayOffset >= 1 && recoveryDayOffset <= recoveryBlock.totalDays;
  const isRecoveryExpired = recoveryBlock !== null && recoveryDayOffset > recoveryBlock.totalDays;
  const recoveryWorkoutCompleted = recoveryBlock?.completedDayOffsets?.includes(recoveryDayOffset) ?? false;

  const requestDebrief = React.useCallback((context: string) => {
    Alert.alert("Debrief", "Quer registrar RPE e dor agora?", [
      { text: "Depois", style: "cancel" },
      {
        text: "Agora",
        onPress: () => {
          promptRPE({
            onSelect: (rpe) => {
              promptPain({
                onSelect: async (pain) => {
                  try {
                    await ProCoachAPI.logWorkoutFeedback({
                      date: getSaoPauloDayKey(),
                      rpe,
                      painLevel: pain,
                      notes: context,
                    });
                  } catch {}
                },
              });
            },
          });
        },
      },
    ]);
  }, []);

  const handleRaceFinished = React.useCallback(async (finishDurationSec: number, race: Race) => {
    try {
      const result = await ProCoachAPI.generatePostRaceRecovery({
        raceName: race.name,
        raceDistanceKm: race.distanceKm,
        finishDurationSec,
        currentWeek,
      });
      const block: PostRaceRecovery = {
        raceId: race.id,
        raceName: race.name,
        raceDistanceKm: race.distanceKm,
        finishDurationSec,
        finishedAt: new Date().toISOString(),
        totalDays: result.totalDays,
        days: result.recoveryDays as any,
        completedDayOffsets: [],
      };
      await setRecoveryBlock(block);
    } catch {}

    promptGelUsage({
      title: "Prova concluída",
      onSelect: async (gelsUsed) => {
        try {
          await ProCoachAPI.logGelUsage({
            date: getSaoPauloDayKey(),
            context: `race:${race.id}`,
            gelsUsed,
          });
        } catch {}
        requestDebrief(`race:${race.id}`);
      },
    });
  }, [currentWeek, setRecoveryBlock, requestDebrief]);

  const handleRecoveryComplete = React.useCallback(async () => {
    if (!recoveryBlock) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated: PostRaceRecovery = {
      ...recoveryBlock,
      completedDayOffsets: [...(recoveryBlock.completedDayOffsets ?? []), recoveryDayOffset],
    };
    await setRecoveryBlock(updated);
  }, [recoveryBlock, recoveryDayOffset, setRecoveryBlock]);

  const phase = getPhase(currentWeek);
  const phaseColor = getPhaseColor(phase);
  const weekInBlock = getWeekInBlock(currentWeek);
  const weeklyVolume = getWeeklyVolume(currentWeek);
  const daysUntilRace = getDaysUntilRace(profile.targetRaceDate);
  const progress = currentWeek / 16;

  const now = new Date();
  const dayNames = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
  const monthNames = ["JAN","FEV","MAR","ABR","MAI","JUN","JUL","AGO","SET","OUT","NOV","DEZ"];
  const todayLabel = `${dayNames[now.getDay()]} ${now.getDate()} ${monthNames[now.getMonth()]}`;

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setDayWeatherLoading(true);
      try {
        const lat = -23.6087;
        const lon = -46.6676;
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
          `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode` +
          `&timezone=America%2FSao_Paulo&forecast_days=1`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = (await res.json()) as {
          daily?: {
            temperature_2m_max: number[];
            temperature_2m_min: number[];
            precipitation_probability_max: number[];
            windspeed_10m_max: number[];
            weathercode: number[];
          };
        };
        const d = data.daily;
        if (!d) return;
        const code = d.weathercode?.[0] ?? 0;
        const emoji = code === 0 ? "☀️" : code <= 3 ? "⛅" : code <= 67 ? "🌧️" : "⛈️";
        const payload = {
          emoji,
          minC: Math.round(d.temperature_2m_min?.[0] ?? 0),
          maxC: Math.round(d.temperature_2m_max?.[0] ?? 0),
          windKmH: Math.round(d.windspeed_10m_max?.[0] ?? 0),
          rainPct: Math.round(d.precipitation_probability_max?.[0] ?? 0),
        };
        if (!cancelled) setDayWeather(payload);
      } catch {
      } finally {
        if (!cancelled) setDayWeatherLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setPlanTodayLoading(true);
      try {
        const r = await ProCoachAPI.getPlanToday();
        if (!cancelled) setPlanToday(r.session ?? null);
      } catch {
      } finally {
        if (!cancelled) setPlanTodayLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleComplete = async () => {
    if (todayWorkout.completed) return;
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await markWorkoutComplete();

    const estimatedMin =
      todayWorkout.durationMin > 0
        ? todayWorkout.durationMin
        : calcEstimatedTimeMin(todayWorkout.distanceKm, 6.75);
    const isLongao =
      todayWorkout.type === "corrida" && (todayWorkout.distanceKm >= 12 || estimatedMin >= 70);

    if (isLongao) {
      promptGelUsage({
        title: "Longão concluído",
        onSelect: async (gelsUsed) => {
          try {
            await ProCoachAPI.logGelUsage({
              date: getSaoPauloDayKey(),
              context: "longao",
              gelsUsed,
            });
          } catch {}
          requestDebrief("longao");
        },
      });
    } else {
      requestDebrief("workout");
    }
  };

  const s = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop:
        Platform.OS === "web"
          ? insets.top + 67
          : insets.top + 16,
      paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 24,
    },
    appTitle: {
      fontSize: 11,
      fontWeight: "800" as const,
      letterSpacing: 3,
      color: colors.primary,
    },
    dateLabel: {
      fontSize: 11,
      fontWeight: "600" as const,
      letterSpacing: 2,
      color: colors.mutedForeground,
    },
    raceCountdown: {
      alignItems: "flex-end",
    },
    raceCountdownNum: {
      fontSize: 22,
      fontWeight: "800" as const,
      color: colors.primary,
      letterSpacing: -1,
    },
    raceCountdownLabel: {
      fontSize: 9,
      letterSpacing: 2,
      color: colors.mutedForeground,
    },
    cycleCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 18,
      marginBottom: 16,
    },
    cycleRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    cycleLeft: {
      gap: 2,
    },
    cycleWeekLabel: {
      fontSize: 11,
      letterSpacing: 3,
      color: colors.mutedForeground,
    },
    cycleWeekNum: {
      fontSize: 28,
      fontWeight: "800" as const,
      color: colors.foreground,
      letterSpacing: -1,
    },
    cycleWeekOf: {
      fontSize: 11,
      letterSpacing: 2,
      color: colors.mutedForeground,
    },
    phaseBadge: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
      alignItems: "center",
    },
    phaseBadgeText: {
      fontSize: 10,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    phaseSubText: {
      fontSize: 9,
      letterSpacing: 1,
      marginTop: 2,
    },
    progressBarBg: {
      height: 4,
      backgroundColor: colors.border,
      borderRadius: 2,
      overflow: "hidden",
    },
    progressBarFill: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.primary,
    },
    statsRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 12,
    },
    statItem: {
      alignItems: "center",
      gap: 2,
    },
    statNum: {
      fontSize: 16,
      fontWeight: "700" as const,
      color: colors.foreground,
    },
    statLabel: {
      fontSize: 9,
      letterSpacing: 2,
      color: colors.mutedForeground,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 12,
    },
    injuryCard: {
      backgroundColor: "#1A0A00",
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: "#FF5F00",
      padding: 16,
      marginBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    injuryTextBlock: {
      flex: 1,
    },
    injuryTitle: {
      fontSize: 10,
      letterSpacing: 3,
      color: colors.primary,
      fontWeight: "800" as const,
      marginBottom: 2,
    },
    injuryDesc: {
      fontSize: 12,
      color: "#FFAA70",
      lineHeight: 16,
    },
    workoutCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: todayWorkout.completed ? "#FF5F0033" : colors.border,
      padding: 20,
      marginBottom: 16,
    },
    workoutHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 16,
    },
    workoutLabel: {
      fontSize: 10,
      letterSpacing: 3,
      color: colors.mutedForeground,
    },
    workoutType: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 4,
    },
    workoutTypeName: {
      fontSize: 18,
      fontWeight: "800" as const,
      color: colors.foreground,
      letterSpacing: 1,
    },
    workoutDistanceBlock: {
      alignItems: "flex-end",
    },
    workoutDistanceNum: {
      fontSize: 42,
      fontWeight: "800" as const,
      color: colors.primary,
      lineHeight: 44,
      letterSpacing: -2,
    },
    workoutDistanceUnit: {
      fontSize: 14,
      color: colors.primary,
      letterSpacing: 2,
    },
    workoutDesc: {
      fontSize: 13,
      color: colors.mutedForeground,
      lineHeight: 20,
      marginBottom: 16,
    },
    workoutMeta: {
      flexDirection: "row",
      gap: 20,
      marginBottom: 20,
    },
    workoutMetaItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    workoutMetaText: {
      fontSize: 12,
      color: colors.mutedForeground,
      letterSpacing: 1,
    },
    completeBtn: {
      backgroundColor: todayWorkout.completed
        ? colors.border
        : colors.primary,
      borderRadius: colors.radius - 2,
      paddingVertical: 14,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
    },
    completeBtnText: {
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 3,
      color: todayWorkout.completed ? colors.mutedForeground : "#000000",
    },
    sectionTitle: {
      fontSize: 10,
      letterSpacing: 3,
      color: colors.mutedForeground,
      marginBottom: 12,
    },
    hrvCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    hrvItem: {
      alignItems: "center",
      flex: 1,
    },
    hrvNum: {
      fontSize: 24,
      fontWeight: "800" as const,
      letterSpacing: -1,
    },
    hrvLabel: {
      fontSize: 9,
      letterSpacing: 2,
      color: colors.mutedForeground,
      marginTop: 2,
    },
    hrvDivider: {
      width: 1,
      height: 40,
      backgroundColor: colors.border,
    },
    dayWeatherCard: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
  });

  const workoutIcon = WORKOUT_ICONS[todayWorkout.type] ?? "activity";
  const workoutLabel = WORKOUT_LABELS[todayWorkout.type] ?? "TREINO";
  const distKm = formatDistance(todayWorkout.distanceKm);
  const showDistance = todayWorkout.type !== "forca" && todayWorkout.type !== "folga" && distKm > 0;
  const estimatedMinForGels =
    todayWorkout.durationMin > 0
      ? todayWorkout.durationMin
      : calcEstimatedTimeMin(todayWorkout.distanceKm, 6.75);
  const isLongaoForGels =
    todayWorkout.type === "corrida" && (todayWorkout.distanceKm >= 12 || estimatedMinForGels >= 70);
  const recommendedGels = isLongaoForGels ? calcGelCount(estimatedMinForGels) : 0;

  const hrvColor = hrv >= 65 ? "#4CAF50" : hrv >= 50 ? "#FF9800" : "#EF4444";
  const painColor = painLevel === 0 ? "#4CAF50" : painLevel <= 2 ? "#FF9800" : "#EF4444";

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={s.appTitle}>PROCOACH OS V5.1</Text>
            <Text style={s.dateLabel}>{todayLabel}</Text>
          </View>
          <View style={s.raceCountdown}>
            <Text style={s.raceCountdownNum}>{daysUntilRace}</Text>
            <Text style={s.raceCountdownLabel}>DIAS P/ PROVA</Text>
          </View>
        </View>

        <View style={s.cycleCard}>
          <View style={s.cycleRow}>
            <View style={s.cycleLeft}>
              <Text style={s.cycleWeekLabel}>SEMANA</Text>
              <Text style={s.cycleWeekNum}>
                {currentWeek}{" "}
                <Text style={s.cycleWeekOf}>DE 16</Text>
              </Text>
            </View>
            <View style={[s.phaseBadge, { backgroundColor: phaseColor + "22" }]}>
              <Text style={[s.phaseBadgeText, { color: phaseColor }]}>
                {phase.toUpperCase()}
              </Text>
              <Text style={[s.phaseSubText, { color: phaseColor + "AA" }]}>
                BLOCO {Math.ceil(currentWeek / 4)} · SEM {weekInBlock}/4
              </Text>
            </View>
          </View>
          <View style={s.progressBarBg}>
            <View style={[s.progressBarFill, { width: `${progress * 100}%` }]} />
          </View>
          <View style={s.statsRow}>
            <View style={s.statItem}>
              <Text style={s.statNum}>{weeklyVolume}km</Text>
              <Text style={s.statLabel}>VOL/SEM</Text>
            </View>
            <View style={s.statItem}>
              <Text style={[s.statNum, { color: phaseColor }]}>{phase}</Text>
              <Text style={s.statLabel}>FASE</Text>
            </View>
            <View style={s.statItem}>
              <Text style={s.statNum}>{formatDateBR(profile.targetRaceDate)}</Text>
              <Text style={s.statLabel}>PROVA ALVO</Text>
            </View>
          </View>
        </View>

        <View style={s.dayWeatherCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ fontSize: 24 }}>{dayWeather?.emoji ?? "🌤️"}</Text>
            <View>
              <Text style={{ fontSize: 9, letterSpacing: 3, fontWeight: "800" as const, color: colors.mutedForeground }}>
                PREVISÃO DE HOJE
              </Text>
              {dayWeather ? (
                <Text style={{ fontSize: 12, color: colors.foreground, marginTop: 4 }}>
                  {dayWeather.minC}°–{dayWeather.maxC}° · 💧 {dayWeather.rainPct}% · 💨 {dayWeather.windKmH}km/h
                </Text>
              ) : (
                <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
                  {dayWeatherLoading ? "Buscando previsão..." : "Previsão indisponível"}
                </Text>
              )}
            </View>
          </View>
          {dayWeatherLoading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
        </View>

        {(planTodayLoading || planToday) && (
          <View style={s.dayWeatherCard}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
              <Text style={{ fontSize: 22 }}>📋</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 9, letterSpacing: 3, fontWeight: "800" as const, color: colors.mutedForeground }}>
                  PLANO DE HOJE
                </Text>
                {planToday ? (
                  <>
                    <Text style={{ fontSize: 12, color: colors.foreground, marginTop: 4, fontWeight: "800" as const }}>
                      {planToday.activity}{planToday.planned_km ? ` · ${planToday.planned_km}km` : ""}
                    </Text>
                    {(planToday.pace_target || planToday.rest_interval || planToday.structure) && (
                      <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4, lineHeight: 16 }}>
                        {planToday.pace_target ? `Pace: ${planToday.pace_target}` : ""}
                        {planToday.pace_target && planToday.rest_interval ? " · " : ""}
                        {planToday.rest_interval ? `Rep: ${planToday.rest_interval}` : ""}
                        {(planToday.pace_target || planToday.rest_interval) && planToday.structure ? " · " : ""}
                        {planToday.structure ?? ""}
                      </Text>
                    )}
                  </>
                ) : (
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 4 }}>
                    {planTodayLoading ? "Buscando plano..." : "Nenhum treino importado para hoje"}
                  </Text>
                )}
              </View>
            </View>
            {planTodayLoading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          </View>
        )}

        {/* ── PRE-RACE BANNERS (≤2 days) ──────────── */}
        {upcomingRaces.map((race) => {
          const col = race.priority === "P1" ? "#FF5F00" : race.priority === "P2" ? "#2196F3" : "#9C27B0";
          const daysUntil = getDaysUntilRace(race.date);
          const paceMinKm = race.targetPaceMinKm ?? 6;
          const estimatedMin = calcEstimatedTimeMin(race.distanceKm, paceMinKm);
          const gels = calcGelCount(estimatedMin);
          const times = race.raceStartTime ? calcLogisticsTimes(race.raceStartTime, 30) : null;
          return (
            <View key={race.id} style={{
              backgroundColor: col + "0D", borderRadius: colors.radius,
              borderWidth: 1.5, borderColor: col + "66", padding: 16, marginBottom: 16,
            }}>
              <Text style={{ fontSize: 8, letterSpacing: 3, fontWeight: "800" as const, color: col, marginBottom: 4 }}>
                🏁 {daysUntil === 0 ? "DIA DA PROVA!" : daysUntil === 1 ? "PROVA AMANHÃ!" : "PROVA EM 2 DIAS — LOGÍSTICA ATIVA"}
              </Text>
              <Text style={{ fontSize: 15, fontWeight: "800" as const, color: colors.foreground, letterSpacing: -0.5, marginBottom: 10 }}>
                {race.name} · {race.priority} · {race.distanceKm}km
              </Text>
              <View style={{ flexDirection: "row", gap: 10, marginBottom: times ? 12 : 0 }}>
                <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, padding: 8, alignItems: "center" }}>
                  <Text style={{ fontSize: 16, fontWeight: "800" as const, color: col }}>{race.distanceKm}km</Text>
                  <Text style={{ fontSize: 8, letterSpacing: 2, color: colors.mutedForeground }}>DIST</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, padding: 8, alignItems: "center" }}>
                  <Text style={{ fontSize: 16, fontWeight: "800" as const, color: colors.foreground }}>{formatDuration(estimatedMin)}</Text>
                  <Text style={{ fontSize: 8, letterSpacing: 2, color: colors.mutedForeground }}>ESTIMADO</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, padding: 8, alignItems: "center" }}>
                  <Text style={{ fontSize: 16, fontWeight: "800" as const, color: "#4CAF50" }}>{gels}</Text>
                  <Text style={{ fontSize: 8, letterSpacing: 2, color: colors.mutedForeground }}>GÉIS</Text>
                </View>
              </View>
              {times && (
                <View style={{ backgroundColor: colors.card, borderRadius: 8, padding: 10, gap: 4 }}>
                  {[
                    { icon: "🌅", label: "Acordar", time: times.wakeUp },
                    { icon: "🚗", label: "Sair de casa", time: times.leaveHome },
                    { icon: "🏁", label: "Largada", time: times.raceStart },
                  ].map((item, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Text style={{ width: 18, fontSize: 12, textAlign: "center" }}>{item.icon}</Text>
                      <Text style={{ fontSize: 14, fontWeight: "800" as const, color: col, width: 44 }}>{item.time}</Text>
                      <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{item.label}</Text>
                    </View>
                  ))}
                </View>
              )}
              <Text style={{ fontSize: 9, color: colors.mutedForeground, marginTop: 8, letterSpacing: 1 }}>
                Veja a logística completa em PROVAS →
              </Text>
            </View>
          );
        })}

        {/* ── RACE MODE (day of race) ───────────────── */}
        {todayRace ? (
          <RaceModeCard
            race={todayRace}
            onRaceFinished={(sec) => handleRaceFinished(sec, todayRace)}
          />
        ) : (isInRecovery || isRecoveryExpired) && recoveryBlock ? (
          <RecoveryBlockCard
            recoveryBlock={recoveryBlock}
            onComplete={handleRecoveryComplete}
            onClear={clearRecoveryBlock}
            workoutCompleted={recoveryWorkoutCompleted}
          />
        ) : (
          <>
        {todayWorkout.injuryAlert && (
          <View style={s.injuryCard}>
            <Feather name="alert-triangle" size={20} color="#FF5F00" />
            <View style={s.injuryTextBlock}>
              <Text style={s.injuryTitle}>ALERTA DE PREVENÇÃO</Text>
              <Text style={s.injuryDesc}>
                Treino ajustado: <Text style={{ fontWeight: "700" as const }}>{todayWorkout.injuryAlert}</Text>
                {"\n"}VFC/Dor indicam necessidade de recuperação.
              </Text>
            </View>
          </View>
        )}

        <View style={s.workoutCard}>
          {aiLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 32, gap: 12 }}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={{ fontSize: 10, letterSpacing: 3, color: colors.mutedForeground, fontWeight: "700" as const }}>
                IA GERANDO TREINO...
              </Text>
            </View>
          ) : (
            <>
              <View style={s.workoutHeader}>
                <View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                    <Text style={s.workoutLabel}>TREINO DO DIA</Text>
                    {todayWorkout.aiGenerated && (
                      <View style={{ backgroundColor: colors.primary + "22", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 8, fontWeight: "800" as const, color: colors.primary, letterSpacing: 1 }}>✦ IA</Text>
                      </View>
                    )}
                  </View>
                  <View style={s.workoutType}>
                    <Feather
                      name={workoutIcon as any}
                      size={16}
                      color={todayWorkout.injuryAlert ? "#FF9800" : colors.primary}
                    />
                    <Text style={[s.workoutTypeName, todayWorkout.injuryAlert ? { color: "#FF9800" } : {}]}>
                      {workoutLabel}
                    </Text>
                  </View>
                </View>
                {showDistance ? (
                  <View style={s.workoutDistanceBlock}>
                    <Text style={s.workoutDistanceNum}>{distKm}</Text>
                    <Text style={s.workoutDistanceUnit}>KM</Text>
                  </View>
                ) : (
                  <View style={s.workoutDistanceBlock}>
                    <Feather name={workoutIcon as any} size={36} color={colors.border} />
                  </View>
                )}
              </View>

              <Text style={s.workoutDesc}>{todayWorkout.description}</Text>

              {todayWorkout.aiReasoning ? (
                <View style={{ backgroundColor: colors.secondary, borderRadius: 8, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, letterSpacing: 0.5, lineHeight: 15, fontStyle: "italic" as const }}>
                    {todayWorkout.aiReasoning}
                  </Text>
                </View>
              ) : null}

              {todayWorkout.durationMin > 0 && (
                <View style={s.workoutMeta}>
                  <View style={s.workoutMetaItem}>
                    <Feather name="clock" size={13} color={colors.mutedForeground} />
                    <Text style={s.workoutMetaText}>{todayWorkout.durationMin} MIN</Text>
                  </View>
                  {showDistance && (
                    <View style={s.workoutMetaItem}>
                      <Feather name="map" size={13} color={colors.mutedForeground} />
                      <Text style={s.workoutMetaText}>{distKm} KM INTEIROS</Text>
                    </View>
                  )}
                </View>
              )}

              {isLongaoForGels && recommendedGels > 0 && (
                <View style={{ backgroundColor: colors.secondary, borderRadius: 8, padding: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, letterSpacing: 0.5, lineHeight: 15 }}>
                    🍬 Recomendação de géis: 1º após 1h, depois a cada 30min · Total sugerido:{" "}
                    <Text style={{ fontWeight: "700" as const, color: colors.foreground }}>
                      {recommendedGels}
                    </Text>
                  </Text>
                </View>
              )}
            </>
          )}

          {!aiLoading && (
            <>
              <Pressable
                style={({ pressed }) => [s.completeBtn, { opacity: pressed ? 0.8 : 1 }]}
                onPress={handleComplete}
                disabled={todayWorkout.completed}
              >
                <Feather
                  name={todayWorkout.completed ? "check-circle" : "check"}
                  size={15}
                  color={todayWorkout.completed ? colors.mutedForeground : "#000000"}
                />
                <Text style={s.completeBtnText}>
                  {todayWorkout.completed ? "CONCLUÍDO" : "MARCAR CONCLUÍDO"}
                </Text>
              </Pressable>
              {!todayWorkout.completed && (
                <Pressable
                  style={({ pressed }) => [{
                    marginTop: 8,
                    flexDirection: "row" as const,
                    alignItems: "center" as const,
                    justifyContent: "center" as const,
                    gap: 6,
                    paddingVertical: 10,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.border,
                    opacity: pressed ? 0.6 : 1,
                  }]}
                  onPress={regenerateWorkout}
                >
                  <Feather name="refresh-cw" size={12} color={colors.mutedForeground} />
                  <Text style={{ fontSize: 10, fontWeight: "700" as const, letterSpacing: 1.5, color: colors.mutedForeground }}>
                    GERAR NOVO TREINO COM IA
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </View>
          </>
        )}

        <StravaCard />

        <SpotifyPlaylistCard workoutType={todayWorkout.type} />

        <Text style={s.sectionTitle}>MONITORAMENTO</Text>
        <View style={s.hrvCard}>
          <View style={s.hrvItem}>
            <Text style={[s.hrvNum, { color: hrvColor }]}>{hrv}</Text>
            <Text style={s.hrvLabel}>VFC (ms)</Text>
          </View>
          <View style={s.hrvDivider} />
          <View style={s.hrvItem}>
            <Text style={[s.hrvNum, { color: painColor }]}>{painLevel}/5</Text>
            <Text style={s.hrvLabel}>DOR</Text>
          </View>
          <View style={s.hrvDivider} />
          <View style={s.hrvItem}>
            <Text style={[s.hrvNum, { color: phaseColor }]}>{weeklyVolume}</Text>
            <Text style={s.hrvLabel}>KM/SEM</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
