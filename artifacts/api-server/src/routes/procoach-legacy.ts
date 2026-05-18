import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, sql } from "@workspace/db";
import { db } from "@workspace/db";
import {
  athletesTable,
  workoutEntriesTable,
  weeklyStatsTable,
} from "@workspace/db/schema";
import {
  parsePlanImportText,
  parsePlannedKmFromStrings,
  parseBike,
  parseSegments,
  groupBlocks,
  computeTreadmillTelemetry,
  inferModalities
} from "./PlanParserService";
import {
  MONO_DEVICE_ID,
  ensureGelTables,
  ensurePlanTable,
  ensureBioimpedanceTable,
  ensureAthletesRacesColumn
} from "./migrations";
import { 
  roundKm, 
  normalizeEntryDate, 
  computeRacePointers, 
  getRainProbability, 
  sendTelegram, 
  asNumberOrNull,
  upsertWorkoutFeedback,
  getSaoPauloDayKey
} from "./procoach-utils";

const router: IRouter = Router();

router.get("/procoach/athletes/:deviceId/profile", async (req: Request, res: Response) => {
  try {
    const deviceId = String(req.params.deviceId);
    await ensureAthletesRacesColumn();
    await ensureGelTables();

    const athleteRows = await db.execute(sql`SELECT * FROM procoach_athletes WHERE device_id = ${deviceId} LIMIT 1`) as any;
    const athlete = athleteRows.rows[0];
    
    if (!athlete) {
      res.status(404).json({ error: "Athlete not found" });
      return;
    }

    const gelRows = await db.execute(sql`SELECT gels_in_stock FROM procoach_gel_stock WHERE athlete_id = ${athlete.id} LIMIT 1`) as any;
    const currentGels = gelRows.rows[0] ? Number(gelRows.rows[0].gels_in_stock) : 0;

    let races = [];
    if (athlete.races) {
      races = typeof athlete.races === "string" ? JSON.parse(athlete.races) : athlete.races;
    }

    res.json({
      id: athlete.id.toString(),
      name: athlete.name || "CEO",
      gel_inventory: currentGels,
      races: races,
    });
  } catch (err) {
    console.error("[API] Erro ao buscar perfil compatível:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

router.get("/procoach/athletes/:deviceId", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  await ensureAthletesRacesColumn();
  const rows = await db.execute(sql`SELECT * FROM procoach_athletes WHERE device_id = ${deviceId} LIMIT 1`) as any;

  if (rows.rows.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }
  const athlete = rows.rows[0];
  let pointers = { nextRace: null, nextP1: null, anchor: null };
  if (athlete && athlete.races) {
    pointers = computeRacePointers(
      typeof athlete.races === "string" ? JSON.parse(athlete.races) : athlete.races,
      athlete.macrocycleRaceId ?? athlete.macrocycle_race_id
    );
  }
  res.json({ athlete, pointers });
});

router.post("/procoach/athletes/:deviceId/workouts", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { date, distanceKm, type, durationMin, week, injuryAlert, rpe, painLevel, notes, panelDistanceKm } = req.body as {
    date: string;
    distanceKm: number;
    type: string;
    durationMin: number;
    week: number;
    injuryAlert?: string;
    rpe?: number;
    painLevel?: number;
    notes?: string;
    panelDistanceKm?: number | null;
  };

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);

  if (athletes.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }

  const athleteId = athletes[0]!.id;
  const entryDate = normalizeEntryDate(date);

  let roundedKm = roundKm(distanceKm);
  let panelKmToSave: number | null = null;

  if (panelDistanceKm && panelDistanceKm > 0) {
    panelKmToSave = Number(panelDistanceKm);
    const planRows = await db.execute(sql`
      SELECT details_json FROM procoach_plan_sessions
      WHERE athlete_id = ${athleteId} AND session_date = ${entryDate} LIMIT 1
    `) as any;
    const plan = planRows.rows[0];
    const details = typeof plan?.details_json === "string" ? JSON.parse(plan.details_json) : plan?.details_json;
    const hiddenKm = details?.treadmillTelemetry?.restTotalKm ? Number(details.treadmillTelemetry.restTotalKm) : 0;

    const bodyKm = panelKmToSave - hiddenKm;
    roundedKm = roundKm(Math.max(0, bodyKm));
  }

  const existingEntry = await db
    .select()
    .from(workoutEntriesTable)
    .where(and(eq(workoutEntriesTable.athleteId, athleteId), eq(workoutEntriesTable.entryDate, entryDate)) as any)
    .limit(1);
  if (existingEntry[0]) {
    if (panelKmToSave !== null) {
      await db.execute(sql`UPDATE procoach_workout_entries SET panel_distance_km = ${panelKmToSave}, distance_km = ${roundedKm} WHERE id = ${existingEntry[0].id}`);
    }
    await upsertWorkoutFeedback({ athleteId, entryDate, rpe, painLevel, notes });
    res.json({ entry: existingEntry[0] });
    return;
  }

  const [entry] = await db
    .insert(workoutEntriesTable)
    .values({
      athleteId,
      entryDate,
      distanceKm: roundedKm,
      type: type as any,
      durationMin,
      week,
      injuryAlert: injuryAlert ?? null,
    })
    .returning();

  if (panelKmToSave !== null) {
    await db.execute(sql`UPDATE procoach_workout_entries SET panel_distance_km = ${panelKmToSave} WHERE id = ${entry.id}`);
  }

  await upsertWorkoutFeedback({ athleteId, entryDate, rpe, painLevel, notes });

  const adherence = type === "corrida" && roundedKm >= 3;
  if (!adherence) {
    res.json({ entry });
    return;
  }

  const existing = await db
    .select()
    .from(weeklyStatsTable)
    .where(
      and(
        eq(weeklyStatsTable.athleteId, athleteId),
        eq(weeklyStatsTable.week, week)
      ) as any
    )
    .limit(1);

  if (existing.length === 0) {
    await db.insert(weeklyStatsTable).values({
      athleteId,
      week,
      completedKm: roundedKm,
      sessionsCount: 1,
    });
  } else {
    await db
      .update(weeklyStatsTable)
      .set({
        completedKm: existing[0]!.completedKm + roundedKm,
        sessionsCount: existing[0]!.sessionsCount + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(weeklyStatsTable.athleteId, athleteId),
          eq(weeklyStatsTable.week, week)
        )
      );
  }

  res.json({ entry });
});

router.post("/procoach/athletes/:deviceId/workout-feedback", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { date, rpe, painLevel, notes } = req.body as {
    date?: string;
    rpe?: number;
    painLevel?: number;
    notes?: string;
  };

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }

  const athleteId = athletes[0]!.id;
  const entryDate = normalizeEntryDate(String(date ?? new Date().toISOString()));
  await upsertWorkoutFeedback({ athleteId, entryDate, rpe, painLevel, notes });
  res.json({ ok: true, entryDate });
});

router.post("/procoach/athletes/:deviceId/plan/import-text", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { text, year } = req.body as { text?: string; year?: number };
  const raw = String(text ?? "");
  const y = Number.isFinite(Number(year)) ? Math.round(Number(year)) : 2026;
  if (!raw.trim()) { res.status(400).json({ error: "text is required" }); return; }

  await ensurePlanTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const sessions = parsePlanImportText(raw, y);
  if (sessions.length === 0) { res.status(400).json({ error: "no sessions parsed" }); return; }

  for (const s of sessions) {
    const plannedKm = parsePlannedKmFromStrings(s.activity, s.structure);
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
        (${athleteId}, ${s.sessionDate}, ${s.dayName}, ${s.activity}, ${s.paceTarget}, ${s.treadmillSpeed}, ${s.restInterval}, ${s.structure}, ${plannedKm}, ${detailsJson}::jsonb, NOW(), NOW())
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
    year: y,
    firstDate: sessions[0]!.sessionDate,
    lastDate: sessions[sessions.length - 1]!.sessionDate,
  });
});

router.post("/procoach/athletes/:deviceId/plan/import-json", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const body = req.body as any;
  const plan = body?.plano_treinamento ?? body?.planoTreinamento ?? body;
  const cronograma = plan?.cronograma;
  if (!Array.isArray(cronograma) || cronograma.length === 0) {
    res.status(400).json({ error: "cronograma is required" });
    return;
  }

  await ensurePlanTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const sessions = cronograma
    .map((s: any) => {
      const rawDate = String(s?.data ?? "").trim();
      const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : normalizeEntryDate(rawDate);
      const dayName = s?.dia_semana ? String(s.dia_semana).trim() : "";
      const activity = String(s?.atividade ?? "").trim();
      const paceTarget = s?.pace_alvo ? String(s.pace_alvo).trim() : null;
      const restInterval = s?.repouso ? String(s.repouso).trim() : null;
      const structure = s?.estrutura ? String(s.estrutura).trim() : null;
      const distanceRaw = s?.distancia ? String(s.distancia).trim() : null;
      const treadmillRaw = s?.velocidade_esteira_kmh;
      const treadmillSpeed =
        treadmillRaw === undefined || treadmillRaw === null || treadmillRaw === ""
          ? null
          : typeof treadmillRaw === "number"
            ? `${treadmillRaw} km/h`
            : String(treadmillRaw).trim();
      if (!activity || !sessionDate) return null;
      const plannedKm = parsePlannedKmFromStrings(activity, structure, distanceRaw);
      return {
        sessionDate,
        dayName: dayName || null,
        activity,
        paceTarget: paceTarget && paceTarget !== "-" ? paceTarget : null,
        treadmillSpeed,
        restInterval: restInterval && restInterval !== "-" ? restInterval : null,
        structure,
        plannedKm,
      };
    })
    .filter(Boolean) as Array<{
      sessionDate: string;
      dayName: string | null;
      activity: string;
      paceTarget: string | null;
      treadmillSpeed: string | null;
      restInterval: string | null;
      structure: string | null;
      plannedKm: number;
    }>;

  if (sessions.length === 0) { res.status(400).json({ error: "no sessions parsed" }); return; }

  for (const s of sessions) {
    await db.execute(sql`
      INSERT INTO procoach_plan_sessions
        (athlete_id, session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, created_at, updated_at)
      VALUES
        (${athleteId}, ${s.sessionDate}, ${s.dayName}, ${s.activity}, ${s.paceTarget}, ${s.treadmillSpeed}, ${s.restInterval}, ${s.structure}, ${s.plannedKm}, NOW(), NOW())
      ON CONFLICT (athlete_id, session_date)
      DO UPDATE SET
        day_name = EXCLUDED.day_name,
        activity = EXCLUDED.activity,
        pace_target = EXCLUDED.pace_target,
        treadmill_speed = EXCLUDED.treadmill_speed,
        rest_interval = EXCLUDED.rest_interval,
        structure = EXCLUDED.structure,
        planned_km = EXCLUDED.planned_km,
        updated_at = NOW()
    `);
  }

  res.json({
    imported: sessions.length,
    firstDate: sessions[0]!.sessionDate,
    lastDate: sessions[sessions.length - 1]!.sessionDate,
  });
});

router.get("/procoach/athletes/:deviceId/plan", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  await ensurePlanTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId}
      AND (${from ?? null} IS NULL OR session_date >= ${from ?? null})
      AND (${to ?? null} IS NULL OR session_date <= ${to ?? null})
    ORDER BY session_date ASC
  `) as { rows: Array<any> };

  res.json({ sessions: rows.rows });
});

router.get("/procoach/athletes/:deviceId/plan/today", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const date = typeof req.query.date === "string" && req.query.date.trim() ? req.query.date.trim() : getSaoPauloDayKey();
  await ensurePlanTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date = ${date}
    LIMIT 1
  `) as { rows: Array<any> };

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

router.get("/procoach/athletes/:deviceId/plan/next", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : getSaoPauloDayKey();
  await ensurePlanTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date > ${from}
    ORDER BY session_date ASC
    LIMIT 1
  `) as { rows: Array<any> };

  res.json({ session: rows.rows[0] ?? null });
});

router.get("/procoach/athletes/:deviceId/compliance", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
  const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : getSaoPauloDayKey();
  const fromSafe = from ?? to;
  await ensurePlanTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const planned = await db.execute(sql`
    SELECT COUNT(*)::int AS planned_sessions, COALESCE(SUM(planned_km), 0)::int AS planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId}
      AND session_date >= ${fromSafe}
      AND session_date <= ${to}
  `) as { rows: Array<{ planned_sessions: number; planned_km: number }> };

  const completed = await db.execute(sql`
    SELECT COUNT(*)::int AS completed_sessions, COALESCE(SUM(distance_km), 0)::int AS completed_km
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
      AND entry_date >= ${fromSafe}
      AND entry_date <= ${to}
      AND type = 'corrida'
      AND distance_km >= 3
  `) as { rows: Array<{ completed_sessions: number; completed_km: number }> };

  res.json({
    from: fromSafe,
    to,
    plannedSessions: planned.rows[0]?.planned_sessions ?? 0,
    plannedKm: planned.rows[0]?.planned_km ?? 0,
    completedSessions: completed.rows[0]?.completed_sessions ?? 0,
    completedKm: completed.rows[0]?.completed_km ?? 0,
  });
});

router.get("/procoach/athletes/:deviceId/workouts", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const limitParam = Number(req.query.limit) || 30;
  const offsetParam = Math.max(0, Number(req.query.offset) || 0);

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);

  if (athletes.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }

  const athleteId = athletes[0]!.id;

  const totalRes = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
  `) as { rows: Array<{ count: number }> };
  const totalCount = totalRes.rows[0]?.count ?? 0;

  const entries = await db
    .select()
    .from(workoutEntriesTable)
    .where(eq(workoutEntriesTable.athleteId, athleteId) as any)
    .orderBy(desc(workoutEntriesTable.createdAt) as any)
    .limit(limitParam)
    .offset(offsetParam);

  res.json({ entries, totalCount });
});

router.post("/procoach/athletes/:deviceId/push-token", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { token } = req.body as { token?: string };

  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  const rows = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }

  await db
    .update(athletesTable)
    .set({ expoPushToken: token, updatedAt: new Date() })
    .where(eq(athletesTable.deviceId, deviceId) as any);

  res.json({ registered: true });
});

router.get("/procoach/athletes/:deviceId/weekly-stats", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);

  if (athletes.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }

  const stats = await db
    .select()
    .from(weeklyStatsTable)
    .where(eq(weeklyStatsTable.athleteId, athletes[0]!.id) as any);

  const weeklyCompleted: Record<number, number> = {};
  for (const s of stats) {
    weeklyCompleted[s.week] = s.completedKm;
  }

  res.json({ weeklyCompleted });
});

router.post("/procoach/athletes/:deviceId/bioimpedance", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  await ensureBioimpedanceTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const body = req.body as Record<string, unknown>;
  const entryDate = normalizeEntryDate(String(body.date ?? body.entryDate ?? ""));
  const weightKg = asNumberOrNull(body.weight ?? body.weight_kg ?? body.weightKg);
  const bodyFatPct = asNumberOrNull(body.body_fat ?? body.body_fat_pct ?? body.bodyFat ?? body.bodyFatPct);
  const muscleMassKg = asNumberOrNull(body.muscle_mass ?? body.muscle_mass_kg ?? body.muscleMass ?? body.muscleMassKg);
  const bodyWaterPct = asNumberOrNull(body.body_water ?? body.body_water_pct ?? body.bodyWater ?? body.bodyWaterPct);
  const visceralFat = asNumberOrNull(body.visceral_fat ?? body.visceralFat);
  const metabolicAgeRaw = asNumberOrNull(body.metabolic_age ?? body.metabolicAge);
  const tmbRaw = asNumberOrNull(body.tmb ?? body.tmb_kcal ?? body.tmbKcal);
  const proteinPct = asNumberOrNull(body.protein ?? body.protein_pct ?? body.proteinPct);
  const boneMassKg = asNumberOrNull(body.bone_mass ?? body.bone_mass_kg ?? body.boneMass ?? body.boneMassKg);
  const healthNotes =
    typeof body.health_notes === "string"
      ? body.health_notes
      : typeof body.healthNotes === "string"
        ? body.healthNotes
        : typeof body.notes === "string"
          ? body.notes
          : "";

  if (!entryDate) { res.status(400).json({ error: "date is required" }); return; }

  const metabolicAge = metabolicAgeRaw === null ? null : Math.max(0, Math.round(metabolicAgeRaw));
  const tmbKcal = tmbRaw === null ? null : Math.max(0, Math.round(tmbRaw));

  if (weightKg !== null && (weightKg < 30 || weightKg > 250)) { res.status(400).json({ error: "weight out of range" }); return; }
  if (bodyFatPct !== null && (bodyFatPct < 0 || bodyFatPct > 70)) { res.status(400).json({ error: "body_fat out of range" }); return; }
  if (bodyWaterPct !== null && (bodyWaterPct < 0 || bodyWaterPct > 100)) { res.status(400).json({ error: "body_water out of range" }); return; }

  const rows = await db.execute(sql`
    INSERT INTO procoach_bioimpedance
      (athlete_id, entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, created_at, updated_at)
    VALUES
      (${athleteId}, ${entryDate}, ${weightKg}, ${bodyFatPct}, ${muscleMassKg}, ${bodyWaterPct}, ${visceralFat}, ${metabolicAge}, ${tmbKcal}, ${proteinPct}, ${boneMassKg}, ${healthNotes}, NOW(), NOW())
    ON CONFLICT (athlete_id, entry_date)
    DO UPDATE SET
      weight_kg = EXCLUDED.weight_kg,
      body_fat_pct = EXCLUDED.body_fat_pct,
      muscle_mass_kg = EXCLUDED.muscle_mass_kg,
      body_water_pct = EXCLUDED.body_water_pct,
      visceral_fat = EXCLUDED.visceral_fat,
      metabolic_age = EXCLUDED.metabolic_age,
      tmb_kcal = EXCLUDED.tmb_kcal,
      protein_pct = EXCLUDED.protein_pct,
      bone_mass_kg = EXCLUDED.bone_mass_kg,
      health_notes = EXCLUDED.health_notes,
      updated_at = NOW()
    RETURNING
      entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, updated_at
  `) as { rows: Array<any> };

  res.json({ entry: rows.rows[0] ?? null });
});

router.get("/procoach/athletes/:deviceId/bioimpedance", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const limitParam = Math.max(1, Math.min(90, Number(req.query.limit) || 30));
  await ensureBioimpedanceTable();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }
  const athleteId = athletes[0]!.id;

  const rows = await db.execute(sql`
    SELECT
      entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, updated_at
    FROM procoach_bioimpedance
    WHERE athlete_id = ${athleteId}
    ORDER BY entry_date DESC
    LIMIT ${limitParam}
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ entries: rows.rows });
});

router.get("/procoach/athletes/:deviceId/gel-stock", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  await ensureGelTables();

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }

  const athleteId = athletes[0]!.id;
  const rows = await db.execute(
    sql`SELECT gels_in_stock FROM procoach_gel_stock WHERE athlete_id = ${athleteId} LIMIT 1`
  ) as { rows: Array<{ gels_in_stock: number | string }> };
  const gelsInStock = rows.rows[0] ? Number(rows.rows[0].gels_in_stock) : 0;
  res.json({ gelsInStock });
});

router.put("/procoach/athletes/:deviceId/gel-stock", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { gelsInStock } = req.body as { gelsInStock?: number };
  await ensureGelTables();

  const val = Math.max(0, Math.round(Number(gelsInStock ?? 0)));

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }

  const athleteId = athletes[0]!.id;
  await db.execute(sql`
    INSERT INTO procoach_gel_stock (athlete_id, gels_in_stock, updated_at)
    VALUES (${athleteId}, ${val}, NOW())
    ON CONFLICT (athlete_id)
    DO UPDATE SET gels_in_stock = EXCLUDED.gels_in_stock, updated_at = NOW()
  `);
  res.json({ gelsInStock: val });
});

router.post("/procoach/athletes/:deviceId/gel-usage", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { date, context, gelsUsed } = req.body as { date?: string; context?: string; gelsUsed?: number };
  await ensureGelTables();

  const used = Math.max(0, Math.round(Number(gelsUsed ?? 0)));
  const entryDate = normalizeEntryDate(String(date ?? new Date().toISOString()));
  const ctx = String(context ?? "workout").slice(0, 64) || "workout";

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);
  if (athletes.length === 0) { res.status(404).json({ error: "Athlete not found" }); return; }

  const athleteId = athletes[0]!.id;

  const beforeRows = await db.execute(
    sql`SELECT gels_in_stock FROM procoach_gel_stock WHERE athlete_id = ${athleteId} LIMIT 1`
  ) as { rows: Array<{ gels_in_stock: number | string }> };
  const before = beforeRows.rows[0] ? Number(beforeRows.rows[0].gels_in_stock) : 0;
  const after = Math.max(0, before - used);

  await db.execute(sql`
    INSERT INTO procoach_gel_stock (athlete_id, gels_in_stock, updated_at)
    VALUES (${athleteId}, ${after}, NOW())
    ON CONFLICT (athlete_id)
    DO UPDATE SET gels_in_stock = EXCLUDED.gels_in_stock, updated_at = NOW()
  `);

  await db.execute(sql`
    INSERT INTO procoach_gel_usage (athlete_id, entry_date, context, gels_used, created_at)
    VALUES (${athleteId}, ${entryDate}, ${ctx}, ${used}, NOW())
  `);

  if (before > 0 && after === 0) {
    await sendTelegram(
      `🚨 *ESTOQUE DE GÉIS ZEROU*\n\n` +
      `Contexto: *${ctx}*\n` +
      `Data: *${entryDate}*\n\n` +
      `Reabastecer hoje.`
    );
  }

  res.json({ gelsInStock: after, gelsUsed: used, entryDate, context: ctx });
});

export default router;