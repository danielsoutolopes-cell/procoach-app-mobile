import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { PostRaceRecovery, WorkoutType } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatHMS(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0
    ? `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`
    : `${m}m${String(s).padStart(2, "0")}s`;
}

function getCalendarDayOffset(finishedAt: string): number {
  const finishDay = finishedAt.slice(0, 10);
  const todayDay = new Date()
    .toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const diffMs =
    new Date(todayDay).getTime() - new Date(finishDay).getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}

const TYPE_ICON: Record<WorkoutType, string> = {
  corrida: "activity",
  bike: "wind",
  regenerativo: "heart",
  forca: "zap",
  folga: "moon",
};

const TYPE_LABEL: Record<WorkoutType, string> = {
  corrida: "CORRIDA LEVE",
  bike: "BIKE INDOLOR",
  regenerativo: "REGENERATIVO",
  forca: "FORÇA",
  folga: "DESCANSO TOTAL",
};

const TYPE_COLOR: Record<WorkoutType, string> = {
  corrida: "#4CAF50",
  bike: "#2196F3",
  regenerativo: "#00BCD4",
  forca: "#FF9800",
  folga: "#9E9E9E",
};

// ─── COMPONENT ────────────────────────────────────────────────────────────────

interface Props {
  recoveryBlock: PostRaceRecovery;
  onComplete: () => void;
  onClear: () => void;
  workoutCompleted: boolean;
}

export function RecoveryBlockCard({
  recoveryBlock,
  onComplete,
  onClear,
  workoutCompleted,
}: Props) {
  const colors = useColors();
  const ACCENT = "#4CAF50";

  const dayOffset = getCalendarDayOffset(recoveryBlock.finishedAt);
  const todayRecovery = recoveryBlock.days.find((d) => d.dayOffset === dayOffset);
  const isExpired = dayOffset > recoveryBlock.totalDays;

  const handleComplete = async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onComplete();
  };

  const handleClear = async () => {
    await Haptics.selectionAsync();
    onClear();
  };

  const s = StyleSheet.create({
    card: {
      backgroundColor: "#001A00",
      borderRadius: colors.radius,
      borderWidth: 2,
      borderColor: ACCENT + "88",
      padding: 20,
      marginBottom: 16,
    },
    tag: {
      fontSize: 8,
      letterSpacing: 4,
      fontWeight: "800" as const,
      color: ACCENT,
      marginBottom: 4,
    },
    raceName: {
      fontSize: 16,
      fontWeight: "800" as const,
      color: colors.foreground,
      letterSpacing: -0.5,
      marginBottom: 2,
    },
    raceMeta: {
      fontSize: 11,
      color: colors.mutedForeground,
      marginBottom: 14,
    },
    divider: {
      height: 1,
      backgroundColor: ACCENT + "33",
      marginBottom: 14,
    },
    dayRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      marginBottom: 12,
    },
    dayLabel: {
      fontSize: 10,
      letterSpacing: 3,
      color: ACCENT,
      fontWeight: "800" as const,
    },
    dayCount: {
      fontSize: 10,
      letterSpacing: 2,
      color: colors.mutedForeground,
    },
    dotsRow: {
      flexDirection: "row" as const,
      gap: 6,
      marginBottom: 16,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    workoutBox: {
      backgroundColor: "#002200",
      borderRadius: 10,
      padding: 14,
      marginBottom: 14,
      gap: 6,
    },
    workoutTypeRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
    },
    workoutTypeName: {
      fontSize: 16,
      fontWeight: "800" as const,
      letterSpacing: 1,
    },
    distRow: {
      flexDirection: "row" as const,
      gap: 14,
      marginTop: 4,
    },
    distItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 5,
    },
    distText: {
      fontSize: 11,
      letterSpacing: 1,
      color: colors.mutedForeground,
    },
    desc: {
      fontSize: 12,
      color: colors.mutedForeground,
      lineHeight: 18,
      marginTop: 4,
    },
    completeBtn: {
      borderRadius: colors.radius - 2,
      paddingVertical: 14,
      alignItems: "center" as const,
      flexDirection: "row" as const,
      justifyContent: "center" as const,
      gap: 8,
    },
    completeBtnText: {
      fontSize: 11,
      fontWeight: "800" as const,
      letterSpacing: 3,
    },
    clearLink: {
      alignItems: "center" as const,
      paddingVertical: 10,
      marginTop: 4,
    },
    clearLinkText: {
      fontSize: 10,
      color: colors.mutedForeground,
      letterSpacing: 1,
    },
    expiredBox: {
      alignItems: "center" as const,
      paddingVertical: 20,
      gap: 8,
    },
    expiredTitle: {
      fontSize: 13,
      fontWeight: "800" as const,
      color: ACCENT,
      letterSpacing: 2,
    },
    expiredSub: {
      fontSize: 11,
      color: colors.mutedForeground,
      textAlign: "center" as const,
    },
  });

  const finishTime = formatHMS(recoveryBlock.finishDurationSec);
  const progressDots = Array.from({ length: recoveryBlock.totalDays }, (_, i) => {
    const off = i + 1;
    return {
      offset: off,
      done: off < dayOffset,
      active: off === dayOffset,
    };
  });

  if (isExpired) {
    return (
      <View style={s.card}>
        <Text style={s.tag}>✅ RECUPERAÇÃO CONCLUÍDA</Text>
        <Text style={s.raceName}>{recoveryBlock.raceName}</Text>
        <View style={s.divider} />
        <View style={s.expiredBox}>
          <Text style={s.expiredTitle}>Recuperação completa! 🎉</Text>
          <Text style={s.expiredSub}>
            Você concluiu {recoveryBlock.totalDays} dias de recuperação pós-prova.{"\n"}
            Retomando o plano de treino normal.
          </Text>
          <Pressable style={[s.completeBtn, { backgroundColor: ACCENT + "22", marginTop: 10, borderRadius: 10, paddingHorizontal: 20 }]} onPress={handleClear}>
            <Feather name="refresh-cw" size={14} color={ACCENT} />
            <Text style={[s.completeBtnText, { color: ACCENT }]}>RETOMAR PLANO NORMAL</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (!todayRecovery) return null;

  const typeKey = todayRecovery.type as WorkoutType;
  const typeColor = TYPE_COLOR[typeKey] ?? ACCENT;
  const typeIcon = TYPE_ICON[typeKey] ?? "heart";
  const typeLabel = TYPE_LABEL[typeKey] ?? "RECUPERATIVO";
  const showDist = todayRecovery.distanceKm > 0;
  const showDur = todayRecovery.durationMin > 0;

  return (
    <View style={s.card}>
      <Text style={s.tag}>🟢 RECUPERAÇÃO PÓS-PROVA</Text>
      <Text style={s.raceName}>{recoveryBlock.raceName}</Text>
      <Text style={s.raceMeta}>
        {recoveryBlock.raceDistanceKm}km · {finishTime} · {recoveryBlock.totalDays} dias de recuperação
      </Text>

      <View style={s.divider} />

      <View style={s.dayRow}>
        <Text style={s.dayLabel}>DIA {dayOffset} DE {recoveryBlock.totalDays}</Text>
        <Text style={s.dayCount}>
          {dayOffset === recoveryBlock.totalDays ? "ÚLTIMO DIA" : `${recoveryBlock.totalDays - dayOffset} DIA${recoveryBlock.totalDays - dayOffset !== 1 ? "S" : ""} RESTANTE${recoveryBlock.totalDays - dayOffset !== 1 ? "S" : ""}`}
        </Text>
      </View>

      <View style={s.dotsRow}>
        {progressDots.map((dot) => (
          <View
            key={dot.offset}
            style={[
              s.dot,
              {
                backgroundColor: dot.done
                  ? ACCENT
                  : dot.active
                  ? ACCENT + "99"
                  : colors.border,
                transform: [{ scale: dot.active ? 1.3 : 1 }],
              },
            ]}
          />
        ))}
      </View>

      <View style={s.workoutBox}>
        <View style={s.workoutTypeRow}>
          <Feather name={typeIcon as any} size={16} color={typeColor} />
          <Text style={[s.workoutTypeName, { color: typeColor }]}>{typeLabel}</Text>
          {showDist && (
            <Text style={{ fontSize: 22, fontWeight: "800" as const, color: typeColor, marginLeft: "auto" as any }}>
              {todayRecovery.distanceKm}km
            </Text>
          )}
        </View>

        {(showDist || showDur) && (
          <View style={s.distRow}>
            {showDist && (
              <View style={s.distItem}>
                <Feather name="map" size={11} color={colors.mutedForeground} />
                <Text style={s.distText}>{todayRecovery.distanceKm} KM</Text>
              </View>
            )}
            {showDur && (
              <View style={s.distItem}>
                <Feather name="clock" size={11} color={colors.mutedForeground} />
                <Text style={s.distText}>{todayRecovery.durationMin} MIN</Text>
              </View>
            )}
          </View>
        )}

        <Text style={s.desc}>{todayRecovery.description}</Text>
      </View>

      <Pressable
        style={({ pressed }) => [
          s.completeBtn,
          {
            backgroundColor: workoutCompleted ? colors.border : typeColor,
            opacity: pressed ? 0.8 : 1,
          },
        ]}
        onPress={handleComplete}
        disabled={workoutCompleted}
      >
        <Feather
          name={workoutCompleted ? "check-circle" : "check"}
          size={15}
          color={workoutCompleted ? colors.mutedForeground : "#000000"}
        />
        <Text
          style={[
            s.completeBtnText,
            { color: workoutCompleted ? colors.mutedForeground : "#000000" },
          ]}
        >
          {workoutCompleted ? "CONCLUÍDO" : "MARCAR CONCLUÍDO"}
        </Text>
      </Pressable>

      <Pressable style={s.clearLink} onPress={handleClear}>
        <Text style={s.clearLinkText}>IGNORAR RECUPERAÇÃO</Text>
      </Pressable>
    </View>
  );
}
