import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Race } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";
import { calcEstimatedTimeMin, formatDuration } from "@/utils/raceLogistics";

// ─── TYPES ────────────────────────────────────────────────────────────────────

type RacePhase = "pre" | "running" | "done";

interface RaceDayState {
  phase: RacePhase;
  startMs: number | null;
  finishMs: number | null;
  checkedItems: string[];
}

// ─── CHECKLIST ────────────────────────────────────────────────────────────────

const CHECKLIST = [
  { id: "shoes",    emoji: "👟", label: "Tênis amarrados e testados" },
  { id: "bib",      emoji: "🏷️", label: "Número/chip fixado no body" },
  { id: "gels",     emoji: "🍬", label: "Géis carregados no short/colete" },
  { id: "hydration",emoji: "💧", label: "Hidratação preparada" },
  { id: "food",     emoji: "🍌", label: "Café/desjejum feito (2-3h antes)" },
  { id: "warmup",   emoji: "🔥", label: "Aquecimento dinâmico feito" },
  { id: "music",    emoji: "🎧", label: "Fone/música prontos (opcional)" },
];

// ─── GEL SCHEDULE (1h first, then every 30min) ───────────────────────────────

function buildGelSchedule(estimatedMin: number): { label: string; minFromStart: number }[] {
  const gels: { label: string; minFromStart: number }[] = [];
  let t = 60;
  let n = 1;
  while (t < estimatedMin + 10) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    const time = h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, "0") : ""}` : `${m}min`;
    gels.push({ label: `Gel ${n} — ${time} de corrida`, minFromStart: t });
    t += 30;
    n++;
  }
  return gels;
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatHMS(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatPace(distKm: number, durationMin: number): string {
  if (distKm === 0) return "--:--";
  const paceMin = durationMin / distKm;
  const min = Math.floor(paceMin);
  const sec = Math.round((paceMin - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")} /km`;
}

function getRaceStartMs(race: Race): number | null {
  if (!race.raceStartTime) return null;
  const today = new Date();
  const [hStr, mStr] = race.raceStartTime.split(":");
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(),
    parseInt(hStr ?? "7", 10), parseInt(mStr ?? "0", 10), 0, 0);
  return d.getTime();
}

function getSecondsUntil(targetMs: number): number {
  return Math.max(0, Math.round((targetMs - Date.now()) / 1000));
}

function getElapsedSeconds(startMs: number): number {
  return Math.max(0, Math.round((Date.now() - startMs) / 1000));
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function RaceModeCard({
  race,
  onRaceFinished,
}: {
  race: Race;
  onRaceFinished?: (finishDurationSec: number) => void;
}) {
  const colors = useColors();
  const storageKey = `@procoach_race_day_v1_${race.id}`;

  const paceMinKm = race.targetPaceMinKm ?? 6;
  const estimatedMin = calcEstimatedTimeMin(race.distanceKm, paceMinKm);
  const gelSchedule = buildGelSchedule(estimatedMin);
  const raceStartScheduledMs = getRaceStartMs(race);

  const [phase, setPhase] = useState<RacePhase>("pre");
  const [startMs, setStartMs] = useState<number | null>(null);
  const [finishMs, setFinishMs] = useState<number | null>(null);
  const [checkedItems, setCheckedItems] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (raw) {
        try {
          const saved: RaceDayState = JSON.parse(raw);
          setPhase(saved.phase);
          setStartMs(saved.startMs);
          setFinishMs(saved.finishMs);
          setCheckedItems(new Set(saved.checkedItems ?? []));
        } catch {}
      }
      setLoaded(true);
    });
  }, [storageKey]);

  // ── Tick timer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === "done") { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    intervalRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [phase]);

  // ── Persist state ─────────────────────────────────────────────────────────
  const persist = useCallback(async (p: RacePhase, sMs: number | null, fMs: number | null, checked: Set<string>) => {
    const payload: RaceDayState = {
      phase: p, startMs: sMs, finishMs: fMs,
      checkedItems: Array.from(checked),
    };
    await AsyncStorage.setItem(storageKey, JSON.stringify(payload));
  }, [storageKey]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const toggleItem = useCallback(async (id: string) => {
    await Haptics.selectionAsync();
    setCheckedItems((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      persist(phase, startMs, finishMs, next);
      return next;
    });
  }, [phase, startMs, finishMs, persist]);

  const handleStart = useCallback(async () => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const now = Date.now();
    setPhase("running");
    setStartMs(now);
    await persist("running", now, null, checkedItems);
  }, [checkedItems, persist]);

  const handleFinish = useCallback(() => {
    Alert.alert(
      "Finalizar Prova",
      "Confirmar o fim da corrida e registrar o resultado?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: async () => {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const now = Date.now();
            const durationSec = Math.round((now - (startMs ?? now)) / 1000);
            setPhase("done");
            setFinishMs(now);
            await persist("done", startMs, now, checkedItems);
            onRaceFinished?.(durationSec);
          },
        },
      ]
    );
  }, [startMs, checkedItems, persist]);

  const handleReset = useCallback(() => {
    Alert.alert("Resetar Modo Prova", "Isso vai apagar o resultado registrado. Continuar?", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Resetar",
        style: "destructive",
        onPress: async () => {
          setPhase("pre");
          setStartMs(null);
          setFinishMs(null);
          setCheckedItems(new Set());
          await AsyncStorage.removeItem(storageKey);
        },
      },
    ]);
  }, [storageKey]);

  if (!loaded) return null;

  // ── Computed display values ───────────────────────────────────────────────
  const elapsedSec = phase === "running" && startMs ? getElapsedSeconds(startMs) : 0;
  const countdownSec = raceStartScheduledMs && phase === "pre"
    ? getSecondsUntil(raceStartScheduledMs) : 0;
  const finishDurationSec = finishMs && startMs ? Math.round((finishMs - startMs) / 1000) : 0;
  const finishDurationMin = finishDurationSec / 60;
  const checkedCount = checkedItems.size;
  const allChecked = checkedCount === CHECKLIST.length;

  // Gel alerts: which is next, which are past
  const elapsedMin = elapsedSec / 60;
  const nextGelIdx = gelSchedule.findIndex((g) => g.minFromStart > elapsedMin);
  const nextGel = nextGelIdx >= 0 ? gelSchedule[nextGelIdx] : null;
  const nextGelSecsAway = nextGel ? (nextGel.minFromStart - elapsedMin) * 60 : null;
  const isGelAlert = nextGelSecsAway !== null && nextGelSecsAway <= 120;

  const priorityColor =
    race.priority === "P1" ? "#FF5F00" :
    race.priority === "P2" ? "#2196F3" : "#9C27B0";

  const s = StyleSheet.create({
    card: {
      backgroundColor: "#0D0500",
      borderRadius: colors.radius,
      borderWidth: 2,
      borderColor: priorityColor,
      padding: 20,
      marginBottom: 16,
    },
    headerTag: { fontSize: 8, letterSpacing: 4, fontWeight: "800" as const, color: priorityColor, marginBottom: 4 },
    raceName: { fontSize: 18, fontWeight: "800" as const, color: colors.foreground, letterSpacing: -0.5 },
    raceDistance: { fontSize: 12, color: colors.mutedForeground, marginTop: 2, marginBottom: 16 },
    divider: { height: 1, backgroundColor: priorityColor + "33", marginBottom: 16 },
    // Countdown
    countdownBox: {
      alignItems: "center", paddingVertical: 16,
      backgroundColor: priorityColor + "11", borderRadius: 12, marginBottom: 16,
    },
    countdownLabel: { fontSize: 9, letterSpacing: 3, color: colors.mutedForeground, marginBottom: 4 },
    countdownNum: { fontSize: 48, fontWeight: "800" as const, color: priorityColor, letterSpacing: -2, fontVariant: ["tabular-nums"] as any },
    countdownSub: { fontSize: 10, color: colors.mutedForeground, marginTop: 4, letterSpacing: 2 },
    // Checklist
    checklistTitle: { fontSize: 9, letterSpacing: 3, color: colors.mutedForeground, marginBottom: 10 },
    checkItem: {
      flexDirection: "row" as const, alignItems: "center" as const,
      paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.border + "55", gap: 10,
    },
    checkBox: {
      width: 22, height: 22, borderRadius: 6, borderWidth: 1.5,
      alignItems: "center" as const, justifyContent: "center" as const,
    },
    checkLabel: { flex: 1, fontSize: 12, color: colors.foreground },
    checkEmoji: { fontSize: 14, width: 22, textAlign: "center" as const },
    // Gel schedule
    gelTitle: { fontSize: 9, letterSpacing: 3, color: colors.mutedForeground, marginTop: 16, marginBottom: 10 },
    gelRow: {
      flexDirection: "row" as const, alignItems: "center" as const,
      paddingVertical: 7, gap: 10,
    },
    gelDot: { width: 8, height: 8, borderRadius: 4 },
    gelLabel: { flex: 1, fontSize: 11, color: colors.foreground },
    gelStatus: { fontSize: 10, fontWeight: "700" as const },
    gelAlert: {
      flexDirection: "row" as const, alignItems: "center" as const,
      backgroundColor: "#4CAF5022", borderRadius: 8,
      padding: 12, marginBottom: 12, gap: 8,
    },
    gelAlertText: { flex: 1, fontSize: 12, color: "#4CAF50", fontWeight: "700" as const },
    // Timer running
    timerBox: {
      alignItems: "center", paddingVertical: 20,
      backgroundColor: "#003300", borderRadius: 12, marginBottom: 16, gap: 4,
    },
    timerLabel: { fontSize: 9, letterSpacing: 3, color: "#4CAF5088" },
    timerNum: { fontSize: 56, fontWeight: "800" as const, color: "#4CAF50", letterSpacing: -2, fontVariant: ["tabular-nums"] as any },
    // Result
    resultBox: {
      backgroundColor: priorityColor + "11", borderRadius: 12,
      padding: 20, marginBottom: 16, alignItems: "center" as const,
    },
    resultTitle: { fontSize: 9, letterSpacing: 4, color: priorityColor, fontWeight: "800" as const, marginBottom: 8 },
    resultTime: { fontSize: 48, fontWeight: "800" as const, color: priorityColor, letterSpacing: -2 },
    resultMeta: { fontSize: 12, color: colors.mutedForeground, marginTop: 6 },
    resultSplit: { fontSize: 13, color: colors.foreground, marginTop: 4, fontWeight: "600" as const },
    resultRow: { flexDirection: "row" as const, gap: 16, marginTop: 12 },
    resultStat: { alignItems: "center" as const, flex: 1 },
    resultStatNum: { fontSize: 20, fontWeight: "800" as const, color: colors.foreground },
    resultStatLabel: { fontSize: 9, letterSpacing: 2, color: colors.mutedForeground, marginTop: 2 },
    // Buttons
    primaryBtn: {
      backgroundColor: priorityColor, borderRadius: colors.radius - 2,
      paddingVertical: 16, alignItems: "center" as const,
      flexDirection: "row" as const, justifyContent: "center" as const, gap: 8,
    },
    primaryBtnText: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 3, color: "#000000" },
    dangerBtn: {
      backgroundColor: "#EF444422", borderRadius: colors.radius - 2,
      paddingVertical: 14, alignItems: "center" as const,
      flexDirection: "row" as const, justifyContent: "center" as const, gap: 8, marginTop: 10,
    },
    dangerBtnText: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 3, color: "#EF4444" },
    resetLink: { alignItems: "center" as const, paddingVertical: 10, marginTop: 6 },
    resetLinkText: { fontSize: 10, color: colors.mutedForeground, letterSpacing: 1 },
    progressBar: { height: 3, backgroundColor: colors.border, borderRadius: 2, overflow: "hidden" as const, marginBottom: 14 },
    progressFill: { height: 3, borderRadius: 2, backgroundColor: priorityColor },
  });

  // ── PHASE: DONE ─────────────────────────────────────────────────────────────
  if (phase === "done") {
    const pace = formatPace(race.distanceKm, finishDurationMin);
    const vsEstimated = Math.round(finishDurationMin - estimatedMin);
    const vsSign = vsEstimated > 0 ? "+" : "";
    return (
      <View style={s.card}>
        <Text style={s.headerTag}>🏁 PROVA CONCLUÍDA — {race.priority}</Text>
        <Text style={s.raceName}>{race.name}</Text>
        <Text style={s.raceDistance}>{race.distanceKm}km</Text>
        <View style={s.divider} />
        <View style={s.resultBox}>
          <Text style={s.resultTitle}>SEU TEMPO FINAL</Text>
          <Text style={s.resultTime}>{formatHMS(finishDurationSec)}</Text>
          <Text style={s.resultMeta}>{vsSign}{vsEstimated} min vs. estimado ({formatDuration(estimatedMin)})</Text>
          <View style={s.resultRow}>
            <View style={s.resultStat}>
              <Text style={s.resultStatNum}>{pace}</Text>
              <Text style={s.resultStatLabel}>RITMO MÉDIO</Text>
            </View>
            <View style={s.resultStat}>
              <Text style={s.resultStatNum}>{race.distanceKm}km</Text>
              <Text style={s.resultStatLabel}>DISTÂNCIA</Text>
            </View>
            <View style={s.resultStat}>
              <Text style={s.resultStatNum}>{gelSchedule.filter((g) => g.minFromStart <= finishDurationMin).length}</Text>
              <Text style={s.resultStatLabel}>GÉIS</Text>
            </View>
          </View>
        </View>
        <Pressable style={s.resetLink} onPress={handleReset}>
          <Text style={s.resetLinkText}>RESETAR MODO PROVA</Text>
        </Pressable>
      </View>
    );
  }

  // ── PHASE: RUNNING ──────────────────────────────────────────────────────────
  if (phase === "running") {
    const progressPct = Math.min(1, elapsedSec / (estimatedMin * 60));
    return (
      <View style={s.card}>
        <Text style={s.headerTag}>🏃 CORRENDO AGORA — {race.priority}</Text>
        <Text style={s.raceName}>{race.name}</Text>
        <Text style={s.raceDistance}>{race.distanceKm}km · estimado {formatDuration(estimatedMin)}</Text>
        <View style={s.divider} />

        {/* Live timer */}
        <View style={s.timerBox}>
          <Text style={s.timerLabel}>TEMPO EM CORRIDA</Text>
          <Text style={s.timerNum}>{formatHMS(elapsedSec)}</Text>
        </View>

        {/* Progress bar */}
        <View style={s.progressBar}>
          <View style={[s.progressFill, { width: `${progressPct * 100}%` }]} />
        </View>

        {/* Gel alert */}
        {isGelAlert && nextGel && nextGelSecsAway !== null && (
          <View style={s.gelAlert}>
            <Text style={{ fontSize: 18 }}>🍬</Text>
            <Text style={s.gelAlertText}>
              {nextGelSecsAway <= 30
                ? `AGORA! ${nextGel.label}`
                : `${formatHMS(Math.round(nextGelSecsAway))} para o ${nextGel.label.split(" —")[0]}`}
            </Text>
          </View>
        )}

        {/* Gel schedule */}
        <Text style={s.gelTitle}>ESTRATÉGIA DE GÉIS</Text>
        {gelSchedule.map((g, i) => {
          const isPast = elapsedMin >= g.minFromStart;
          const isNext = i === nextGelIdx;
          return (
            <View key={i} style={s.gelRow}>
              <View style={[s.gelDot, {
                backgroundColor: isPast ? "#4CAF50" : isNext ? "#FF9800" : colors.border
              }]} />
              <Text style={[s.gelLabel, { color: isPast ? colors.mutedForeground : colors.foreground }]}>
                {g.label}
              </Text>
              <Text style={[s.gelStatus, {
                color: isPast ? "#4CAF50" : isNext ? "#FF9800" : colors.mutedForeground
              }]}>
                {isPast ? "✓" : isNext ? "PRÓXIMO" : ""}
              </Text>
            </View>
          );
        })}

        <View style={{ marginTop: 20 }}>
          <Pressable
            style={({ pressed }) => [s.dangerBtn, { opacity: pressed ? 0.8 : 1 }]}
            onPress={handleFinish}
          >
            <Feather name="flag" size={15} color="#EF4444" />
            <Text style={s.dangerBtnText}>FINALIZAR PROVA</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── PHASE: PRE ───────────────────────────────────────────────────────────────
  return (
    <View style={s.card}>
      <Text style={s.headerTag}>🏁 DIA DE PROVA — {race.priority}</Text>
      <Text style={s.raceName}>{race.name}</Text>
      <Text style={s.raceDistance}>{race.distanceKm}km · {race.raceStartTime ?? "--:--"} · meta {formatDuration(estimatedMin)}</Text>
      <View style={s.divider} />

      {/* Countdown to start */}
      {raceStartScheduledMs && countdownSec > 0 ? (
        <View style={s.countdownBox}>
          <Text style={s.countdownLabel}>LARGADA EM</Text>
          <Text style={s.countdownNum}>{formatHMS(countdownSec)}</Text>
          <Text style={s.countdownSub}>{race.raceStartTime}</Text>
        </View>
      ) : (
        <View style={[s.countdownBox, { backgroundColor: "#4CAF5011" }]}>
          <Text style={[s.countdownLabel, { color: "#4CAF50" }]}>
            {raceStartScheduledMs ? "HORA DE LARGAR! 🚀" : "DIA DA PROVA"}
          </Text>
          <Text style={[s.countdownNum, { fontSize: 28, color: "#4CAF50" }]}>
            {race.raceStartTime ?? "Largada definida na tela PROVAS"}
          </Text>
        </View>
      )}

      {/* Progress indicator */}
      <View style={[s.progressBar, { marginBottom: 16 }]}>
        <View style={[s.progressFill, {
          width: checkedCount === 0 ? "2%" : `${(checkedCount / CHECKLIST.length) * 100}%`,
          backgroundColor: allChecked ? "#4CAF50" : priorityColor,
        }]} />
      </View>

      {/* Checklist */}
      <Text style={s.checklistTitle}>
        CHECKLIST PRÉ-LARGADA · {checkedCount}/{CHECKLIST.length}
      </Text>
      {CHECKLIST.map((item) => {
        const checked = checkedItems.has(item.id);
        return (
          <Pressable key={item.id} style={s.checkItem} onPress={() => toggleItem(item.id)}>
            <View style={[s.checkBox, {
              borderColor: checked ? "#4CAF50" : colors.border,
              backgroundColor: checked ? "#4CAF5022" : "transparent",
            }]}>
              {checked && <Feather name="check" size={13} color="#4CAF50" />}
            </View>
            <Text style={s.checkEmoji}>{item.emoji}</Text>
            <Text style={[s.checkLabel, { color: checked ? colors.mutedForeground : colors.foreground }]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}

      {/* Gel strategy */}
      <Text style={s.gelTitle}>ESTRATÉGIA DE GÉIS · {gelSchedule.length} GEL{gelSchedule.length !== 1 ? "S" : ""}</Text>
      {gelSchedule.map((g, i) => (
        <View key={i} style={s.gelRow}>
          <View style={[s.gelDot, { backgroundColor: priorityColor }]} />
          <Text style={s.gelLabel}>{g.label}</Text>
        </View>
      ))}
      {gelSchedule.length === 0 && (
        <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
          Prova muito curta — 1 gel preventivo opcional.
        </Text>
      )}

      {/* Start button */}
      <View style={{ marginTop: 20 }}>
        <Pressable
          style={({ pressed }) => [s.primaryBtn, { opacity: pressed ? 0.8 : 1 }]}
          onPress={handleStart}
        >
          <Feather name="play-circle" size={16} color="#000000" />
          <Text style={s.primaryBtnText}>INICIAR CORRIDA</Text>
        </Pressable>
      </View>
    </View>
  );
}
