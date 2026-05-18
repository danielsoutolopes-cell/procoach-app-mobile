import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "@workspace/db";
import { db } from "@workspace/db";
import multer from "multer";
import pdfParse from "pdf-parse";
import {
  parsePlannedKmFromStrings,
  formatKmhFromPaceTarget,
  parseBike,
  parseSegments,
  groupBlocks,
  computeTreadmillTelemetry,
  parseInterval,
  sumDistanceKm,
  inferModalities,
} from "./PlanParserService";
import { ensurePlanTable, getOrCreateMonoAthleteId } from "./migrations";
import { getRainProbability, getSaoPauloDayKey, normalizeEntryDate } from "./procoach-utils";

const router: IRouter = Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post("/procoach/me/plan/import-text", async (req: Request, res: Response) => {
  const body = req.body as any;
  const raw = typeof body?.text === "string" ? body.text : "";
  if (!raw.trim()) { res.status(400).json({ error: "text is required" }); return; }

  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const lines = raw.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
  const year = new Date().getFullYear();

  const parsed = lines.map((line: string) => {
    const m = line.match(/^(\d{2}\/\d{2})(?:\/(\d{4}))?\s*-\s*(.*)$/);
    if (!m) return null;
    const [, ddmm, yyyy, rest] = m;
    const [dd, mm] = ddmm.split("/").map(Number);
    const y = yyyy ? Number(yyyy) : year;
    if (!dd || !mm || !y) return null;
    const sessionDate = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    return { sessionDate, rest: String(rest ?? "").trim() };
  }).filter(Boolean) as Array<{ sessionDate: string; rest: string }>;

  const sessions = parsed.map((p) => {
    const activity = p.rest.split("|")[0]?.trim() ?? p.rest;
    const structure = p.rest.includes("|") ? p.rest.split("|").slice(1).join("|").trim() : null;
    const plannedKm = parsePlannedKmFromStrings(activity, structure, null);
    return {
      sessionDate: p.sessionDate,
      dayName: null as string | null,
      activity,
      paceTarget: null as string | null,
      treadmillSpeed: null as string | null,
      restInterval: null as string | null,
      structure,
      plannedKm,
    };
  });

  if (sessions.length === 0) { res.status(400).json({ error: "no sessions parsed" }); return; }

  for (const s of sessions) {
        const bike = parseBike(s.structure);
        const segments = parseSegments(s.structure);
        const blocks = groupBlocks(segments);
        const treadmillTelemetry = computeTreadmillTelemetry({
          structure: s.structure, paceTarget: s.paceTarget, treadmillSpeed: s.treadmillSpeed, restInterval: s.restInterval, segments
        });
        const detailsJson = JSON.stringify({
          source: "text_import", modalities: inferModalities(s.activity, s.structure),
          bike, segments, blocks, treadmillTelemetry
        });

    await db.execute(sql`
      INSERT INTO procoach_plan_sessions
            (athlete_id, session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, details_json, created_at, updated_at)
      VALUES
            (${athleteId}, ${s.sessionDate}, ${s.dayName}, ${s.activity}, ${s.paceTarget}, ${s.treadmillSpeed}, ${s.restInterval}, ${s.structure}, ${s.plannedKm}, ${detailsJson}::jsonb, NOW(), NOW())
      ON CONFLICT (athlete_id, session_date)
      DO UPDATE SET
        day_name = EXCLUDED.day_name,
        activity = EXCLUDED.activity,
        pace_target = EXCLUDED.pace_target,
        treadmill_speed = EXCLUDED.treadmill_speed,
        rest_interval = EXCLUDED.rest_interval,
        structure = EXCLUDED.structure,
        planned_km = EXCLUDED.planned_km,
            details_json = EXCLUDED.details_json,
        updated_at = NOW()
    `);
  }

  res.json({
    imported: sessions.length,
    year,
    firstDate: sessions[0]!.sessionDate,
    lastDate: sessions[sessions.length - 1]!.sessionDate,
  });
});

router.post(
  "/procoach/me/plan/import-pdf",
  pdfUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const athleteId = await getOrCreateMonoAthleteId();
      const file = (req as any).file as { buffer: Buffer; originalname?: string; } | undefined;
      if (!file?.buffer) {
        res.status(400).json({ error: "Arquivo PDF é obrigatório (field: file)" });
        return;
      }

      const parsed = await pdfParse(file.buffer);
      const text = String(parsed.text ?? "");
      const lines = text.split(/\r?\n/g).map((l) => l.replace(/\u00a0/g, " ").trim()).filter(Boolean);
      const year = new Date().getFullYear();
      const importTextLines: string[] = [];

      for (const line of lines) {
        const mIso = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
        const mBr = !mIso ? line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/) : null;
        const mDdMm = !mIso && !mBr ? line.match(/^(\d{2}\/\d{2})\s+(.*)$/) : null;
        if (!mIso && !mBr && !mDdMm) continue;

        let dateKey = "", rest = "";
        if (mIso) { [dateKey, rest] = [mIso[1]!, mIso[2] ?? ""]; const [y, mm, dd] = dateKey.split("-"); dateKey = `${dd}/${mm}/${y}`; }
        else if (mBr) { [dateKey, rest] = [mBr[1]!, mBr[2] ?? ""]; }
        else if (mDdMm) { [dateKey, rest] = [`${mDdMm[1]!}/${year}`, mDdMm[2] ?? ""]; }

        importTextLines.push(`${dateKey} - ${rest.replace(/\s{2,}/g, " ").trim()}`);
      }

      res.json({ athleteId, fileName: file.originalname ?? null, detected: importTextLines.length, importText: importTextLines.join("\n"), rawTextPreview: text.slice(0, 2000) });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Falha ao processar PDF" });
    }
  }
);

router.post("/procoach/me/plan/import-json", async (req: Request, res: Response) => {
  const body = req.body as any;
  const plan = body?.plano_treinamento ?? body;
  const items = (Array.isArray(plan?.treinos) && plan.treinos.length > 0) ? plan.treinos : (plan?.treino_hoje ? [plan.treino_hoje] : (Array.isArray(plan?.cronograma) ? plan.cronograma : []));
  if (items.length === 0) {
    res.status(400).json({ error: "Nenhum treino encontrado no JSON (treinos[], treino_hoje, ou cronograma[])." });
    return;
  }

  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();
  const cfg = plan?.configuracoes_operacionais ?? {};

  const sessions = items.map((s: any) => {
    const sessionDate = normalizeEntryDate(String(s?.data ?? s?.date ?? ""));
    const activity = String(s?.atividade ?? "").trim();
    if (!activity || !sessionDate) return null;

    const structure = s?.estrutura ? String(s.estrutura).trim() : null;
    const paceTarget = s?.pace_alvo ? String(s.pace_alvo).trim() : null;
    const treadmillSpeedRaw = s?.velocidade_esteira_kmh ?? s?.vel_esteira_principal ?? s?.vel_esteira ?? s?.vel_esteira_kmh;
    const treadmillSpeed = treadmillSpeedRaw ? String(treadmillSpeedRaw) + ' km/h' : null;
    const treadmillSpeedFinal = treadmillSpeed ?? formatKmhFromPaceTarget(paceTarget);
    const segments = parseSegments(structure);
    const treadmillTelemetry = computeTreadmillTelemetry({ structure, paceTarget, treadmillSpeed: treadmillSpeedFinal, restInterval: s?.repouso, segments });
    const computedBodyKm = treadmillTelemetry?.rule === "A" ? (treadmillTelemetry.volumeBodyKm as number) : (treadmillTelemetry?.volumeTotalKm as number);
    const interval = parseInterval(structure);
    const sumKm = sumDistanceKm(segments) + (interval ? interval.reps * interval.distTiroKm : 0);
    const plannedKm = Math.round(s?.volume_total_km ?? computedBodyKm ?? sumKm ?? parsePlannedKmFromStrings(activity, structure, s?.distancia));

    const details = {
      source: "plano_treinamento_v2", athlete: cfg.atleta, status: s.status, suggestedShoe: s.tenis_sugerido,
      warmupKmh: cfg.velocidade_aquecimento_kmh, cooldownKmh: cfg.velocidade_desaquecimento_kmh,
      modalities: inferModalities(activity, structure), bike: parseBike(structure), segments, blocks: groupBlocks(segments), treadmillTelemetry,
      consistency: { plannedKm, computedBodyKm: computedBodyKm ?? null },
    };

    return {
      sessionDate, dayName: s?.dia_semana || null, activity, paceTarget: paceTarget && paceTarget !== "-" ? paceTarget : null,
      treadmillSpeed: treadmillSpeedFinal, restInterval: s?.repouso && s.repouso !== "-" ? s.repouso : null, structure, plannedKm, detailsJson: JSON.stringify(details),
    };
  }).filter(Boolean) as Array<any>;

  if (sessions.length === 0) {
    res.status(400).json({ error: "Nenhuma sessão válida parseada do JSON." });
    return;
  }

  for (const s of sessions) {
    await db.execute(sql`
      INSERT INTO procoach_plan_sessions (athlete_id, session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, details_json, created_at, updated_at)
      VALUES (${athleteId}, ${s.sessionDate}, ${s.dayName}, ${s.activity}, ${s.paceTarget}, ${s.treadmillSpeed}, ${s.restInterval}, ${s.structure}, ${s.plannedKm}, ${s.detailsJson}::jsonb, NOW(), NOW())
      ON CONFLICT (athlete_id, session_date) DO UPDATE SET
        day_name = EXCLUDED.day_name, activity = EXCLUDED.activity, pace_target = EXCLUDED.pace_target, treadmill_speed = EXCLUDED.treadmill_speed,
        rest_interval = EXCLUDED.rest_interval, structure = EXCLUDED.structure, planned_km = EXCLUDED.planned_km, details_json = EXCLUDED.details_json, updated_at = NOW()
    `);
  }

  res.json({ imported: sessions.length, firstDate: sessions[0]!.sessionDate, lastDate: sessions[sessions.length - 1]!.sessionDate });
});

router.get("/procoach/me/plan", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, details_json
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId}
      AND (${from ?? null} IS NULL OR session_date >= ${from ?? null})
      AND (${to ?? null} IS NULL OR session_date <= ${to ?? null})
    ORDER BY session_date ASC
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ sessions: rows.rows });
});

router.get("/procoach/me/plan/today", async (req: Request, res: Response) => {
  const date = typeof req.query.date === "string" && req.query.date.trim() ? req.query.date.trim() : getSaoPauloDayKey();
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, details_json
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date = ${date}
    LIMIT 1
  `) as { rows: Array<Record<string, unknown>> };

  let session = rows.rows[0] ? { ...rows.rows[0] } : null;

  if (session) {
    const lat = req.query.lat ? Number(req.query.lat) : -23.6087;
    const lon = req.query.lon ? Number(req.query.lon) : -46.6676;
    const rainProb = await getRainProbability(date, lat, lon);
    const suggestTreadmill = rainProb > 70;
    Object.assign(session, { suggestTreadmill, rainProbability: rainProb });
    if (suggestTreadmill && session.treadmill_speed) {
      session.pace_target = null;
    }
  }

  res.json({ session });
});

router.get("/procoach/me/plan/next", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : getSaoPauloDayKey();
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, details_json
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date > ${from}
    ORDER BY session_date ASC
    LIMIT 1
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ session: rows.rows[0] ?? null });
});

export default router;