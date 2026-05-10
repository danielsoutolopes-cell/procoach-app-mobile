import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  calculateCurrentWeek,
  formatDistance,
  getRecoverySuggestion,
  getTodayWorkoutForWeek,
  shouldSuggestRecovery,
} from "@/utils/training";
import { ProCoachAPI } from "@/services/api";

export type WorkoutType =
  | "corrida"
  | "bike"
  | "regenerativo"
  | "forca"
  | "folga";

export interface RecoveryDay {
  dayOffset: number;
  type: WorkoutType;
  distanceKm: number;
  durationMin: number;
  description: string;
}

export interface PostRaceRecovery {
  raceId: string;
  raceName: string;
  raceDistanceKm: number;
  finishDurationSec: number;
  finishedAt: string;
  totalDays: number;
  days: RecoveryDay[];
  completedDayOffsets: number[];
}

export interface CompletedEntry {
  date: string;
  distanceKm: number;
  type: WorkoutType;
  durationMin: number;
  week: number;
  injuryAlert?: string;
}

export interface DailyWorkout {
  type: WorkoutType;
  distanceKm: number;
  durationMin: number;
  description: string;
  completed: boolean;
  injuryAlert?: string;
  aiGenerated?: boolean;
  aiReasoning?: string;
}

export type RacePriority = "P1" | "P2" | "P3";

export interface Race {
  id: string;
  name: string;
  date: string;
  distanceKm: number;
  priority: RacePriority;
  address?: string;
  raceStartTime?: string;    // "07:00" format
  targetPaceMinKm?: number;  // e.g. 6.5 = 6min30s/km
  archived?: boolean;
}

export interface AthleteProfile {
  name: string;
  targetRaceName: string;
  targetRaceDate: string;
  targetRaceDistanceKm: number;
  races: Race[];
  macrocycleRaceId?: string | null;
}

export interface AthleteState {
  profile: AthleteProfile;
  todayWorkout: DailyWorkout;
  hrv: number;
  painLevel: number;
  currentWeek: number;
  history: CompletedEntry[];
  weeklyCompleted: Record<number, number>;
  synced: boolean;
  aiLoading: boolean;
  lastCheckInDate: string;
}

interface AthleteContextType {
  state: AthleteState;
  recoveryBlock: PostRaceRecovery | null;
  updateProfile: (profile: Partial<AthleteProfile>) => Promise<void>;
  updateHRV: (hrv: number) => Promise<void>;
  updatePainLevel: (level: number) => Promise<void>;
  markWorkoutComplete: (opts?: { shoeId?: number | null }) => Promise<void>;
  setCurrentWeek: (week: number) => Promise<void>;
  refreshHistory: () => Promise<void>;
  regenerateWorkout: () => Promise<void>;
  submitDailyCheckIn: (hrv: number, pain: number) => Promise<void>;
  setRecoveryBlock: (block: PostRaceRecovery) => Promise<void>;
  clearRecoveryBlock: () => Promise<void>;
}

const defaultRaceDate = new Date(
  Date.now() + 16 * 7 * 24 * 60 * 60 * 1000
).toISOString();

const baseWorkout = getTodayWorkoutForWeek(1);

const DEFAULT_STATE: AthleteState = {
  profile: {
    name: "Atleta",
    targetRaceName: "Maratona São Paulo",
    targetRaceDate: defaultRaceDate,
    targetRaceDistanceKm: 42,
    races: [],
  },
  todayWorkout: { ...baseWorkout, completed: false },
  hrv: 68,
  painLevel: 0,
  currentWeek: 1,
  history: [],
  weeklyCompleted: {},
  synced: false,
  aiLoading: false,
  lastCheckInDate: "",
};

const AthleteContext = createContext<AthleteContextType | null>(null);
const STORAGE_KEY = "@procoach_v51_state_v4";
const AI_WORKOUT_DATE_KEY = "@procoach_ai_workout_date_v2";
const AI_WORKOUT_CACHE_KEY = "@procoach_ai_workout_cache_v1";
const RECOVERY_BLOCK_KEY = "@procoach_recovery_block_v1";
const COMPLETED_WORKOUT_DAYS_KEY = "@procoach_completed_workout_days_v1";

function getSaoPauloDayKey(d: Date = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function deriveTargetFromNextP1(profile: AthleteProfile): AthleteProfile {
  const races = profile.races ?? [];
  const anchorId = profile.macrocycleRaceId;
  const anchor = anchorId ? races.find((r) => r.id === anchorId) : undefined;
  if (anchor) {
    return {
      ...profile,
      targetRaceName: anchor.name,
      targetRaceDate: anchor.date,
      targetRaceDistanceKm: anchor.distanceKm,
    };
  }

  const p1s = races.filter((r) => r.priority === "P1");
  if (p1s.length === 0) return profile;
  const todayKey = getSaoPauloDayKey();
  const sorted = [...p1s].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((r) => r.date.slice(0, 10) >= todayKey);
  const next = upcoming[0] ?? sorted[0]!;
  return {
    ...profile,
    targetRaceName: next.name,
    targetRaceDate: next.date,
    targetRaceDistanceKm: next.distanceKm,
  };
}

async function fetchAIWorkout(opts: {
  currentWeek: number;
  hrv: number;
  painLevel: number;
  targetRaceDistanceKm: number;
  targetRaceDate: string;
  currentWorkoutCompleted: boolean;
}): Promise<DailyWorkout | null> {
  try {
    const result = await ProCoachAPI.generateAIWorkout({
      currentWeek: opts.currentWeek,
      hrv: opts.hrv,
      painLevel: opts.painLevel,
      targetRaceDistanceKm: opts.targetRaceDistanceKm,
      targetRaceDate: opts.targetRaceDate,
    });
    const w = result.workout;
    return {
      type: (w.type as WorkoutType) ?? "corrida",
      distanceKm: w.distanceKm ?? 0,
      durationMin: w.durationMin ?? 0,
      description: w.description ?? "",
      completed: opts.currentWorkoutCompleted,
      aiGenerated: true,
      aiReasoning: w.reasoning,
      injuryAlert: (w as any).injuryAlert ?? undefined,
    };
  } catch {
    return null;
  }
}

export function AthleteProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AthleteState>(DEFAULT_STATE);
  const [recoveryBlock, setRecoveryBlockState] = useState<PostRaceRecovery | null>(null);
  const mountedRef = React.useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    (async () => {
      let localState = DEFAULT_STATE;
      const [raw, cachedWorkoutRaw, lastAIDate, recoveryRaw, completedDaysRaw] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEY),
        AsyncStorage.getItem(AI_WORKOUT_CACHE_KEY),
        AsyncStorage.getItem(AI_WORKOUT_DATE_KEY),
        AsyncStorage.getItem(RECOVERY_BLOCK_KEY),
        AsyncStorage.getItem(COMPLETED_WORKOUT_DAYS_KEY),
      ]);
      if (raw) {
        try {
          const saved = JSON.parse(raw) as AthleteState;
          localState = {
            ...DEFAULT_STATE,
            ...saved,
            history: saved.history ?? [],
            weeklyCompleted: saved.weeklyCompleted ?? {},
            synced: false,
            aiLoading: false,
          };
        } catch {}
      }
      // Restore cached AI workout if present (survives reloads while AI was in-flight)
      const todayStr = new Date().toDateString();
      const todayKey = getSaoPauloDayKey();
      const completedDays: string[] = (() => {
        try {
          const parsed = completedDaysRaw ? JSON.parse(completedDaysRaw) : [];
          return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
        } catch {
          return [];
        }
      })();
      const completedToday = completedDays.includes(todayKey);
      if (completedToday) {
        localState = { ...localState, todayWorkout: { ...localState.todayWorkout, completed: true } };
      }
      const cachedWorkout: DailyWorkout | null = (() => {
        try { return cachedWorkoutRaw ? JSON.parse(cachedWorkoutRaw) : null; } catch { return null; }
      })();
      const hasCachedWorkout = lastAIDate === todayStr && cachedWorkout &&
        typeof cachedWorkout.description === "string" &&
        cachedWorkout.description.length > 20 &&
        cachedWorkout.description !== "Treino do dia gerado pela IA.";
      if (hasCachedWorkout && cachedWorkout) {
        localState = { ...localState, todayWorkout: { ...cachedWorkout, completed: localState.todayWorkout.completed } };
      }

      if (
        (localState.profile.races?.length ?? 0) === 0 &&
        localState.profile.targetRaceName === "Maratona São Paulo" &&
        localState.profile.targetRaceDistanceKm === 42
      ) {
        const p1Date = "2026-07-26T15:00:00.000Z";
        localState = {
          ...localState,
          profile: {
            ...localState.profile,
            targetRaceName: "Nike SP City Marathon",
            targetRaceDate: p1Date,
            targetRaceDistanceKm: 21,
            races: [
              {
                id: "p1-nike-sp-city-marathon-21k-2026",
                name: "Nike SP City Marathon",
                date: p1Date,
                distanceKm: 21,
                priority: "P1",
                address: "Praça Charles Miller, São Paulo, SP",
                raceStartTime: "05:30",
              },
            ],
            macrocycleRaceId: "p1-nike-sp-city-marathon-21k-2026",
          },
        };
      }
      localState = { ...localState, profile: deriveTargetFromNextP1(localState.profile) };
      if (!mountedRef.current) return;
      setState(localState);

      // Load recovery block
      if (recoveryRaw) {
        try {
          const rb = JSON.parse(recoveryRaw) as PostRaceRecovery;
          setRecoveryBlockState(rb);
        } catch {}
      }

      // Sync to backend
      try {
        await ProCoachAPI.syncAthlete({
          name: localState.profile.name,
          targetRaceName: localState.profile.targetRaceName,
          targetRaceDate: localState.profile.targetRaceDate,
          targetRaceDistanceKm: localState.profile.targetRaceDistanceKm,
          hrv: localState.hrv,
          painLevel: localState.painLevel,
          currentWeek: localState.currentWeek,
        });

        const statsRes = await ProCoachAPI.getWeeklyStats();
        const remoteWeeklyCompleted = statsRes.weeklyCompleted ?? {};
        const merged: Record<number, number> = { ...localState.weeklyCompleted };
        for (const [week, km] of Object.entries(remoteWeeklyCompleted)) {
          const w = Number(week);
          merged[w] = Number(km) || 0;
        }

        const needsNewWorkout = !hasCachedWorkout;

        if (needsNewWorkout) {
          // Mark AI date BEFORE the request so a page reload won't re-trigger
          await AsyncStorage.setItem(AI_WORKOUT_DATE_KEY, todayStr);
          if (!mountedRef.current) return;
          setState((prev) => ({ ...prev, weeklyCompleted: merged, synced: true, aiLoading: true }));

          const aiWorkout = await fetchAIWorkout({
            currentWeek: localState.currentWeek,
            hrv: localState.hrv,
            painLevel: localState.painLevel,
            targetRaceDistanceKm: localState.profile.targetRaceDistanceKm,
            targetRaceDate: localState.profile.targetRaceDate,
            currentWorkoutCompleted: localState.todayWorkout.completed,
          });

          if (!mountedRef.current) return;
          if (aiWorkout) {
            // Store in separate cache key for resilience across reloads
            await AsyncStorage.setItem(AI_WORKOUT_CACHE_KEY, JSON.stringify(aiWorkout));
            setState((prev) => {
              const next = { ...prev, weeklyCompleted: merged, synced: true, aiLoading: false, todayWorkout: { ...aiWorkout, completed: prev.todayWorkout.completed } };
              AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              return next;
            });
          } else {
            setState((prev) => {
              const next = { ...prev, weeklyCompleted: merged, synced: true, aiLoading: false };
              AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              return next;
            });
          }
        } else {
          if (!mountedRef.current) return;
          setState((prev) => {
            const next = { ...prev, weeklyCompleted: merged, synced: true, aiLoading: false };
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        }
      } catch {
        if (!mountedRef.current) return;
        setState((prev) => ({ ...prev, synced: false, aiLoading: false }));
      }
    })();
  }, []);

  const save = useCallback(async (newState: AthleteState) => {
    setState(newState);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
  }, []);

  const syncToBackend = useCallback(async (s: AthleteState) => {
    try {
      await ProCoachAPI.syncAthlete({
        name: s.profile.name,
        targetRaceName: s.profile.targetRaceName,
        targetRaceDate: s.profile.targetRaceDate,
        targetRaceDistanceKm: s.profile.targetRaceDistanceKm,
        hrv: s.hrv,
        painLevel: s.painLevel,
        currentWeek: s.currentWeek,
      });
    } catch {}
  }, []);

  const buildWorkoutWithInjuryCheck = useCallback(
    (base: DailyWorkout, painLevel: number, hrv: number): DailyWorkout => {
      if (shouldSuggestRecovery(painLevel, hrv)) {
        const suggestion = getRecoverySuggestion(painLevel, hrv);
        return {
          ...base,
          injuryAlert: suggestion,
          type: suggestion === "Bike Indolor" ? "bike" : "regenerativo",
          distanceKm: suggestion === "Bike Indolor" ? 20 : 8,
          durationMin: 45,
          description:
            suggestion === "Bike Indolor"
              ? "Pedalada leve sem impacto articular. Frequência cardíaca máx 130bpm."
              : "Caminhada leve ou trote suave. Priorize recuperação muscular e neural.",
          aiGenerated: false,
        };
      }
      const { injuryAlert: _removed, ...rest } = base;
      return rest;
    },
    []
  );

  const regenerateWorkout = useCallback(async () => {
    setState((prev) => ({ ...prev, aiLoading: true }));
    try {
      const aiWorkout = await fetchAIWorkout({
        currentWeek: state.currentWeek,
        hrv: state.hrv,
        painLevel: state.painLevel,
        targetRaceDistanceKm: state.profile.targetRaceDistanceKm,
        targetRaceDate: state.profile.targetRaceDate,
        currentWorkoutCompleted: state.todayWorkout.completed,
      });
      if (aiWorkout) {
        const todayStr = new Date().toDateString();
        await AsyncStorage.setItem(AI_WORKOUT_DATE_KEY, todayStr);
        const next = { ...state, aiLoading: false, todayWorkout: aiWorkout };
        await save(next);
      } else {
        setState((prev) => ({ ...prev, aiLoading: false }));
      }
    } catch {
      setState((prev) => ({ ...prev, aiLoading: false }));
    }
  }, [state, save]);

  const updateProfile = useCallback(
    async (profile: Partial<AthleteProfile>) => {
      const mergedProfile = { ...state.profile, ...profile };
      const newProfile = deriveTargetFromNextP1(mergedProfile);
      const newWeek = newProfile.targetRaceDate
        ? calculateCurrentWeek(newProfile.targetRaceDate)
        : state.currentWeek;
      const baseWorkoutNew = getTodayWorkoutForWeek(newWeek);
      const todayWorkout = buildWorkoutWithInjuryCheck(
        { ...baseWorkoutNew, completed: state.todayWorkout.completed },
        state.painLevel,
        state.hrv
      );
      const next = { ...state, profile: newProfile, currentWeek: newWeek, todayWorkout, aiLoading: false };
      await save(next);
      await syncToBackend(next);

      // Regenerate AI workout after profile change
      setState((prev) => ({ ...prev, aiLoading: true }));
      try {
        const aiWorkout = await fetchAIWorkout({
          currentWeek: newWeek,
          hrv: state.hrv,
          painLevel: state.painLevel,
          targetRaceDistanceKm: newProfile.targetRaceDistanceKm,
          targetRaceDate: newProfile.targetRaceDate,
          currentWorkoutCompleted: state.todayWorkout.completed,
        });
        if (aiWorkout) {
          const todayStr = new Date().toDateString();
          await AsyncStorage.setItem(AI_WORKOUT_DATE_KEY, todayStr);
          await save({ ...next, aiLoading: false, todayWorkout: aiWorkout });
        } else {
          setState((prev) => ({ ...prev, aiLoading: false }));
        }
      } catch {
        setState((prev) => ({ ...prev, aiLoading: false }));
      }
    },
    [state, save, buildWorkoutWithInjuryCheck, syncToBackend]
  );

  const updateHRV = useCallback(
    async (hrv: number) => {
      const todayWorkout = buildWorkoutWithInjuryCheck(state.todayWorkout, state.painLevel, hrv);
      const next = { ...state, hrv, todayWorkout };
      await save(next);
      await syncToBackend(next);
    },
    [state, save, buildWorkoutWithInjuryCheck, syncToBackend]
  );

  const updatePainLevel = useCallback(
    async (painLevel: number) => {
      const todayWorkout = buildWorkoutWithInjuryCheck(state.todayWorkout, painLevel, state.hrv);
      const next = { ...state, painLevel, todayWorkout };
      await save(next);
      await syncToBackend(next);
    },
    [state, save, buildWorkoutWithInjuryCheck, syncToBackend]
  );

  const markWorkoutComplete = useCallback(async (opts?: { shoeId?: number | null }) => {
    const roundedKm = formatDistance(state.todayWorkout.distanceKm);
    const todayKey = getSaoPauloDayKey();
    try {
      const existingRaw = await AsyncStorage.getItem(COMPLETED_WORKOUT_DAYS_KEY);
      const existing = (() => {
        try {
          const parsed = existingRaw ? JSON.parse(existingRaw) : [];
          return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
        } catch {
          return [];
        }
      })();
      if (!existing.includes(todayKey)) {
        await AsyncStorage.setItem(
          COMPLETED_WORKOUT_DAYS_KEY,
          JSON.stringify([todayKey, ...existing].slice(0, 60)),
        );
      }
    } catch {}
    const entry: CompletedEntry = {
      date: todayKey,
      distanceKm: roundedKm,
      type: state.todayWorkout.type,
      durationMin: state.todayWorkout.durationMin,
      week: state.currentWeek,
      injuryAlert: state.todayWorkout.injuryAlert,
    };

    const prevKm = state.weeklyCompleted[state.currentWeek] ?? 0;
    const adherenceKm = entry.type === "corrida" && roundedKm >= 3 ? roundedKm : 0;
    const next: AthleteState = {
      ...state,
      todayWorkout: { ...state.todayWorkout, completed: true },
      history: [entry, ...state.history],
      weeklyCompleted: {
        ...state.weeklyCompleted,
        [state.currentWeek]: prevKm + adherenceKm,
      },
    };
    await save(next);

    try {
      const rpe =
        state.todayWorkout.type === "folga"
          ? 1
          : state.todayWorkout.type === "regenerativo"
            ? 3
            : 5;
      await ProCoachAPI.logWorkout({
        date: entry.date,
        distanceKm: roundedKm,
        type: entry.type,
        durationMin: entry.durationMin,
        week: entry.week,
        rpe,
        painLevel: state.painLevel,
        injuryAlert: entry.injuryAlert,
        shoeId: opts?.shoeId ?? null,
      });
    } catch {}
  }, [state, save]);

  const setCurrentWeek = useCallback(
    async (week: number) => {
      const baseWorkoutNew = getTodayWorkoutForWeek(week);
      const todayWorkout = buildWorkoutWithInjuryCheck(
        { ...baseWorkoutNew, completed: false },
        state.painLevel,
        state.hrv
      );
      const next = { ...state, currentWeek: week, todayWorkout, aiLoading: false };
      await save(next);
      await syncToBackend(next);
    },
    [state, save, buildWorkoutWithInjuryCheck, syncToBackend]
  );

  const refreshHistory = useCallback(async () => {
    try {
      const [workoutsRes, statsRes] = await Promise.all([
        ProCoachAPI.getWorkouts(100),
        ProCoachAPI.getWeeklyStats(),
      ]);
      const entries = (workoutsRes.entries as any[]).map((e) => ({
        date: e.entryDate ?? e.entry_date ?? "",
        distanceKm: e.distanceKm ?? e.distance_km ?? 0,
        type: e.type as WorkoutType,
        durationMin: e.durationMin ?? e.duration_min ?? 0,
        week: e.week ?? 1,
        injuryAlert: e.injuryAlert ?? e.injury_alert ?? undefined,
      })) as CompletedEntry[];
      const remoteWeekly = statsRes.weeklyCompleted ?? {};
      setState((prev) => {
        const merged: Record<number, number> = { ...prev.weeklyCompleted };
        for (const [w, km] of Object.entries(remoteWeekly)) {
          merged[Number(w)] = Number(km) || 0;
        }
        const next = { ...prev, history: entries, weeklyCompleted: merged };
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      });
    } catch {}
  }, []);

  const submitDailyCheckIn = useCallback(
    async (hrv: number, pain: number) => {
      const todayStr = new Date().toDateString();

      // Save HRV + pain + mark check-in date, clear AI cache so fresh workout generates
      await AsyncStorage.multiRemove([AI_WORKOUT_CACHE_KEY, AI_WORKOUT_DATE_KEY]);

      const intermediate = {
        ...state,
        hrv,
        painLevel: pain,
        lastCheckInDate: todayStr,
        aiLoading: true,
      };
      await save(intermediate);
      await syncToBackend(intermediate);

      // Re-trigger AI with the new values
      setState((prev) => ({ ...prev, hrv, painLevel: pain, lastCheckInDate: todayStr, aiLoading: true }));
      try {
        const aiWorkout = await fetchAIWorkout({
          currentWeek: state.currentWeek,
          hrv,
          painLevel: pain,
          targetRaceDistanceKm: state.profile.targetRaceDistanceKm,
          targetRaceDate: state.profile.targetRaceDate,
          currentWorkoutCompleted: state.todayWorkout.completed,
        });
        if (aiWorkout) {
          await AsyncStorage.setItem(AI_WORKOUT_DATE_KEY, todayStr);
          await AsyncStorage.setItem(AI_WORKOUT_CACHE_KEY, JSON.stringify(aiWorkout));
          setState((prev) => {
            const next = { ...prev, hrv, painLevel: pain, lastCheckInDate: todayStr, aiLoading: false, todayWorkout: { ...aiWorkout, completed: prev.todayWorkout.completed } };
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            return next;
          });
        } else {
          setState((prev) => ({ ...prev, aiLoading: false }));
        }
      } catch {
        setState((prev) => ({ ...prev, aiLoading: false }));
      }
    },
    [state, save, syncToBackend]
  );

  const setRecoveryBlock = useCallback(async (block: PostRaceRecovery) => {
    setRecoveryBlockState(block);
    await AsyncStorage.setItem(RECOVERY_BLOCK_KEY, JSON.stringify(block));
  }, []);

  const clearRecoveryBlock = useCallback(async () => {
    setRecoveryBlockState(null);
    await AsyncStorage.removeItem(RECOVERY_BLOCK_KEY);
  }, []);

  return (
    <AthleteContext.Provider
      value={{
        state, recoveryBlock,
        updateProfile, updateHRV, updatePainLevel, markWorkoutComplete,
        setCurrentWeek, refreshHistory, regenerateWorkout, submitDailyCheckIn,
        setRecoveryBlock, clearRecoveryBlock,
      }}
    >
      {children}
    </AthleteContext.Provider>
  );
}

export function useAthlete() {
  const ctx = useContext(AthleteContext);
  if (!ctx) throw new Error("useAthlete must be used inside AthleteProvider");
  return ctx;
}
