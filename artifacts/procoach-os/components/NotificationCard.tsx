import { Feather } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { useAthlete } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";
import {
  cancelDailyNotif,
  getScheduledNotifId,
  loadNotifPrefs,
  type NotifPrefs,
  notificationsSupported,
  requestNotifPermission,
  saveNotifPrefs,
  scheduleDaily,
  sendTestNotif,
} from "@/utils/notifications";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

export function NotificationCard() {
  const colors = useColors();
  const { state } = useAthlete();

  const [prefs, setPrefs] = useState<NotifPrefs>({ enabled: false, hour: 7, minute: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scheduledId, setScheduledId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const p = await loadNotifPrefs();
      const id = await getScheduledNotifId();
      setPrefs(p);
      setScheduledId(id);
      setLoading(false);
    })();
  }, []);

  const applyPrefs = useCallback(
    async (newPrefs: NotifPrefs) => {
      setSaving(true);
      await saveNotifPrefs(newPrefs);

      if (!newPrefs.enabled) {
        await cancelDailyNotif();
        setScheduledId(null);
      } else {
        const granted = await requestNotifPermission();
        if (!granted) {
          if (Platform.OS !== "web") {
            Alert.alert(
              "Permissão Necessária",
              "Habilite notificações nas Configurações do celular para receber lembretes do PROCOACH OS.",
              [{ text: "OK" }]
            );
          }
          setSaving(false);
          return;
        }
        const workout = state.todayWorkout;
        const id = await scheduleDaily({
          hour: newPrefs.hour,
          minute: newPrefs.minute,
          week: state.currentWeek,
          workoutType: workout.type,
          distanceKm: workout.distanceKm,
          durationMin: workout.durationMin,
          athleteName: state.profile.name,
        });
        setScheduledId(id);
      }
      setPrefs(newPrefs);
      setSaving(false);
    },
    [state.todayWorkout, state.currentWeek, state.profile.name]
  );

  const handleToggle = useCallback(
    (val: boolean) => applyPrefs({ ...prefs, enabled: val }),
    [prefs, applyPrefs]
  );

  const handleHourChange = useCallback(
    (h: number) => {
      const next = { ...prefs, hour: h };
      setPrefs(next);
      if (prefs.enabled) applyPrefs(next);
    },
    [prefs, applyPrefs]
  );

  const handleMinuteChange = useCallback(
    (m: number) => {
      const next = { ...prefs, minute: m };
      setPrefs(next);
      if (prefs.enabled) applyPrefs(next);
    },
    [prefs, applyPrefs]
  );

  const handleTest = useCallback(async () => {
    if (Platform.OS === "web") {
      Alert.alert("Notificações", "Notificações locais só funcionam no app nativo (iOS/Android).");
      return;
    }
    const granted = await requestNotifPermission();
    if (!granted) {
      Alert.alert("Permissão Negada", "Habilite notificações nas configurações do dispositivo.");
      return;
    }
    await sendTestNotif({
      week: state.currentWeek,
      workoutType: state.todayWorkout.type,
      distanceKm: state.todayWorkout.distanceKm,
      durationMin: state.todayWorkout.durationMin,
      athleteName: state.profile.name,
    });
    Alert.alert("Teste Enviado!", "A notificação chegará em 2 segundos.", [{ text: "OK" }]);
  }, [state]);

  const fmt = (h: number, m: number) =>
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  const s = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: prefs.enabled ? colors.primary + "55" : colors.border,
      padding: 16,
      marginBottom: 12,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    iconBox: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: prefs.enabled ? colors.primary + "22" : colors.secondary,
      alignItems: "center",
      justifyContent: "center",
    },
    titleBlock: { flex: 1 },
    title: {
      fontSize: 13,
      fontWeight: "800" as const,
      color: colors.foreground,
      letterSpacing: 0.5,
    },
    subtitle: {
      fontSize: 10,
      color: colors.mutedForeground,
      letterSpacing: 1,
      marginTop: 1,
    },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },
    timeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 10,
    },
    timeLabel: {
      fontSize: 10,
      letterSpacing: 2,
      color: colors.mutedForeground,
      width: 60,
    },
    timeDisplay: {
      fontSize: 28,
      fontWeight: "800" as const,
      color: prefs.enabled ? colors.primary : colors.mutedForeground,
      letterSpacing: -1,
      minWidth: 80,
    },
    pickerRow: {
      flexDirection: "row",
      flexWrap: "wrap" as const,
      gap: 6,
    },
    pickerBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 8,
      borderWidth: 1,
    },
    pickerBtnText: {
      fontSize: 11,
      fontWeight: "700" as const,
      letterSpacing: 1,
    },
    pickerLabel: {
      fontSize: 9,
      letterSpacing: 2,
      color: colors.mutedForeground,
      marginBottom: 6,
      marginTop: 10,
    },
    statusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 12,
    },
    statusText: {
      fontSize: 10,
      color: colors.mutedForeground,
      letterSpacing: 1,
    },
    testBtn: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.primary + "55",
      backgroundColor: colors.primary + "11",
    },
    testBtnText: {
      fontSize: 10,
      fontWeight: "800" as const,
      color: colors.primary,
      letterSpacing: 1.5,
    },
    webNote: {
      fontSize: 10,
      color: colors.mutedForeground,
      letterSpacing: 1,
      textAlign: "center" as const,
      marginTop: 10,
      fontStyle: "italic" as const,
    },
  });

  if (loading) {
    return (
      <View style={[s.card, { alignItems: "center", paddingVertical: 24 }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Expo Go (SDK 53+): push notifications not supported — show info banner
  if (!notificationsSupported()) {
    return (
      <View style={s.card}>
        <View style={s.header}>
          <View style={s.iconBox}>
            <Feather name="bell-off" size={16} color={colors.mutedForeground} />
          </View>
          <View style={s.titleBlock}>
            <Text style={s.title}>LEMBRETE DIÁRIO</Text>
            <Text style={s.subtitle}>REQUER BUILD DE DESENVOLVIMENTO</Text>
          </View>
        </View>
        <Text style={[s.webNote, { marginTop: 12 }]}>
          Notificações push não estão disponíveis no Expo Go (SDK 53+).{"\n"}
          Use um Development Build para ativar esta função.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.header}>
        <View style={s.iconBox}>
          <Feather
            name="bell"
            size={16}
            color={prefs.enabled ? colors.primary : colors.mutedForeground}
          />
        </View>
        <View style={s.titleBlock}>
          <Text style={s.title}>LEMBRETE DIÁRIO</Text>
          <Text style={s.subtitle}>
            {prefs.enabled
              ? `ATIVO · TODO DIA ÀS ${fmt(prefs.hour, prefs.minute)}`
              : "DESATIVADO"}
          </Text>
        </View>
        {saving ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Switch
            value={prefs.enabled}
            onValueChange={handleToggle}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor={prefs.enabled ? "#000" : colors.mutedForeground}
          />
        )}
      </View>

      {prefs.enabled && (
        <>
          <View style={s.divider} />
          <View style={s.timeRow}>
            <Text style={s.timeLabel}>HORÁRIO</Text>
            <Text style={s.timeDisplay}>{fmt(prefs.hour, prefs.minute)}</Text>
          </View>

          <Text style={s.pickerLabel}>HORA</Text>
          <View style={s.pickerRow}>
            {[5, 6, 7, 8, 9, 10, 11, 12, 18, 19, 20, 21].map((h) => {
              const sel = prefs.hour === h;
              return (
                <Pressable
                  key={h}
                  style={[
                    s.pickerBtn,
                    {
                      backgroundColor: sel ? colors.primary : colors.secondary,
                      borderColor: sel ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleHourChange(h)}
                >
                  <Text
                    style={[
                      s.pickerBtnText,
                      { color: sel ? "#000" : colors.mutedForeground },
                    ]}
                  >
                    {String(h).padStart(2, "0")}h
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={s.pickerLabel}>MINUTO</Text>
          <View style={s.pickerRow}>
            {MINUTES.map((m) => {
              const sel = prefs.minute === m;
              return (
                <Pressable
                  key={m}
                  style={[
                    s.pickerBtn,
                    {
                      backgroundColor: sel ? colors.primary : colors.secondary,
                      borderColor: sel ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => handleMinuteChange(m)}
                >
                  <Text
                    style={[
                      s.pickerBtnText,
                      { color: sel ? "#000" : colors.mutedForeground },
                    ]}
                  >
                    :{String(m).padStart(2, "0")}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {scheduledId && (
            <View style={s.statusRow}>
              <Feather name="check-circle" size={12} color="#4CAF50" />
              <Text style={s.statusText}>
                Lembrete agendado para as {fmt(prefs.hour, prefs.minute)} com o treino da Semana {state.currentWeek}
              </Text>
            </View>
          )}

          <Pressable style={s.testBtn} onPress={handleTest}>
            <Feather name="send" size={12} color={colors.primary} />
            <Text style={s.testBtnText}>ENVIAR NOTIFICAÇÃO DE TESTE</Text>
          </Pressable>
        </>
      )}

      {Platform.OS === "web" && (
        <Text style={s.webNote}>
          Notificações locais requerem o app nativo (iOS/Android via Expo Go ou build)
        </Text>
      )}
    </View>
  );
}
