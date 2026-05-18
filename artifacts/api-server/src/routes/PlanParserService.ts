export function parsePtBrMonth(mon: string): number | null {
  const m = mon.toLowerCase().replace(".", "").trim();
  const map: Record<string, number> = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };
  return map[m] ?? null;
}

export function parsePlanDate(raw: string, year: number): string | null {
  const t = raw.trim();
  const m1 = t.match(/^(\d{1,2})\/([a-zA-ZçÇ]{3})$/);
  if (m1) {
    const day = Number(m1[1]);
    const month = parsePtBrMonth(m1[2]);
    if (!month) return null;
    const d = String(day).padStart(2, "0");
    const mm = String(month).padStart(2, "0");
    return `${year}-${mm}-${d}`;
  }
  const m2 = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const d = String(Number(m2[1])).padStart(2, "0");
    const mm = String(Number(m2[2])).padStart(2, "0");
    return `${m2[3]}-${mm}-${d}`;
  }
  return null;
}

export function parsePlannedKmFromStrings(activity: string, structure: string | null, distanceRaw?: string | null): number {
  const fromDistance = distanceRaw ? String(distanceRaw).match(/(\d+(?:[.,]\d+)?)\s*km/i) : null;
  if (fromDistance?.[1]) return Math.max(0, Math.round(Number(fromDistance[1].replace(",", "."))));
  const hay = `${activity} ${structure ?? ""}`;
  const m = hay.match(/(\d+(?:[.,]\d+)?)\s*km/i);
  if (!m?.[1]) return 0;
  return Math.max(0, Math.round(Number(m[1].replace(",", "."))));
}

export function parsePlanImportText(text: string, year: number): Array<{
  sessionDate: string;
  dayName: string;
  activity: string;
  paceTarget: string | null;
  treadmillSpeed: string | null;
  restInterval: string | null;
  structure: string | null;
}> {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const out: Array<{
    sessionDate: string;
    dayName: string;
    activity: string;
    paceTarget: string | null;
    treadmillSpeed: string | null;
    restInterval: string | null;
    structure: string | null;
  }> = [];

  let i = 0;
  while (i < lines.length) {
    const date = parsePlanDate(lines[i]!, year);
    if (!date) { i++; continue; }
    const dayName = (lines[i + 1] ?? "").trim();
    const activity = (lines[i + 2] ?? "").trim();
    const paceTarget = (lines[i + 3] ?? "").trim();
    const treadmillSpeed = (lines[i + 4] ?? "").trim();
    const restInterval = (lines[i + 5] ?? "").trim();
    const structure = (lines[i + 6] ?? "").trim();

    if (dayName && activity) {
      out.push({
        sessionDate: date,
        dayName,
        activity,
        paceTarget: paceTarget && paceTarget !== "-" ? paceTarget : null,
        treadmillSpeed: treadmillSpeed && treadmillSpeed !== "-" ? treadmillSpeed : null,
        restInterval: restInterval && restInterval !== "-" ? restInterval : null,
        structure: structure ? structure : null,
      });
      i += 7;
      continue;
    }
    i++;
  }
  return out;
}

export function formatKmh(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") return `${raw} km/h`;
  const s = String(raw).trim();
  return s ? s : null;
}

export function parseKmhNumber(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d+(?:[.,]\d+)?)\s*km\/?h/i);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function parsePaceMinPerKm(raw: string | null): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
  if (m?.[1] && m?.[2]) {
    const mm = Number(m[1]);
    const ss = Number(m[2]);
    if (!Number.isFinite(mm) || !Number.isFinite(ss) || mm < 0 || ss < 0 || ss >= 60) return null;
    const pace = mm + ss / 60;
    return pace > 0 ? pace : null;
  }
  const m2 = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:min\/km|\/km)\b/i);
  if (!m2?.[1]) return null;
  const pace = Number(m2[1].replace(",", "."));
  if (!Number.isFinite(pace) || pace <= 0) return null;
  return pace;
}

export function kmhFromPace(paceMinPerKm: number): number | null {
  if (!Number.isFinite(paceMinPerKm) || paceMinPerKm <= 0) return null;
  const kmh = 60 / paceMinPerKm;
  if (!Number.isFinite(kmh) || kmh <= 0) return null;
  return kmh;
}

export function formatKmhFromPaceTarget(paceTarget: string | null): string | null {
  const pace = parsePaceMinPerKm(paceTarget);
  const kmh = pace ? kmhFromPace(pace) : null;
  if (!kmh) return null;
  return `${kmh.toFixed(1)} km/h`;
}

export function parseRestSeconds(restInterval: string | null): number | null {
  if (!restInterval) return null;
  const s = restInterval.toLowerCase().replace(/\s+/g, "");
  const m = s.match(/(\d+)(?:s|seg|secs|sec)\b/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

export function parseInterval(structure: string | null): null | { reps: number; distTiroKm: number } {
  if (!structure) return null;
  const m = structure.match(/(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(m|km)\b/i);
  if (!m?.[1] || !m?.[2] || !m?.[3]) return null;
  const reps = Number(m[1]);
  const rawDist = Number(m[2].replace(",", "."));
  if (!Number.isFinite(reps) || reps <= 0) return null;
  if (!Number.isFinite(rawDist) || rawDist <= 0) return null;
  const unit = String(m[3]).toLowerCase();
  const distTiroKm = unit === "m" ? rawDist / 1000 : rawDist;
  if (!Number.isFinite(distTiroKm) || distTiroKm <= 0) return null;
  return { reps: Math.round(reps), distTiroKm };
}

export function parseBike(structure: string | null): null | { minutes: number; label: string | null } {
  if (!structure) return null;
  const hay = structure.toLowerCase();
  if (!hay.includes("bike")) return null;
  const min = hay.match(/(\d+)\s*min(?:utos?)?\s*bike\b/);
  const minutes = min?.[1] ? Math.max(1, Math.round(Number(min[1]))) : 30;
  let label: string | null = null;
  if (/\bz2\b/i.test(structure)) label = "Z2";
  if (/giro\s*indolor/i.test(structure)) label = "Giro Indolor";
  return { minutes, label };
}

export function isStrengthOrBikePart(part: string): boolean {
  const t = part.toLowerCase();
  if (t.includes("bike")) return true;
  if (t.includes("musc") || t.includes("muscul")) return true;
  if (/\btreino\s*[abc]\b/i.test(part)) return true;
  if (/\bficha\s*[abc]\b/i.test(part)) return true;
  return false;
}

export function parseSegments(structure: string | null): Array<Record<string, unknown>> {
  if (!structure) return [];
  const parts = structure
    .split("+")
    .map((p) => p.replace(/\s{2,}/g, " ").trim())
    .filter(Boolean)
    .filter((p) => !isStrengthOrBikePart(p));
  return parts.map((p) => {
    const isInterval = /\d+\s*x\s*\d+(?:[.,]\d+)?\s*(m|km)\b/i.test(p);
    
    // Se for bloco de intervalo, omitimos a distanceKm isolada
    // para evitar que a distância do tiro seja contabilizada em duplicado na soma base.
    let dist: string | undefined;
    if (!isInterval) {
      dist = p.match(/(\d+(?:[.,]\d+)?)\s*km/i)?.[1];
    }

    const min = p.match(/(\d+)\s*min/i)?.[1];
    const kmh = p.match(/(\d+(?:[.,]\d+)?)\s*km\/?h/i)?.[1];
    const kind = /(^|\s)AQ(\s|$)/i.test(p) ? "warmup" : /(^|\s)DQ(\s|$)/i.test(p) ? "cooldown" : "main";
    return {
      kind,
      label: p,
      isInterval,
      distanceKm: dist ? Number(dist.replace(",", ".")) : null,
      durationMin: min ? Number(min) : null,
      treadmillKmh: kmh ? Number(kmh.replace(",", ".")) : null,
    };
  });
}

export function groupBlocks(segments: Array<Record<string, unknown>>): {
  warmup: Array<Record<string, unknown>>;
  main: Array<Record<string, unknown>>;
  cooldown: Array<Record<string, unknown>>;
} {
  const warmup = segments.filter((s) => s.kind === "warmup");
  const cooldown = segments.filter((s) => s.kind === "cooldown");
  const main = segments.filter((s) => s.kind !== "warmup" && s.kind !== "cooldown");
  return { warmup, main, cooldown };
}

export function sumDistanceKm(segments: Array<Record<string, unknown>>, kind?: string): number {
  return segments.reduce((acc, s) => {
    if (kind && s.kind !== kind) return acc;
    // Pula segmentos de intervalo para não contar duplicado
    if (s.isInterval) return acc;

    const d = typeof s.distanceKm === "number" && Number.isFinite(s.distanceKm) ? s.distanceKm : 0;
    return acc + Math.max(0, d);
  }, 0);
}

export function computeTreadmillTelemetry(opts: {
  structure: string | null;
  paceTarget: string | null;
  treadmillSpeed: string | null;
  restInterval: string | null;
  segments: Array<Record<string, unknown>>;
}): Record<string, unknown> | null {
  const interval = parseInterval(opts.structure);
  if (!interval) return null;
  const restSec = parseRestSeconds(opts.restInterval);
  if (!restSec) return null;
  const velFromField = parseKmhNumber(opts.treadmillSpeed);
  const velFromPace = (() => {
    const p = parsePaceMinPerKm(opts.paceTarget);
    return p ? kmhFromPace(p) : null;
  })();
  const velTiroKmh = velFromField ?? velFromPace;
  if (!velTiroKmh) return null;

  const reps = interval.reps;
  const distTiroKm = interval.distTiroKm;
  const rests = Math.max(0, reps - 1);
  const restH = restSec / 3600;

  const aqKm = sumDistanceKm(opts.segments, "warmup");
  const dqKm = sumDistanceKm(opts.segments, "cooldown");
  const otherMainKm = sumDistanceKm(opts.segments, "main");

  const repsKm = reps * distTiroKm;
  const baseKm = aqKm + dqKm + repsKm + otherMainKm;

  if (distTiroKm < 0.8) {
    const distOcultaKmPerRest = velTiroKmh * restH;
    const extraKm = rests * distOcultaKmPerRest;
    const volumeBodyKm = baseKm;
    const volumePanelKm = baseKm + extraKm;
    return {
      kind: "interval",
      rule: "A",
      reps,
      distTiroKm,
      restSec,
      velTiroKmh,
      rests,
      distOcultaKmPerRest,
      restTotalKm: extraKm,
      volumeBodyKm,
      volumePanelKm,
    };
  }

  const walkKmh = 3.0;
  const distWalkKmPerRest = walkKmh * restH;
  const extraKm = rests * distWalkKmPerRest;
  const volumeTotalKm = baseKm + extraKm;
  return {
    kind: "interval",
    rule: "B",
    reps,
    distTiroKm,
    restSec,
    velTiroKmh,
    rests,
    walkKmh,
    distWalkKmPerRest,
    restTotalKm: extraKm,
    volumeTotalKm,
  };
}

export function inferModalities(activity: string, structure: string | null): string[] {
  const hay = `${activity} ${structure ?? ""}`.toLowerCase();
  const out: string[] = [];
  const hasRun =
    hay.includes("corrida") ||
    hay.includes("longao") ||
    hay.includes("longão") ||
    hay.includes("prova") ||
    hay.includes("fartlek") ||
    /(\d+(?:[.,]\d+)?)\s*km\b/i.test(hay);
  if (hasRun) out.push("run");
  if (hay.includes("bike") || /\b\d+\s*min\s*bike\b/i.test(hay)) out.push("bike");
  if (hay.includes("musc") || hay.includes("muscul")) out.push("strength");
  return Array.from(new Set(out));
}