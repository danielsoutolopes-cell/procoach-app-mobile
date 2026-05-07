import { Race } from "./schema";
// api.ts
import Constants from "expo-constants";

// -----------------------------------------------------------------------------
// MOTOR DE COMUNICAÇÃO PROCOACH OS V5.1
// Arquitetura Sequencial: Comunicação Blindada com o Render
// -----------------------------------------------------------------------------

// Prioriza a URL fornecida via variável de ambiente (ex: .env)
// No Expo, use EXPO_PUBLIC_API_URL para o ambiente de produção
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "https://coach-pro-v8e4.onrender.com";

if (!process.env.EXPO_PUBLIC_API_URL) {
  console.warn("[ALERTA TÁTICO] EXPO_PUBLIC_API_URL não definida. As requisições podem falhar ou usar o endereço incorreto.");
}

const BASE = `${API_URL}/api`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${BASE}${path}`;
  
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
  deviceId: string;
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

  async getAthlete(deviceId: string) {
    return request<{ athlete: unknown }>(`/procoach/athletes/${deviceId}`);
  },

  // --- TELEMETRIA TÁTICA (TREINOS) ---
  async logWorkout(deviceId: string, payload: WorkoutPayload) {
    // REGRA DE OURO: QUILOMETRAGEM REDONDA
    // Intercepta e arredonda matematicamente antes de enviar ao Render
    const cargaBlindada = {
      ...payload,
      distanceKm: Math.round(payload.distanceKm)
    };

    return request<{ entry: unknown }>(
      `/procoach/athletes/${deviceId}/workouts`,
      { method: "POST", body: JSON.stringify(cargaBlindada) }
    );
  },

  async getWorkouts(deviceId: string, limit = 30) {
    return request<{ entries: unknown[] }>(
      `/procoach/athletes/${deviceId}/workouts?limit=${limit}`
    );
  },

  async getWeeklyStats(deviceId: string) {
    return request<{ weeklyCompleted: Record<number, number> }>(
      `/procoach/athletes/${deviceId}/weekly-stats`
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
  async stravaStatus(deviceId: string) {
    return request<{ connected: boolean; lastSyncAt: string | null; stravaAthleteId?: number }>(
      `/strava/status?deviceId=${encodeURIComponent(deviceId)}`
    );
  },

  async stravaSync(deviceId: string) {
    return request<{ imported: number; total: number }>("/strava/sync", {
      method: "POST",
      body: JSON.stringify({ deviceId }),
    });
  },

  async stravaDisconnect(deviceId: string) {
    return request<{ disconnected: boolean }>("/strava/disconnect", {
      method: "POST",
      body: JSON.stringify({ deviceId }),
    });
  },

  stravaConnectUrl(deviceId: string): string {
    return `${BASE}/strava/connect?deviceId=${encodeURIComponent(deviceId)}`;
  },

  // --- NOTIFICAÇÕES TÁTICAS ---
  async registerPushToken(deviceId: string, pushToken: string) {
    return request<{ registered: boolean }>(
      `/procoach/athletes/${deviceId}/push-token`,
      { method: "POST", body: JSON.stringify({ token: pushToken }) }
    );
  },

  // --- ORÁCULO DE IA E LOGÍSTICA ---
  async generateAIWorkout(payload: {
    deviceId: string;
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
    deviceId: string;
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
