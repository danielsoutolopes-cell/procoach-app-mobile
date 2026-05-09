import { Race } from "./schema";
// api.ts
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

// -----------------------------------------------------------------------------
// MOTOR DE COMUNICAÇÃO PROCOACH OS V5.1
// Arquitetura Sequencial: Comunicação Blindada com o Render
// -----------------------------------------------------------------------------

// Prioriza a URL fornecida via variável de ambiente (ex: .env)
// No Expo, use EXPO_PUBLIC_API_URL para o ambiente de produção
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://coach-pro-v8e4.onrender.com";
const API_URL_OVERRIDE_KEY = "@procoach_api_url_override";

if (!process.env.EXPO_PUBLIC_API_URL) {
  console.warn("[ALERTA TÁTICO] EXPO_PUBLIC_API_URL não definida. As requisições podem falhar ou usar o endereço incorreto.");
}

let apiUrlOverrideCache: string | null | undefined = undefined;

function normalizeApiUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export async function getEffectiveApiUrl(): Promise<string> {
  if (apiUrlOverrideCache === undefined) {
    apiUrlOverrideCache = (await AsyncStorage.getItem(API_URL_OVERRIDE_KEY).catch(() => null)) ?? null;
  }
  const v = apiUrlOverrideCache ? normalizeApiUrl(apiUrlOverrideCache) : normalizeApiUrl(DEFAULT_API_URL);
  return v;
}

export async function setApiUrlOverride(next: string | null): Promise<string> {
  const normalized = next && next.trim() ? normalizeApiUrl(next) : null;
  apiUrlOverrideCache = normalized;
  if (normalized) {
    await AsyncStorage.setItem(API_URL_OVERRIDE_KEY, normalized);
  } else {
    await AsyncStorage.removeItem(API_URL_OVERRIDE_KEY);
  }
  return getEffectiveApiUrl();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = await getEffectiveApiUrl();
  const url = `${baseUrl}/api${path}`;
  
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...options.headers },
      ...options,
    });
    
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${options.method ?? "GET"} ${path} → ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  } catch (error) {
    console.error(`[ALERTA TÁTICO] Falha na comunicação com o Cérebro: ${url}`, error);
    throw error;
  }
}

// -----------------------------------------------------------------------------
// INTERFACES (ANATOMIA DOS DADOS E REGRAS DE OURO)
// -----------------------------------------------------------------------------

export interface AthletePayload {
  name?: string;
  // Regra de Ouro: Foco absoluto na Prova Alvo
  targetRaceName?: string;
  targetRacePriority?: "P1" | "P2" | "P3"; 
  targetRaceDate?: string;
  targetRaceDistanceKm?: number;
  // Regra de Ouro: Matriz de 16 Semanas (Valores de 1 a 16)
  currentWeek?: number;
  hrv?: number;
  painLevel?: number;
  races?: Race[];
}

export interface WorkoutPayload {
  date: string;
  // Regra de Ouro: Quilometragem sempre inteira
  distanceKm: number; 
  type: string;
  durationMin: number;
  week: number;
  // Regra de Ouro: Análise Quali/Quanti e Prevenção de Lesões
  rpe: number;         // Rate of Perceived Exertion (1-10)
  painLevel?: number;  // Radar Articular (1-10)
  injuryAlert?: string; // Descrição de dores (ex: "Ombro Direito")
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  tracksTotal: number;
  spotifyUrl: string;
  spotifyUri: string;
  owner: string;
}

export interface StravaDiagnostics {
  configured: boolean;
  connected: boolean;
  redirectUri: string;
  lastSyncAt: string | null;
}

// -----------------------------------------------------------------------------
// MÓDULOS DA API (SERVIÇOS DE TELEMETRIA)
// -----------------------------------------------------------------------------

export const ProCoachAPI = {
  // --- SINCRONIZAÇÃO E MATRIZ DE 16 SEMANAS ---
  async syncAthlete(payload: AthletePayload) {
    // Garante que a semana nunca fuja do ciclo de 16 semanas
    if (payload.currentWeek && (payload.currentWeek < 1 || payload.currentWeek > 16)) {
      console.warn("[RADAR] Semana fora da Matriz. Ajustando para limites da base.");
      payload.currentWeek = Math.max(1, Math.min(16, payload.currentWeek));
    }
    
    return request<{ athlete: unknown }>("/procoach/athletes/sync", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getAthlete() {
    return request<{ athlete: unknown }>(`/procoach/me`);
  },

  // --- TELEMETRIA TÁTICA (TREINOS) ---
  async logWorkout(payload: WorkoutPayload) {
    // REGRA DE OURO: QUILOMETRAGEM REDONDA
    // Intercepta e arredonda matematicamente antes de enviar ao Render
    const cargaBlindada = {
      ...payload,
      distanceKm: Math.round(payload.distanceKm)
    };

    return request<{ entry: unknown }>(
      `/procoach/me/workouts`,
      { method: "POST", body: JSON.stringify(cargaBlindada) }
    );
  },

  async logWorkoutFeedback(payload: { date: string; rpe?: number; painLevel?: number; notes?: string }) {
    return request<{ ok: boolean; entryDate: string }>(`/procoach/me/workout-feedback`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getWorkouts(limit = 30) {
    return request<{ entries: unknown[] }>(
      `/procoach/me/workouts?limit=${limit}`
    );
  },

  async getWeeklyStats() {
    return request<{ weeklyCompleted: Record<number, number> }>(
      `/procoach/me/weekly-stats`
    );
  },

  // --- ESTOQUE DE GÉIS ---
  async getGelStock() {
    return request<{ gelsInStock: number }>(`/procoach/me/gel-stock`);
  },

  async setGelStock(gelsInStock: number) {
    return request<{ gelsInStock: number }>(`/procoach/me/gel-stock`, {
      method: "PUT",
      body: JSON.stringify({ gelsInStock }),
    });
  },

  async logGelUsage(payload: { date: string; context: string; gelsUsed: number }) {
    return request<{ gelsInStock: number; gelsUsed: number; entryDate: string; context: string }>(
      `/procoach/me/gel-usage`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async importPlanJson(payload: unknown) {
    return request<{ imported: number; firstDate: string; lastDate: string }>(
      `/procoach/me/plan/import-json`,
      { method: "POST", body: JSON.stringify(payload) }
    );
  },

  async getPlan(opts: { from?: string; to?: string } = {}) {
    const qs = new URLSearchParams();
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      sessions: Array<{
        session_date: string;
        day_name: string | null;
        activity: string;
        pace_target: string | null;
        treadmill_speed: string | null;
        rest_interval: string | null;
        structure: string | null;
        planned_km?: number;
      }>;
    }>(`/procoach/me/plan${suffix}`);
  },

  async getPlanToday(date?: string) {
    const suffix = date ? `?date=${encodeURIComponent(date)}` : "";
    return request<{
      session: null | {
        session_date: string;
        day_name: string | null;
        activity: string;
        pace_target: string | null;
        treadmill_speed: string | null;
        rest_interval: string | null;
        structure: string | null;
        planned_km?: number;
      };
    }>(`/procoach/me/plan/today${suffix}`);
  },

  async getPlanNext(from?: string) {
    const suffix = from ? `?from=${encodeURIComponent(from)}` : "";
    return request<{
      session: null | {
        session_date: string;
        day_name: string | null;
        activity: string;
        pace_target: string | null;
        treadmill_speed: string | null;
        rest_interval: string | null;
        structure: string | null;
        planned_km?: number;
      };
    }>(`/procoach/me/plan/next${suffix}`);
  },

  async getCompliance(opts: { from?: string; to?: string } = {}) {
    const qs = new URLSearchParams();
    if (opts.from) qs.set("from", opts.from);
    if (opts.to) qs.set("to", opts.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<{
      from: string;
      to: string;
      plannedSessions: number;
      plannedKm: number;
      completedSessions: number;
      completedKm: number;
    }>(`/procoach/me/compliance${suffix}`);
  },

  async upsertBioimpedance(payload: unknown) {
    return request<{ entry: Record<string, unknown> | null }>(`/procoach/me/bioimpedance`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getBioimpedance(limit = 30) {
    return request<{ entries: Array<Record<string, unknown>> }>(
      `/procoach/me/bioimpedance?limit=${Math.max(1, Math.min(90, limit))}`
    );
  },

  // --- AUTENTICAÇÃO ---
  async sendOTP(phone: string) {
    return request<{ sent: boolean; phone: string }>("/auth/otp/send", {
      method: "POST",
      body: JSON.stringify({ phone }),
    });
  },

  async verifyOTP(phone: string, code: string, deviceId: string) {
    return request<{ token: string; athlete: unknown; expiresAt: string }>(
      "/auth/otp/verify",
      {
        method: "POST",
        body: JSON.stringify({ phone, code, deviceId }),
      }
    );
  },

  async verifyToken(token: string) {
    return request<{ valid: boolean; athlete: unknown }>("/auth/verify-token", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  async logout(token: string) {
    return request<{ success: boolean }>("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },

  // --- INTEGRAÇÃO STRAVA ---
  async stravaStatus() {
    return request<{ connected: boolean; configured: boolean; lastSyncAt: string | null }>(
      `/strava/status-device`
    );
  },

  async stravaSync() {
    return request<{ imported: number; synced: boolean }>("/strava/sync-device", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  async stravaDisconnect() {
    return request<{ disconnected: boolean }>("/strava/disconnect-device", {
      method: "POST",
      body: JSON.stringify({}),
    });
  },

  async stravaConnectUrl(): Promise<string> {
    const res = await request<{ url: string }> (
      `/strava/connect-url`
    );
    return res.url;
  },

  async stravaDiagnostics() {
    return request<StravaDiagnostics>(`/strava/diagnostics`);
  },

  // --- NOTIFICAÇÕES TÁTICAS ---
  async registerPushToken(pushToken: string) {
    return request<{ registered: boolean }>(
      `/procoach/me/push-token`,
      { method: "POST", body: JSON.stringify({ token: pushToken }) }
    );
  },

  // --- ORÁCULO DE IA E LOGÍSTICA ---
  async generateAIWorkout(payload: {
    currentWeek: number;
    hrv: number;
    painLevel: number;
    targetRaceDistanceKm: number;
    targetRaceDate: string;
  }) {
    return request<{
      workout: {
        type: string;
        distanceKm: number;
        durationMin: number;
        description: string;
        reasoning: string;
      };
    }>("/procoach/ai-workout", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  async getSpotifyPlaylist(workoutType: string) {
    return request<{ playlist: SpotifyPlaylist; workoutLabel: string }>(
      `/spotify/playlist-for-workout?workoutType=${encodeURIComponent(workoutType)}`
    );
  },

  async generatePostRaceRecovery(payload: {
    raceName: string;
    raceDistanceKm: number;
    finishDurationSec: number;
    currentWeek: number;
  }) {
    return request<{
      totalDays: number;
      recoveryDays: Array<{
        dayOffset: number;
        type: string;
        distanceKm: number;
        durationMin: number;
        description: string;
      }>;
    }>("/procoach/post-race-recovery", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
