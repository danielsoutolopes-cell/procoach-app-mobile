import { Race, RacePriority } from "@/context/AthleteContext";
import { getPhase, formatDateBR } from "@/utils/training";

// ─── ROLE DESCRIPTIONS ───────────────────────────────────────────────────────

export const RACE_ROLE: Record<RacePriority, { label: string; description: string; color: string }> = {
  P1: {
    label: "PROVA ALVO",
    description: "Foco principal do ciclo de 16 semanas. Todo o treinamento é estruturado para o pico de desempenho nesta data.",
    color: "#FF5F00",
  },
  P2: {
    label: "PROVA DE POLIMENTO",
    description: "Prova de calibragem para a P1. Usada para testar ritmo de corrida, gestão de géis e logística em condição real de competição.",
    color: "#2196F3",
  },
  P3: {
    label: "PROVA PARTICIPATIVA",
    description: "Participação leve, sem pressão de performance. Não interfere na carga de treinamento para a P1.",
    color: "#9C27B0",
  },
};

// ─── CYCLE VALIDATION ────────────────────────────────────────────────────────

export interface CycleValidation {
  ok: boolean;
  warning: boolean;
  message: string;
}

export function getRaceWeekInCycle(p1DateISO: string, raceDateISO: string): number {
  const p1 = new Date(p1DateISO);
  const race = new Date(raceDateISO);
  const diffDays = Math.ceil((p1.getTime() - race.getTime()) / (1000 * 60 * 60 * 24));
  const weeksBeforeP1 = Math.ceil(diffDays / 7);
  const week = 16 - weeksBeforeP1;
  return Math.max(1, Math.min(16, week));
}

export function validateRacePlacement(race: Race, p1DateISO: string): CycleValidation {
  if (race.priority === "P1") {
    return { ok: true, warning: false, message: "Prova alvo do ciclo. Toda a periodização está ancorada nesta data." };
  }

  const week = getRaceWeekInCycle(p1DateISO, race.date);
  const phase = getPhase(week);

  if (race.priority === "P2") {
    if (week >= 13 && week <= 15) {
      return { ok: true, warning: false, message: `✅ Semana ${week} (${phase}) — ideal! P2 na fase de Polimento calibra ritmo e logística antes da P1.` };
    }
    if (week >= 9 && week <= 12) {
      return { ok: false, warning: true, message: `⚠️ Semana ${week} (${phase}) — na fase Pico. Corra como P3 (participativa) para não comprometer a preparação para a P1.` };
    }
    if (week >= 5 && week <= 8) {
      return { ok: false, warning: true, message: `⚠️ Semana ${week} (${phase}) — muito cedo para polimento. Trate-a como P3 e foque no volume da fase de Construção.` };
    }
    return { ok: false, warning: true, message: `⚠️ Semana ${week} (${phase}) — P2 muito próxima ao início do ciclo. Avaliar se faz sentido mantê-la.` };
  }

  if (race.priority === "P3") {
    if (week >= 15) {
      return { ok: false, warning: true, message: `⚠️ Semana ${week} — P3 muito próxima da P1. Avalie se vale o desgaste físico e logístico.` };
    }
    if (week >= 9 && week <= 12) {
      return { ok: false, warning: true, message: `⚠️ Semana ${week} (Pico) — P3 na fase mais intensa do ciclo. Corra com intensidade mínima para não comprometer o volume.` };
    }
    return { ok: true, warning: false, message: `✅ Semana ${week} (${phase}) — P3 participativa sem impacto relevante na preparação.` };
  }

  return { ok: true, warning: false, message: "" };
}

// ─── GEL CALCULATION ─────────────────────────────────────────────────────────

export function calcEstimatedTimeMin(distanceKm: number, paceMinKm: number): number {
  return Math.round(distanceKm * paceMinKm);
}

export function calcGelCount(estimatedTimeMin: number): number {
  if (estimatedTimeMin < 45) return 0;
  return Math.floor(estimatedTimeMin / 45);
}

export function getGelSchedule(estimatedTimeMin: number): string[] {
  const count = calcGelCount(estimatedTimeMin);
  const schedule: string[] = [];
  for (let i = 1; i <= count; i++) {
    const min = i * 45;
    const h = Math.floor(min / 60);
    const m = min % 60;
    const label = h > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${m}min`;
    schedule.push(`Gel ${i} às ${label} de prova`);
  }
  return schedule;
}

export function formatPace(paceMinKm: number): string {
  const min = Math.floor(paceMinKm);
  const sec = Math.round((paceMinKm - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")} min/km`;
}

export function formatDuration(totalMin: number): string {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}min`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

// ─── WAKE-UP TIME CALCULATION ─────────────────────────────────────────────────

export function calcLogisticsTimes(raceStartTime: string, travelMin: number): {
  wakeUp: string;
  leaveHome: string;
  arriveVenue: string;
  raceStart: string;
} {
  const [hStr, mStr] = raceStartTime.split(":").map(Number);
  const raceStartMin = (hStr ?? 7) * 60 + (mStr ?? 0);

  const arriveVenueMin = raceStartMin - 60;   // 1h antes da largada
  const leaveHomeMin  = arriveVenueMin - Math.max(15, travelMin); // deslocamento
  const prepMin       = 60;                   // 1h de preparo (café, kit, aquecimento)
  const wakeUpMin     = leaveHomeMin - prepMin;

  const fmt = (totalMin: number): string => {
    const h = Math.floor(((totalMin % (24 * 60)) + 24 * 60) % (24 * 60) / 60);
    const m = ((totalMin % 60) + 60) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  return {
    wakeUp:      fmt(wakeUpMin),
    leaveHome:   fmt(leaveHomeMin),
    arriveVenue: fmt(arriveVenueMin),
    raceStart:   raceStartTime,
  };
}

// ─── HTML LOGISTICS REPORT ────────────────────────────────────────────────────

export function generateLogisticsReport(opts: {
  race: Race;
  travelMin: number;
  athleteName: string;
  p1DateISO: string;
  weatherHtml?: string;
  adjustedPaceMinKm?: number;
  adjustedEstimatedMin?: number;
}): string {
  const { race, travelMin, athleteName, p1DateISO, weatherHtml, adjustedPaceMinKm, adjustedEstimatedMin } = opts;
  const role = RACE_ROLE[race.priority];
  const paceMinKm = adjustedPaceMinKm ?? race.targetPaceMinKm ?? 6;
  const estimatedMin = adjustedEstimatedMin ?? calcEstimatedTimeMin(race.distanceKm, paceMinKm);
  const gels = calcGelCount(estimatedMin);
  const gelSchedule = getGelSchedule(estimatedMin);
  const times = race.raceStartTime
    ? calcLogisticsTimes(race.raceStartTime, travelMin)
    : null;
  const validation = validateRacePlacement(race, p1DateISO);
  const week = getRaceWeekInCycle(p1DateISO, race.date);
  const phase = getPhase(week);

  const timelineRows = times
    ? `
      <div style="margin-bottom:20px;">
        ${[
          { time: times.wakeUp,      icon: "🌅", label: "DESPERTAR", detail: "Acorde, hidrate-se, prepare o kit" },
          { time: times.leaveHome,   icon: "🚗", label: "SAÍDA DE CASA", detail: `Deslocamento estimado: ${formatDuration(travelMin)}` },
          { time: times.arriveVenue, icon: "📍", label: "CHEGADA AO LOCAL", detail: "Retire o kit, aqueça, localize o banheiro" },
          { time: times.raceStart,   icon: "🏁", label: "LARGADA", detail: `${race.name} · ${race.distanceKm}km` },
        ].map((item) => `
          <div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid #1A1A1A;">
            <div style="font-size:20px;width:28px;text-align:center;">${item.icon}</div>
            <div style="width:52px;font-size:18px;font-weight:800;color:#FF5F00;letter-spacing:-0.5px;flex-shrink:0;">${item.time}</div>
            <div>
              <div style="font-size:9px;letter-spacing:2px;color:#666;font-weight:700;">${item.label}</div>
              <div style="font-size:12px;color:#CCC;margin-top:2px;">${item.detail}</div>
            </div>
          </div>`).join("")}
      </div>`
    : `<div style="background:#111;border-radius:8px;padding:12px;margin-bottom:20px;color:#555;font-size:12px;">
        Defina o horário de largada na edição da prova para gerar a linha do tempo.
       </div>`;

  const gelRows = gelSchedule.length > 0
    ? gelSchedule.map((s, i) => `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid #1A1A1A;">
          <div style="width:22px;height:22px;background:#FF5F0022;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#FF5F00;">${i + 1}</div>
          <div style="font-size:12px;color:#CCC;">${s}</div>
        </div>`).join("")
    : `<div style="font-size:12px;color:#555;padding:8px 0;">Sem necessidade de gel para distâncias abaixo de 45 min estimados.</div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#0A0A0A; color:#EEE; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; padding:28px 24px; max-width:600px; margin:0 auto; }
  .label { font-size:9px; letter-spacing:3px; font-weight:800; color:#555; margin-bottom:4px; }
  .card { background:#111; border:1px solid #1E1E1E; border-radius:10px; padding:16px; margin-bottom:16px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px; }
  .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-bottom:16px; }
  .footer { font-size:9px; color:#222; text-align:center; margin-top:32px; letter-spacing:1px; }
</style>
</head>
<body>

<div style="margin-bottom:24px;">
  <div class="label">PROCOACH OS V5.1 — LOGÍSTICA DE PROVA</div>
  <div style="font-size:22px;font-weight:800;color:#FFF;letter-spacing:-1px;margin-top:4px;">${race.name}</div>
  <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
    <div style="background:${role.color}22;border:1px solid ${role.color}44;border-radius:6px;padding:4px 10px;">
      <span style="font-size:9px;font-weight:800;letter-spacing:2px;color:${role.color};">${race.priority} · ${role.label}</span>
    </div>
    <span style="font-size:12px;color:#888;">${formatDateBR(race.date)} · ${race.distanceKm}km · Semana ${week} (${phase})</span>
  </div>
  ${athleteName ? `<div style="font-size:12px;color:#666;margin-top:4px;">Atleta: ${athleteName}</div>` : ""}
</div>

${!validation.ok && validation.warning ? `
<div style="background:#1A1000;border:1px solid #FF980044;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:11px;color:#FF9800;line-height:1.6;">
  ${validation.message}
</div>` : ""}

<div class="label" style="margin-bottom:8px;">DADOS DA PROVA</div>
<div class="grid3">
  <div class="card" style="text-align:center;">
    <div style="font-size:26px;font-weight:800;color:#FF5F00;">${race.distanceKm}</div>
    <div class="label">KM</div>
  </div>
  <div class="card" style="text-align:center;">
    <div style="font-size:26px;font-weight:800;color:#2196F3;">${formatDuration(estimatedMin)}</div>
    <div class="label">TEMPO ESTIMADO</div>
  </div>
  <div class="card" style="text-align:center;">
    <div style="font-size:22px;font-weight:800;color:#4CAF50;">${formatPace(paceMinKm)}</div>
    <div class="label">PACE ALVO</div>
  </div>
</div>

${weatherHtml ?? ""}

${race.address ? `
<div class="label" style="margin-bottom:8px;">LOCAL DA PROVA</div>
<div class="card" style="margin-bottom:16px;">
  <div style="display:flex;align-items:center;gap:8px;">
    <span style="font-size:16px;">📍</span>
    <div style="font-size:13px;color:#EEE;">${race.address}</div>
  </div>
</div>` : ""}

<div class="label" style="margin-bottom:8px;">LINHA DO TEMPO — DIA DA PROVA</div>
<div class="card">
  ${timelineRows}
  ${travelMin > 0 ? `<div style="font-size:10px;color:#444;margin-top:8px;">Deslocamento configurado: ${formatDuration(travelMin)} · Chegue com 1h de antecedência</div>` : ""}
</div>

<div class="label" style="margin-bottom:8px;">NUTRIÇÃO — GÉIS DURANTE A PROVA</div>
<div class="card">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
    <div style="font-size:28px;font-weight:800;color:#FF5F00;">${gels}</div>
    <div>
      <div style="font-size:13px;font-weight:700;color:#EEE;">géis necessários</div>
      <div style="font-size:10px;color:#666;">1 gel a cada 45 min de prova (a partir de 45min)</div>
    </div>
  </div>
  ${gelRows}
  ${gels > 0 ? `<div style="font-size:10px;color:#555;margin-top:10px;line-height:1.5;">
    Leve ${gels + 1} géis (1 extra de reserva). Tome com água, nunca puro.<br>
    Carboidrato pré-largada: 30-45 min antes. Hidrate-se a cada 15 min.
  </div>` : ""}
</div>

<div class="label" style="margin-bottom:8px;">CHECKLIST PRÉ-PROVA</div>
<div class="card">
  ${[
    "📋 Número de peito e chip de cronometragem",
    "👟 Tênis de prova (sem estrear no dia)",
    "🩳 Kit de corrida testado em treino",
    `🍬 ${gels + 1} géis energéticos + ${Math.ceil(race.distanceKm / 5)} sachês de sal`,
    "💧 Cinto de hidratação ou garrafinha (provas sem abastecimento)",
    "🧴 Vaselina / anti-atrito nas áreas de risco",
    "📱 Celular carregado + fone (se permitido)",
    "🪪 Documento de identidade",
    "💳 Cartão para emergências",
  ].map((item) => `<div style="padding:6px 0;border-bottom:1px solid #1A1A1A;font-size:12px;color:#CCC;">${item}</div>`).join("")}
</div>

<div class="label" style="margin-bottom:8px;">REGRA DE PERFORMANCE POR PRIORIDADE</div>
<div class="card" style="border-left:3px solid ${role.color};">
  <div style="font-size:10px;font-weight:800;letter-spacing:2px;color:${role.color};margin-bottom:6px;">${race.priority} — ${role.label}</div>
  <div style="font-size:12px;color:#CCC;line-height:1.6;">${role.description}</div>
</div>

<div class="footer">PROCOACH OS V5.1 · Logística gerada em ${new Date().toLocaleString("pt-BR")} · ${race.name}</div>
</body>
</html>`;
}
