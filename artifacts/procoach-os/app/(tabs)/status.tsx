import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAthlete } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";
import { ProCoachAPI, getEffectiveApiUrl, setApiUrlOverride } from "@/services/api";
import { getRecoverySuggestion, shouldSuggestRecovery } from "@/utils/training";
import {
  WeeklyReportPrefs,
  cancelWeeklyReportNotif,
  loadWeeklyReportPrefs,
  notificationsSupported,
  requestNotifPermission,
  saveWeeklyReportPrefs,
  scheduleWeeklyReport,
  sendTestWeeklyReportNotif,
} from "@/utils/notifications";

const PAIN_LABELS = ["SEM DOR", "LEVE", "MODERADA", "INTENSA", "SEVERA", "CRÍTICA"];
const PAIN_EMOJIS = ["😊", "🙂", "😐", "😣", "😫", "🚨"];
const PAIN_COLORS = ["#4CAF50", "#8BC34A", "#FF9800", "#FF5722", "#F44336", "#B71C1C"];

const HRV_MIN = 20;
const HRV_MAX = 120;

const HOUR_GREETINGS: Record<number, string> = {
  5: "BOM DIA", 6: "BOM DIA", 7: "BOM DIA", 8: "BOM DIA",
  9: "BOM DIA", 10: "BOM DIA", 11: "BOM DIA", 12: "BOA TARDE",
  13: "BOA TARDE", 14: "BOA TARDE", 15: "BOA TARDE", 16: "BOA TARDE",
  17: "BOA TARDE", 18: "BOA NOITE", 19: "BOA NOITE", 20: "BOA NOITE",
  21: "BOA NOITE", 22: "BOA NOITE", 23: "BOA NOITE",
};

function getGreeting() {
  const h = new Date().getHours();
  return HOUR_GREETINGS[h] ?? "OLÁ";
}

function getHRVStatus(hrv: number): { label: string; color: string; detail: string } {
  if (hrv >= 70) return { label: "EXCELENTE", color: "#4CAF50", detail: "Pronto para treino intenso" };
  if (hrv >= 55) return { label: "BOM", color: "#8BC34A", detail: "Pronto para treinar normalmente" };
  if (hrv >= 45) return { label: "ATENÇÃO", color: "#FF9800", detail: "Treino leve recomendado" };
  if (hrv >= 35) return { label: "BAIXO", color: "#FF5722", detail: "Treino regenerativo indicado" };
  return { label: "CRÍTICO", color: "#EF4444", detail: "Descanso total recomendado" };
}

const HOUR_OPTIONS = Array.from({ length: 16 }, (_, i) => i + 6); // 06h–21h

function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function getSaoPauloWeekStartKey(): string {
  const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day = nowSp.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(nowSp);
  start.setDate(nowSp.getDate() - daysSinceMonday);
  return start.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export default function CheckInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, submitDailyCheckIn, updateProfile } = useAthlete();
  const { hrv, painLevel, profile, lastCheckInDate, aiLoading, currentWeek } = state;

  const todayStr = new Date().toDateString();
  const alreadyCheckedIn = lastCheckInDate === todayStr;

  const [localHRV, setLocalHRV] = useState(hrv);
  const [localHRVText, setLocalHRVText] = useState(String(hrv));
  const [localPain, setLocalPain] = useState(painLevel);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(alreadyCheckedIn);
  const [nameInput, setNameInput] = useState(profile.name);

  const [gelStock, setGelStock] = useState<number>(0);
  const [gelStockText, setGelStockText] = useState<string>("0");
  const [gelLoading, setGelLoading] = useState(false);
  const [gelSaving, setGelSaving] = useState(false);

  const [planJsonText, setPlanJsonText] = useState<string>("");
  const [planImporting, setPlanImporting] = useState(false);
  const [planImportResult, setPlanImportResult] = useState<string>("");
  const [planChecking, setPlanChecking] = useState(false);
  const [planSessions, setPlanSessions] = useState<Array<{
    date: string;
    activity: string;
    paceTarget: string | null;
    structure: string | null;
  }>>([]);

  const [complianceLoading, setComplianceLoading] = useState(false);
  const [compliance, setCompliance] = useState<null | {
    from: string;
    to: string;
    plannedSessions: number;
    plannedKm: number;
    completedSessions: number;
    completedKm: number;
  }>(null);

  const [bioLoading, setBioLoading] = useState(false);
  const [bioSaving, setBioSaving] = useState(false);
  const [bioJsonText, setBioJsonText] = useState<string>("");
  const [bioResult, setBioResult] = useState<string>("");
  const [bioEntries, setBioEntries] = useState<Array<Record<string, unknown>>>([]);
  const latestBio = bioEntries[0] as any | undefined;

  const [stravaDiagLoading, setStravaDiagLoading] = useState(false);
  const [stravaDiag, setStravaDiag] = useState<null | {
    configured: boolean;
    connected: boolean;
    redirectUri: string;
    lastSyncAt: string | null;
  }>(null);
  const [stravaDiagError, setStravaDiagError] = useState<string>("");

  const [apiUrlCurrent, setApiUrlCurrent] = useState<string>("");
  const [apiUrlInput, setApiUrlInput] = useState<string>("");
  const [apiUrlSaving, setApiUrlSaving] = useState(false);

  // ── Notification state ─────────────────────────────────────────────────────
  const supported = notificationsSupported();
  const [weeklyPrefs, setWeeklyPrefs] = useState<WeeklyReportPrefs>({ enabled: false, hour: 9, minute: 0 });
  const [notifPermission, setNotifPermission] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [togglingWeekly, setTogglingWeekly] = useState(false);

  useEffect(() => {
    loadWeeklyReportPrefs().then(setWeeklyPrefs);
  }, []);

  useEffect(() => {
    setGelLoading(true);
    ProCoachAPI.getGelStock()
      .then((r) => {
        const v = Math.max(0, Math.round(r.gelsInStock ?? 0));
        setGelStock(v);
        setGelStockText(String(v));
      })
      .catch(() => {})
      .finally(() => setGelLoading(false));
  }, []);

  const refreshCompliance = useCallback(async () => {
    setComplianceLoading(true);
    try {
      const from = getSaoPauloWeekStartKey();
      const to = getSaoPauloDayKey();
      const r = await ProCoachAPI.getCompliance({ from, to });
      setCompliance(r);
    } catch {
      setCompliance(null);
    } finally {
      setComplianceLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCompliance();
  }, [refreshCompliance]);

  const refreshStravaDiag = useCallback(async () => {
    setStravaDiagLoading(true);
    try {
      const r = await ProCoachAPI.stravaDiagnostics();
      setStravaDiag(r);
      setStravaDiagError("");
    } catch {
      setStravaDiag(null);
      setStravaDiagError("Falha ao consultar. Verifique o servidor (API URL).");
    } finally {
      setStravaDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStravaDiag();
  }, [refreshStravaDiag]);

  useEffect(() => {
    getEffectiveApiUrl().then((u) => {
      setApiUrlCurrent(u);
      setApiUrlInput(u);
    });
  }, []);

  const handleSaveApiUrl = useCallback(async () => {
    setApiUrlSaving(true);
    try {
      const next = await setApiUrlOverride(apiUrlInput);
      setApiUrlCurrent(next);
      setApiUrlInput(next);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshStravaDiag();
    } catch {
    } finally {
      setApiUrlSaving(false);
    }
  }, [apiUrlInput, refreshStravaDiag]);

  const handleClearApiUrl = useCallback(async () => {
    setApiUrlSaving(true);
    try {
      const next = await setApiUrlOverride(null);
      setApiUrlCurrent(next);
      setApiUrlInput(next);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshStravaDiag();
    } catch {
    } finally {
      setApiUrlSaving(false);
    }
  }, [refreshStravaDiag]);

  const refreshBio = useCallback(async () => {
    setBioLoading(true);
    try {
      const r = await ProCoachAPI.getBioimpedance(7);
      setBioEntries(Array.isArray(r.entries) ? r.entries : []);
    } catch {
      setBioEntries([]);
    } finally {
      setBioLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshBio();
  }, [refreshBio]);

  const hrvStatus = getHRVStatus(localHRV);
  const needsRecovery = shouldSuggestRecovery(localPain, localHRV);
  const suggestion = needsRecovery ? getRecoverySuggestion(localPain, localHRV) : null;
  const painColor = PAIN_COLORS[localPain] ?? "#4CAF50";

  const handleHRVTextChange = (text: string) => {
    setLocalHRVText(text);
    const val = parseInt(text, 10);
    if (!isNaN(val) && val >= HRV_MIN && val <= HRV_MAX) setLocalHRV(val);
  };

  const adjustHRV = (delta: number) => {
    const next = Math.max(HRV_MIN, Math.min(HRV_MAX, localHRV + delta));
    setLocalHRV(next);
    setLocalHRVText(String(next));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handlePainSelect = (level: number) => {
    setLocalPain(level);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await submitDailyCheckIn(localHRV, localPain);
    setDone(true);
    setSubmitting(false);
  };

  const handleRedo = () => {
    setDone(false);
    setLocalHRV(hrv);
    setLocalHRVText(String(hrv));
    setLocalPain(painLevel);
  };

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    await updateProfile({ name: nameInput.trim() });
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleGelTextChange = (text: string) => {
    const digits = text.replace(/[^\d]/g, "");
    setGelStockText(digits);
    const v = Math.max(0, Math.round(Number(digits || "0")));
    setGelStock(v);
  };

  const adjustGelStock = (delta: number) => {
    const next = Math.max(0, gelStock + delta);
    setGelStock(next);
    setGelStockText(String(next));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSaveGelStock = async () => {
    setGelSaving(true);
    try {
      const r = await ProCoachAPI.setGelStock(gelStock);
      const v = Math.max(0, Math.round(r.gelsInStock ?? 0));
      setGelStock(v);
      setGelStockText(String(v));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
    } finally {
      setGelSaving(false);
    }
  };

  const handleImportPlan = async () => {
    const raw = planJsonText.trim();
    if (!raw) {
      Alert.alert("Faltou o JSON", "Cole o JSON do plano aqui antes de importar.");
      return;
    }
    setPlanImporting(true);
    setPlanImportResult("");
    try {
      const parsed = JSON.parse(raw) as any;
      const maybePlan = parsed?.plano_treinamento ?? parsed?.planoTreinamento ?? parsed;
      const cronograma = maybePlan?.cronograma;
      if (!Array.isArray(cronograma) || cronograma.length === 0) {
        Alert.alert("JSON inválido", "Não encontrei 'cronograma' no JSON. Cole o JSON completo do plano.");
        return;
      }
      const result = await ProCoachAPI.importPlanJson(parsed);
      setPlanImportResult(`Importado: ${result.imported} treinos (${result.firstDate} → ${result.lastDate})`);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Alert.alert("Erro ao importar", String(e?.message ?? e ?? "Falha desconhecida"));
    } finally {
      setPlanImporting(false);
    }
  };

  const handleCheckPlan = async () => {
    setPlanChecking(true);
    try {
      const from = getSaoPauloDayKey();
      const to = state.profile.targetRaceDate?.slice(0, 10) || undefined;
      const res = await ProCoachAPI.getPlan({ from, to });
      const normalized = (res.sessions ?? []).map((s) => ({
        date: s.session_date,
        activity: s.activity,
        paceTarget: s.pace_target,
        structure: s.structure,
      }));
      setPlanSessions(normalized.slice(0, 12));
      if (normalized.length === 0) {
        Alert.alert("Plano vazio", "Ainda não encontrei treinos importados. Faça a importação e tente novamente.");
      }
    } catch (e: any) {
      Alert.alert("Erro ao consultar", String(e?.message ?? e ?? "Falha desconhecida"));
    } finally {
      setPlanChecking(false);
    }
  };

  const handleSaveBio = async () => {
    const raw = bioJsonText.trim();
    if (!raw) {
      Alert.alert("Faltou o JSON", "Cole o JSON da bioimpedância aqui antes de salvar.");
      return;
    }
    setBioSaving(true);
    setBioResult("");
    try {
      const parsed = JSON.parse(raw) as any;
      if (!parsed?.date && !parsed?.entry_date && !parsed?.entryDate) {
        Alert.alert("JSON inválido", "Faltou o campo 'date' (ex.: 2026-05-08).");
        return;
      }
      await ProCoachAPI.upsertBioimpedance(parsed);
      setBioResult("Bioimpedância salva no Neon.");
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await refreshBio();
    } catch (e: any) {
      Alert.alert("Erro ao salvar", String(e?.message ?? e ?? "Falha desconhecida"));
    } finally {
      setBioSaving(false);
    }
  };

  // ── Weekly report notification handlers ────────────────────────────────────
  const handleToggleWeekly = useCallback(async (val: boolean) => {
    setTogglingWeekly(true);
    try {
      if (val) {
        const granted = await requestNotifPermission();
        setNotifPermission(granted);
        if (!granted) { setTogglingWeekly(false); return; }
        await scheduleWeeklyReport({
          hour: weeklyPrefs.hour,
          minute: weeklyPrefs.minute,
          athleteName: profile.name,
          currentWeek,
        });
      } else {
        await cancelWeeklyReportNotif();
      }
      const newPrefs = { ...weeklyPrefs, enabled: val };
      setWeeklyPrefs(newPrefs);
      await saveWeeklyReportPrefs(newPrefs);
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } finally {
      setTogglingWeekly(false);
    }
  }, [weeklyPrefs, profile.name, currentWeek]);

  const handleChangeHour = useCallback(async (hour: number) => {
    const newPrefs = { ...weeklyPrefs, hour };
    setWeeklyPrefs(newPrefs);
    await saveWeeklyReportPrefs(newPrefs);
    if (newPrefs.enabled) {
      await scheduleWeeklyReport({ hour, minute: newPrefs.minute, athleteName: profile.name, currentWeek });
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [weeklyPrefs, profile.name, currentWeek]);

  const handleTestNotif = useCallback(async () => {
    await sendTestWeeklyReportNotif({ athleteName: profile.name, currentWeek });
    setTestSent(true);
    setTimeout(() => setTestSent(false), 4000);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [profile.name, currentWeek]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    scroll: { flex: 1 },
    content: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top + 16,
      paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
    },
    greeting: { fontSize: 10, letterSpacing: 4, color: colors.primary, fontWeight: "800" as const, marginBottom: 2 },
    name: { fontSize: 26, fontWeight: "800" as const, color: colors.foreground, letterSpacing: -0.5, marginBottom: 4 },
    subtitle: { fontSize: 13, color: colors.mutedForeground, marginBottom: 24 },
    doneCard: {
      backgroundColor: "#0A1A0A", borderRadius: colors.radius,
      borderWidth: 1.5, borderColor: "#4CAF50", padding: 20, marginBottom: 16, alignItems: "center", gap: 8,
    },
    doneTitle: { fontSize: 11, letterSpacing: 3, fontWeight: "800" as const, color: "#4CAF50" },
    doneSummaryRow: { flexDirection: "row", gap: 24, marginTop: 4 },
    doneSummaryItem: { alignItems: "center", gap: 2 },
    doneSummaryVal: { fontSize: 22, fontWeight: "800" as const, letterSpacing: -1 },
    doneSummaryLabel: { fontSize: 9, letterSpacing: 2, color: colors.mutedForeground },
    redoBtn: { marginTop: 8, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
    redoBtnText: { fontSize: 9, letterSpacing: 2, color: colors.mutedForeground, fontWeight: "700" as const },
    card: { backgroundColor: colors.card, borderRadius: colors.radius, borderWidth: 1, borderColor: colors.border, padding: 18, marginBottom: 12 },
    cardTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    cardTitle: { fontSize: 10, letterSpacing: 3, color: colors.mutedForeground, fontWeight: "700" as const },
    hrvStatusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
    hrvStatusText: { fontSize: 9, fontWeight: "800" as const, letterSpacing: 2 },
    hrvRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 },
    hrvStepper: {
      width: 40, height: 40, borderRadius: 10, borderWidth: 1,
      borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.secondary,
    },
    hrvValue: { flex: 1, alignItems: "center" },
    hrvNum: { fontSize: 52, fontWeight: "800" as const, letterSpacing: -3, lineHeight: 56 },
    hrvUnit: { fontSize: 11, letterSpacing: 2, color: colors.mutedForeground, marginTop: -4 },
    hrvDetail: { fontSize: 11, color: colors.mutedForeground, textAlign: "center", marginTop: 4 },
    hrvInputRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 12 },
    inputField: {
      flex: 1, backgroundColor: colors.input, borderRadius: 8, borderWidth: 1,
      borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10,
      color: colors.foreground, fontSize: 16, fontWeight: "700" as const,
    },
    hrvBar: { height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: "hidden" as const, marginTop: 14 },
    hrvBarFill: { height: 6, borderRadius: 3 },
    hrvGuide: { flexDirection: "row", justifyContent: "space-between", marginTop: 5 },
    hrvGuideText: { fontSize: 8, letterSpacing: 0.5, color: colors.mutedForeground },
    painGrid: { flexDirection: "row", flexWrap: "wrap" as const, gap: 8 },
    painOption: { width: "30%", paddingVertical: 14, borderRadius: 10, borderWidth: 1.5, alignItems: "center", gap: 3 },
    painEmoji: { fontSize: 20 },
    painNum: { fontSize: 14, fontWeight: "800" as const },
    painLabel: { fontSize: 7, letterSpacing: 1, fontWeight: "700" as const },
    alertBanner: { borderRadius: 10, borderWidth: 1, padding: 14, marginBottom: 12, flexDirection: "row", alignItems: "center", gap: 10 },
    alertText: { flex: 1, fontSize: 12, lineHeight: 18 },
    alertSuggestion: { marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, alignSelf: "flex-start" },
    alertSuggestionText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 1.5 },
    submitBtn: {
      backgroundColor: colors.primary, borderRadius: colors.radius - 2, paddingVertical: 16,
      alignItems: "center", flexDirection: "row", justifyContent: "center",
      gap: 8, marginBottom: 12, marginTop: 4,
    },
    submitBtnText: { fontSize: 12, fontWeight: "800" as const, letterSpacing: 3, color: "#000000" },
    divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
    profileLabel: { fontSize: 9, letterSpacing: 2, color: colors.mutedForeground, marginBottom: 6 },
    inputRow: { flexDirection: "row", gap: 8, alignItems: "center" },
    saveBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12 },
    saveBtnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2, color: "#000000" },
    // notification card styles
    notifToggleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    notifToggleLabel: { fontSize: 13, fontWeight: "700" as const, color: colors.foreground },
    notifToggleSub: { fontSize: 10, color: colors.mutedForeground, marginBottom: 14, lineHeight: 15 },
    hourScroll: { flexDirection: "row", gap: 6, flexWrap: "wrap" as const, marginBottom: 14 },
    hourChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },
    hourChipText: { fontSize: 12, fontWeight: "700" as const, letterSpacing: 0.5 },
    testBtn: {
      flexDirection: "row", alignItems: "center", justifyContent: "center",
      gap: 6, borderRadius: 8, paddingVertical: 10, borderWidth: 1,
    },
    testBtnText: { fontSize: 10, fontWeight: "800" as const, letterSpacing: 2 },
    unsupportedNote: {
      backgroundColor: colors.secondary, borderRadius: 8, padding: 12,
      flexDirection: "row", alignItems: "flex-start", gap: 8,
    },
    unsupportedText: { flex: 1, fontSize: 11, color: colors.mutedForeground, lineHeight: 16 },
    activeIndicator: {
      flexDirection: "row", alignItems: "center", gap: 6,
      backgroundColor: "#0A2A1A", borderRadius: 8, padding: 10, marginBottom: 12,
    },
    activeIndicatorText: { fontSize: 11, color: "#4CAF50", flex: 1, lineHeight: 15 },
    gelRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    gelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, alignItems: "center" },
    gelBtnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2 },
    planTextArea: {
      minHeight: 160,
      textAlignVertical: "top" as any,
    },
    importBtn: {
      marginTop: 10,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
    },
    importBtnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2, color: "#000000" },
    checkBtn: {
      marginTop: 8,
      backgroundColor: "transparent",
      borderRadius: 10,
      paddingVertical: 12,
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "center",
      gap: 8,
      borderWidth: 1,
      borderColor: colors.border,
    },
    checkBtnText: { fontSize: 11, fontWeight: "800" as const, letterSpacing: 2, color: colors.mutedForeground },
  });

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        <Text style={s.greeting}>{getGreeting()}</Text>
        <Text style={s.name}>{profile.name.split(" ")[0]}</Text>
        <Text style={s.subtitle}>
          {done
            ? "Check-in de hoje registrado. Seu treino foi gerado."
            : "Registre como você está para personalizar o treino de hoje."}
        </Text>

        {/* ── DONE STATE ────────────────────────────────────── */}
        {done && (
          <View style={s.doneCard}>
            <Feather name="check-circle" size={28} color="#4CAF50" />
            <Text style={s.doneTitle}>CHECK-IN CONCLUÍDO</Text>
            <View style={s.doneSummaryRow}>
              <View style={s.doneSummaryItem}>
                <Text style={[s.doneSummaryVal, { color: getHRVStatus(hrv).color }]}>{hrv}</Text>
                <Text style={s.doneSummaryLabel}>VFC (ms)</Text>
              </View>
              <View style={s.doneSummaryItem}>
                <Text style={[s.doneSummaryVal, { color: PAIN_COLORS[painLevel] ?? "#4CAF50" }]}>{painLevel}/5</Text>
                <Text style={s.doneSummaryLabel}>DOR</Text>
              </View>
              <View style={s.doneSummaryItem}>
                {aiLoading
                  ? <ActivityIndicator color={colors.primary} size="small" />
                  : <Feather name="zap" size={22} color={colors.primary} />}
                <Text style={s.doneSummaryLabel}>{aiLoading ? "GERANDO..." : "TREINO IA"}</Text>
              </View>
            </View>
            <Pressable style={({ pressed }) => [s.redoBtn, { opacity: pressed ? 0.6 : 1 }]} onPress={handleRedo}>
              <Text style={s.redoBtnText}>REFAZER CHECK-IN</Text>
            </Pressable>
          </View>
        )}

        {/* ── INJURY ALERT PREVIEW ──────────────────────────── */}
        {!done && needsRecovery && (
          <View style={[s.alertBanner, { backgroundColor: "#1A0800", borderColor: "#FF5F00" }]}>
            <Feather name="alert-triangle" size={18} color="#FF5F00" />
            <View style={{ flex: 1 }}>
              <Text style={[s.alertText, { color: "#FFAA70" }]}>
                {localPain >= 2
                  ? `Dor ${localPain}/5 detectada — treino ajustado automaticamente.`
                  : `VFC baixa (${localHRV}ms) — treino de recuperação indicado.`}
              </Text>
              <View style={[s.alertSuggestion, { backgroundColor: "#FF5F0022" }]}>
                <Text style={[s.alertSuggestionText, { color: "#FF5F00" }]}>{suggestion}</Text>
              </View>
            </View>
          </View>
        )}

        {/* ── HRV CARD ──────────────────────────────────────── */}
        {!done && (
          <>
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>VFC — VARIABILIDADE CARDÍACA</Text>
                <View style={[s.hrvStatusBadge, { backgroundColor: hrvStatus.color + "22" }]}>
                  <Text style={[s.hrvStatusText, { color: hrvStatus.color }]}>{hrvStatus.label}</Text>
                </View>
              </View>
              <View style={s.hrvRow}>
                <Pressable
                  style={({ pressed }) => [s.hrvStepper, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => adjustHRV(-1)}
                  onLongPress={() => adjustHRV(-5)}
                >
                  <Feather name="minus" size={18} color={colors.foreground} />
                </Pressable>
                <View style={s.hrvValue}>
                  <Text style={[s.hrvNum, { color: hrvStatus.color }]}>{localHRV}</Text>
                  <Text style={s.hrvUnit}>ms</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [s.hrvStepper, { opacity: pressed ? 0.6 : 1 }]}
                  onPress={() => adjustHRV(1)}
                  onLongPress={() => adjustHRV(5)}
                >
                  <Feather name="plus" size={18} color={colors.foreground} />
                </Pressable>
              </View>
              <Text style={[s.hrvDetail, { color: hrvStatus.color + "BB" }]}>{hrvStatus.detail}</Text>
              <View style={s.hrvBar}>
                <View
                  style={[s.hrvBarFill, {
                    width: `${Math.min(100, ((localHRV - HRV_MIN) / (HRV_MAX - HRV_MIN)) * 100)}%`,
                    backgroundColor: hrvStatus.color,
                  }]}
                />
              </View>
              <View style={s.hrvGuide}>
                <Text style={s.hrvGuideText}>CRÍTICO &lt;35</Text>
                <Text style={s.hrvGuideText}>ATENÇÃO 45–55</Text>
                <Text style={s.hrvGuideText}>BOM &gt;65</Text>
              </View>
              <View style={s.hrvInputRow}>
                <TextInput
                  style={s.inputField}
                  value={localHRVText}
                  onChangeText={handleHRVTextChange}
                  keyboardType="numeric"
                  placeholderTextColor={colors.mutedForeground}
                  placeholder="68"
                  maxLength={3}
                />
                <Text style={{ fontSize: 11, color: colors.mutedForeground, letterSpacing: 1 }}>Digite ou use ±</Text>
              </View>
            </View>

            {/* ── PAIN CARD ─────────────────────────────────── */}
            <View style={s.card}>
              <View style={s.cardTitleRow}>
                <Text style={s.cardTitle}>DOR / DESCONFORTO</Text>
                <Text style={{ fontSize: 18 }}>{PAIN_EMOJIS[localPain]}</Text>
              </View>
              <View style={s.painGrid}>
                {[0, 1, 2, 3, 4, 5].map((level) => {
                  const sel = localPain === level;
                  const pc = PAIN_COLORS[level] ?? "#4CAF50";
                  return (
                    <Pressable
                      key={level}
                      style={({ pressed }) => [
                        s.painOption,
                        { backgroundColor: sel ? pc + "22" : colors.secondary, borderColor: sel ? pc : colors.border, opacity: pressed ? 0.7 : 1 },
                      ]}
                      onPress={() => handlePainSelect(level)}
                    >
                      <Text style={s.painEmoji}>{PAIN_EMOJIS[level]}</Text>
                      <Text style={[s.painNum, { color: sel ? pc : colors.mutedForeground }]}>{level}</Text>
                      <Text style={[s.painLabel, { color: sel ? pc : colors.mutedForeground }]}>{PAIN_LABELS[level]}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* ── SUBMIT ────────────────────────────────────── */}
            <Pressable
              style={({ pressed }) => [s.submitBtn, { opacity: pressed || submitting ? 0.7 : 1 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting
                ? <ActivityIndicator color="#000000" size="small" />
                : <>
                    <Feather name="check-circle" size={16} color="#000000" />
                    <Text style={s.submitBtnText}>CONFIRMAR CHECK-IN</Text>
                  </>}
            </Pressable>
          </>
        )}

        {/* ── SUNDAY PDF REMINDER ───────────────────────────── */}
        <View style={[s.card, { borderColor: weeklyPrefs.enabled ? "#FF5F0044" : colors.border }]}>
          <View style={s.cardTitleRow}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Feather name="file-text" size={14} color={weeklyPrefs.enabled ? colors.primary : colors.mutedForeground} />
              <Text style={[s.cardTitle, weeklyPrefs.enabled && { color: colors.primary }]}>
                LEMBRETE DOMINICAL — PDF SEMANAL
              </Text>
            </View>
          </View>

          {!supported ? (
            <View style={s.unsupportedNote}>
              <Feather name="info" size={14} color={colors.mutedForeground} />
              <Text style={s.unsupportedText}>
                Notificações disponíveis apenas no app nativo (iOS / Android). No web ou Expo Go esse recurso fica desabilitado.
              </Text>
            </View>
          ) : (
            <>
              {weeklyPrefs.enabled && (
                <View style={s.activeIndicator}>
                  <Feather name="check-circle" size={14} color="#4CAF50" />
                  <Text style={s.activeIndicatorText}>
                    Lembrete ativo todo domingo às {String(weeklyPrefs.hour).padStart(2, "0")}:00 para gerar o Relatório PDF da semana.
                  </Text>
                </View>
              )}

              <View style={s.notifToggleRow}>
                <Text style={s.notifToggleLabel}>
                  {weeklyPrefs.enabled ? "Lembrete ativado" : "Ativar lembrete dominical"}
                </Text>
                {togglingWeekly
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : (
                    <Switch
                      value={weeklyPrefs.enabled}
                      onValueChange={handleToggleWeekly}
                      trackColor={{ false: colors.border, true: colors.primary + "88" }}
                      thumbColor={weeklyPrefs.enabled ? colors.primary : colors.mutedForeground}
                    />
                  )}
              </View>
              <Text style={s.notifToggleSub}>
                Todo domingo, o app te avisa que o Relatório PDF da semana está pronto para ser gerado na aba PROVAS.
              </Text>

              {weeklyPrefs.enabled && (
                <>
                  <Text style={[s.cardTitle, { marginBottom: 10 }]}>HORÁRIO DO LEMBRETE</Text>
                  <View style={s.hourScroll}>
                    {HOUR_OPTIONS.map((h) => {
                      const active = weeklyPrefs.hour === h;
                      return (
                        <Pressable
                          key={h}
                          style={({ pressed }) => [
                            s.hourChip,
                            {
                              backgroundColor: active ? colors.primary + "22" : colors.secondary,
                              borderColor: active ? colors.primary : colors.border,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                          onPress={() => handleChangeHour(h)}
                        >
                          <Text style={[s.hourChipText, { color: active ? colors.primary : colors.mutedForeground }]}>
                            {String(h).padStart(2, "0")}h
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      s.testBtn,
                      {
                        borderColor: testSent ? "#4CAF5066" : colors.border,
                        backgroundColor: testSent ? "#0A2A1A" : "transparent",
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                    onPress={handleTestNotif}
                    disabled={testSent}
                  >
                    <Feather name={testSent ? "check" : "send"} size={13} color={testSent ? "#4CAF50" : colors.mutedForeground} />
                    <Text style={[s.testBtnText, { color: testSent ? "#4CAF50" : colors.mutedForeground }]}>
                      {testSent ? "TESTE ENVIADO — AGUARDE 3s" : "ENVIAR NOTIFICAÇÃO DE TESTE"}
                    </Text>
                  </Pressable>
                </>
              )}
            </>
          )}
        </View>

        {/* ── PROFILE ───────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardTitle}>PERFIL DO ATLETA</Text>
          <View style={s.divider} />
          <Text style={s.profileLabel}>NOME</Text>
          <View style={s.inputRow}>
            <TextInput
              style={[s.inputField, { fontSize: 14 }]}
              value={nameInput}
              onChangeText={setNameInput}
              placeholderTextColor={colors.mutedForeground}
              placeholder="Seu nome"
            />
            <Pressable style={({ pressed }) => [s.saveBtn, { opacity: pressed ? 0.7 : 1 }]} onPress={handleSaveName}>
              <Text style={s.saveBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>COMPLIANCE DA SEMANA</Text>
            <Pressable onPress={refreshCompliance} disabled={complianceLoading}>
              {complianceLoading ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
              )}
            </Pressable>
          </View>
          <View style={s.divider} />
          {compliance ? (
            <>
              <Text style={s.profileLabel}>SESSÕES</Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "800" as const }}>
                {compliance.completedSessions}/{compliance.plannedSessions}
                {compliance.plannedSessions > 0
                  ? ` (${Math.round((compliance.completedSessions / compliance.plannedSessions) * 100)}%)`
                  : ""}
              </Text>
              <View style={{ height: 10 }} />
              <Text style={s.profileLabel}>QUILOMETRAGEM</Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "800" as const }}>
                {compliance.completedKm}km/{compliance.plannedKm}km
                {compliance.plannedKm > 0
                  ? ` (${Math.round((compliance.completedKm / compliance.plannedKm) * 100)}%)`
                  : ""}
              </Text>
              <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 10, lineHeight: 15 }}>
                {compliance.from} → {compliance.to}
              </Text>
            </>
          ) : (
            <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 16 }}>
              Sem dados ainda. Importe o plano e marque treinos como concluídos.
            </Text>
          )}
        </View>

        <View style={s.card}>
          <Text style={s.cardTitle}>SERVIDOR (API URL)</Text>
          <View style={s.divider} />
          <Text style={{ fontSize: 11, color: colors.mutedForeground, lineHeight: 16 }}>
            Atual: {apiUrlCurrent || "—"}
          </Text>
          <View style={{ height: 10 }} />
          <TextInput
            style={[s.inputField, { fontSize: 12 }]}
            value={apiUrlInput}
            onChangeText={setApiUrlInput}
            placeholderTextColor={colors.mutedForeground}
            placeholder="https://SEU-SERVICO.onrender.com"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={{ flexDirection: "row", marginTop: 10 }}>
            <Pressable
              style={({ pressed }) => [
                s.saveBtn,
                { opacity: pressed ? 0.7 : 1, backgroundColor: apiUrlSaving ? colors.border : colors.primary },
              ]}
              onPress={handleSaveApiUrl}
              disabled={apiUrlSaving}
            >
              <Text style={s.saveBtnText}>SALVAR</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                s.saveBtn,
                { opacity: pressed ? 0.7 : 1, backgroundColor: colors.card, marginLeft: 10 },
              ]}
              onPress={handleClearApiUrl}
              disabled={apiUrlSaving}
            >
              <Text style={[s.saveBtnText, { color: colors.foreground }]}>LIMPAR</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>STRAVA (DIAGNÓSTICO)</Text>
            <Pressable onPress={refreshStravaDiag} disabled={stravaDiagLoading}>
              {stravaDiagLoading ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
              )}
            </Pressable>
          </View>
          <View style={s.divider} />
          {stravaDiag ? (
            <>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, lineHeight: 16 }}>
                Configurado: {stravaDiag.configured ? "SIM" : "NÃO"}{"\n"}
                Conectado: {stravaDiag.connected ? "SIM" : "NÃO"}{"\n"}
                Último sync: {stravaDiag.lastSyncAt ? stravaDiag.lastSyncAt : "—"}
              </Text>
              <View style={{ height: 10 }} />
              <Text style={{ fontSize: 10, color: colors.mutedForeground, lineHeight: 15 }}>
                redirect_uri: {stravaDiag.redirectUri}
              </Text>
            </>
          ) : (
            <>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 16 }}>
                {stravaDiagError || "Não foi possível consultar o diagnóstico do Strava agora."}
              </Text>
              <Text style={{ fontSize: 10, color: colors.mutedForeground, marginTop: 8, lineHeight: 15 }}>
                Servidor: {apiUrlCurrent || "—"}
              </Text>
            </>
          )}
        </View>

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>BIOIMPEDÂNCIA (V5.2)</Text>
            <Pressable onPress={refreshBio} disabled={bioLoading}>
              {bioLoading ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
              )}
            </Pressable>
          </View>
          <View style={s.divider} />

          {latestBio ? (
            <>
              <Text style={s.profileLabel}>ÚLTIMO REGISTRO</Text>
              <Text style={{ fontSize: 10, color: colors.mutedForeground, letterSpacing: 1 }}>
                {String(latestBio.entry_date ?? "")}
              </Text>
              <Text style={{ fontSize: 14, color: colors.foreground, fontWeight: "800" as const, marginTop: 6 }}>
                {latestBio.weight_kg ? `${latestBio.weight_kg}kg` : "—"}{" "}
                {latestBio.body_fat_pct ? `· ${latestBio.body_fat_pct}% gordura` : ""}
              </Text>
              <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 6, lineHeight: 16 }}>
                {latestBio.muscle_mass_kg ? `💪 ${latestBio.muscle_mass_kg}kg músculo` : ""}{latestBio.muscle_mass_kg && latestBio.body_water_pct ? " · " : ""}
                {latestBio.body_water_pct ? `💧 ${latestBio.body_water_pct}% água` : ""}{(latestBio.muscle_mass_kg || latestBio.body_water_pct) && latestBio.visceral_fat ? " · " : ""}
                {latestBio.visceral_fat ? `🧠 ${latestBio.visceral_fat} visceral` : ""}
              </Text>
              {(latestBio.metabolic_age || latestBio.tmb_kcal) && (
                <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4, lineHeight: 16 }}>
                  {latestBio.metabolic_age ? `⏳ Idade metab.: ${latestBio.metabolic_age}` : ""}{latestBio.metabolic_age && latestBio.tmb_kcal ? " · " : ""}
                  {latestBio.tmb_kcal ? `🔥 TMB: ${latestBio.tmb_kcal} kcal` : ""}
                </Text>
              )}
              <View style={{ height: 12 }} />
            </>
          ) : (
            <Text style={{ fontSize: 12, color: colors.mutedForeground, lineHeight: 16 }}>
              Sem registros ainda. Cole o JSON abaixo para salvar.
            </Text>
          )}

          <Text style={s.profileLabel}>COLAR JSON</Text>
          <TextInput
            style={[s.inputField, s.planTextArea, { fontSize: 12 }]}
            value={bioJsonText}
            onChangeText={setBioJsonText}
            placeholderTextColor={colors.mutedForeground}
            placeholder='Ex.: {"date":"2026-05-08","weight":75,"body_fat":24.3,"muscle_mass":54.1,"body_water":54.1,"visceral_fat":13.5,"metabolic_age":43,"tmb":1557,"protein":17.6,"bone_mass":3.09,"health_notes":""}'
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={({ pressed }) => [
              s.importBtn,
              { opacity: pressed ? 0.7 : 1, backgroundColor: bioSaving ? colors.border : colors.primary },
            ]}
            onPress={handleSaveBio}
            disabled={bioSaving}
          >
            {bioSaving ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Feather name="save" size={14} color="#000000" />
            )}
            <Text style={s.importBtnText}>SALVAR NO NEON</Text>
          </Pressable>
          {!!bioResult && (
            <Text style={{ marginTop: 10, fontSize: 11, color: "#4CAF50", lineHeight: 16 }}>
              {bioResult}
            </Text>
          )}

          {bioEntries.length > 0 && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {bioEntries.slice(0, 5).map((e: any) => (
                <View key={String(e.entry_date)} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, letterSpacing: 1 }}>
                    {String(e.entry_date ?? "")}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "700" as const, marginTop: 4 }}>
                    {e.weight_kg ? `${e.weight_kg}kg` : "—"} {e.body_fat_pct ? `· ${e.body_fat_pct}%` : ""}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>ESTOQUE DE GÉIS</Text>
            {gelLoading && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          </View>
          <View style={s.divider} />
          <Text style={s.profileLabel}>QUANTIDADE ATUAL</Text>
          <View style={s.inputRow}>
            <TextInput
              style={[s.inputField, { fontSize: 14 }]}
              value={gelStockText}
              onChangeText={handleGelTextChange}
              placeholderTextColor={colors.mutedForeground}
              placeholder="0"
              keyboardType="number-pad"
            />
            <Pressable
              style={({ pressed }) => [
                s.saveBtn,
                { opacity: pressed ? 0.7 : 1, backgroundColor: gelSaving ? colors.border : colors.primary },
              ]}
              onPress={handleSaveGelStock}
              disabled={gelSaving}
            >
              {gelSaving ? (
                <ActivityIndicator size="small" color={colors.mutedForeground} />
              ) : (
                <Text style={s.saveBtnText}>SALVAR</Text>
              )}
            </Pressable>
          </View>
          <View style={{ height: 10 }} />
          <View style={s.gelRow}>
            <Pressable
              style={({ pressed }) => [
                s.gelBtn,
                { opacity: pressed ? 0.7 : 1, borderColor: colors.border, backgroundColor: colors.secondary },
              ]}
              onPress={() => adjustGelStock(-1)}
            >
              <Text style={[s.gelBtnText, { color: colors.mutedForeground }]}>-1</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                s.gelBtn,
                { opacity: pressed ? 0.7 : 1, borderColor: colors.border, backgroundColor: colors.secondary },
              ]}
              onPress={() => adjustGelStock(+1)}
            >
              <Text style={[s.gelBtnText, { color: colors.mutedForeground }]}>+1</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                s.gelBtn,
                { opacity: pressed ? 0.7 : 1, borderColor: colors.border, backgroundColor: colors.secondary },
              ]}
              onPress={() => adjustGelStock(+5)}
            >
              <Text style={[s.gelBtnText, { color: colors.mutedForeground }]}>+5</Text>
            </Pressable>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.cardTitleRow}>
            <Text style={s.cardTitle}>IMPORTAR PLANO (JSON)</Text>
            {planImporting && <ActivityIndicator size="small" color={colors.mutedForeground} />}
          </View>
          <View style={s.divider} />
          <Text style={s.profileLabel}>COLE O JSON DO SEU PLANO</Text>
          <TextInput
            style={[s.inputField, s.planTextArea, { fontSize: 12 }]}
            value={planJsonText}
            onChangeText={setPlanJsonText}
            placeholderTextColor={colors.mutedForeground}
            placeholder='Cole aqui o JSON (começa com {"plano_treinamento": ...})'
            multiline
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            style={({ pressed }) => [
              s.importBtn,
              { opacity: pressed ? 0.7 : 1, backgroundColor: planImporting ? colors.border : colors.primary },
            ]}
            onPress={handleImportPlan}
            disabled={planImporting}
          >
            {planImporting ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Feather name="upload" size={14} color="#000000" />
            )}
            <Text style={s.importBtnText}>IMPORTAR PARA O NEON</Text>
          </Pressable>
          {!!planImportResult && (
            <Text style={{ marginTop: 10, fontSize: 11, color: "#4CAF50", lineHeight: 16 }}>
              {planImportResult}
            </Text>
          )}
          <Pressable
            style={({ pressed }) => [s.checkBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleCheckPlan}
            disabled={planChecking}
          >
            {planChecking ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : (
              <Feather name="list" size={14} color={colors.mutedForeground} />
            )}
            <Text style={s.checkBtnText}>VERIFICAR PLANO IMPORTADO</Text>
          </Pressable>
          {planSessions.length > 0 && (
            <View style={{ marginTop: 12, gap: 8 }}>
              {planSessions.map((sesh) => (
                <View key={sesh.date} style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
                  <Text style={{ fontSize: 10, color: colors.mutedForeground, letterSpacing: 1 }}>
                    {sesh.date}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.foreground, fontWeight: "700" as const, marginTop: 4 }}>
                    {sesh.activity}
                  </Text>
                  {(sesh.paceTarget || sesh.structure) && (
                    <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4, lineHeight: 16 }}>
                      {sesh.paceTarget ? `Pace: ${sesh.paceTarget}` : ""}{sesh.paceTarget && sesh.structure ? " · " : ""}{sesh.structure ?? ""}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

      </ScrollView>
    </View>
  );
}
