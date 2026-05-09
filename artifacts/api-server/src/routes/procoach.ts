import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, sql } from "@workspace/db";
import { db } from "@workspace/db";
import {
  athletesTable,
  workoutEntriesTable,
  weeklyStatsTable,
  insertAthleteSchema,
} from "@workspace/db/schema";

const router: IRouter = Router();

const MONO_DEVICE_ID = "mono";

function roundKm(val: number): number {
  return Math.round(val);
}

function normalizeEntryDate(raw: string): string {
  if (typeof raw !== "string") return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function defaultRaceDateISO(): string {
  return new Date(Date.now() + 16 * 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function getOrCreateMonoAthleteId(): Promise<number> {
  const existing = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, MONO_DEVICE_ID) as any)
    .limit(1);

  if (existing[0]) return existing[0].id;

  const [created] = await db
    .insert(athletesTable)
    .values({
      deviceId: MONO_DEVICE_ID,
      targetRaceDate: defaultRaceDateISO(),
    })
    .returning();

  return created.id;
}

let gelTablesReady = false;
async function ensureGelTables(): Promise<void> {
  if (gelTablesReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_gel_stock (
      athlete_id INTEGER PRIMARY KEY REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      gels_in_stock INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_gel_usage (
      id SERIAL PRIMARY KEY,
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      entry_date VARCHAR(32) NOT NULL,
      context VARCHAR(64) NOT NULL,
      gels_used INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  gelTablesReady = true;
}

let feedbackTableReady = false;
async function ensureWorkoutFeedbackTable(): Promise<void> {
  if (feedbackTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_workout_feedback (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      entry_date VARCHAR(32) NOT NULL,
      rpe INTEGER,
      pain_level INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, entry_date)
    )
  `);
  feedbackTableReady = true;
}

let planTableReady = false;
async function ensurePlanTable(): Promise<void> {
  if (planTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_plan_sessions (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      session_date VARCHAR(32) NOT NULL,
      day_name VARCHAR(32),
      activity VARCHAR(120) NOT NULL,
      pace_target VARCHAR(32),
      treadmill_speed VARCHAR(32),
      rest_interval VARCHAR(32),
      structure TEXT,
      planned_km INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, session_date)
    )
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_plan_sessions
      ADD COLUMN IF NOT EXISTS planned_km INTEGER NOT NULL DEFAULT 0
  `);
  planTableReady = true;
}

let bioimpedanceTableReady = false;
async function ensureBioimpedanceTable(): Promise<void> {
  if (bioimpedanceTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_bioimpedance (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      entry_date VARCHAR(32) NOT NULL,
      weight_kg NUMERIC(6,2),
      body_fat_pct NUMERIC(5,2),
      muscle_mass_kg NUMERIC(6,2),
      body_water_pct NUMERIC(5,2),
      visceral_fat NUMERIC(5,2),
      metabolic_age INTEGER,
      tmb_kcal INTEGER,
      protein_pct NUMERIC(5,2),
      bone_mass_kg NUMERIC(5,2),
      health_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, entry_date)
    )
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS muscle_mass_kg NUMERIC(6,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS body_water_pct NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS visceral_fat NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS metabolic_age INTEGER
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS tmb_kcal INTEGER
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS protein_pct NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS bone_mass_kg NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS health_notes TEXT
  `);
  bioimpedanceTableReady = true;
}

function parsePtBrMonth(mon: string): number | null {
  const m = mon.toLowerCase().replace(".", "").trim();
  const map: Record<string, number> = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };
  return map[m] ?? null;
}

function parsePlanDate(raw: string, year: number): string | null {
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

function parsePlannedKmFromStrings(activity: string, structure: string | null, distanceRaw?: string | null): number {
  const fromDistance = distanceRaw ? String(distanceRaw).match(/(\d+(?:[.,]\d+)?)\s*km/i) : null;
  if (fromDistance?.[1]) return Math.max(0, Math.round(Number(fromDistance[1].replace(",", "."))));
  const hay = `${activity} ${structure ?? ""}`;
  const m = hay.match(/(\d+(?:[.,]\d+)?)\s*km/i);
  if (!m?.[1]) return 0;
  return Math.max(0, Math.round(Number(m[1].replace(",", "."))));
}

function asNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : Number(String(val).replace(",", ".").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

function parsePlanImportText(text: string, year: number): Array<{
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

async function upsertWorkoutFeedback(payload: {
  athleteId: number;
  entryDate: string;
  rpe?: number;
  painLevel?: number;
  notes?: string;
}): Promise<void> {
  await ensureWorkoutFeedbackTable();
  const rpeVal = payload.rpe === undefined ? null : Math.max(1, Math.min(10, Math.round(payload.rpe)));
  const painVal = payload.painLevel === undefined ? null : Math.max(0, Math.min(5, Math.round(payload.painLevel)));
  const notes = payload.notes ? String(payload.notes).slice(0, 2000) : null;
  if (rpeVal === null && painVal === null && notes === null) return;
  await db.execute(sql`
    INSERT INTO procoach_workout_feedback (athlete_id, entry_date, rpe, pain_level, notes, created_at, updated_at)
    VALUES (${payload.athleteId}, ${payload.entryDate}, ${rpeVal}, ${painVal}, ${notes}, NOW(), NOW())
    ON CONFLICT (athlete_id, entry_date)
    DO UPDATE SET
      rpe = COALESCE(EXCLUDED.rpe, procoach_workout_feedback.rpe),
      pain_level = COALESCE(EXCLUDED.pain_level, procoach_workout_feedback.pain_level),
      notes = COALESCE(EXCLUDED.notes, procoach_workout_feedback.notes),
      updated_at = NOW()
  `);
}

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
}

router.post("/procoach/athletes/sync", async (req: Request, res: Response) => {
  // Validação em tempo de execução com Zod
  const body = (req.body ?? {}) as Record<string, unknown>;
  const inferredDeviceId =
    typeof body.deviceId === "string" && body.deviceId.trim()
      ? body.deviceId.trim()
      : MONO_DEVICE_ID;
  const parseResult = insertAthleteSchema.safeParse({ ...body, deviceId: inferredDeviceId });

  if (!parseResult.success) {
    res.status(400).json({ error: "Invalid athlete data", details: parseResult.error.issues });
    return;
  }

  // Desestruturamos os dados validados pelo Zod.
  // 'races' foi removido do objeto de inserção/atualização conforme a instrução,
  // assumindo que não está no schema do Drizzle para inserção direta.
  const { deviceId, ...restOfAthleteData } = parseResult.data;

  const existing = await db
    .select()
    .from(athletesTable)
    // O cast 'as any' no operador 'eq' resolve o conflito de tipos Drizzle em monorepos (Error 2345/2769).
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);

  let athlete;
  if (existing.length === 0) {
    const defaultRaceDate = restOfAthleteData.targetRaceDate ?? new Date(Date.now() + 16 * 7 * 24 * 60 * 60 * 1000).toISOString();
    const [created] = await db
      .insert(athletesTable)
      .values({
        ...restOfAthleteData, // Inclui todos os campos validados, exceto deviceId e races
        deviceId: deviceId, // deviceId é obrigatório e já vem do parseResult.data
        targetRaceDistanceKm: restOfAthleteData.targetRaceDistanceKm ? roundKm(restOfAthleteData.targetRaceDistanceKm) : 42,
        targetRaceDate: defaultRaceDate, // Garante que a data padrão seja usada se não fornecida
        // 'races' removido conforme instrução. Se for uma coluna JSONB, ela deve ser incluída aqui.
      })
      .returning();
    athlete = created;
  } else {
    const [updated] = await db
      .update(athletesTable)
      .set({
        ...Object.fromEntries(
          Object.entries(restOfAthleteData).filter(([, value]) => value !== undefined)
        ),
        // 'races' removido conforme instrução. Se for uma coluna JSONB, ela deve ser incluída aqui.
        updatedAt: new Date(),
      })
      .where(eq(athletesTable.deviceId, deviceId) as any)
      .returning();
    athlete = updated;
  }

  res.json({ athlete });
});

router.get("/procoach/me", async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  const rows = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.id, athleteId) as any)
    .limit(1);
  res.json({ athlete: rows[0] ?? null });
});

router.post("/procoach/me/workouts", async (req: Request, res: Response) => {
  const { date, distanceKm, type, durationMin, week, injuryAlert, rpe, painLevel, notes } = req.body as {
    date: string;
    distanceKm: number;
    type: string;
    durationMin: number;
    week: number;
    injuryAlert?: string;
    rpe?: number;
    painLevel?: number;
    notes?: string;
  };

  const athleteId = await getOrCreateMonoAthleteId();
  const roundedKm = roundKm(distanceKm);
  const entryDate = normalizeEntryDate(date);

  const existingEntry = await db
    .select()
    .from(workoutEntriesTable)
    .where(and(eq(workoutEntriesTable.athleteId, athleteId), eq(workoutEntriesTable.entryDate, entryDate)) as any)
    .limit(1);
  if (existingEntry[0]) {
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

  await upsertWorkoutFeedback({ athleteId, entryDate, rpe, painLevel, notes });

  const existing = await db
    .select()
    .from(weeklyStatsTable)
    .where(and(eq(weeklyStatsTable.athleteId, athleteId), eq(weeklyStatsTable.week, week)) as any)
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
      .where(and(eq(weeklyStatsTable.athleteId, athleteId), eq(weeklyStatsTable.week, week)));
  }

  res.json({ entry });
});

router.post("/procoach/me/workout-feedback", async (req: Request, res: Response) => {
  const { date, rpe, painLevel, notes } = req.body as {
    date?: string;
    rpe?: number;
    painLevel?: number;
    notes?: string;
  };

  const athleteId = await getOrCreateMonoAthleteId();
  const entryDate = normalizeEntryDate(String(date ?? new Date().toISOString()));
  await upsertWorkoutFeedback({ athleteId, entryDate, rpe, painLevel, notes });
  res.json({ ok: true, entryDate });
});

router.get("/procoach/me/workouts", async (req: Request, res: Response) => {
  const limitParam = Number(req.query.limit) || 30;
  const athleteId = await getOrCreateMonoAthleteId();

  const entries = await db
    .select()
    .from(workoutEntriesTable)
    .where(eq(workoutEntriesTable.athleteId, athleteId) as any)
    .orderBy(desc(workoutEntriesTable.createdAt) as any)
    .limit(limitParam);

  res.json({ entries });
});

router.get("/procoach/me/weekly-stats", async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();

  const stats = await db
    .select()
    .from(weeklyStatsTable)
    .where(eq(weeklyStatsTable.athleteId, athleteId) as any);

  const weeklyCompleted: Record<number, number> = {};
  for (const s of stats) {
    weeklyCompleted[s.week] = s.completedKm;
  }

  res.json({ weeklyCompleted });
});

router.post("/procoach/me/push-token", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  await getOrCreateMonoAthleteId();

  await db
    .update(athletesTable)
    .set({ expoPushToken: token, updatedAt: new Date() })
    .where(eq(athletesTable.deviceId, MONO_DEVICE_ID) as any);

  res.json({ registered: true });
});

router.get("/procoach/me/gel-stock", async (_req: Request, res: Response) => {
  await ensureGelTables();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(
    sql`SELECT gels_in_stock FROM procoach_gel_stock WHERE athlete_id = ${athleteId} LIMIT 1`
  ) as { rows: Array<{ gels_in_stock: number | string }> };
  const gelsInStock = rows.rows[0] ? Number(rows.rows[0].gels_in_stock) : 0;
  res.json({ gelsInStock });
});

router.put("/procoach/me/gel-stock", async (req: Request, res: Response) => {
  await ensureGelTables();
  const { gelsInStock } = req.body as { gelsInStock?: number };
  const val = Math.max(0, Math.round(Number(gelsInStock ?? 0)));
  const athleteId = await getOrCreateMonoAthleteId();

  await db.execute(sql`
    INSERT INTO procoach_gel_stock (athlete_id, gels_in_stock, updated_at)
    VALUES (${athleteId}, ${val}, NOW())
    ON CONFLICT (athlete_id)
    DO UPDATE SET gels_in_stock = EXCLUDED.gels_in_stock, updated_at = NOW()
  `);
  res.json({ gelsInStock: val });
});

router.post("/procoach/me/gel-usage", async (req: Request, res: Response) => {
  await ensureGelTables();
  const { date, context, gelsUsed } = req.body as { date?: string; context?: string; gelsUsed?: number };

  const used = Math.max(0, Math.round(Number(gelsUsed ?? 0)));
  const entryDate = normalizeEntryDate(String(date ?? new Date().toISOString()));
  const ctx = String(context ?? "workout").slice(0, 64) || "workout";
  const athleteId = await getOrCreateMonoAthleteId();

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

  if (after === 0 && before > 0) {
    await sendTelegram(`⚠️ *GÉIS ZERADOS*\nVocê usou ${used} géis (${ctx}) e seu estoque foi para 0.\nReponha hoje.`);
  }

  res.json({ gelsInStock: after, gelsUsed: used, entryDate, context: ctx });
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
    year,
    firstDate: sessions[0]!.sessionDate,
    lastDate: sessions[sessions.length - 1]!.sessionDate,
  });
});

router.post("/procoach/me/plan/import-json", async (req: Request, res: Response) => {
  const body = req.body as any;
  const plan = body?.plano_treinamento ?? body?.planoTreinamento ?? body;
  const cronograma = plan?.cronograma;
  if (!Array.isArray(cronograma) || cronograma.length === 0) {
    res.status(400).json({ error: "cronograma is required" });
    return;
  }

  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

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

router.get("/procoach/me/plan", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
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
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date = ${date}
    LIMIT 1
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ session: rows.rows[0] ?? null });
});

router.get("/procoach/me/plan/next", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : getSaoPauloDayKey();
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date > ${from}
    ORDER BY session_date ASC
    LIMIT 1
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ session: rows.rows[0] ?? null });
});

router.get("/procoach/me/compliance", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
  const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : getSaoPauloDayKey();
  const fromSafe = from ?? to;
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

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

router.post("/procoach/me/bioimpedance", async (req: Request, res: Response) => {
  await ensureBioimpedanceTable();
  const athleteId = await getOrCreateMonoAthleteId();

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
          : null;

  const metabolicAge = metabolicAgeRaw === null ? null : Math.max(0, Math.round(metabolicAgeRaw));
  const tmbKcal = tmbRaw === null ? null : Math.max(0, Math.round(tmbRaw));

  const rows = await db.execute(sql`
    INSERT INTO procoach_bioimpedance (
      athlete_id, entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat,
      metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, created_at, updated_at
    )
    VALUES (
      ${athleteId}, ${entryDate}, ${weightKg}, ${bodyFatPct}, ${muscleMassKg}, ${bodyWaterPct}, ${visceralFat},
      ${metabolicAge}, ${tmbKcal}, ${proteinPct}, ${boneMassKg}, ${healthNotes}, NOW(), NOW()
    )
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
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ entry: rows.rows[0] ?? null });
});

router.get("/procoach/me/bioimpedance", async (req: Request, res: Response) => {
  const limitParam = Math.max(1, Math.min(90, Number(req.query.limit) || 30));
  await ensureBioimpedanceTable();
  const athleteId = await getOrCreateMonoAthleteId();

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

router.get("/procoach/athletes/:deviceId", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const rows = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }
  res.json({ athlete: rows[0] });
});

router.post("/procoach/athletes/:deviceId/workouts", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { date, distanceKm, type, durationMin, week, injuryAlert, rpe, painLevel, notes } = req.body as {
    date: string;
    distanceKm: number;
    type: string;
    durationMin: number;
    week: number;
    injuryAlert?: string;
    rpe?: number;
    painLevel?: number;
    notes?: string;
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
  const roundedKm = roundKm(distanceKm);
  const entryDate = normalizeEntryDate(date);

  const existingEntry = await db
    .select()
    .from(workoutEntriesTable)
    .where(and(eq(workoutEntriesTable.athleteId, athleteId), eq(workoutEntriesTable.entryDate, entryDate)) as any)
    .limit(1);
  if (existingEntry[0]) {
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

  await upsertWorkoutFeedback({ athleteId, entryDate, rpe, painLevel, notes });

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

function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

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
    await db.execute(sql`
      INSERT INTO procoach_plan_sessions
        (athlete_id, session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, created_at, updated_at)
      VALUES
        (${athleteId}, ${s.sessionDate}, ${s.dayName}, ${s.activity}, ${s.paceTarget}, ${s.treadmillSpeed}, ${s.restInterval}, ${s.structure}, ${plannedKm}, NOW(), NOW())
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
  `) as { rows: Array<{
    session_date: string;
    day_name: string | null;
    activity: string;
    pace_target: string | null;
    treadmill_speed: string | null;
    rest_interval: string | null;
    structure: string | null;
    planned_km: number | string;
  }> };

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
  `) as { rows: Array<{
    session_date: string;
    day_name: string | null;
    activity: string;
    pace_target: string | null;
    treadmill_speed: string | null;
    rest_interval: string | null;
    structure: string | null;
    planned_km: number | string;
  }> };

  res.json({ session: rows.rows[0] ?? null });
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
  `) as { rows: Array<{
    session_date: string;
    day_name: string | null;
    activity: string;
    pace_target: string | null;
    treadmill_speed: string | null;
    rest_interval: string | null;
    structure: string | null;
    planned_km: number | string;
  }> };

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

  const athletes = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId) as any)
    .limit(1);

  if (athletes.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }

  const entries = await db
    .select()
    .from(workoutEntriesTable)
    .where(eq(workoutEntriesTable.athleteId, athletes[0]!.id) as any)
    .orderBy(desc(workoutEntriesTable.createdAt) as any)
    .limit(limitParam);

  res.json({ entries });
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
  `) as { rows: Array<{
    entry_date: string;
    weight_kg: string | number | null;
    body_fat_pct: string | number | null;
    muscle_mass_kg: string | number | null;
    body_water_pct: string | number | null;
    visceral_fat: string | number | null;
    metabolic_age: number | null;
    tmb_kcal: number | null;
    protein_pct: string | number | null;
    bone_mass_kg: string | number | null;
    health_notes: string | null;
    updated_at: string;
  }> };

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
