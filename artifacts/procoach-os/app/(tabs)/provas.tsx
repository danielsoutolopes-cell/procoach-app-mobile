import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import * as WebBrowser from "expo-web-browser";
import { useAthlete, Race, RacePriority } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";
import {
  formatDateBR,
  getDaysUntilRace,
  getPhase,
  getPhaseColor,
  getWeekRaceDateISO,
  getWeeklyVolume,
} from "@/utils/training";
import { generateWeeklyReport } from "@/utils/weeklyReport";
import {
  RACE_ROLE,
  validateRacePlacement,
  getRaceWeekInCycle,
  calcEstimatedTimeMin,
  calcGelCount,
  getGelSchedule,
  calcLogisticsTimes,
  formatPace,
  formatDuration,
  generateLogisticsReport,
} from "@/utils/raceLogistics";
import {
  fetchRaceWeather,
  formatWeatherForPDF,
  getWeatherTip,
  applyPaceAdjustment,
  WeatherData,
} from "@/utils/weather";
import {
  requestNotifPermission,
  schedulePreRaceReminder,
  cancelPreRaceReminder,
  notificationsSupported,
} from "@/utils/notifications";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "https://coach-pro-v8e4.onrender.com";

const DISTANCES = [5, 10, 21, 42];
const PRIORITIES: RacePriority[] = ["P1", "P2", "P3"];

const PRIORITY_COLORS: Record<RacePriority, string> = {
  P1: "#FF5F00",
  P2: "#2196F3",
  P3: "#9C27B0",
};

const START_HOURS = [5, 6, 7, 8, 9, 10, 11, 12];
const PACE_OPTIONS = [
  4.0, 4.5,
  5.0, 5.33, 5.5,
  5.75, 6.0, 6.2, 6.5,
  6.75, 7.0, 7.5,
  8.0, 8.5, 9.0,
];
const TRAVEL_OPTIONS = [10, 15, 20, 30, 45, 60, 90, 120];

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

function parseBRDate(str: string): string | null {
  const parts = str.split("/");
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  if (!d || !m || !y || y.length !== 4) return null;
  const date = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T12:00:00`);
  if (isNaN(date.getTime())) return null;
  return date.toISOString();
}

function autoFormatDate(text: string, prev: string): string {
  const isDeleting = text.length < prev.length;
  const digits = text.replace(/\D/g, "");
  if (digits.length === 0) return "";
  if (isDeleting) {
    if (digits.length <= 2) return digits;
    if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
  }
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4, 8)}`;
}

// ─── LOGISTICS CARD ───────────────────────────────────────────────────────────

function formatAdjPace(p: number): string {
  const min = Math.floor(p);
  const sec = Math.round((p - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function LogisticsCard({ race, p1DateISO, colors, onGeneratePDF }: {
  race: Race;
  p1DateISO: string;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  onGeneratePDF: (race: Race, travelMin: number, weather: WeatherData | null) => void;
}) {
  const [travelMin, setTravelMin] = useState(30);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const daysUntil = getDaysUntilRace(race.date);
  const col = PRIORITY_COLORS[race.priority];
  const basePace = race.targetPaceMinKm ?? 6;
  const effectivePace = weather?.available ? weather.adjustedPaceMinKm : basePace;
  const estimatedMin = calcEstimatedTimeMin(race.distanceKm, effectivePace);
  const gels = calcGelCount(estimatedMin);
  const gelSchedule = getGelSchedule(estimatedMin);
  const times = race.raceStartTime ? calcLogisticsTimes(race.raceStartTime, travelMin) : null;
  const raceHour = parseInt((race.raceStartTime ?? "07:00").split(":")[0] ?? "7", 10);

  // Fetch weather for races within 16 days (Open-Meteo forecast limit)
  useEffect(() => {
    if (!race.address || daysUntil > 16 || daysUntil < 0) return;
    setWeatherLoading(true);
    fetchRaceWeather(race.address, race.date, raceHour, basePace)
      .then(setWeather)
      .finally(() => setWeatherLoading(false));
  }, [race.address, race.date, raceHour, basePace, daysUntil]);

  const s = StyleSheet.create({
    card: {
      borderRadius: colors.radius, borderWidth: 1.5, padding: 16, marginBottom: 16,
      backgroundColor: col + "08", borderColor: col + "55",
    },
    tag: { fontSize: 8, letterSpacing: 3, fontWeight: "800" as const, marginBottom: 4 },
    raceName: { fontSize: 17, fontWeight: "800" as const, color: colors.foreground, letterSpacing: -0.5, marginBottom: 12 },
    sectionTitle: { fontSize: 9, letterSpacing: 2, color: colors.mutedForeground, fontWeight: "700" as const, marginBottom: 8 },
    timelineRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border + "66" },
    timelineTime: { fontSize: 17, fontWeight: "800" as const, width: 52, color: col },
    timelineLabel: { fontSize: 9, letterSpacing: 1, fontWeight: "700" as const, color: colors.mutedForeground },
    timelineDetail: { fontSize: 11, color: colors.foreground },
    gelRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.border + "44" },
    gelNum: { width: 22, height: 22, borderRadius: 6, backgroundColor: col + "22", alignItems: "center", justifyContent: "center" },
    gelNumText: { fontSize: 10, fontWeight: "800" as const, color: col },
    gelText: { fontSize: 12, color: colors.foreground },
    travelRow: { flexDirection: "row", flexWrap: "wrap" as const, gap: 6, marginBottom: 14 },
    travelChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },
    travelChipText: { fontSize: 11, fontWeight: "700" as const },
    pdfBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, borderRadius: 10, paddingVertical: 12, marginTop: 4,
      backgroundColor: col + "22", borderWidth: 1, borderColor: col + "66",
    },
    pdfBtnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2, color: col },
    weatherCard: {
      borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 14,
      backgroundColor: "#0A0F1A", borderColor: "#1E3A5F",
    },
    weatherRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 12 },
    weatherTemp: { fontSize: 28, fontWeight: "800" as const, color: "#FFF" },
    weatherDesc: { fontSize: 12, color: "#AAA" },
    weatherGrid: { flexDirection: "row", gap: 8, marginBottom: 10 },
    weatherStat: { flex: 1, backgroundColor: "#0A0A0A", borderRadius: 8, padding: 8, alignItems: "center" },
    weatherStatVal: { fontSize: 14, fontWeight: "800" as const, color: "#EEE" },
    weatherStatLabel: { fontSize: 7, letterSpacing: 2, color: "#555", marginTop: 2 },
    paceAdjBanner: { borderRadius: 8, padding: 10 },
  });

  const tip = weather?.available ? getWeatherTip(weather) : "";

  return (
    <View style={s.card}>
      <Text style={[s.tag, { color: col }]}>
        🏁 {daysUntil === 0 ? "DIA DA PROVA!" : daysUntil === 1 ? "AMANHÃ É A PROVA!" : "EM 2 DIAS — LOGÍSTICA ATIVA"}
      </Text>
      <Text style={s.raceName}>{race.name} · {race.priority}</Text>

      {/* Stats row */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
        <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, padding: 10, alignItems: "center" }}>
          <Text style={{ fontSize: 18, fontWeight: "800" as const, color: col }}>{race.distanceKm}</Text>
          <Text style={[s.tag, { color: colors.mutedForeground, marginBottom: 0 }]}>KM</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, padding: 10, alignItems: "center" }}>
          <Text style={{ fontSize: 13, fontWeight: "800" as const, color: colors.foreground }}>{formatDuration(estimatedMin)}</Text>
          <Text style={[s.tag, { color: colors.mutedForeground, marginBottom: 0 }]}>TEMPO EST.</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.card, borderRadius: 8, padding: 10, alignItems: "center" }}>
          <Text style={{ fontSize: 14, fontWeight: "800" as const, color: "#4CAF50" }}>{gels}</Text>
          <Text style={[s.tag, { color: colors.mutedForeground, marginBottom: 0 }]}>GÉIS</Text>
        </View>
      </View>

      {/* Weather card */}
      {race.address && (
        weatherLoading ? (
          <View style={[s.weatherCard, { alignItems: "center", paddingVertical: 18 }]}>
            <ActivityIndicator size="small" color="#2196F3" />
            <Text style={{ fontSize: 11, color: "#555", marginTop: 8 }}>Buscando previsão do tempo...</Text>
          </View>
        ) : weather?.available ? (
          <View style={s.weatherCard}>
            <Text style={{ fontSize: 8, letterSpacing: 3, fontWeight: "800" as const, color: "#2196F3", marginBottom: 10 }}>
              PREVISÃO — DIA DA PROVA · {String(raceHour).padStart(2, "0")}h
            </Text>
            <View style={s.weatherRow}>
              <Text style={{ fontSize: 36 }}>{weather.emoji}</Text>
              <View>
                <Text style={s.weatherTemp}>{weather.temperature}°C</Text>
                <Text style={s.weatherDesc}>{weather.description} · Sensação {weather.feelsLike}°C</Text>
              </View>
            </View>
            <View style={s.weatherGrid}>
              {[
                { label: "UMIDADE", val: `${weather.humidity}%` },
                { label: "VENTO", val: `${weather.windSpeed}km/h` },
                { label: "CHUVA", val: `${weather.precipitationProb}%` },
              ].map((item) => (
                <View key={item.label} style={s.weatherStat}>
                  <Text style={s.weatherStatVal}>{item.val}</Text>
                  <Text style={s.weatherStatLabel}>{item.label}</Text>
                </View>
              ))}
            </View>
            {weather.paceAdjustmentPercent > 0 ? (
              <View style={[s.paceAdjBanner, { backgroundColor: "#1A0800", borderWidth: 1, borderColor: "#FF5F0033" }]}>
                <Text style={{ fontSize: 9, fontWeight: "800" as const, color: "#FF9800", letterSpacing: 1 }}>
                  ⚠️ IMPACTO NO DESEMPENHO: +{weather.paceAdjustmentPercent}%
                </Text>
                <Text style={{ fontSize: 11, color: "#CCC", marginTop: 4 }}>
                  Pace ajustado: <Text style={{ color: "#FF5F00", fontWeight: "700" as const }}>{formatAdjPace(weather.adjustedPaceMinKm)} min/km</Text>{" "}
                  (base: {formatAdjPace(basePace)})
                </Text>
              </View>
            ) : (
              <View style={[s.paceAdjBanner, { backgroundColor: "#0A1A0A", borderWidth: 1, borderColor: "#4CAF5033" }]}>
                <Text style={{ fontSize: 11, color: "#4CAF50" }}>✅ Condições favoráveis — mantenha o pace planejado.</Text>
              </View>
            )}
            {tip ? (
              <Text style={{ fontSize: 10, color: "#888", marginTop: 10, lineHeight: 15 }}>{tip}</Text>
            ) : null}
          </View>
        ) : (
          daysUntil > 16 ? null : (
            <View style={[s.weatherCard, { borderColor: "#222" }]}>
              <Text style={{ fontSize: 11, color: "#555" }}>
                Previsão do tempo indisponível para este local. Verifique o endereço da prova.
              </Text>
            </View>
          )
        )
      )}

      {/* Travel time picker */}
      <Text style={s.sectionTitle}>TEMPO DE DESLOCAMENTO</Text>
      <View style={s.travelRow}>
        {TRAVEL_OPTIONS.map((t) => {
          const active = travelMin === t;
          return (
            <Pressable
              key={t}
              style={[s.travelChip, { backgroundColor: active ? col + "22" : colors.secondary, borderColor: active ? col : colors.border }]}
              onPress={() => setTravelMin(t)}
            >
              <Text style={[s.travelChipText, { color: active ? col : colors.mutedForeground }]}>{t}min</Text>
            </Pressable>
          );
        })}
      </View>

      {/* Timeline */}
      {times && (
        <>
          <Text style={s.sectionTitle}>LINHA DO TEMPO — DIA DA PROVA</Text>
          {[
            { time: times.wakeUp, icon: "🌅", label: "DESPERTAR", detail: "Café da manhã, kit de corrida, preparo" },
            { time: times.leaveHome, icon: "🚗", label: "SAÍDA DE CASA", detail: `Deslocamento de ${formatDuration(travelMin)}` },
            { time: times.arriveVenue, icon: "📍", label: "CHEGADA AO LOCAL", detail: "Retirar kit, aquecer, localizar largada" },
            { time: times.raceStart, icon: "🏁", label: "LARGADA", detail: `${race.name} · ${race.distanceKm}km` },
          ].map((item, i) => (
            <View key={i} style={s.timelineRow}>
              <Text style={{ fontSize: 16, width: 24, textAlign: "center" }}>{item.icon}</Text>
              <Text style={s.timelineTime}>{item.time}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.timelineLabel}>{item.label}</Text>
                <Text style={s.timelineDetail}>{item.detail}</Text>
              </View>
            </View>
          ))}
          <View style={{ height: 12 }} />
        </>
      )}
      {!race.raceStartTime && (
        <View style={{ backgroundColor: colors.secondary, borderRadius: 8, padding: 10, marginBottom: 12 }}>
          <Text style={{ fontSize: 11, color: colors.mutedForeground }}>
            Defina o horário de largada na edição da prova para calcular o horário de acordar.
          </Text>
        </View>
      )}

      {/* Gel schedule */}
      {gelSchedule.length > 0 && (
        <>
          <Text style={s.sectionTitle}>GÉIS — CRONOGRAMA</Text>
          {gelSchedule.map((gs, i) => (
            <View key={i} style={s.gelRow}>
              <View style={s.gelNum}><Text style={s.gelNumText}>{i + 1}</Text></View>
              <Text style={s.gelText}>{gs}</Text>
            </View>
          ))}
          <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 8, lineHeight: 15 }}>
            Leve {gels + 1} géis (1 extra de reserva). Tome sempre com água.
          </Text>
          <View style={{ height: 12 }} />
        </>
      )}

      {/* Address */}
      {race.address ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12 }}>
          <Feather name="map-pin" size={12} color={col} />
          <Text style={{ fontSize: 12, color: colors.foreground, flex: 1 }}>{race.address}</Text>
        </View>
      ) : null}

      {/* PDF button */}
      <Pressable
        style={({ pressed }) => [s.pdfBtn, { opacity: pressed ? 0.7 : 1 }]}
        onPress={() => onGeneratePDF(race, travelMin, weather)}
      >
        <Feather name="file-text" size={14} color={col} />
        <Text style={s.pdfBtnText}>GERAR PDF DE LOGÍSTICA</Text>
      </Pressable>
    </View>
  );
}

// ─── STRAVA SECTION ───────────────────────────────────────────────────────────

interface StravaResult {
  found: boolean;
  activityName?: string;
  activityUrl?: string;
  startDateLocal?: string;
  actualDistKm?: number;
  actualTimeMin?: number;
  avgPaceMinKm?: number;
  avgHeartRate?: number;
  elevationGain?: number;
  achievements?: number;
}

function StravaSection({ race, colors }: {
  race: Race;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
}) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<StravaResult | null>(null);
  const [resultLoading, setResultLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const raceDateOnly = race.date.slice(0, 10);
  const isPast = getDaysUntilRace(race.date) < 0;

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/strava/status-device`);
      if (!res.ok) return;
      const data = await res.json() as { connected: boolean; configured?: boolean };
      setConnected(data.connected);
      if (data.configured !== undefined) setConfigured(data.configured);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { checkStatus(); }, [checkStatus]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const res = await fetch(`${API_BASE}/api/strava/connect-url`);
      const data = await res.json() as { url?: string; error?: string };
      if (!data.url) {
        Alert.alert("Strava não configurado", data.error ?? "Adicione STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET no servidor.");
        return;
      }
      await WebBrowser.openBrowserAsync(data.url);
      // Poll until connected (max 2 min)
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts++;
        await checkStatus();
        if (attempts > 24) stopPoll();
      }, 5000);
    } catch (e) {
      Alert.alert("Erro", "Não foi possível abrir o navegador para autorização.");
    } finally {
      setConnecting(false);
    }
  }, [checkStatus, stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch(`${API_BASE}/api/strava/sync-device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raceDate: raceDateOnly }),
      });
      const data = await res.json() as { imported?: number };
      Alert.alert("Strava sincronizado", `${data.imported ?? 0} atividade(s) importada(s).`);
    } catch {
      Alert.alert("Erro", "Falha ao sincronizar com o Strava.");
    } finally {
      setSyncing(false);
    }
  }, [raceDateOnly]);

  const handleFetchResult = useCallback(async () => {
    setResultLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/strava/race-result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raceDate: raceDateOnly, distanceKm: race.distanceKm }),
      });
      const data = await res.json() as StravaResult;
      setResult(data);
      if (!data.found) Alert.alert("Nenhuma atividade encontrada", "Não encontrei uma corrida de ~" + race.distanceKm + "km próxima à data desta prova no Strava.");
    } catch {
      Alert.alert("Erro", "Falha ao buscar resultado no Strava.");
    } finally {
      setResultLoading(false);
    }
  }, [raceDateOnly, race.distanceKm]);

  const handleDisconnect = useCallback(() => {
    Alert.alert("Desconectar Strava?", "Você poderá reconectar quando quiser.", [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Desconectar", style: "destructive", onPress: async () => {
          await fetch(`${API_BASE}/api/strava/disconnect-device`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          setConnected(false);
          setResult(null);
        }
      }
    ]);
  }, []);

  if (!configured && connected === false) {
    return (
      <View style={{ backgroundColor: "#1A1A0A", borderRadius: 10, borderWidth: 1, borderColor: "#FF980033", padding: 14, marginBottom: 16 }}>
        <Text style={{ fontSize: 8, letterSpacing: 3, fontWeight: "800" as const, color: "#FF9800", marginBottom: 6 }}>STRAVA — NÃO CONFIGURADO</Text>
        <Text style={{ fontSize: 11, color: "#888", lineHeight: 16 }}>
          Para ativar a integração com o Strava, o administrador precisa adicionar{"\n"}
          <Text style={{ color: "#FF9800" }}>STRAVA_CLIENT_ID</Text> e <Text style={{ color: "#FF9800" }}>STRAVA_CLIENT_SECRET</Text>{"\n"}
          nas variáveis de ambiente do servidor.
        </Text>
      </View>
    );
  }

  const formatPaceStr = (p: number) => {
    const min = Math.floor(p); const sec = Math.round((p - min) * 60);
    return `${min}:${String(sec).padStart(2, "0")}`;
  };
  const formatTime = (m: number) => {
    const h = Math.floor(m / 60); const min = Math.round(m % 60);
    return h > 0 ? `${h}h${String(min).padStart(2, "0")}` : `${min}min`;
  };

  return (
    <View style={{ backgroundColor: "#0D1117", borderRadius: 10, borderWidth: 1, borderColor: "#FC4C0233", padding: 14, marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <Text style={{ fontSize: 18 }}>🟠</Text>
        <Text style={{ fontSize: 8, letterSpacing: 3, fontWeight: "800" as const, color: "#FC4C02" }}>STRAVA</Text>
        {connected === null && <ActivityIndicator size="small" color="#FC4C02" style={{ marginLeft: "auto" }} />}
        {connected === true && (
          <View style={{ marginLeft: "auto", backgroundColor: "#0A1A0A", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 9, color: "#4CAF50", fontWeight: "700" as const }}>● CONECTADO</Text>
          </View>
        )}
        {connected === false && (
          <View style={{ marginLeft: "auto", backgroundColor: "#1A0A0A", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
            <Text style={{ fontSize: 9, color: "#555", fontWeight: "700" as const }}>○ DESCONECTADO</Text>
          </View>
        )}
      </View>

      {connected === false && (
        <Pressable
          style={({ pressed }) => ({
            backgroundColor: pressed ? "#FC4C0244" : "#FC4C0222",
            borderRadius: 8, borderWidth: 1, borderColor: "#FC4C0266",
            paddingVertical: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8,
          })}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? <ActivityIndicator size="small" color="#FC4C02" /> : <Text style={{ fontSize: 16 }}>🟠</Text>}
          <Text style={{ fontSize: 11, fontWeight: "800" as const, color: "#FC4C02", letterSpacing: 1 }}>
            {connecting ? "ABRINDO AUTORIZAÇÃO..." : "CONECTAR COM STRAVA"}
          </Text>
        </Pressable>
      )}

      {connected === true && (
        <>
          <View style={{ flexDirection: "row", gap: 8, marginBottom: result ? 12 : 0 }}>
            <Pressable
              style={({ pressed }) => ({
                flex: 1, backgroundColor: pressed ? "#FC4C0244" : "#FC4C0222",
                borderRadius: 8, borderWidth: 1, borderColor: "#FC4C0255",
                paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6,
              })}
              onPress={handleSync}
              disabled={syncing}
            >
              {syncing ? <ActivityIndicator size="small" color="#FC4C02" /> : <Feather name="refresh-cw" size={12} color="#FC4C02" />}
              <Text style={{ fontSize: 9, fontWeight: "800" as const, color: "#FC4C02", letterSpacing: 1 }}>SINCRONIZAR</Text>
            </Pressable>
            {isPast && (
              <Pressable
                style={({ pressed }) => ({
                  flex: 1, backgroundColor: pressed ? "#2196F322" : "#2196F311",
                  borderRadius: 8, borderWidth: 1, borderColor: "#2196F355",
                  paddingVertical: 10, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6,
                })}
                onPress={handleFetchResult}
                disabled={resultLoading}
              >
                {resultLoading ? <ActivityIndicator size="small" color="#2196F3" /> : <Feather name="award" size={12} color="#2196F3" />}
                <Text style={{ fontSize: 9, fontWeight: "800" as const, color: "#2196F3", letterSpacing: 1 }}>
                  {resultLoading ? "BUSCANDO..." : "RESULTADO"}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Race result card */}
          {result?.found && (
            <View style={{ backgroundColor: "#0A0A0A", borderRadius: 10, borderWidth: 1, borderColor: "#FC4C0244", padding: 12, marginTop: 8 }}>
              <Text style={{ fontSize: 8, letterSpacing: 3, fontWeight: "800" as const, color: "#FC4C02", marginBottom: 10 }}>
                🏆 RESULTADO — {result.activityName}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
                {[
                  { label: "DISTÂNCIA", val: `${result.actualDistKm}km`, color: "#FC4C02" },
                  { label: "TEMPO", val: formatTime(result.actualTimeMin ?? 0), color: "#FFF" },
                  { label: "PACE", val: formatPaceStr(result.avgPaceMinKm ?? 0) + "/km", color: "#4CAF50" },
                ].map((item) => (
                  <View key={item.label} style={{ flex: 1, backgroundColor: "#111", borderRadius: 8, padding: 8, alignItems: "center" }}>
                    <Text style={{ fontSize: 13, fontWeight: "800" as const, color: item.color }}>{item.val}</Text>
                    <Text style={{ fontSize: 7, letterSpacing: 2, color: "#555", marginTop: 2 }}>{item.label}</Text>
                  </View>
                ))}
              </View>
              {(result.avgHeartRate || result.elevationGain || result.achievements) ? (
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 8 }}>
                  {result.avgHeartRate ? (
                    <Text style={{ fontSize: 10, color: "#888" }}>❤️ {Math.round(result.avgHeartRate)} bpm</Text>
                  ) : null}
                  {result.elevationGain ? (
                    <Text style={{ fontSize: 10, color: "#888" }}>⛰️ {Math.round(result.elevationGain)}m</Text>
                  ) : null}
                  {result.achievements ? (
                    <Text style={{ fontSize: 10, color: "#FF9800" }}>🏅 {result.achievements} conquista(s)</Text>
                  ) : null}
                </View>
              ) : null}
              {/* Planned vs actual comparison */}
              {race.targetPaceMinKm && result.avgPaceMinKm ? (
                <View style={{ backgroundColor: "#111", borderRadius: 8, padding: 8 }}>
                  <Text style={{ fontSize: 8, letterSpacing: 2, color: "#555", marginBottom: 6 }}>PLANEJADO vs REALIZADO</Text>
                  {[
                    { label: "Pace", plan: formatPaceStr(race.targetPaceMinKm) + "/km", actual: formatPaceStr(result.avgPaceMinKm) + "/km", better: result.avgPaceMinKm <= race.targetPaceMinKm },
                    { label: "Tempo", plan: formatTime(calcEstimatedTimeMin(race.distanceKm, race.targetPaceMinKm)), actual: formatTime(result.actualTimeMin ?? 0), better: (result.actualTimeMin ?? 99999) <= calcEstimatedTimeMin(race.distanceKm, race.targetPaceMinKm) },
                  ].map((row) => (
                    <View key={row.label} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ fontSize: 10, color: "#666", width: 50 }}>{row.label}</Text>
                      <Text style={{ fontSize: 10, color: "#888" }}>Meta: {row.plan}</Text>
                      <Text style={{ fontSize: 10, color: row.better ? "#4CAF50" : "#FF5F00", fontWeight: "700" as const }}>
                        {row.actual} {row.better ? "✅" : "⚡"}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          )}

          <Pressable onPress={handleDisconnect} style={{ alignItems: "center", marginTop: 10 }}>
            <Text style={{ fontSize: 9, color: "#333", letterSpacing: 1 }}>Desconectar Strava</Text>
          </Pressable>
        </>
      )}

      {connected === true && !isPast && (
        <Text style={{ fontSize: 10, color: "#444", marginTop: 8, textAlign: "center" }}>
          O botão "Resultado" aparece após a data da prova.
        </Text>
      )}
    </View>
  );
}

// ─── MAIN SCREEN ──────────────────────────────────────────────────────────────

export default function ProvasScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, updateProfile, setCurrentWeek } = useAthlete();
  const { profile, currentWeek } = state;

  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDateStr, setDraftDateStr] = useState("");
  const [draftDistance, setDraftDistance] = useState<number>(42);
  const [draftPriority, setDraftPriority] = useState<RacePriority>("P1");
  const [draftAddress, setDraftAddress] = useState("");
  const [draftStartHour, setDraftStartHour] = useState(7);
  const [draftPaceMinKm, setDraftPaceMinKm] = useState(6.0);
  const [draftIsAnchor, setDraftIsAnchor] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [validationResult, setValidationResult] = useState<{ ok: boolean; warning: boolean; message: string } | null>(null);
  const [raceFilter, setRaceFilter] = useState<"TODAS" | RacePriority | "PASSADAS">("TODAS");

  const races: Race[] = useMemo(() => {
    const stored = profile.races ?? [];
    if (stored.length === 0) {
      return [{
        id: "p1-legacy",
        name: profile.targetRaceName,
        date: profile.targetRaceDate,
        distanceKm: profile.targetRaceDistanceKm,
        priority: "P1" as RacePriority,
      }];
    }
    return stored;
  }, [profile]);

  const activeRaces = useMemo(() => races.filter((r) => !r.archived), [races]);

  const futureRaces = useMemo(() => {
    return [...activeRaces]
      .filter((r) => getDaysUntilRace(r.date) >= 0)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [activeRaces]);

  const nextRace = futureRaces[0] ?? [...activeRaces].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

  const nextP1Race = useMemo(() => {
    const nextP1 = futureRaces.find((r) => r.priority === "P1");
    if (nextP1) return nextP1;
    const anyP1 = activeRaces.find((r) => r.priority === "P1");
    return anyP1 ?? activeRaces[0];
  }, [futureRaces, activeRaces]);

  const macrocycleRace = useMemo(() => {
    const id = (profile as any).macrocycleRaceId as string | null | undefined;
    if (!id) return null;
    return activeRaces.find((r) => r.id === id) ?? null;
  }, [profile, activeRaces]);

  const anchorRace = macrocycleRace ?? nextP1Race ?? nextRace ?? null;

  // Races within 2 days → show logistics
  const upcomingRaces = useMemo(
    () => activeRaces.filter((r) => {
      const d = getDaysUntilRace(r.date);
      return d >= 0 && d <= 2;
    }),
    [activeRaces]
  );

  const openNew = useCallback(() => {
    setEditingId(null);
    setDraftName("");
    setDraftDateStr("");
    setDraftDistance(42);
    setDraftPriority("P1");
    setDraftAddress("");
    setDraftStartHour(7);
    setDraftPaceMinKm(6.0);
    setDraftIsAnchor(false);
    setValidationResult(null);
    setEditing(true);
  }, []);

  const openEdit = useCallback((race: Race) => {
    setEditingId(race.id);
    setDraftName(race.name);
    setDraftDateStr(formatDateBR(race.date));
    setDraftDistance(race.distanceKm);
    setDraftPriority(race.priority);
    setDraftAddress(race.address ?? "");
    setDraftStartHour(parseInt((race.raceStartTime ?? "07:00").split(":")[0] ?? "7", 10));
    setDraftPaceMinKm(race.targetPaceMinKm ?? 6.0);
    setDraftIsAnchor((profile as any).macrocycleRaceId === race.id);
    setValidationResult(null);
    setEditing(true);
  }, [profile]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditingId(null);
    setValidationResult(null);
  }, []);

  const handleSave = useCallback(async () => {
    const isoDate = parseBRDate(draftDateStr);
    if (!isoDate) {
      Alert.alert("Data inválida", "Use o formato DD/MM/AAAA (ex: 22/08/2026).");
      return;
    }
    if (!draftName.trim()) {
      Alert.alert("Nome obrigatório", "Digite o nome da prova.");
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const raceStartTime = `${String(draftStartHour).padStart(2, "0")}:00`;
    const raceData: Omit<Race, "id"> = {
      name: draftName.trim(),
      date: isoDate,
      distanceKm: draftDistance,
      priority: draftPriority,
      address: draftAddress.trim() || undefined,
      raceStartTime,
      targetPaceMinKm: draftPaceMinKm,
      archived: false,
    };

    let newRaces: Race[];
    let savedRaceId: string;
    if (editingId) {
      savedRaceId = editingId;
      newRaces = races.map((r) => (r.id === editingId ? { ...r, ...raceData } : r));
    } else {
      savedRaceId = genId();
      const newRace: Race = { id: savedRaceId, ...raceData };
      newRaces = [...races, newRace];
    }

    newRaces.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const nextMacroId = draftIsAnchor ? savedRaceId : ((profile as any).macrocycleRaceId as string | null | undefined);
    const macroRaceNext =
      (nextMacroId ? newRaces.find((r) => r.id === nextMacroId) : undefined) ??
      newRaces.filter((r) => !r.archived && r.priority === "P1").sort((a, b) => a.date.localeCompare(b.date))[0] ??
      newRaces.filter((r) => !r.archived)[0];

    const macroDateISO = macroRaceNext?.date ?? isoDate;

    for (const r of newRaces) {
      if (r.archived) continue;
      const val = validateRacePlacement(r, macroDateISO);
      if (!val.ok && r.id === (editingId ?? newRaces[newRaces.length - 1]?.id)) {
        setValidationResult(val);
      }
    }

    await updateProfile({
      races: newRaces,
      ...(draftIsAnchor ? { macrocycleRaceId: savedRaceId } : {}),
    });

    // Schedule pre-race notification
    if (notificationsSupported()) {
      const granted = await requestNotifPermission();
      if (granted) {
        const savedRace = editingId
          ? newRaces.find((r) => r.id === editingId)
          : newRaces.find((r) => r.priority === draftPriority);
        if (savedRace) {
          await schedulePreRaceReminder({
            raceId: savedRace.id,
            raceName: savedRace.name,
            priority: savedRace.priority,
            raceDateISO: savedRace.date,
            athleteName: profile.name,
          });
        }
      }
    }

    setEditing(false);
    setEditingId(null);
  }, [draftName, draftDateStr, draftDistance, draftPriority, draftAddress, draftStartHour, draftPaceMinKm, draftIsAnchor, editingId, races, updateProfile, profile]);

  const handleDelete = useCallback(async (id: string) => {
    await cancelPreRaceReminder(id);
    const nextRaces = races.map((r) => (r.id === id ? { ...r, archived: true } : r));
    const isAnchor = ((profile as any).macrocycleRaceId as string | null | undefined) === id;
    await updateProfile({
      races: nextRaces,
      ...(isAnchor ? { macrocycleRaceId: null } : {}),
    });
    setEditing(false);
    setValidationResult(null);
  }, [races, updateProfile, profile]);

  const handleGenerateWeeklyPDF = useCallback(async () => {
    setPdfLoading(true);
    try {
      const html = generateWeeklyReport(state, currentWeek);
      await openPDF(html, `Relatório Semana ${currentWeek}`);
    } catch {
      Alert.alert("Erro ao gerar PDF", "Tente novamente em instantes.");
    } finally {
      setPdfLoading(false);
    }
  }, [state, currentWeek]);

  const handleGenerateLogisticsPDF = useCallback(async (race: Race, travelMin: number, weather: WeatherData | null) => {
    try {
      const wHtml = weather?.available ? formatWeatherForPDF(weather) : undefined;
      const adjPace = weather?.available && weather.paceAdjustmentPercent > 0 ? weather.adjustedPaceMinKm : undefined;
      const adjTime = adjPace ? calcEstimatedTimeMin(race.distanceKm, adjPace) : undefined;
      const html = generateLogisticsReport({
        race, travelMin, athleteName: profile.name,
        p1DateISO: anchorRace?.date ?? race.date,
        weatherHtml: wHtml,
        adjustedPaceMinKm: adjPace,
        adjustedEstimatedMin: adjTime,
      });
      await openPDF(html, `Logística — ${race.name}`);
    } catch {
      Alert.alert("Erro ao gerar PDF", "Tente novamente em instantes.");
    }
  }, [profile.name, anchorRace]);

  const daysUntil = getDaysUntilRace(anchorRace?.date ?? profile.targetRaceDate);
  const weeksUntilRace = Math.ceil(daysUntil / 7);
  const weeksArray = Array.from({ length: 16 }, (_, i) => i + 1);
  const anchorId = (profile as any).macrocycleRaceId as string | null | undefined;

  const racesForList = useMemo(() => {
    const sorted = [...races].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (raceFilter === "PASSADAS") {
      return sorted.filter((r) => !r.archived && getDaysUntilRace(r.date) < 0);
    }
    if (raceFilter === "TODAS") {
      return sorted.filter((r) => !r.archived);
    }
    return sorted.filter((r) => !r.archived && r.priority === raceFilter);
  }, [races, raceFilter]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top + 16,
      paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
    },
    pageTitle: { fontSize: 10, letterSpacing: 4, color: colors.primary, fontWeight: "800" as const, marginBottom: 4 },
    pageSubtitle: { fontSize: 22, fontWeight: "800" as const, color: colors.foreground, letterSpacing: -0.5, marginBottom: 20 },
    raceHeroCard: {
      backgroundColor: "#1A0A00", borderRadius: colors.radius,
      borderWidth: 1.5, borderColor: colors.primary, padding: 20, marginBottom: 12,
    },
    raceHeroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
    raceTag: { fontSize: 9, letterSpacing: 3, fontWeight: "800" as const, marginBottom: 4 },
    raceName: { fontSize: 20, fontWeight: "800" as const, color: colors.foreground, letterSpacing: -0.5 },
    raceRoleDesc: { fontSize: 11, color: colors.mutedForeground, marginTop: 4, lineHeight: 16 },
    raceDistanceBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, alignItems: "center" },
    raceDistanceNum: { fontSize: 20, fontWeight: "800" as const, color: "#000000", letterSpacing: -1 },
    raceDistanceUnit: { fontSize: 9, fontWeight: "700" as const, color: "#000000", letterSpacing: 1 },
    raceMetaRow: { flexDirection: "row", gap: 16, marginBottom: 16, flexWrap: "wrap" as const },
    raceMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
    raceMetaText: { fontSize: 11, color: colors.mutedForeground, letterSpacing: 0.5 },
    countdownRow: { flexDirection: "row", justifyContent: "space-around", borderTopWidth: 1, borderTopColor: "#FF5F0033", paddingTop: 14 },
    countdownItem: { alignItems: "center" },
    countdownNum: { fontSize: 28, fontWeight: "800" as const, color: colors.primary, letterSpacing: -1 },
    countdownLabel: { fontSize: 9, letterSpacing: 2, color: colors.mutedForeground },
    actionsRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
    actionBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
    actionBtnText: { fontSize: 9, letterSpacing: 2, fontWeight: "700" as const },
    secondaryCard: {
      borderRadius: colors.radius, borderWidth: 1, padding: 14, marginBottom: 8,
      flexDirection: "row", alignItems: "center", gap: 12,
    },
    priorityBadge: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    priorityBadgeText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 1 },
    secondaryInfo: { flex: 1 },
    secondaryName: { fontSize: 13, fontWeight: "700" as const, color: colors.foreground },
    secondaryMeta: { fontSize: 10, color: colors.mutedForeground, marginTop: 2, letterSpacing: 0.5 },
    secondaryRole: { fontSize: 9, color: colors.mutedForeground, marginTop: 1, fontStyle: "italic" as const },
    validationBanner: { borderRadius: 10, borderWidth: 1, padding: 12, marginBottom: 12 },
    validationText: { fontSize: 11, lineHeight: 17 },
    editCard: {
      backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 16, gap: 12,
    },
    editCardTitle: { fontSize: 11, letterSpacing: 3, color: colors.primary, fontWeight: "800" as const, marginBottom: 4 },
    inputLabel: { fontSize: 9, letterSpacing: 2, color: colors.mutedForeground, marginBottom: 4 },
    inputField: {
      backgroundColor: colors.input, borderRadius: 8, borderWidth: 1,
      borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12,
      color: colors.foreground, fontSize: 14,
    },
    priorityPicker: { flexDirection: "row", gap: 8 },
    priorityOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: "center", gap: 2 },
    priorityOptionLabel: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 1 },
    priorityOptionSub: { fontSize: 7, letterSpacing: 0.5, textAlign: "center" as const },
    chipRow: { flexDirection: "row", flexWrap: "wrap" as const, gap: 8 },
    chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1 },
    chipText: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0.5 },
    distancePicker: { flexDirection: "row", gap: 8 },
    distanceOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, alignItems: "center" },
    distanceOptionText: { fontSize: 13, fontWeight: "700" as const, letterSpacing: 1 },
    saveBtn: { backgroundColor: colors.primary, borderRadius: colors.radius - 2, paddingVertical: 14, alignItems: "center", marginTop: 4 },
    saveBtnText: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 3, color: "#000000" },
    deleteBtn: { borderWidth: 1, borderColor: "#EF444422", borderRadius: colors.radius - 2, paddingVertical: 10, alignItems: "center", marginTop: 2 },
    deleteBtnText: { fontSize: 10, fontWeight: "700" as const, letterSpacing: 2, color: "#EF4444" },
    sectionLabel: { fontSize: 10, letterSpacing: 3, color: colors.mutedForeground, marginBottom: 12, marginTop: 8 },
    calendarCard: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
    calendarRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
    calendarWeekNum: { width: 32, fontSize: 11, fontWeight: "700" as const, letterSpacing: 1, color: colors.mutedForeground },
    calendarPhase: { width: 6, height: 6, borderRadius: 3, marginRight: 10 },
    calendarInfo: { flex: 1 },
    calendarWeekLabel: { fontSize: 12, color: colors.foreground, fontWeight: "600" as const },
    calendarSubLabel: { fontSize: 10, color: colors.mutedForeground, letterSpacing: 0.5 },
    calendarVol: { fontSize: 12, fontWeight: "700" as const },
    currentRowHighlight: { backgroundColor: "#FF5F0011" },
    raceRow: { backgroundColor: "#FF5F0022" },
    pdfBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 8, borderRadius: colors.radius - 2, paddingVertical: 13, marginBottom: 20,
      borderWidth: 1, borderColor: colors.primary + "44", backgroundColor: colors.primary + "11",
    },
    pdfBtnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2, color: colors.primary },
  });

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.pageTitle}>CALENDÁRIO DE PROVAS</Text>
        <Text style={s.pageSubtitle}>
          Próxima prova: {nextRace ? `${nextRace.name} · ${nextRace.priority} · ${formatDateBR(nextRace.date)}` : "—"}
        </Text>
        <Text style={s.pageSubtitle}>
          Macrociclo (âncora): {anchorRace ? `${anchorRace.name} · ${anchorRace.priority} · ${formatDateBR(anchorRace.date)}` : "—"}
        </Text>
        <Text style={s.pageSubtitle}>
          Próxima P1 (ref): {nextP1Race ? `${nextP1Race.name} · ${formatDateBR(nextP1Race.date)}` : "—"}
        </Text>

        {/* ── PRE-RACE LOGISTICS (≤2 days) ──────────── */}
        {upcomingRaces.length > 0 && (
          <>
            <Text style={s.sectionLabel}>🏁 LOGÍSTICA ATIVA</Text>
            {upcomingRaces.map((race) => (
              <React.Fragment key={race.id}>
                <LogisticsCard
                  race={race}
                  p1DateISO={anchorRace?.date ?? race.date}
                  colors={colors}
                  onGeneratePDF={handleGenerateLogisticsPDF}
                />
                {(!anchorRace || race.id !== anchorRace.id) && <StravaSection race={race} colors={colors} />}
              </React.Fragment>
            ))}
          </>
        )}

        {/* ── P1 HERO CARD ──────────────────────────── */}
        {anchorRace && (
          <View style={s.raceHeroCard}>
            <View style={s.raceHeroRow}>
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text style={[s.raceTag, { color: PRIORITY_COLORS[anchorRace.priority] }]}>ÂNCORA DO MACROCICLO · {anchorRace.priority}</Text>
                <Text style={s.raceName}>{anchorRace.name}</Text>
                <Text style={s.raceRoleDesc}>{RACE_ROLE[anchorRace.priority].description}</Text>
              </View>
              <View style={[s.raceDistanceBadge, { backgroundColor: PRIORITY_COLORS[anchorRace.priority] }]}>
                <Text style={s.raceDistanceNum}>{anchorRace.distanceKm}</Text>
                <Text style={s.raceDistanceUnit}>KM</Text>
              </View>
            </View>
            <View style={s.raceMetaRow}>
              <View style={s.raceMeta}>
                <Feather name="calendar" size={12} color={colors.mutedForeground} />
                <Text style={s.raceMetaText}>{formatDateBR(anchorRace.date)}</Text>
              </View>
              {anchorRace.raceStartTime && (
                <View style={s.raceMeta}>
                  <Feather name="clock" size={12} color={colors.mutedForeground} />
                  <Text style={s.raceMetaText}>Largada {anchorRace.raceStartTime}h</Text>
                </View>
              )}
              {anchorRace.address && (
                <View style={s.raceMeta}>
                  <Feather name="map-pin" size={12} color={colors.mutedForeground} />
                  <Text style={[s.raceMetaText, { flex: 1 }]} numberOfLines={1}>{anchorRace.address}</Text>
                </View>
              )}
            </View>
            <View style={s.countdownRow}>
              <View style={s.countdownItem}>
                <Text style={s.countdownNum}>{daysUntil}</Text>
                <Text style={s.countdownLabel}>DIAS</Text>
              </View>
              <View style={{ width: 1, backgroundColor: "#FF5F0033" }} />
              <View style={s.countdownItem}>
                <Text style={s.countdownNum}>{weeksUntilRace}</Text>
                <Text style={s.countdownLabel}>SEMANAS</Text>
              </View>
              <View style={{ width: 1, backgroundColor: "#FF5F0033" }} />
              <View style={s.countdownItem}>
                <Text style={[s.countdownNum, { color: "#4CAF50" }]}>{currentWeek}</Text>
                <Text style={s.countdownLabel}>SEM ATUAL</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── STRAVA (P1 post-race or always) ──────── */}
        {anchorRace && (
          <StravaSection race={anchorRace} colors={colors} />
        )}

        {/* ── ACTION BUTTONS ────────────────────────── */}
        <View style={s.actionsRow}>
          <Pressable
            style={({ pressed }) => [s.actionBtn, { borderColor: colors.primary + "66", backgroundColor: colors.primary + "11", opacity: pressed ? 0.7 : 1, flex: 1 }]}
            onPress={openNew}
          >
            <Feather name="plus" size={12} color={colors.primary} />
            <Text style={[s.actionBtnText, { color: colors.primary }]}>ADICIONAR PROVA</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [s.actionBtn, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            onPress={() => anchorRace && openEdit(anchorRace)}
          >
            <Feather name="edit-2" size={12} color={colors.mutedForeground} />
            <Text style={[s.actionBtnText, { color: colors.mutedForeground }]}>EDITAR ÂNCORA</Text>
          </Pressable>
        </View>

        <Text style={s.sectionLabel}>TODAS AS PROVAS</Text>
        <View style={s.chipRow}>
          {(["TODAS", "P1", "P2", "P3", "PASSADAS"] as const).map((f) => {
            const active = raceFilter === f;
            const col =
              f === "P1" ? PRIORITY_COLORS.P1 :
              f === "P2" ? PRIORITY_COLORS.P2 :
              f === "P3" ? PRIORITY_COLORS.P3 :
              colors.primary;
            return (
              <Pressable
                key={f}
                style={({ pressed }) => [
                  s.chip,
                  {
                    borderColor: active ? col : colors.border,
                    backgroundColor: active ? col + "22" : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
                onPress={() => setRaceFilter(f as any)}
              >
                <Text style={[s.chipText, { color: active ? col : colors.mutedForeground }]}>{f}</Text>
              </Pressable>
            );
          })}
        </View>

        {racesForList.length === 0 ? (
          <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 16 }}>
            Nenhuma prova nesta categoria.
          </Text>
        ) : (
          racesForList.map((race) => {
            const col = PRIORITY_COLORS[race.priority];
            const d = getDaysUntilRace(race.date);
            const role = RACE_ROLE[race.priority];
            const val = validateRacePlacement(race, anchorRace?.date ?? race.date);
            const isAnchor = anchorId && race.id === anchorId;
            return (
              <Pressable
                key={race.id}
                style={({ pressed }) => [
                  s.secondaryCard,
                  {
                    backgroundColor: col + "0D",
                    borderColor: val.warning ? "#FF980033" : col + "33",
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
                onPress={() => openEdit(race)}
              >
                <View style={[s.priorityBadge, { backgroundColor: col + "22" }]}>
                  <Text style={[s.priorityBadgeText, { color: col }]}>{race.priority}</Text>
                </View>
                <View style={s.secondaryInfo}>
                  <Text style={s.secondaryName}>{race.name}{isAnchor ? " · ÂNCORA" : ""}</Text>
                  <Text style={s.secondaryMeta}>
                    {race.distanceKm}km · {formatDateBR(race.date)} · {d > 0 ? `${d} dias` : "Passada"}
                  </Text>
                  <Text style={s.secondaryRole}>{role.description.split(".")[0]}.</Text>
                  {val.warning && (
                    <Text style={{ fontSize: 9, color: "#FF9800", marginTop: 2 }}>
                      ⚠️ Verificar posicionamento no ciclo
                    </Text>
                  )}
                </View>
                <Feather name={isAnchor ? "star" : "chevron-right"} size={14} color={colors.mutedForeground} />
              </Pressable>
            );
          })
        )}

        {/* ── EDIT / NEW FORM ───────────────────────── */}
        {editing && (
          <View style={s.editCard}>
            <Text style={s.editCardTitle}>{editingId ? "EDITAR PROVA" : "NOVA PROVA"}</Text>

            {validationResult && !validationResult.ok && (
              <View style={[s.validationBanner, { backgroundColor: "#1A1000", borderColor: "#FF980044" }]}>
                <Text style={[s.validationText, { color: "#FF9800" }]}>{validationResult.message}</Text>
              </View>
            )}

            {/* Priority */}
            <View>
              <Text style={s.inputLabel}>PRIORIDADE</Text>
              <View style={s.priorityPicker}>
                {PRIORITIES.map((p) => {
                  const col = PRIORITY_COLORS[p];
                  const active = draftPriority === p;
                  const roleInfo = RACE_ROLE[p];
                  return (
                    <Pressable
                      key={p}
                      style={[s.priorityOption, { backgroundColor: active ? col + "22" : colors.secondary, borderColor: active ? col : colors.border }]}
                      onPress={() => setDraftPriority(p)}
                    >
                      <Text style={[s.priorityOptionLabel, { color: active ? col : colors.mutedForeground }]}>{p}</Text>
                      <Text style={[s.priorityOptionSub, { color: active ? col + "BB" : colors.border }]}>
                        {p === "P1" ? "ALVO" : p === "P2" ? "POLIMENTO" : "PARTICIP."}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 6, lineHeight: 15, fontStyle: "italic" as const }}>
                {RACE_ROLE[draftPriority].description}
              </Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={s.inputLabel}>ÂNCORA DO MACROCICLO</Text>
                <Text style={{ fontSize: 10, color: colors.mutedForeground, lineHeight: 15 }}>
                  Define qual prova dita a fase/semana do ciclo de 16 semanas.
                </Text>
              </View>
              <Switch
                value={draftIsAnchor}
                onValueChange={setDraftIsAnchor}
                trackColor={{ false: colors.border, true: colors.primary + "88" }}
                thumbColor={draftIsAnchor ? colors.primary : colors.mutedForeground}
              />
            </View>

            {/* Name */}
            <View>
              <Text style={s.inputLabel}>NOME DA PROVA</Text>
              <TextInput style={s.inputField} value={draftName} onChangeText={setDraftName}
                placeholderTextColor={colors.mutedForeground} placeholder="Ex: Maratona São Paulo" autoCapitalize="words" />
            </View>

            {/* Date */}
            <View>
              <Text style={s.inputLabel}>DATA DA PROVA (DD/MM/AAAA)</Text>
              <TextInput
                style={s.inputField} value={draftDateStr}
                onChangeText={(t) => setDraftDateStr(autoFormatDate(t, draftDateStr))}
                placeholderTextColor={colors.mutedForeground} placeholder="22/08/2026"
                keyboardType="number-pad" maxLength={10}
              />
            </View>

            {/* Address */}
            <View>
              <Text style={s.inputLabel}>LOCAL / ENDEREÇO DA PROVA</Text>
              <TextInput style={s.inputField} value={draftAddress} onChangeText={setDraftAddress}
                placeholderTextColor={colors.mutedForeground}
                placeholder="Ex: Parque Ibirapuera, São Paulo - SP" autoCapitalize="words" />
            </View>

            {/* Start time */}
            <View>
              <Text style={s.inputLabel}>HORÁRIO DE LARGADA</Text>
              <View style={s.chipRow}>
                {START_HOURS.map((h) => {
                  const active = draftStartHour === h;
                  return (
                    <Pressable key={h}
                      style={[s.chip, { backgroundColor: active ? colors.primary + "22" : colors.secondary, borderColor: active ? colors.primary : colors.border }]}
                      onPress={() => setDraftStartHour(h)}>
                      <Text style={[s.chipText, { color: active ? colors.primary : colors.mutedForeground }]}>{String(h).padStart(2,"0")}h</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Distance */}
            <View>
              <Text style={s.inputLabel}>DISTÂNCIA</Text>
              <View style={s.distancePicker}>
                {DISTANCES.map((d) => (
                  <Pressable key={d}
                    style={[s.distanceOption, { backgroundColor: draftDistance === d ? colors.primary + "22" : colors.secondary, borderColor: draftDistance === d ? colors.primary : colors.border }]}
                    onPress={() => setDraftDistance(d)}>
                    <Text style={[s.distanceOptionText, { color: draftDistance === d ? colors.primary : colors.mutedForeground }]}>{d}km</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Target pace */}
            <View>
              <Text style={s.inputLabel}>PACE ALVO (min/km)</Text>
              <View style={s.chipRow}>
                {PACE_OPTIONS.map((p) => {
                  const active = draftPaceMinKm === p;
                  return (
                    <Pressable key={p}
                      style={[s.chip, { backgroundColor: active ? colors.primary + "22" : colors.secondary, borderColor: active ? colors.primary : colors.border }]}
                      onPress={() => setDraftPaceMinKm(p)}>
                      <Text style={[s.chipText, { color: active ? colors.primary : colors.mutedForeground }]}>{formatPace(p)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 6 }}>
                Tempo estimado: {formatDuration(calcEstimatedTimeMin(draftDistance, draftPaceMinKm))} · {calcGelCount(calcEstimatedTimeMin(draftDistance, draftPaceMinKm))} géis
              </Text>
            </View>

            <Pressable style={({ pressed }) => [s.saveBtn, { opacity: pressed ? 0.8 : 1 }]} onPress={handleSave}>
              <Text style={s.saveBtnText}>SALVAR PROVA</Text>
            </Pressable>

            {editingId && races.length > 1 && (
              <Pressable
                style={({ pressed }) => [s.deleteBtn, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => Alert.alert("Arquivar prova?", "Ela não aparecerá mais nas listas principais.", [
                  { text: "Cancelar", style: "cancel" },
                  { text: "Arquivar", style: "destructive", onPress: () => handleDelete(editingId) },
                ])}
              >
                <Text style={s.deleteBtnText}>ARQUIVAR PROVA</Text>
              </Pressable>
            )}

            <Pressable style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, alignItems: "center", padding: 8 }]} onPress={cancelEdit}>
              <Text style={{ fontSize: 10, letterSpacing: 2, color: colors.mutedForeground }}>CANCELAR</Text>
            </Pressable>
          </View>
        )}

        {/* ── PDF REPORT BUTTON ─────────────────────── */}
        <Pressable
          style={({ pressed }) => [s.pdfBtn, { opacity: pressed || pdfLoading ? 0.7 : 1 }]}
          onPress={handleGenerateWeeklyPDF}
          disabled={pdfLoading}
        >
          {pdfLoading ? <ActivityIndicator size="small" color={colors.primary} /> : <Feather name="file-text" size={14} color={colors.primary} />}
          <Text style={s.pdfBtnText}>{pdfLoading ? "GERANDO PDF..." : `RELATÓRIO PDF — SEMANA ${currentWeek}`}</Text>
        </Pressable>

        {/* ── 16-WEEK CALENDAR ──────────────────────── */}
        <Text style={s.sectionLabel}>CALENDÁRIO RETROATIVO — 16 SEMANAS</Text>
        <View style={s.calendarCard}>
          {weeksArray.map((week) => {
            const phase = getPhase(week);
            const phaseColor = getPhaseColor(phase);
            const vol = getWeeklyVolume(week);
            const anchorDateISO = anchorRace?.date ?? profile.targetRaceDate;
            const weekDate = getWeekRaceDateISO(anchorDateISO, week);
            const isCurrentWeek = week === currentWeek;
            const isRaceWeek = week === 16;
            const isRecovery = week % 4 === 0 && week !== 16;
            const secondaryRaceThisWeek = races.find((r) => {
              if (r.archived) return false;
              if (anchorRace && r.id === anchorRace.id) return false;
              const rWeek = getRaceWeekInCycle(anchorDateISO, r.date);
              return rWeek === week;
            });
            return (
              <View key={week} style={[s.calendarRow, isCurrentWeek && s.currentRowHighlight, isRaceWeek && s.raceRow, week === 16 && { borderBottomWidth: 0 }]}>
                <Text style={[s.calendarWeekNum, isCurrentWeek && { color: colors.primary }]}>S{week}</Text>
                <View style={[s.calendarPhase, { backgroundColor: phaseColor }]} />
                <View style={s.calendarInfo}>
                  <Text style={[s.calendarWeekLabel, isCurrentWeek && { color: colors.primary }]}>
                    {isRaceWeek ? `PROVA — ${anchorRace?.name ?? profile.targetRaceName}` : `Semana ${week} · ${phase}`}
                    {isCurrentWeek ? " ◀" : ""}
                  </Text>
                  <Text style={s.calendarSubLabel}>
                    {isRecovery ? "RECUPERAÇÃO · " : ""}
                    {secondaryRaceThisWeek ? `🏁 ${secondaryRaceThisWeek.priority} · ` : ""}
                    {formatDateBR(weekDate)}
                  </Text>
                </View>
                <Text style={[s.calendarVol, { color: isRaceWeek ? colors.primary : phaseColor }]}>
                  {isRaceWeek ? `${anchorRace?.distanceKm ?? profile.targetRaceDistanceKm}km` : `${vol}km`}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── PDF HELPER ───────────────────────────────────────────────────────────────

async function openPDF(html: string, title: string): Promise<void> {
  if (Platform.OS === "web") {
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
    return;
  }
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) {
    await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: title, UTI: "com.adobe.pdf" });
  } else {
    await Print.printAsync({ uri });
  }
}
