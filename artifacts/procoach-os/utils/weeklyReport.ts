import { AthleteState, CompletedEntry } from "@/context/AthleteContext";
import { getPhase, getWeeklyVolume, formatDateBR, getWeekFocus, formatWeekRange, getNikeSPWeekSessions, getPhaseColor, DaySession } from "@/utils/training";
import { calcEstimatedTimeMin, calcGelCount, formatDuration, formatPace, getGelSchedule } from "@/utils/raceLogistics";

const PHASE_COLORS: Record<string, string> = {
  Base:       "#4CAF50",
  Construção: "#2196F3",
  Pico:       "#FF5F00",
  Polimento:  "#9C27B0",
};

const WORKOUT_LABELS: Record<string, string> = {
  corrida: "Corrida", bike: "Bike Indolor",
  regenerativo: "Regenerativo", forca: "Força", folga: "Descanso",
};

function calcPace(distKm: number, durationMin: number): string {
  if (distKm <= 0 || durationMin <= 0) return "—";
  const secPerKm = (durationMin * 60) / distKm;
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} min/km`;
}

function barHtml(pct: number, color: string, label: string): string {
  const w = Math.max(0, Math.min(100, pct));
  return `
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:10px;color:#888;margin-bottom:4px;">
        <span>${label}</span><span>${Math.round(pct)}%</span>
      </div>
      <div style="background:#222;border-radius:4px;height:10px;overflow:hidden;">
        <div style="background:${color};width:${w}%;height:100%;border-radius:4px;"></div>
      </div>
    </div>`;
}

function weekBarChart(
  weeks: number[],
  completedVolumes: Record<number, number>,
  currentWeek: number
): string {
  const maxVol = Math.max(...weeks.map((w) => getWeeklyVolume(w)), 1);
  const bars = weeks.map((w) => {
    const target = getWeeklyVolume(w);
    const done = completedVolumes[w] ?? 0;
    const phase = getPhase(w);
    const color = PHASE_COLORS[phase] ?? "#FF5F00";
    const isCurrent = w === currentWeek;
    const targetH = Math.round((target / maxVol) * 100);
    const doneH = Math.round((done / maxVol) * 100);
    return `
      <div style="display:flex;flex-direction:column;align-items:center;flex:1;gap:2px;">
        <div style="position:relative;width:100%;display:flex;align-items:flex-end;justify-content:center;height:80px;">
          <div style="width:70%;background:#1E1E1E;border-radius:3px 3px 0 0;height:${targetH}%;position:absolute;bottom:0;${isCurrent ? "border:1.5px solid " + color : ""}"></div>
          ${done > 0 ? `<div style="width:70%;background:${color};border-radius:3px 3px 0 0;height:${doneH}%;position:absolute;bottom:0;opacity:0.9;"></div>` : ""}
        </div>
        <span style="font-size:7px;color:${isCurrent ? color : "#555"};font-weight:${isCurrent ? "bold" : "normal"};">${w}</span>
      </div>`;
  }).join("");
  return `<div style="display:flex;align-items:flex-end;gap:1px;padding:8px 0;">${bars}</div>`;
}

export function generateWeeklyReport(state: AthleteState, week: number): string {
  const { profile, weeklyCompleted, history, hrv, painLevel } = state;
  const phase = getPhase(week);
  const phaseColor = PHASE_COLORS[phase] ?? "#FF5F00";
  const targetVol = getWeeklyVolume(week);
  const doneVol = weeklyCompleted[week] ?? 0;
  const prevDoneVol = weeklyCompleted[week - 1] ?? 0;
  const prevTargetVol = getWeeklyVolume(week - 1);
  const volPct = targetVol > 0 ? (doneVol / targetVol) * 100 : 0;
  const focus = getWeekFocus(week);

  const weekEntries: CompletedEntry[] = history.filter((e) => e.week === week);
  const prevEntries: CompletedEntry[] = history.filter((e) => e.week === week - 1);

  const totalDist = weekEntries.reduce((a, e) => a + e.distanceKm, 0);
  const totalMin = weekEntries.reduce((a, e) => a + e.durationMin, 0);
  const pace = calcPace(totalDist, totalMin);

  const prevDist = prevEntries.reduce((a, e) => a + e.distanceKm, 0);
  const prevMin = prevEntries.reduce((a, e) => a + e.durationMin, 0);
  const prevPace = calcPace(prevDist, prevMin);

  const distDelta = totalDist - prevDist;
  const distDeltaStr = distDelta >= 0 ? `+${Math.round(distDelta)}km` : `${Math.round(distDelta)}km`;
  const distDeltaColor = distDelta >= 0 ? "#4CAF50" : "#EF4444";

  const isEndOfCycle = week === 16;

  // Cycle-wide stats
  const allWeeks = Array.from({ length: 16 }, (_, i) => i + 1);
  const totalCycleDone = allWeeks.reduce((a, w) => a + (weeklyCompleted[w] ?? 0), 0);
  const totalCycleTarget = allWeeks.reduce((a, w) => a + getWeeklyVolume(w), 0);
  const cyclePct = totalCycleTarget > 0 ? (totalCycleDone / totalCycleTarget) * 100 : 0;

  const hrvColor = hrv >= 65 ? "#4CAF50" : hrv >= 45 ? "#FF9800" : "#EF4444";
  const painColor = painLevel === 0 ? "#4CAF50" : painLevel <= 2 ? "#FF9800" : "#EF4444";

  const weekHistory = weekEntries.map((e) => {
    const d = new Date(e.date);
    const dateStr = `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
    return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #1E1E1E;font-size:11px;color:#CCC;">${dateStr}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1E1E1E;font-size:11px;color:#EEE;">${WORKOUT_LABELS[e.type] ?? e.type}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1E1E1E;font-size:11px;color:#FF5F00;text-align:right;">${e.distanceKm > 0 ? e.distanceKm + "km" : "—"}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1E1E1E;font-size:11px;color:#888;text-align:right;">${e.durationMin}min</td>
        <td style="padding:6px 8px;border-bottom:1px solid #1E1E1E;font-size:11px;color:#666;text-align:right;">${e.injuryAlert ?? "—"}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="5" style="padding:12px;text-align:center;color:#555;font-size:11px;">Nenhum treino registrado nesta semana</td></tr>`;

  const logbookSection = isEndOfCycle ? `
    <div style="margin-top:28px;border:1.5px solid #FF5F00;border-radius:10px;padding:20px;">
      <div style="font-size:10px;letter-spacing:3px;color:#FF5F00;font-weight:800;margin-bottom:6px;">DIÁRIO DE BORDO — FIM DO CICLO</div>
      <div style="font-size:18px;font-weight:800;color:#FFF;margin-bottom:16px;">Ciclo de 16 Semanas Completo</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
        <div style="background:#111;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#FF5F00;">${Math.round(totalCycleDone)}</div>
          <div style="font-size:8px;letter-spacing:2px;color:#666;margin-top:2px;">KM CONCLUÍDOS</div>
        </div>
        <div style="background:#111;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#4CAF50;">${Math.round(cyclePct)}%</div>
          <div style="font-size:8px;letter-spacing:2px;color:#666;margin-top:2px;">DO PLANO ATINGIDO</div>
        </div>
        <div style="background:#111;border-radius:8px;padding:12px;text-align:center;">
          <div style="font-size:28px;font-weight:800;color:#2196F3;">${history.length}</div>
          <div style="font-size:8px;letter-spacing:2px;color:#666;margin-top:2px;">TREINOS NO CICLO</div>
        </div>
      </div>
      <div style="font-size:10px;color:#888;line-height:1.7;">
        Ciclo finalizado em ${new Date().toLocaleDateString("pt-BR")}. Prova alvo: <strong style="color:#FF5F00;">${profile.targetRaceName}</strong> (${profile.targetRaceDistanceKm}km) em ${formatDateBR(profile.targetRaceDate)}.
        ${cyclePct >= 85 ? "Excelente execução do plano. O atleta está bem preparado para a prova." : cyclePct >= 60 ? "Boa execução. Pequenos ajustes podem melhorar a preparação nas próximas edições." : "Volume abaixo do esperado. Revise os fatores que impediram a execução completa."}
      </div>
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0A0A0A; color: #EEE; font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif; padding: 28px 24px; max-width: 600px; margin: 0 auto; }
  .label { font-size: 9px; letter-spacing: 3px; font-weight: 800; color: #666; margin-bottom: 2px; }
  .section { margin-bottom: 24px; }
  .card { background: #111; border: 1px solid #1E1E1E; border-radius: 10px; padding: 16px; margin-bottom: 12px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }
  .metric-num { font-size: 24px; font-weight: 800; letter-spacing: -1px; }
  .metric-label { font-size: 8px; letter-spacing: 2px; color: #666; margin-top: 3px; }
  table { width: 100%; border-collapse: collapse; }
  th { font-size: 8px; letter-spacing: 2px; color: #555; font-weight: 700; padding: 6px 8px; text-align: left; border-bottom: 1px solid #1E1E1E; }
  th:last-child, th:nth-child(3), th:nth-child(4) { text-align: right; }
  .divider { height: 1px; background: #1E1E1E; margin: 16px 0; }
  .footer { font-size: 9px; color: #333; text-align: center; margin-top: 32px; letter-spacing: 1px; }
</style>
</head>
<body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;">
  <div>
    <div class="label">PROCOACH OS V5.1 — RELATÓRIO SEMANAL</div>
    <div style="font-size:22px;font-weight:800;color:#FFF;letter-spacing:-1px;margin-top:4px;">Semana ${week} de 16</div>
    <div style="font-size:13px;color:#888;margin-top:2px;">${profile.name} · ${new Date().toLocaleDateString("pt-BR")}</div>
  </div>
  <div style="background:${phaseColor}22;border:1px solid ${phaseColor}44;border-radius:8px;padding:10px 14px;text-align:center;">
    <div style="font-size:10px;font-weight:800;letter-spacing:3px;color:${phaseColor};">${phase.toUpperCase()}</div>
    <div style="font-size:9px;color:#888;margin-top:2px;">BLOCO ${Math.ceil(week / 4)}</div>
  </div>
</div>

<div class="label" style="margin-bottom:8px;">FOCO DA SEMANA</div>
<div style="background:#111;border-left:3px solid ${phaseColor};border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#CCC;">${focus}</div>

<!-- METRICS -->
<div class="label" style="margin-bottom:8px;">DESEMPENHO DA SEMANA</div>
<div class="grid3" style="margin-bottom:12px;">
  <div class="card" style="text-align:center;">
    <div class="metric-num" style="color:#FF5F00;">${Math.round(totalDist)}</div>
    <div class="metric-label">KM PERCORRIDOS</div>
  </div>
  <div class="card" style="text-align:center;">
    <div class="metric-num" style="color:#2196F3;">${Math.round(totalMin)}</div>
    <div class="metric-label">MIN TREINADOS</div>
  </div>
  <div class="card" style="text-align:center;">
    <div class="metric-num" style="color:#4CAF50;">${weekEntries.length}</div>
    <div class="metric-label">TREINOS FEITOS</div>
  </div>
</div>

<div class="grid2" style="margin-bottom:20px;">
  <div class="card">
    <div class="label">PACE MÉDIO</div>
    <div style="font-size:18px;font-weight:800;color:#FFF;margin-top:4px;">${pace}</div>
    <div style="font-size:9px;color:#555;margin-top:2px;">Pace normalizado: ${pace}</div>
  </div>
  <div class="card">
    <div class="label">ALTIMETRIA / TEMP.</div>
    <div style="font-size:18px;font-weight:800;color:#888;margin-top:4px;">N/D</div>
    <div style="font-size:9px;color:#555;margin-top:2px;">Indisponível sem GPS</div>
  </div>
</div>

<!-- VOLUME BARS -->
<div class="label" style="margin-bottom:6px;">GRÁFICO DE VOLUME — 16 SEMANAS</div>
<div class="card">
  ${weekBarChart(allWeeks, weeklyCompleted, week)}
  <div style="display:flex;gap:14px;margin-top:6px;">
    <div style="display:flex;align-items:center;gap:5px;"><div style="width:8px;height:8px;background:#1E1E1E;border-radius:2px;border:1px solid #333;"></div><span style="font-size:8px;color:#555;">META</span></div>
    <div style="display:flex;align-items:center;gap:5px;"><div style="width:8px;height:8px;background:#FF5F00;border-radius:2px;"></div><span style="font-size:8px;color:#555;">CONCLUÍDO</span></div>
    <div style="display:flex;align-items:center;gap:5px;"><div style="width:8px;height:8px;border:1.5px solid #FF5F00;border-radius:2px;"></div><span style="font-size:8px;color:#555;">SEMANA ATUAL</span></div>
  </div>
</div>

<!-- VOLUME VS TARGET -->
<div class="label" style="margin-bottom:8px;">EXECUÇÃO DO PLANO</div>
<div class="card">
  ${barHtml(volPct, phaseColor, `Semana ${week} — ${Math.round(doneVol)}km de ${targetVol}km`)}
  ${barHtml(Math.round(cyclePct), "#FF5F00", `Ciclo total — ${Math.round(totalCycleDone)}km de ${totalCycleTarget}km`)}
</div>

<!-- COMPARISON PREVIOUS WEEK -->
<div class="label" style="margin-bottom:8px;">COMPARATIVO — SEM ${week} vs SEM ${week - 1}</div>
<div class="grid2" style="margin-bottom:20px;">
  <div class="card">
    <div class="label">SEM ${week - 1} (ANTERIOR)</div>
    <div style="margin-top:8px;">
      <div class="metric-num" style="font-size:20px;color:#888;">${Math.round(prevDist)}<span style="font-size:11px;font-weight:400;color:#555;"> km</span></div>
      <div class="metric-label">DISTÂNCIA · ${prevPace} pace</div>
    </div>
  </div>
  <div class="card" style="border-color:${phaseColor}44;">
    <div class="label" style="color:${phaseColor};">SEM ${week} (ATUAL)</div>
    <div style="margin-top:8px;">
      <div class="metric-num" style="font-size:20px;color:${phaseColor};">${Math.round(totalDist)}<span style="font-size:11px;font-weight:400;color:#888;"> km</span></div>
      <div class="metric-label">DISTÂNCIA · ${pace} pace</div>
    </div>
  </div>
</div>
<div class="card" style="text-align:center;padding:12px;">
  <span style="font-size:11px;color:#888;">Variação de distância: </span>
  <span style="font-size:14px;font-weight:800;color:${distDeltaColor};">${distDeltaStr}</span>
  <span style="font-size:11px;color:#888;"> em relação à semana anterior</span>
</div>

<!-- HRV / PAIN -->
<div class="divider"></div>
<div class="label" style="margin-bottom:8px;">MONITORAMENTO</div>
<div class="grid2">
  <div class="card" style="text-align:center;">
    <div class="metric-num" style="color:${hrvColor};">${hrv}</div>
    <div class="metric-label">VFC (ms)</div>
  </div>
  <div class="card" style="text-align:center;">
    <div class="metric-num" style="color:${painColor};">${painLevel}/5</div>
    <div class="metric-label">DOR / DESCONFORTO</div>
  </div>
</div>

<!-- WEEK LOG TABLE -->
<div class="divider"></div>
<div class="label" style="margin-bottom:8px;">TREINOS DA SEMANA ${week}</div>
<div class="card" style="padding:0;overflow:hidden;">
  <table>
    <tr>
      <th>DATA</th><th>TREINO</th><th style="text-align:right">KM</th><th style="text-align:right">MIN</th><th style="text-align:right">ALERTA</th>
    </tr>
    ${weekHistory}
  </table>
</div>

<!-- PROVA INFO -->
<div class="divider"></div>
<div class="label" style="margin-bottom:8px;">PROVA ALVO (P1)</div>
<div class="card" style="border-color:#FF5F0044;">
  <div style="font-size:16px;font-weight:800;color:#FFF;">${profile.targetRaceName}</div>
  <div style="font-size:11px;color:#888;margin-top:4px;">${profile.targetRaceDistanceKm}km · ${formatDateBR(profile.targetRaceDate)}</div>
</div>

${logbookSection}

<div class="footer">PROCOACH OS V5.1 · Gerado em ${new Date().toLocaleString("pt-BR")} · Semana ${week}/16</div>
</body>
</html>`;
}

// ─── WEEKLY SCHEDULE PDF (PLANO TAB) ─────────────────────────────────────────

const SESSION_COLOR_MAP: Record<string, string> = {
  corrida:      "#4CAF50",
  tiros:        "#FF5F00",
  regenerativo: "#2196F3",
  folga:        "#9E9E9E",
  prova:        "#FFD700",
};

const SESSION_TYPE_LABEL: Record<string, string> = {
  corrida:      "CORRIDA",
  tiros:        "INTERVALADO",
  regenerativo: "REGENERATIVO",
  folga:        "FOLGA",
  prova:        "PROVA",
};

function extractPacesFromText(text: string): string[] {
  const matches = text.match(/\d:\d{2}\/km/g);
  return matches ? [...new Set(matches)] : [];
}

interface GelInfo {
  sessionLabel: string;
  distanceKm: number;
  gelCount: number;
  schedule: string[];
  estimatedMin: number;
}

function getSessionGelStrategy(sessions: DaySession[], paceMinKm = 6.75): GelInfo[] {
  return sessions
    .filter((s) => (s.type === "corrida" || s.type === "tiros" || s.type === "prova") && s.distanceKm >= 10)
    .map((s) => {
      const estimatedMin = calcEstimatedTimeMin(s.distanceKm, paceMinKm);
      const gelCount = calcGelCount(estimatedMin);
      return { sessionLabel: `${s.day} — ${s.label}`, distanceKm: s.distanceKm, gelCount, schedule: getGelSchedule(estimatedMin), estimatedMin };
    })
    .filter((g) => g.gelCount > 0);
}

export interface WeeklyScheduleOptions {
  week: number;
  raceDateISO: string;
  athleteName?: string;
  targetRaceName?: string;
  targetPaceMinKm?: number;
}

export function generateWeeklyScheduleHtml(opts: WeeklyScheduleOptions): string {
  const { week, raceDateISO, athleteName, targetRaceName, targetPaceMinKm = 6.75 } = opts;

  const sessions    = getNikeSPWeekSessions(week);
  const phase       = getPhase(week);
  const phaseColor  = getPhaseColor(phase);
  const focus       = getWeekFocus(week);
  const dateRange   = formatWeekRange(raceDateISO, week);
  const totalKm     = getWeeklyVolume(week);
  const gelStrategy = getSessionGelStrategy(sessions, targetPaceMinKm);
  const isRaceWeek  = week === 6 || week === 16;
  const generatedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  const tirosCount  = sessions.filter((s) => s.type === "tiros").length;

  // ── Session rows ───────────────────────────────────────────────────────────
  const sessionRows = sessions.map((s) => {
    const col      = SESSION_COLOR_MAP[s.type] ?? "#9E9E9E";
    const typeLabel= SESSION_TYPE_LABEL[s.type] ?? s.type.toUpperCase();
    const paces    = extractPacesFromText(s.description);
    const hasKm    = s.distanceKm > 0;
    return `
      <div style="background:#111;border:1px solid #1E1E1E;border-left:3px solid ${col};border-radius:10px;padding:14px 16px;margin-bottom:10px;page-break-inside:avoid;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
              <div style="background:${col}22;border-radius:5px;padding:3px 8px;font-size:8px;font-weight:800;letter-spacing:2px;color:${col};">${s.day}</div>
              <div style="font-size:8px;font-weight:700;letter-spacing:2px;color:#555;">${typeLabel}</div>
              ${s.isRace ? `<div style="background:#FFD70022;border:1px solid #FFD70044;border-radius:5px;padding:3px 8px;font-size:8px;font-weight:800;letter-spacing:1px;color:#FFD700;">🏁 PROVA</div>` : ""}
            </div>
            <div style="font-size:13px;font-weight:700;color:#EEE;margin-bottom:6px;">${s.label}</div>
            <div style="font-size:11px;color:#888;line-height:1.6;">${s.description}</div>
            ${paces.length > 0 ? `
              <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                ${paces.map((p) => `<span style="background:#FF5F0015;border:1px solid #FF5F0033;border-radius:4px;padding:2px 8px;font-size:9px;font-weight:700;letter-spacing:1px;color:#FF5F00;">⏱ ${p}</span>`).join("")}
              </div>` : ""}
            ${s.raceTag ? `<div style="margin-top:8px;font-size:9px;font-weight:800;letter-spacing:2px;color:#FFD700;">${s.raceTag}</div>` : ""}
          </div>
          <div style="text-align:center;flex-shrink:0;padding-top:4px;">
            ${hasKm
              ? `<div style="font-size:26px;font-weight:800;color:${col};letter-spacing:-1px;line-height:1;">${s.distanceKm}</div>
                 <div style="font-size:8px;letter-spacing:2px;color:#555;font-weight:700;">KM</div>`
              : `<div style="font-size:20px;">😴</div>
                 <div style="font-size:8px;letter-spacing:1px;color:#555;">FOLGA</div>`}
          </div>
        </div>
      </div>`;
  }).join("");

  // ── Gel strategy section ───────────────────────────────────────────────────
  const gelSection = gelStrategy.length > 0 ? `
    <div style="margin-top:28px;">
      <div class="section-label">ESTRATÉGIA DE NUTRIÇÃO — GÉIS</div>
      ${gelStrategy.map((g) => `
        <div style="background:#111;border:1px solid #1E1E1E;border-radius:10px;padding:14px 16px;margin-bottom:10px;page-break-inside:avoid;">
          <div style="font-size:9px;letter-spacing:2px;color:#888;font-weight:700;margin-bottom:8px;">${g.sessionLabel} · ${g.distanceKm}km</div>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <span style="font-size:28px;font-weight:800;color:#FF5F00;">${g.gelCount}</span>
            <span style="font-size:12px;color:#888;">géis · tempo estimado ${formatDuration(g.estimatedMin)}</span>
          </div>
          <div style="border-top:1px solid #1E1E1E;padding-top:10px;">
            ${g.schedule.map((s, i) => `
              <div style="display:flex;align-items:center;gap:10px;padding:5px 0;${i < g.schedule.length - 1 ? "border-bottom:1px solid #1A1A1A;" : ""}">
                <div style="width:20px;height:20px;background:#FF5F0022;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#FF5F00;flex-shrink:0;">${i + 1}</div>
                <div style="font-size:12px;color:#CCC;">${s}</div>
              </div>`).join("")}
            <div style="font-size:10px;color:#555;margin-top:10px;line-height:1.5;">
              Leve ${g.gelCount + 1} géis (1 reserva). Tome sempre com água. Hidrate a cada 15min.
            </div>
          </div>
        </div>`).join("")}
    </div>` : "";

  // ── Pace reference ─────────────────────────────────────────────────────────
  const paceRefs = [
    { label: "P2 Tribuna 10K",   pace: 6.2,  color: "#2196F3" },
    { label: "Meta Nike SP 21K", pace: 6.75, color: "#FF5F00" },
    { label: "Z2 — Aeróbico",   pace: 7.5,  color: "#4CAF50" },
    { label: "Regenerativo",     pace: 8.0,  color: "#9E9E9E" },
  ];

  const paceSection = `
    <div style="margin-top:28px;">
      <div class="section-label">REFERÊNCIA DE PACES</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        ${paceRefs.map((r) => `
          <div style="background:#111;border:1px solid #1E1E1E;border-radius:10px;padding:12px 14px;">
            <div style="font-size:8px;letter-spacing:2px;color:#666;font-weight:700;margin-bottom:4px;">${r.label}</div>
            <div style="font-size:18px;font-weight:800;color:${r.color};">${formatPace(r.pace)}</div>
          </div>`).join("")}
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:#0A0A0A; color:#EEE; font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif; padding:28px 20px; max-width:620px; margin:0 auto; }
  .section-label { font-size:9px; letter-spacing:3px; font-weight:800; color:#555; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid #1E1E1E; }
  .footer { font-size:9px; color:#333; text-align:center; margin-top:36px; letter-spacing:1px; }
  @media print { body { background:#fff; color:#000; } }
</style>
</head>
<body>

<div style="margin-bottom:24px;">
  <div style="font-size:9px;letter-spacing:3px;color:#555;font-weight:700;margin-bottom:4px;">PROCOACH OS V5.1 — PLANO SEMANAL</div>
  <div style="font-size:26px;font-weight:800;color:#FFF;letter-spacing:-1px;line-height:1.1;margin-bottom:8px;">
    SEMANA ${week} <span style="color:${phaseColor};">· ${phase.toUpperCase()}</span>
  </div>
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">
    <div style="background:${phaseColor}22;border:1px solid ${phaseColor}44;border-radius:6px;padding:4px 10px;">
      <span style="font-size:9px;font-weight:800;letter-spacing:2px;color:${phaseColor};">BLOCO ${Math.ceil(week / 4)} · SEM ${week} DE 16</span>
    </div>
    <span style="font-size:12px;color:#888;">${dateRange}</span>
    ${isRaceWeek ? `<div style="background:#FFD70022;border:1px solid #FFD70044;border-radius:6px;padding:4px 10px;"><span style="font-size:9px;font-weight:800;letter-spacing:2px;color:#FFD700;">🏁 SEMANA DE PROVA</span></div>` : ""}
  </div>
  ${athleteName ? `<div style="font-size:12px;color:#666;margin-top:4px;">Atleta: ${athleteName}</div>` : ""}
  ${targetRaceName ? `<div style="font-size:12px;color:#555;margin-top:2px;">Plano: ${targetRaceName}</div>` : ""}
</div>

<div style="background:${phaseColor}12;border:1px solid ${phaseColor}33;border-radius:10px;padding:12px 16px;margin-bottom:20px;">
  <div style="font-size:8px;letter-spacing:2px;color:${phaseColor};font-weight:800;margin-bottom:4px;">FOCO DA SEMANA</div>
  <div style="font-size:14px;font-weight:700;color:#EEE;">${focus}</div>
</div>

<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:24px;">
  <div style="background:#111;border:1px solid #1E1E1E;border-radius:10px;padding:14px;text-align:center;">
    <div style="font-size:28px;font-weight:800;color:${phaseColor};letter-spacing:-1px;">${totalKm}</div>
    <div style="font-size:8px;letter-spacing:2px;color:#555;font-weight:700;margin-top:2px;">KM SEMANA</div>
  </div>
  <div style="background:#111;border:1px solid #1E1E1E;border-radius:10px;padding:14px;text-align:center;">
    <div style="font-size:28px;font-weight:800;color:#EEE;letter-spacing:-1px;">${sessions.length}</div>
    <div style="font-size:8px;letter-spacing:2px;color:#555;font-weight:700;margin-top:2px;">SESSÕES</div>
  </div>
  <div style="background:#111;border:1px solid #1E1E1E;border-radius:10px;padding:14px;text-align:center;">
    <div style="font-size:28px;font-weight:800;color:#FF5F00;letter-spacing:-1px;">${tirosCount}</div>
    <div style="font-size:8px;letter-spacing:2px;color:#555;font-weight:700;margin-top:2px;">INTERVALADOS</div>
  </div>
</div>

<div class="section-label">SESSÕES DA SEMANA</div>
${sessionRows}
${gelSection}
${paceSection}

<div class="footer">
  PROCOACH OS V5.1 · Nike SP City Marathon · Semana ${week} · Gerado em ${generatedAt}
</div>
</body>
</html>`;
}
