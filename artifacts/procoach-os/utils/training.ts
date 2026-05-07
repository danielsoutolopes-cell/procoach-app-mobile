export type Phase = "Base" | "Construção" | "Pico" | "Polimento";
export type WorkoutType = "corrida" | "bike" | "regenerativo" | "forca" | "folga";

export function formatDistance(km: number): number {
  return Math.round(km);
}

export function getPhase(week: number): Phase {
  if (week <= 4) return "Base";
  if (week <= 8) return "Construção";
  if (week <= 12) return "Pico";
  return "Polimento";
}

export function getPhaseColor(phase: Phase): string {
  switch (phase) {
    case "Base":       return "#4CAF50";
    case "Construção": return "#2196F3";
    case "Pico":       return "#FF5F00";
    case "Polimento":  return "#9C27B0";
  }
}

export function getBlockNumber(week: number): number {
  return Math.ceil(week / 4);
}

export function getWeekInBlock(week: number): number {
  return ((week - 1) % 4) + 1;
}

/** Week focus label shown in the plan grid */
export function getWeekFocus(week: number): string {
  const focuses: Record<number, string> = {
    1:  "Adaptação aeróbica",
    2:  "Rodagem contínua",
    3:  "Volume base Z2",
    4:  "Recuperação ativa",
    5:  "Volume crescente",
    6:  "Introdução de força",
    7:  "Progressivo longo",
    8:  "Recuperação/Teste",
    9:  "Máximo volume",
    10: "Velocidade + longão",
    11: "Pico de intensidade",
    12: "Recuperação pico",
    13: "Tapering suave",
    14: "Qualidade + ritmo",
    15: "Volume mínimo",
    16: "PROVA ALVO 🏁",
  };
  return focuses[week] ?? "";
}

/** Returns [startDate, endDate] ISO strings for a given training week, anchored to race date at week 16 */
export function getWeekDateRange(
  raceDateISO: string,
  week: number
): [string, string] {
  const raceDate = new Date(raceDateISO);
  const weeksFromRace = 16 - week;
  const weekStart = new Date(raceDate.getTime() - (weeksFromRace * 7 + 6) * 86400000);
  const weekEnd   = new Date(raceDate.getTime() - weeksFromRace * 7 * 86400000);
  return [weekStart.toISOString(), weekEnd.toISOString()];
}

/** Formats a date range as "01/09 – 07/09" */
export function formatWeekRange(raceDateISO: string, week: number): string {
  const [start, end] = getWeekDateRange(raceDateISO, week);
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Retroactively calculates current training week from race date */
export function calculateCurrentWeek(raceDateISO: string): number {
  const raceDate = new Date(raceDateISO);
  const today = new Date();
  const diffDays = Math.floor(
    (raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  const weeksToRace = Math.ceil(diffDays / 7);
  const currentWeek = 17 - weeksToRace;
  return Math.max(1, Math.min(16, currentWeek));
}

/** Returns true if athlete needs a recovery workout (injury prevention rule) */
export function shouldSuggestRecovery(painLevel: number, hrv: number): boolean {
  return painLevel >= 2 || hrv < 45;
}

/** Returns the recovery type based on pain/HRV severity */
export function getRecoverySuggestion(painLevel: number, hrv: number): string {
  if (painLevel >= 3) return "Bike Indolor";
  if (painLevel >= 2) return "Bike Indolor";
  if (hrv < 35)       return "Folga";
  return "Treino Regenerativo";
}

export function getWeeklyVolume(week: number): number {
  const volumes = [
    30, 35, 40, 32,
    45, 50, 55, 44,
    60, 65, 70, 56,
    42, 35, 25, 0,
  ];
  return volumes[week - 1] ?? 30;
}

export function getWeekRaceDateISO(raceDateISO: string, week: number): string {
  const raceDate = new Date(raceDateISO);
  const offset = (16 - week) * 7;
  const weekDate = new Date(raceDate.getTime() - offset * 24 * 60 * 60 * 1000);
  return weekDate.toISOString();
}

export function formatDateBR(isoDate: string): string {
  const d = new Date(isoDate);
  const day   = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year  = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function getDaysUntilRace(raceDateISO: string): number {
  const raceDate = new Date(raceDateISO);
  const today = new Date();
  const diff = Math.ceil(
    (raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  return Math.max(0, diff);
}

// ─── NIKE SP WEEKLY SESSIONS ─────────────────────────────────────────────────

export type DayCode = "TER" | "QUA" | "QUI" | "SÁB" | "DOM";
export type SessionType = "corrida" | "tiros" | "regenerativo" | "folga" | "prova";

export interface DaySession {
  day: DayCode;
  type: SessionType;
  label: string;
  distanceKm: number;
  description: string;
  isRace?: boolean;
  raceTag?: string;
}

const SESSION_COLOR: Record<SessionType, string> = {
  corrida:     "#4CAF50",
  tiros:       "#FF5F00",
  regenerativo:"#2196F3",
  folga:       "#9E9E9E",
  prova:       "#FFD700",
};

export function getSessionColor(type: SessionType): string {
  return SESSION_COLOR[type] ?? "#9E9E9E";
}

// Full 16-week Nike SP City Marathon plan anchored to P1 = 21K, P2 = 10K (Week 6 Sunday)
const NIKE_SP_SESSIONS: Record<number, DaySession[]> = {
  // ── BLOCO 1: BASE ───────────────────────────────────────────────────────────
  1: [
    { day: "TER", type: "corrida",      label: "Corrida leve 6km",       distanceKm: 6,  description: "Corrida aeróbica Z2. Cadência confortável, respiração nasal. 6:00–7:00/km." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 5km",       distanceKm: 5,  description: "Manutenção aeróbica. Pace fácil, sinta o corpo, sem pressão." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 5km",       distanceKm: 5,  description: "Trote suave 7:00+/km ou caminhada ativa. Mobilidade 10min pós-treino." },
    { day: "SÁB", type: "corrida",      label: "Corrida leve 6km",       distanceKm: 6,  description: "Corrida contínua Z2. Sem relógio, apenas percepção de esforço." },
    { day: "DOM", type: "corrida",      label: "Longão 8km Z2",          distanceKm: 8,  description: "Longão semanal. Ritmo conversacional, Z2. Hidratação a cada 20min." },
  ],
  2: [
    { day: "TER", type: "corrida",      label: "Corrida leve 7km",       distanceKm: 7,  description: "Corrida aeróbica Z2 com os 2km finais em Z3 progressivo." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 6km",       distanceKm: 6,  description: "Manutenção aeróbica. Pace fácil, foco em forma e cadência." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 5km",       distanceKm: 5,  description: "Trote regenerativo. Alongamento dinâmico pós-treino." },
    { day: "SÁB", type: "corrida",      label: "Corrida leve 7km",       distanceKm: 7,  description: "Rodagem contínua Z2. Mantenha pace entre 6:30–7:30/km." },
    { day: "DOM", type: "corrida",      label: "Longão 10km Z2",         distanceKm: 10, description: "Longão de volume. Pace Z2 o tempo todo. Primeiro gel se > 70min." },
  ],
  3: [
    { day: "TER", type: "corrida",      label: "Corrida leve 8km + strides", distanceKm: 8, description: "6km Z2 + 4×80m strides no final. Strides: aceleração suave, não sprint total." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 7km",       distanceKm: 7,  description: "Rodagem aeróbica Z2. Mantenha postura ereta e passada eficiente." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 6km",       distanceKm: 6,  description: "Trote muito leve. Foco em recuperação muscular, sem esforço." },
    { day: "SÁB", type: "corrida",      label: "Corrida leve 8km",       distanceKm: 8,  description: "Volume base Z2. Bom dia para testar estratégia de hidratação." },
    { day: "DOM", type: "corrida",      label: "Longão 11km Z2",         distanceKm: 11, description: "Longão progressivo. 7km Z2 + 4km Z2-Z3 suave. Gel aos 50min." },
  ],
  4: [
    { day: "TER", type: "corrida",      label: "Corrida leve 6km",       distanceKm: 6,  description: "Semana de recuperação ativa. Pace muito fácil, pernas leves." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 5km",       distanceKm: 5,  description: "Manutenção aeróbica curta. Corpo absorvendo volume das últimas 3 semanas." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 5km",       distanceKm: 5,  description: "Trote regenerativo ou caminhada. Priorize recuperação total." },
    { day: "SÁB", type: "corrida",      label: "Corrida leve 6km",       distanceKm: 6,  description: "Retomada leve. Pernas descansadas para o próximo bloco." },
    { day: "DOM", type: "corrida",      label: "Longão 10km Z2",         distanceKm: 10, description: "Longão de recuperação. Pace confortável, sem forçar." },
  ],

  // ── BLOCO 2: CONSTRUÇÃO ─────────────────────────────────────────────────────
  5: [
    { day: "TER", type: "tiros",        label: "4×1000m ritmo 10K",      distanceKm: 10, description: "Aquecimento 2km. 4×1000m em 6:12/km (pace Tribuna 10K) c/ 400m trote de rec. Desaquecimento 2km." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 8km",       distanceKm: 8,  description: "Corrida de absorção. Z2, pace fácil, pernas se adaptando aos tiros de terça." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 6km",       distanceKm: 6,  description: "Trote suave. Foco em recuperação pós-intervalado. Alongamento 15min." },
    { day: "SÁB", type: "corrida",      label: "Corrida moderada 9km",   distanceKm: 9,  description: "Corrida Z2-Z3 progressivo. 6km fácil + 3km em ritmo próximo ao pace de prova." },
    { day: "DOM", type: "corrida",      label: "Longão 12km Z2-Z3",      distanceKm: 12, description: "Longão de construção. 8km Z2 + 4km Z3 (7:00/km). Gel aos 60min." },
  ],
  6: [
    { day: "TER", type: "corrida",      label: "Ativação leve 6km",      distanceKm: 6,  description: "Corrida leve + 4×80m strides suaves. Preparação para a Tribuna 10K no domingo." },
    { day: "QUA", type: "regenerativo", label: "Regenerativo 5km",       distanceKm: 5,  description: "Trote suave pré-prova. Pernas descansando, mente afiada. Sem esforço." },
    { day: "QUI", type: "folga",        label: "Folga ativa",            distanceKm: 0,  description: "Descanso completo ou mobilidade leve 20min. Prepare material de prova." },
    { day: "SÁB", type: "corrida",      label: "Strides + aquecimento 3km", distanceKm: 3, description: "15min leve + 4×100m strides. Prepare géis, número e logística para amanhã." },
    { day: "DOM", type: "prova",        label: "🏁 TRIBUNA 10K",        distanceKm: 10, description: "Prova P2 — Tribuna 10K. Meta: 6:12/km (pace 10K). Gel após 60min se necessário. Santos, SP.", isRace: true, raceTag: "P2 · 10K · 6:12/km" },
  ],
  7: [
    { day: "TER", type: "regenerativo", label: "Recuperação pós-prova 6km", distanceKm: 6, description: "Corrida muito leve pós-Tribuna 10K. Pernas pesadas? Normal. Pace 7:30+/km sem pressão." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 8km",       distanceKm: 8,  description: "Retomada aeróbica. Corpo voltando ao ritmo após o esforço de domingo." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 6km",       distanceKm: 6,  description: "Trote suave de recuperação. Pernas ainda assimilando a prova." },
    { day: "SÁB", type: "corrida",      label: "Corrida moderada 10km",  distanceKm: 10, description: "Corrida Z2-Z3 retomando volume. Use dados da Tribuna para calibrar pace." },
    { day: "DOM", type: "corrida",      label: "Longão 15km Z2",         distanceKm: 15, description: "Longão de construção pós-prova. 15km Z2. Gel 1 aos 60min. Importante para base 21K." },
  ],
  8: [
    { day: "TER", type: "tiros",        label: "5×800m ritmo 6:00/km",   distanceKm: 10, description: "Aquecimento 2km. 5×800m em 6:00/km c/ 400m trote de rec. Semana de teste de velocidade." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 8km",       distanceKm: 8,  description: "Absorção pós-intervalado. Z2 pacífico." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 6km",       distanceKm: 6,  description: "Trote regenerativo. Semana de recuperação/consolidação do bloco." },
    { day: "SÁB", type: "corrida",      label: "Corrida moderada 9km",   distanceKm: 9,  description: "Corrida contínua Z2-Z3. Mantenha pace 6:30–7:00/km (pace meta 21K)." },
    { day: "DOM", type: "corrida",      label: "Longão 11km Z2",         distanceKm: 11, description: "Longão de recuperação do bloco. Pace confortável, não force." },
  ],

  // ── BLOCO 3: PICO ───────────────────────────────────────────────────────────
  9: [
    { day: "TER", type: "tiros",        label: "6×1000m pace 21K",       distanceKm: 12, description: "Aquec 2km. 6×1000m em 6:45/km (pace meta Nike SP 21K) c/ 400m rec. Desaquec 2km. Treino central do bloco." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 9km",       distanceKm: 9,  description: "Absorção pós-tiros. Pace Z2, foco em recuperação ativa." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 7km",       distanceKm: 7,  description: "Trote leve. Semana de volume máximo — priorize recuperação diária." },
    { day: "SÁB", type: "corrida",      label: "Tempo run 12km Z3",      distanceKm: 12, description: "12km contínuos em Z3 (7:00/km). Treino de limiar. Hidratação a cada 15min." },
    { day: "DOM", type: "corrida",      label: "Longão 16km Z2-Z3",      distanceKm: 16, description: "Longão de pico. 10km Z2 + 6km Z3. Estratégia de géis: 1 aos 60min, 2º aos 90min." },
  ],
  10: [
    { day: "TER", type: "tiros",        label: "4×1200m pace 6:30/km",   distanceKm: 12, description: "Aquec 2km. 4×1200m em 6:30/km (mais rápido que meta) c/ 600m rec. Desaquec 2km." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 10km",      distanceKm: 10, description: "Absorção aeróbica. Pace Z2 fácil." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 7km",       distanceKm: 7,  description: "Trote regenerativo. Semana de alto volume — cuide das pernas." },
    { day: "SÁB", type: "corrida",      label: "Progressivo 12km",       distanceKm: 12, description: "12km progressivo: 4km Z2 → 4km Z3 → 4km pace meta 21K (6:45/km). Teste de ritmo." },
    { day: "DOM", type: "corrida",      label: "Longão 18km Z2",         distanceKm: 18, description: "Maior longão do ciclo. 18km Z2, pace 7:30/km. Géis: 1 aos 60min, 2º aos 90min." },
  ],
  11: [
    { day: "TER", type: "tiros",        label: "3×2000m + 4×400m",       distanceKm: 14, description: "Aquec 2km. 3×2000m em 6:45/km c/ 800m rec. Recupere 3min. 4×400m rápido c/ 400m rec. Desaquec 2km." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 10km",      distanceKm: 10, description: "Absorção após treino intenso. Pace Z2 fácil." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 8km",       distanceKm: 8,  description: "Trote leve. Semana de pico de intensidade — recuperação é o treino." },
    { day: "SÁB", type: "corrida",      label: "Progressivo 13km",       distanceKm: 13, description: "Progressivo longo. 5km Z2 → 5km Z3 → 3km pace prova (6:45/km)." },
    { day: "DOM", type: "corrida",      label: "Longão 19km (simulação)", distanceKm: 19, description: "Longão simulação. 10km Z2 + 9km em pace prova 6:45/km. Géis: 1 aos 60min, 2º aos 90min. Treino mais importante do ciclo!" },
  ],
  12: [
    { day: "TER", type: "corrida",      label: "Strides + corrida 8km",  distanceKm: 8,  description: "Corrida Z2 8km + 6×100m strides soltos no final. Semana de recuperação do pico." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 8km",       distanceKm: 8,  description: "Corrida de absorção. Pernas se recuperando do volume alto de S10-S11." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 6km",       distanceKm: 6,  description: "Trote regenerativo. Priorize descanso — é semana de recuperação do pico." },
    { day: "SÁB", type: "corrida",      label: "Corrida moderada 10km",  distanceKm: 10, description: "Corrida Z2-Z3 moderada. Retomando disposição antes do polimento." },
    { day: "DOM", type: "corrida",      label: "Longão 14km Z2",         distanceKm: 14, description: "Longão de recuperação. 14km pace confortável, pernas se restaurando." },
  ],

  // ── BLOCO 4: POLIMENTO ──────────────────────────────────────────────────────
  13: [
    { day: "TER", type: "tiros",        label: "4×1000m pace 21K",       distanceKm: 10, description: "Aquec 2km. 4×1000m em 6:45/km (pace meta) c/ 400m rec. Desaquec 2km. Manutenção da velocidade, reduzindo volume." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 8km",       distanceKm: 8,  description: "Absorção leve. Pernas começando a ficar mais frescas com tapering." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 6km",       distanceKm: 6,  description: "Trote suave. Volume caindo — o corpo está acumulando energia." },
    { day: "SÁB", type: "corrida",      label: "Progressivo 9km",        distanceKm: 9,  description: "Progressivo curto. 4km Z2 → 3km Z3 → 2km pace prova. Sinta o ritmo." },
    { day: "DOM", type: "corrida",      label: "Longão 12km Z2",         distanceKm: 12, description: "Longão de polimento. 12km pace confortável. Últimas milhas longas antes da prova." },
  ],
  14: [
    { day: "TER", type: "tiros",        label: "3×1000m pace prova + strides", distanceKm: 9, description: "Aquec 2km. 3×1000m em 6:45/km c/ 400m rec. 4×100m strides. Desaquec 2km. Volume reduzido, qualidade mantida." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 7km",       distanceKm: 7,  description: "Corrida fácil. Volume reduzindo — pernas ficando frescas." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 5km",       distanceKm: 5,  description: "Trote muito suave. Polimento avançado — guarde energia para a prova." },
    { day: "SÁB", type: "corrida",      label: "Corrida leve 7km",       distanceKm: 7,  description: "Corrida leve de manutenção. Pace confortável, sem cronômetro." },
    { day: "DOM", type: "corrida",      label: "Longão 10km Z2",         distanceKm: 10, description: "Último longão antes da prova. 10km pace fácil. Confirme estratégia de géis." },
  ],
  15: [
    { day: "TER", type: "tiros",        label: "2×1000m + 4×200m rápido", distanceKm: 7, description: "Aquec 2km. 2×1000m pace prova c/ rec. 4×200m rápido c/ rec. Desaquec 2km. Volume mínimo, explosividade mantida." },
    { day: "QUA", type: "corrida",      label: "Corrida leve 5km",       distanceKm: 5,  description: "Corrida leve de manutenção. Pernas devem estar sentindo-se muito bem." },
    { day: "QUI", type: "regenerativo", label: "Regenerativo 4km",       distanceKm: 4,  description: "Trote curtinho. Semana de volume mínimo — guarde energia para a prova!" },
    { day: "SÁB", type: "corrida",      label: "Corrida leve 5km",       distanceKm: 5,  description: "Última corrida antes da semana da prova. Pace fácil e solta. Você está pronto." },
    { day: "DOM", type: "corrida",      label: "Longão curto 6km Z2",    distanceKm: 6,  description: "Trote leve de 6km. Confirme checklist de material para a prova. Descanse bem esta noite." },
  ],
  16: [
    { day: "TER", type: "corrida",      label: "Ativação leve 5km + strides", distanceKm: 5, description: "Corrida leve + 4×80m strides. Últimos passos rápidos para ativar fibras. Prepare todo material da prova hoje." },
    { day: "QUA", type: "regenerativo", label: "Regenerativo 3km",       distanceKm: 3,  description: "Trote leve de 15-20min apenas para manter o ritmo. Não faça nada além disso." },
    { day: "QUI", type: "folga",        label: "Folga total",            distanceKm: 0,  description: "Descanso completo. Hidrate bem, coma carboidratos, durma cedo. Logística confirmada." },
    { day: "SÁB", type: "corrida",      label: "Strides 2km",            distanceKm: 2,  description: "10min leve + 4×80m strides suaves. Última ativação pré-prova. Gel e materiais prontos para amanhã." },
    { day: "DOM", type: "prova",        label: "🏁 NIKE SP CITY MARATHON 21K", distanceKm: 21, description: "PROVA P1 — Nike SP City Marathon. Meta: 2h18–2h28 (6:30–7:00/km). Estratégia: 1 gel 1h + gel a cada 30min. Parque do Ibirapuera, São Paulo.", isRace: true, raceTag: "P1 · 21K · meta 2h18–2h28" },
  ],
};

export function getNikeSPWeekSessions(week: number): DaySession[] {
  return NIKE_SP_SESSIONS[week] ?? [];
}

export function getTodayWorkoutForWeek(week: number): {
  type: WorkoutType;
  distanceKm: number;
  durationMin: number;
  description: string;
} {
  const phase = getPhase(week);
  const volume = getWeeklyVolume(week);
  const dayOfWeek = new Date().getDay();

  if (phase === "Base") {
    if (dayOfWeek === 0 || dayOfWeek === 3) {
      return {
        type: "folga",
        distanceKm: 0,
        durationMin: 0,
        description: "Dia de descanso ativo. Alongamento e mobilidade.",
      };
    }
    return {
      type: "corrida",
      distanceKm: volume * 0.2,
      durationMin: Math.round(volume * 0.2 * 5.5),
      description: "Corrida aeróbica Zona 2. Pace confortável, respiração nasal.",
    };
  }
  if (phase === "Construção") {
    if (dayOfWeek === 2) {
      return {
        type: "forca",
        distanceKm: 0,
        durationMin: 50,
        description: "Musculação — agachamento, terra, lunges. Foco em quadríceps e glúteos.",
      };
    }
    return {
      type: "corrida",
      distanceKm: volume * 0.18,
      durationMin: Math.round(volume * 0.18 * 5),
      description: "Corrida progressiva. Inicie em Z2, finalize os últimos 3km em Z3.",
    };
  }
  if (phase === "Pico") {
    if (dayOfWeek === 2) {
      return {
        type: "corrida",
        distanceKm: volume * 0.15,
        durationMin: Math.round(volume * 0.15 * 4.5),
        description: "Treino de velocidade — intervalados 4x1km em pace de prova.",
      };
    }
    return {
      type: "corrida",
      distanceKm: volume * 0.22,
      durationMin: Math.round(volume * 0.22 * 5.2),
      description: "Longão semanal. Mantenha ritmo constante, hidratação a cada 15min.",
    };
  }
  return {
    type: volume > 10 ? "corrida" : "regenerativo",
    distanceKm: volume > 10 ? volume * 0.2 : 6,
    durationMin: volume > 10 ? Math.round(volume * 0.2 * 5) : 40,
    description:
      volume > 10
        ? "Corrida leve de polimento. Mantenha confiança e ritmo tranquilo."
        : "Treino regenerativo suave. Conserve energia para a prova.",
  };
}
