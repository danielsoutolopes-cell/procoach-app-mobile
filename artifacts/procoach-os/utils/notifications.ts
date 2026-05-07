import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPhase } from "./training";

export type NotificationTime = { hour: number; minute: number };

const NOTIF_PREFS_KEY = "@procoach_notif_prefs_v1";
const NOTIF_ID_KEY = "@procoach_notif_id_v1";

export interface NotifPrefs {
  enabled: boolean;
  hour: number;
  minute: number;
}

const DEFAULT_PREFS: NotifPrefs = { enabled: false, hour: 7, minute: 0 };

// Check if running inside Expo Go (notifications not supported in Expo Go SDK 53+)
function isExpoGo(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default;
    return Constants?.appOwnership === "expo";
  } catch {
    return false;
  }
}

// Phase-specific motivational openers
const PHASE_OPENERS: Record<string, string[]> = {
  Base: [
    "Base sólida, resultado garantido.",
    "Cada km agora vale por dois na largada.",
    "Construindo o motor. Não pule etapas.",
  ],
  Construção: [
    "Fase de construção. Eleve o nível hoje.",
    "Volume em alta — seu corpo está evoluindo.",
    "A resistência se constrói aqui. Vá com tudo.",
  ],
  Pico: [
    "FASE PICO. Você está no limite — isso é o plano.",
    "Máximo volume. Máxima entrega.",
    "A largada começa a ganhar forma agora.",
  ],
  Polimento: [
    "Afie a faca. Semana de polimento.",
    "Menos é mais. Qualidade total.",
    "Seu corpo está pronto. Confie no processo.",
  ],
};

function getPhaseOpener(week: number): string {
  const phase = getPhase(week);
  const openers = PHASE_OPENERS[phase] ?? PHASE_OPENERS["Base"]!;
  return openers[Math.floor(Math.random() * openers.length)]!;
}

function buildNotifBody(opts: {
  week: number;
  workoutType: string;
  distanceKm: number;
  durationMin: number;
  athleteName?: string;
}): { title: string; body: string } {
  const phase = getPhase(opts.week);
  const opener = getPhaseOpener(opts.week);
  const name = opts.athleteName ? `, ${opts.athleteName.split(" ")[0]}` : "";

  const typeLabels: Record<string, string> = {
    corrida: "Corrida",
    bike: "Bike Indolor",
    regenerativo: "Regenerativo",
    forca: "Força",
    folga: "Descanso Ativo",
  };
  const label = typeLabels[opts.workoutType] ?? opts.workoutType;

  const detail =
    opts.distanceKm > 0
      ? `${label} · ${opts.distanceKm}km · ${opts.durationMin}min`
      : `${label} · ${opts.durationMin}min`;

  return {
    title: `🏃 PROCOACH${name} — ${phase.toUpperCase()}`,
    body: `${opener}\n\nHoje: ${detail}`,
  };
}

export async function loadNotifPrefs(): Promise<NotifPrefs> {
  try {
    const raw = await AsyncStorage.getItem(NOTIF_PREFS_KEY);
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_PREFS;
}

export async function saveNotifPrefs(prefs: NotifPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export async function requestNotifPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  if (isExpoGo()) return false;
  try {
    const Device = require("expo-device").default;
    if (!Device?.isDevice) return false;
    const Notifications = require("expo-notifications");
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === "granted") return true;
    const { status } = await Notifications.requestPermissionsAsync();
    return status === "granted";
  } catch {
    return false;
  }
}

export async function scheduleDaily(opts: {
  hour: number;
  minute: number;
  week: number;
  workoutType: string;
  distanceKm: number;
  durationMin: number;
  athleteName?: string;
}): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (isExpoGo()) return null;
  try {
    await cancelDailyNotif();
    const Notifications = require("expo-notifications");
    const { title, body } = buildNotifBody(opts);
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        priority: Notifications.AndroidNotificationPriority?.HIGH,
        data: { week: opts.week, type: opts.workoutType },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes?.DAILY,
        hour: opts.hour,
        minute: opts.minute,
      },
    });
    await AsyncStorage.setItem(NOTIF_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export async function cancelDailyNotif(): Promise<void> {
  if (Platform.OS === "web") return;
  if (isExpoGo()) return;
  try {
    const id = await AsyncStorage.getItem(NOTIF_ID_KEY);
    if (id) {
      const Notifications = require("expo-notifications");
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(NOTIF_ID_KEY);
    }
  } catch {}
}

export async function getScheduledNotifId(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(NOTIF_ID_KEY);
  } catch {
    return null;
  }
}

export async function sendTestNotif(opts: {
  week: number;
  workoutType: string;
  distanceKm: number;
  durationMin: number;
  athleteName?: string;
}): Promise<void> {
  if (Platform.OS === "web") return;
  if (isExpoGo()) return;
  try {
    const Notifications = require("expo-notifications");
    const { title, body } = buildNotifBody(opts);
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL,
        seconds: 2,
      },
    });
  } catch {}
}

// Export whether notifications are actually supported in the current environment
export function notificationsSupported(): boolean {
  return Platform.OS !== "web" && !isExpoGo();
}

// ─── SUNDAY WEEKLY REPORT REMINDER ───────────────────────────────────────────

const WEEKLY_REPORT_NOTIF_ID_KEY = "@procoach_weekly_report_notif_id_v1";
const WEEKLY_REPORT_PREFS_KEY = "@procoach_weekly_report_prefs_v1";

export interface WeeklyReportPrefs {
  enabled: boolean;
  hour: number;
  minute: number;
}

const DEFAULT_WEEKLY_PREFS: WeeklyReportPrefs = { enabled: false, hour: 9, minute: 0 };

export async function loadWeeklyReportPrefs(): Promise<WeeklyReportPrefs> {
  try {
    const raw = await AsyncStorage.getItem(WEEKLY_REPORT_PREFS_KEY);
    if (raw) return { ...DEFAULT_WEEKLY_PREFS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_WEEKLY_PREFS;
}

export async function saveWeeklyReportPrefs(prefs: WeeklyReportPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(WEEKLY_REPORT_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

export async function cancelWeeklyReportNotif(): Promise<void> {
  if (Platform.OS === "web") return;
  if (isExpoGo()) return;
  try {
    const id = await AsyncStorage.getItem(WEEKLY_REPORT_NOTIF_ID_KEY);
    if (id) {
      const Notifications = require("expo-notifications");
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(WEEKLY_REPORT_NOTIF_ID_KEY);
    }
  } catch {}
}

export async function scheduleWeeklyReport(opts: {
  hour: number;
  minute: number;
  athleteName?: string;
  currentWeek?: number;
}): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (isExpoGo()) return null;
  try {
    await cancelWeeklyReportNotif();
    const Notifications = require("expo-notifications");
    const name = opts.athleteName ? `, ${opts.athleteName.split(" ")[0]}` : "";
    const week = opts.currentWeek ?? "?";
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `📋 PROCOACH${name} — Relatório Semanal`,
        body: `Semana ${week} concluída! Seu Diário de Bordo está pronto para ser gerado. Abra PROCOACH OS → PROVAS → Relatório PDF.`,
        sound: true,
        priority: Notifications.AndroidNotificationPriority?.HIGH,
        data: { type: "weekly_report", week },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes?.WEEKLY,
        weekday: 1, // 1 = Domingo (Sunday) em expo-notifications
        hour: opts.hour,
        minute: opts.minute,
      },
    });
    await AsyncStorage.setItem(WEEKLY_REPORT_NOTIF_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

export async function sendTestWeeklyReportNotif(opts: {
  athleteName?: string;
  currentWeek?: number;
}): Promise<void> {
  if (Platform.OS === "web") return;
  if (isExpoGo()) return;
  try {
    const Notifications = require("expo-notifications");
    const name = opts.athleteName ? `, ${opts.athleteName.split(" ")[0]}` : "";
    const week = opts.currentWeek ?? "?";
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `📋 PROCOACH${name} — Relatório Semanal`,
        body: `Semana ${week} concluída! Seu Diário de Bordo está pronto para ser gerado. Abra PROCOACH OS → PROVAS → Relatório PDF.`,
        sound: true,
        data: { type: "weekly_report_test" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes?.TIME_INTERVAL,
        seconds: 3,
      },
    });
  } catch {}
}

// ─── PRE-RACE REMINDER ───────────────────────────────────────────────────────

const PRE_RACE_NOTIF_PREFIX = "@procoach_prerace_notif_";

export async function schedulePreRaceReminder(opts: {
  raceId: string;
  raceName: string;
  priority: string;
  raceDateISO: string;
  athleteName?: string;
}): Promise<void> {
  if (Platform.OS === "web") return;
  if (isExpoGo()) return;
  try {
    // Cancel any existing reminder for this race
    const existingId = await AsyncStorage.getItem(`${PRE_RACE_NOTIF_PREFIX}${opts.raceId}`);
    if (existingId) {
      const Notifications = require("expo-notifications");
      await Notifications.cancelScheduledNotificationAsync(existingId).catch(() => {});
    }

    const raceDate = new Date(opts.raceDateISO);
    const triggerDate = new Date(raceDate.getTime() - 2 * 24 * 60 * 60 * 1000);
    triggerDate.setHours(19, 0, 0, 0); // 19h, 2 dias antes

    if (triggerDate <= new Date()) return; // Already past

    const Notifications = require("expo-notifications");
    const name = opts.athleteName ? `, ${opts.athleteName.split(" ")[0]}` : "";
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: `🏁 PROCOACH${name} — ${opts.priority} em 2 dias!`,
        body: `${opts.raceName} é depois de amanhã! Abra o app para ver a logística: horário de acordar, géis e checklist de prova.`,
        sound: true,
        priority: Notifications.AndroidNotificationPriority?.HIGH,
        data: { type: "pre_race", raceId: opts.raceId },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes?.DATE, date: triggerDate },
    });
    await AsyncStorage.setItem(`${PRE_RACE_NOTIF_PREFIX}${opts.raceId}`, id);
  } catch {}
}

export async function cancelPreRaceReminder(raceId: string): Promise<void> {
  if (Platform.OS === "web") return;
  if (isExpoGo()) return;
  try {
    const id = await AsyncStorage.getItem(`${PRE_RACE_NOTIF_PREFIX}${raceId}`);
    if (id) {
      const Notifications = require("expo-notifications");
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      await AsyncStorage.removeItem(`${PRE_RACE_NOTIF_PREFIX}${raceId}`);
    }
  } catch {}
}

// ─── PUSH TOKEN ───────────────────────────────────────────────────────────────

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (isExpoGo()) return null;
  try {
    const Device = require("expo-device").default;
    if (!Device?.isDevice) return null;
    const Notifications = require("expo-notifications");
    const { status: existing } = await Notifications.getPermissionsAsync();
    let finalStatus = existing;
    if (existing !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;
    const result = await Notifications.getExpoPushTokenAsync();
    return result?.data ?? null;
  } catch {
    return null;
  }
}
