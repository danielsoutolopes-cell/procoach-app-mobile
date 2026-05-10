import type { Athlete, WorkoutEntry, WeeklyStat } from '@workspace/db/schema';

export type RacePriority = 'P1' | 'P2' | 'P3';

export interface Race {
  id: string;
  name: string;
  date: string;
  distanceKm: number;
  priority: RacePriority;
  address?: string;
  raceStartTime?: string;
  targetPaceMinKm?: number;
  archived?: boolean;
}

export interface AthleteProfile extends Athlete {
  races?: Race[];
  macrocycleRaceId?: string | null;
}

// Re-exporta os tipos inferidos do schema do Drizzle do pacote compartilhado `lib/db`.
// Isso garante uma única fonte de verdade para as estruturas de dados em todo o monorepo,
// evitando duplicação e mantendo a consistência entre frontend e backend.
export type { Athlete, WorkoutEntry, WeeklyStat };

/**
 * Solução 3 (Padrão Sênior): Separação de Leitura e Criação
 * O CreatePayload omite os campos que o PostgreSQL/Drizzle gerenciam no servidor.
 */
export type CreateWorkoutPayload = Omit<WorkoutEntry, 'id' | 'createdAt' | 'athleteId'>;
