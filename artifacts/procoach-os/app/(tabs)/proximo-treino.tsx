import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { ProCoachAPI } from "@/services/api";

function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code <= 67) return "🌧️";
  return "⛈️";
}

type PlanSession = {
  session_date: string;
  day_name: string | null;
  activity: string;
  pace_target: string | null;
  treadmill_speed: string | null;
  rest_interval: string | null;
  structure: string | null;
  planned_km?: number;
};

export default function ProximoTreinoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [nextSession, setNextSession] = React.useState<PlanSession | null>(null);
  const [sessionLoading, setSessionLoading] = React.useState(false);
  const [weather, setWeather] = React.useState<null | {
    emoji: string;
    minC: number;
    maxC: number;
    windKmH: number;
    rainPct: number;
  }>(null);
  const [weatherLoading, setWeatherLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setSessionLoading(true);
    setWeatherLoading(true);
    setWeather(null);
    try {
      const r = await ProCoachAPI.getPlanNext();
      const session = (r.session ?? null) as any;
      setNextSession(session);
      if (!session?.session_date) return;

      const url =
        "https://api.open-meteo.com/v1/forecast" +
        "?latitude=-23.6087&longitude=-46.6676" +
        "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode" +
        "&timezone=America%2FSao_Paulo";
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        daily?: {
          time: string[];
          temperature_2m_max: number[];
          temperature_2m_min: number[];
          precipitation_probability_max: number[];
          windspeed_10m_max: number[];
          weathercode: number[];
        };
      };
      const d = data.daily;
      if (!d?.time?.length) return;
      const idx = d.time.findIndex((t) => t === session.session_date);
      if (idx < 0) return;
      setWeather({
        emoji: weatherEmoji(d.weathercode?.[idx] ?? 0),
        minC: Math.round(d.temperature_2m_min?.[idx] ?? 0),
        maxC: Math.round(d.temperature_2m_max?.[idx] ?? 0),
        windKmH: Math.round(d.windspeed_10m_max?.[idx] ?? 0),
        rainPct: Math.round(d.precipitation_probability_max?.[idx] ?? 0),
      });
    } catch {
    } finally {
      setSessionLoading(false);
      setWeatherLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top + 16,
      paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 18 },
    title: { fontSize: 12, letterSpacing: 3, fontWeight: "800" as const, color: colors.primary },
    subtitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 6, lineHeight: 16 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 12,
    },
    cardTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { fontSize: 10, letterSpacing: 3, fontWeight: "800" as const, color: colors.mutedForeground },
    big: { fontSize: 16, fontWeight: "800" as const, color: colors.foreground, marginTop: 10 },
    meta: { fontSize: 11, color: colors.mutedForeground, marginTop: 8, lineHeight: 16 },
    btn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 10,
      paddingVertical: 12,
      backgroundColor: colors.primary,
      marginTop: 12,
    },
    btnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2, color: "#000000" },
  });

  const nextDate = nextSession?.session_date ?? null;
  const today = getSaoPauloDayKey();

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={s.title}>PRÓXIMO TREINO</Text>
            <Text style={s.subtitle}>
              Briefing do próximo treino do seu plano + clima.
            </Text>
          </View>
          <Pressable onPress={refresh} disabled={sessionLoading || weatherLoading}>
            {(sessionLoading || weatherLoading) ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
            )}
          </Pressable>
        </View>

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>PRÓXIMA SESSÃO</Text>
            {sessionLoading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          </View>
          {nextSession ? (
            <>
              <Text style={s.big}>
                {nextSession.activity}
                {nextSession.planned_km ? ` · ${nextSession.planned_km}km` : ""}
              </Text>
              <Text style={s.meta}>
                Data: {nextSession.session_date} {nextSession.day_name ? `· ${nextSession.day_name}` : ""}
              </Text>
              {(nextSession.pace_target || nextSession.rest_interval || nextSession.treadmill_speed) && (
                <Text style={s.meta}>
                  {nextSession.pace_target ? `Pace: ${nextSession.pace_target}` : ""}
                  {nextSession.pace_target && nextSession.rest_interval ? " · " : ""}
                  {nextSession.rest_interval ? `Rep: ${nextSession.rest_interval}` : ""}
                  {(nextSession.pace_target || nextSession.rest_interval) && nextSession.treadmill_speed ? " · " : ""}
                  {nextSession.treadmill_speed ? `Esteira: ${nextSession.treadmill_speed}` : ""}
                </Text>
              )}
              {!!nextSession.structure && (
                <Text style={s.meta}>
                  {nextSession.structure}
                </Text>
              )}
            </>
          ) : (
            <Text style={s.subtitle}>
              Nenhum próximo treino encontrado. Importe o plano na aba Status.
            </Text>
          )}
        </View>

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>CLIMA</Text>
            {weatherLoading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          </View>
          {nextDate && nextDate <= today ? (
            <Text style={s.subtitle}>
              O próximo treino está marcado para hoje/ontem. Reimporte o plano ou ajuste as datas.
            </Text>
          ) : weather ? (
            <>
              <Text style={s.big}>
                {weather.emoji} {weather.minC}°–{weather.maxC}°
              </Text>
              <Text style={s.meta}>
                💧 {weather.rainPct}% · 💨 {weather.windKmH}km/h
              </Text>
            </>
          ) : (
            <Text style={s.subtitle}>
              {weatherLoading ? "Buscando previsão..." : "Previsão indisponível para esta data."}
            </Text>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>NOTA</Text>
          <Text style={s.subtitle}>
            O briefing noturno (22h) é enviado pelo servidor no Telegram quando o agendamento estiver ativo.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
