import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, sql } from "@workspace/db";
import { db } from "@workspace/db";
import multer from "multer";
import PDFDocument from "pdfkit";
import pdfParse from "pdf-parse";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  athletesTable,
  shoesTable,
  workoutEntriesTable,
  weeklyStatsTable,
  insertAthleteSchema,
} from "@workspace/db/schema";
import {
  parsePlanImportText,
  parsePlannedKmFromStrings,
  formatKmh,
  parseBike,
  parseSegments,
  groupBlocks,
  computeTreadmillTelemetry,
  parseInterval,
  sumDistanceKm,
  inferModalities,
  parsePlanDate,
  parseKmhNumber,
  parsePaceMinPerKm,
  kmhFromPace,
  formatKmhFromPaceTarget,
  parseRestSeconds,
  isStrengthOrBikePart
} from "./PlanParserService";
import {
  MONO_DEVICE_ID,
  getOrCreateMonoAthleteId,
  ensureGelTables,
  ensureWorkoutFeedbackTable,
  ensurePlanTable,
  StrengthTemplateCode,
  ensureStrengthTables,
  ensureStrengthCatalogSeed,
  ensureShoesTables,
  ensureBioimpedanceTable,
  ensureAthletesRacesColumn
} from "./migrations";

function mapOpenWeatherToWMO(id: number): number {
  if (id === 800) return 0;
  if (id === 801 || id === 802) return 2;
  if (id === 803 || id === 804) return 3;
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 51;
  if (id >= 500 && id < 600) return 63;
  if (id >= 600 && id < 700) return 71;
  if (id >= 700 && id < 800) return 45;
  return 0;
}

const router: IRouter = Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

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

function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function getSaoPauloTomorrowKey(): string {
  const d = new Date();
  const spDate = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  spDate.setDate(spDate.getDate() + 1);
  const yyyy = spDate.getFullYear();
  const mm = String(spDate.getMonth() + 1).padStart(2, "0");
  const dd = String(spDate.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calcula os ponteiros de prova para o atleta (Próxima Prova, Próxima P1 e Âncora do Macrociclo).
 * 
 * @param races - Array de provas cadastradas.
 * @param macrocycleRaceId - (Opcional) ID da prova selecionada manualmente pelo usuário para ser a âncora.
 * @returns Ponteiros para nextRace, nextP1 e anchor.
 */
function computeRacePointers(races: any[], macrocycleRaceId?: string | null) {
  if (!Array.isArray(races)) return { nextRace: null, nextP1: null, anchor: null };
  const today = getSaoPauloDayKey();
  const valid = races.filter((r) => r.data && r.data >= today && r.status !== "cancelada");
  valid.sort((a, b) => a.data.localeCompare(b.data));

  const nextRace = valid[0] ?? null;
  const nextP1 = valid.find((r) => r.tipo_tatico === "P1") ?? null;
  
  // Prioridade 1: Buscar a prova na lista valid onde id === macrocycleRaceId
  let anchor = macrocycleRaceId ? valid.find((r) => String(r.id) === String(macrocycleRaceId)) ?? null : null;

  // Prioridade 2 (Fallback): Se não encontrou a prova manual, usa a próxima P1
  if (!anchor) {
    anchor = nextP1;
  }

  return { nextRace, nextP1, anchor };
}

function asNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : Number(String(val).replace(",", ".").trim());
  if (!Number.isFinite(n)) return null;
  return n;
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

  if (painVal !== null) {
    // Atualiza o nível de dor no perfil do atleta para integrar com o Radar Articular
    await db.update(athletesTable)
      .set({ painLevel: painVal, updatedAt: new Date() })
      .where(eq(athletesTable.id, payload.athleteId));
  }
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
        updatedAt: new Date(),
      })
      .where(eq(athletesTable.deviceId, deviceId) as any)
      .returning();
    athlete = updated;
  }

  // Atualiza o Calendário Perene de forma segura (ignorando restrições temporárias do Zod/Drizzle)
  const racesRaw = Array.isArray(body.races) ? body.races : [];
  await ensureAthletesRacesColumn();
  await db.execute(sql`
    UPDATE procoach_athletes
    SET races = ${JSON.stringify(racesRaw)}::jsonb
    WHERE device_id = ${deviceId}
  `);

  const updatedRows = await db.execute(sql`SELECT * FROM procoach_athletes WHERE device_id = ${deviceId} LIMIT 1`) as any;
  const updatedAthlete = updatedRows.rows[0];
  const pointers = computeRacePointers(
    typeof updatedAthlete.races === "string" ? JSON.parse(updatedAthlete.races) : updatedAthlete.races,
    updatedAthlete.macrocycleRaceId ?? updatedAthlete.macrocycle_race_id
  );

  res.json({ athlete: updatedAthlete, pointers });
});

// ─── Gerenciamento de Provas (Races) ──────────────────────────────────────────
router.post("/procoach/athletes/:deviceId/races", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const raceData = req.body;
  
  await ensureAthletesRacesColumn();
  const athletes = await db.select().from(athletesTable).where(eq(athletesTable.deviceId, deviceId) as any).limit(1);
  if (athletes.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }
  const athlete = athletes[0];
  const currentRaces = typeof athlete.races === "string" ? JSON.parse(athlete.races) : (athlete.races || []);
  currentRaces.push(raceData);

  await db.execute(sql`
    UPDATE procoach_athletes
    SET races = ${JSON.stringify(currentRaces)}::jsonb, updated_at = NOW()
    WHERE id = ${athlete.id}
  `);

  res.json({ success: true, races: currentRaces });
});

router.put("/procoach/athletes/:deviceId/macrocycle-anchor", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const { raceId } = req.body;

  const athletes = await db.select().from(athletesTable).where(eq(athletesTable.deviceId, deviceId) as any).limit(1);
  if (athletes.length === 0) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }

  // Atualiza a âncora do macrociclo que ditará as 16 semanas do atleta
  await db.execute(sql`
    UPDATE procoach_athletes
    SET macrocycle_race_id = ${raceId}, updated_at = NOW()
    WHERE id = ${athletes[0].id}
  `);

  res.json({ success: true, macrocycleRaceId: raceId });
});

// ─── Rota Retrocompatível para Flutter (Legado athletes.ts) ───────────────────
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

// ─── Gemini Race Strategy ─────────────────────────────────────────────────────
router.post("/procoach/me/race-strategy", async (req: Request, res: Response) => {
  try {
    const { raceName } = req.body as { raceName?: string };
    if (!raceName) {
      res.status(400).json({ error: "raceName is required" });
      return;
    }

    const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
    const modelName = (process.env.GEMINI_MODEL || "gemini-pro").replace(/^['"`]+|['"`]+$/g, "").trim();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt = `Você é um treinador de corrida de elite. Seu atleta vai correr a prova "${raceName}" muito em breve.
Crie uma estratégia de prova curta e tática.
Inclua 3 bullet points práticos (Ex: pacing, hidratação, mentalidade).
Seja direto, inspirador e não use formatação markdown excessiva além dos bullets.`;

    const result = await model.generateContent(prompt);
    res.json({ strategy: result.response.text() });
  } catch (err) {
    console.error("[API] Erro na IA de Race Strategy:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ─── Upload e Processamento de Bioimpedância em PDF via IA ────────────────────
router.post(
  "/procoach/me/bioimpedance/upload",
  pdfUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      await ensureBioimpedanceTable();
      const athleteId = await getOrCreateMonoAthleteId();

      const file = (req as any).file as { buffer: Buffer; originalname?: string; mimetype?: string } | undefined;
      if (!file?.buffer) {
        res.status(400).json({ error: "Arquivo PDF é obrigatório (field: file)" });
        return;
      }

      console.log(`📄 Recebido PDF do atleta ${athleteId}: ${file.originalname}`);
      const base64Data = file.buffer.toString("base64");

      const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
      const modelName = (process.env.GEMINI_MODEL || "gemini-pro").replace(/^['"`]+|['"`]+$/g, "").trim();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `Você é um especialista em nutrição e leitura de exames.
Analise o PDF de bioimpedância em anexo e extraia exatamente as seguintes métricas num JSON válido:
{
  "date": "YYYY-MM-DD",
  "weight_kg": numero,
  "body_fat_pct": numero,
  "muscle_mass_kg": numero,
  "body_water_pct": numero,
  "visceral_fat": numero,
  "metabolic_age": numero,
  "tmb_kcal": numero,
  "protein_pct": numero,
  "bone_mass_kg": numero
}
Caso alguma métrica não exista no documento, retorne null no valor. Responda apenas com o JSON bruto, sem marcação markdown ou blocos de código.`;

      const result = await model.generateContent([ prompt, { inlineData: { data: base64Data, mimeType: "application/pdf" } } ]);

      const rawText = result.response.text();
      const cleaned = rawText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
      const data = JSON.parse(cleaned);
      const entryDate = normalizeEntryDate(data.date || "");

      await db.execute(sql`
        INSERT INTO procoach_bioimpedance
          (athlete_id, entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, created_at, updated_at)
        VALUES
          (${athleteId}, ${entryDate}, ${data.weight_kg ?? null}, ${data.body_fat_pct ?? null}, ${data.muscle_mass_kg ?? null}, ${data.body_water_pct ?? null}, ${data.visceral_fat ?? null}, ${data.metabolic_age ?? null}, ${data.tmb_kcal ?? null}, ${data.protein_pct ?? null}, ${data.bone_mass_kg ?? null}, NOW(), NOW())
        ON CONFLICT (athlete_id, entry_date)
        DO UPDATE SET weight_kg = EXCLUDED.weight_kg, body_fat_pct = EXCLUDED.body_fat_pct, muscle_mass_kg = EXCLUDED.muscle_mass_kg, body_water_pct = EXCLUDED.body_water_pct, visceral_fat = EXCLUDED.visceral_fat, metabolic_age = EXCLUDED.metabolic_age, tmb_kcal = EXCLUDED.tmb_kcal, protein_pct = EXCLUDED.protein_pct, bone_mass_kg = EXCLUDED.bone_mass_kg, updated_at = NOW()
      `);
      res.json({ success: true, message: "Upload concluído e bioimpedância salva.", data });
    } catch (err: any) {
      console.error("[API] Erro ao processar PDF com IA:", err);
      res.status(500).json({ error: err?.message || "Internal Server Error" });
    }
  }
);

router.get("/procoach/me", async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureAthletesRacesColumn();
  const rows = await db.execute(sql`SELECT * FROM procoach_athletes WHERE id = ${athleteId} LIMIT 1`) as any;
  const athlete = rows.rows[0] ?? null;
  
  let pointers = { nextRace: null, nextP1: null, anchor: null };
  if (athlete && athlete.races) {
    pointers = computeRacePointers(
      typeof athlete.races === "string" ? JSON.parse(athlete.races) : athlete.races,
      athlete.macrocycleRaceId ?? athlete.macrocycle_race_id
    );
  }
  res.json({ athlete, pointers });
});

router.post("/procoach/me/workouts", async (req: Request, res: Response) => {
  const { date, distanceKm, type, durationMin, week, injuryAlert, rpe, painLevel, notes, shoeId, panelDistanceKm } = req.body as {
    date: string;
    distanceKm: number;
    type: string;
    durationMin: number;
    week: number;
    injuryAlert?: string;
    rpe?: number;
    painLevel?: number;
    notes?: string;
    shoeId?: number | null;
    panelDistanceKm?: number | null;
  };

  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();
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

    // Deduz do painel a quilometragem que a lona rolou sozinha (descanso)
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
      shoeId: shoeId ?? null,
      source: "manual",
      externalId: null,
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
  const offsetParam = Math.max(0, Number(req.query.offset) || 0);
  const athleteId = await getOrCreateMonoAthleteId();

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

// ─── Spotify (Integração Futura) ──────────────────────────────────────────────

router.get("/procoach/me/spotify-recommendation", async (req: Request, res: Response) => {
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();
  const today = getSaoPauloDayKey();

  const rows = await db.execute(sql`
    SELECT activity, structure FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date = ${today} LIMIT 1
  `) as { rows: Array<any> };

  const session = rows.rows[0];
  let searchKeyword = "running motivation"; // Padrão

  if (session) {
    const act = String(session.activity).toLowerCase();
    if (act.includes("corrida") || act.includes("longão") || act.includes("fartlek")) searchKeyword = "running pace bpm";
    else if (act.includes("bike") || act.includes("ciclismo")) searchKeyword = "cycling workout tempo";
    else if (act.includes("musc") || act.includes("força")) searchKeyword = "gym workout heavy";
    else if (act.includes("descanso") || act.includes("regenerativo")) searchKeyword = "chill relaxing recovery";
  }

  // TODO: Implementar chamada real à API do Spotify usando Client Credentials

  res.json({
    keyword: searchKeyword,
    playlist: {
      name: `ProCoach OS: ${session ? session.activity : 'Treino'}`,
      uri: "spotify:playlist:37i9dQZF1DX76Wlfdnj7AP", // URI real da playlist "Running" do Spotify
      url: "https://open.spotify.com/playlist/37i9dQZF1DX76Wlfdnj7AP"
    }
  });
});

// ─── Shoes (Equipamentos) ─────────────────────────────────────────────────────

router.get("/procoach/me/shoes", async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();

  const rows = await db.execute(sql`
    SELECT
      s.id,
      s.nickname,
      s.brand,
      s.model,
      s.start_date,
      s.initial_km,
      s.target_km,
      s.retired_at,
      s.created_at,
      s.updated_at,
      (s.initial_km + COALESCE(SUM(w.distance_km), 0))::int AS km_total,
      MAX(w.entry_date) AS last_used_at
    FROM procoach_shoes s
    LEFT JOIN procoach_workout_entries w
      ON w.athlete_id = s.athlete_id AND w.shoe_id = s.id
    WHERE s.athlete_id = ${athleteId}
    GROUP BY s.id
    ORDER BY (s.retired_at IS NULL) DESC, s.retired_at DESC NULLS LAST, s.updated_at DESC
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ shoes: rows.rows });
});

router.post("/procoach/me/shoes", async (req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();
  const body = req.body as {
    nickname?: string;
    brand?: string | null;
    model?: string | null;
    startDate?: string | null;
    initialKm?: number | null;
    targetKm?: number | null;
  };

  const nickname = String(body.nickname ?? "").trim();
  if (!nickname) {
    res.status(400).json({ error: "nickname é obrigatório" });
    return;
  }

  const initialKm = Math.max(0, Math.round(Number(body.initialKm ?? 0)));
  const targetKm = Math.max(1, Math.round(Number(body.targetKm ?? 500)));
  const startDate = body.startDate ? String(body.startDate).trim() : null;
  const brand = body.brand ? String(body.brand).trim() : null;
  const model = body.model ? String(body.model).trim() : null;

  const [created] = await db
    .insert(shoesTable)
    .values({
      athleteId,
      nickname,
      brand,
      model,
      startDate,
      initialKm,
      targetKm,
      updatedAt: new Date(),
    })
    .returning();

  res.json({ shoe: created });
});

router.put("/procoach/me/shoes/:id", async (req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "id inválido" });
    return;
  }

  const body = req.body as {
    nickname?: string;
    brand?: string | null;
    model?: string | null;
    startDate?: string | null;
    initialKm?: number | null;
    targetKm?: number | null;
  };

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.nickname !== undefined) patch.nickname = String(body.nickname ?? "").trim();
  if (body.brand !== undefined) patch.brand = body.brand ? String(body.brand).trim() : null;
  if (body.model !== undefined) patch.model = body.model ? String(body.model).trim() : null;
  if (body.startDate !== undefined) patch.startDate = body.startDate ? String(body.startDate).trim() : null;
  if (body.initialKm !== undefined) patch.initialKm = Math.max(0, Math.round(Number(body.initialKm ?? 0)));
  if (body.targetKm !== undefined) patch.targetKm = Math.max(1, Math.round(Number(body.targetKm ?? 500)));

  const [updated] = await db
    .update(shoesTable)
    .set(patch as any)
    .where(and(eq(shoesTable.id, id), eq(shoesTable.athleteId, athleteId)) as any)
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Tênis não encontrado" });
    return;
  }
  res.json({ shoe: updated });
});

router.post("/procoach/me/shoes/:id/archive", async (req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "id inválido" });
    return;
  }
  const [updated] = await db
    .update(shoesTable)
    .set({ retiredAt: new Date(), updatedAt: new Date() })
    .where(and(eq(shoesTable.id, id), eq(shoesTable.athleteId, athleteId)) as any)
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Tênis não encontrado" });
    return;
  }
  res.json({ shoe: updated });
});

router.get("/procoach/me/workouts/pending-shoe", async (req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();
  const limitParam = Math.max(1, Math.min(50, Number(req.query.limit) || 20));

  const rows = await db.execute(sql`
    SELECT id, entry_date, distance_km, duration_min
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
      AND source = 'strava'
      AND type = 'corrida'
      AND shoe_id IS NULL
    ORDER BY entry_date DESC
    LIMIT ${limitParam}
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ pending: rows.rows });
});

router.post("/procoach/me/workouts/:id/set-shoe", async (req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();

  const workoutId = Number(req.params.id);
  const shoeId = Number((req.body as any)?.shoeId);
  if (!Number.isFinite(workoutId) || !Number.isFinite(shoeId)) {
    res.status(400).json({ error: "workoutId/shoeId inválidos" });
    return;
  }

  const shoes = await db
    .select({ id: shoesTable.id })
    .from(shoesTable)
    .where(and(eq(shoesTable.id, shoeId), eq(shoesTable.athleteId, athleteId)) as any)
    .limit(1);
  if (!shoes[0]) {
    res.status(404).json({ error: "Tênis não encontrado" });
    return;
  }

  const workouts = await db
    .select({ id: workoutEntriesTable.id })
    .from(workoutEntriesTable)
    .where(and(eq(workoutEntriesTable.id, workoutId), eq(workoutEntriesTable.athleteId, athleteId)) as any)
    .limit(1);
  if (!workouts[0]) {
    res.status(404).json({ error: "Treino não encontrado" });
    return;
  }

  const [updated] = await db
    .update(workoutEntriesTable)
    .set({ shoeId })
    .where(and(eq(workoutEntriesTable.id, workoutId), eq(workoutEntriesTable.athleteId, athleteId)) as any)
    .returning();

  res.json({ entry: updated ?? null });
});

router.get("/procoach/me/weekly-stats", async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  const rows = await db.execute(sql`
    SELECT week, COALESCE(SUM(distance_km), 0)::int AS completed_km
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
      AND type = 'corrida'
      AND distance_km >= 3
    GROUP BY week
  `) as { rows: Array<{ week: number; completed_km: number }> };

  const weeklyCompleted: Record<number, number> = {};
  for (const r of rows.rows) {
    weeklyCompleted[Number(r.week)] = Number(r.completed_km) || 0;
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
      await ensurePlanTable();
      const athleteId = await getOrCreateMonoAthleteId();

      const file = (req as any).file as { buffer: Buffer; originalname?: string; mimetype?: string } | undefined;
      if (!file?.buffer) {
        res.status(400).json({ error: "Arquivo PDF é obrigatório (field: file)" });
        return;
      }

      const parsed = await pdfParse(file.buffer);
      const text = String(parsed.text ?? "");
      const lines = text
        .split(/\r?\n/g)
        .map((l) => l.replace(/\u00a0/g, " ").trim())
        .filter(Boolean);

      // Melhor-esforço: detectar linhas com data e produzir um "import-text" compatível.
      // Isso permite iterar rápido: PDF -> texto -> mesma rotina de importação.
      const year = new Date().getFullYear();
      const importTextLines: string[] = [];

      for (const line of lines) {
        const mIso = line.match(/^(\d{4}-\d{2}-\d{2})\s+(.*)$/);
        const mBr = !mIso ? line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/) : null;
        const mDdMm = !mIso && !mBr ? line.match(/^(\d{2}\/\d{2})\s+(.*)$/) : null;
        if (!mIso && !mBr && !mDdMm) continue;

        let dateKey = "";
        let rest = "";

        if (mIso) {
          dateKey = mIso[1]!;
          rest = mIso[2] ?? "";
          // converte para DD/MM para reutilizar o import-text
          const [y, mm, dd] = dateKey.split("-");
          dateKey = `${dd}/${mm}/${y}`;
        } else if (mBr) {
          dateKey = mBr[1]!;
          rest = mBr[2] ?? "";
        } else if (mDdMm) {
          dateKey = `${mDdMm[1]!}/${year}`;
          rest = mDdMm[2] ?? "";
        }

        const normalizedRest = rest.replace(/\s{2,}/g, " ").trim();
        importTextLines.push(`${dateKey} - ${normalizedRest}`);
      }

      res.json({
        athleteId,
        fileName: file.originalname ?? null,
        detected: importTextLines.length,
        importText: importTextLines.join("\n"),
        rawTextPreview: text.slice(0, 2000),
      });
    } catch (e: any) {
      res.status(500).json({ error: e?.message ?? "Falha ao processar PDF" });
    }
  }
);

router.post("/procoach/me/plan/import-json", async (req: Request, res: Response) => {
  const body = req.body as any;
  const plan = body?.plano_treinamento ?? body?.planoTreinamento ?? body;
  const cfg = plan?.configuracoes_operacionais ?? plan?.configuracoesOperacionais ?? {};

  const treinos = plan?.treinos;
  const treinoHoje = plan?.treino_hoje ?? plan?.treinoHoje;
  const cronograma = plan?.cronograma;

  const items: any[] =
    Array.isArray(treinos) && treinos.length > 0
      ? treinos
      : treinoHoje && typeof treinoHoje === "object"
        ? [treinoHoje]
        : Array.isArray(cronograma) && cronograma.length > 0
          ? cronograma
          : [];

  if (items.length === 0) {
    res.status(400).json({ error: "treinos[] (or treino_hoje) or cronograma[] is required" });
    return;
  }

  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const warmupKmh = asNumberOrNull(cfg?.velocidade_aquecimento_kmh ?? cfg?.velocidadeAquecimentoKmh);
  const cooldownKmh = asNumberOrNull(cfg?.velocidade_desaquecimento_kmh ?? cfg?.velocidadeDesaquecimentoKmh);
  const athleteName = typeof cfg?.atleta === "string" ? cfg.atleta.trim() : null;

  const sessions = items
    .map((s: any) => {
      const rawDate = String(s?.data ?? s?.date ?? "").trim();
      const sessionDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : normalizeEntryDate(rawDate);
      const dayName = s?.dia_semana ? String(s.dia_semana).trim() : "";
      const activity = String(s?.atividade ?? "").trim();
      const paceTarget = s?.pace_alvo ? String(s.pace_alvo).trim() : null;
      const restInterval = s?.repouso ? String(s.repouso).trim() : null;
      const structure = s?.estrutura ? String(s.estrutura).trim() : null;
      const distanceRaw =
        s?.distancia !== undefined && s?.distancia !== null && String(s.distancia).trim()
          ? String(s.distancia).trim()
          : null;
      const treadmillSpeed =
        formatKmh(s?.velocidade_esteira_kmh) ??
        formatKmh(s?.vel_esteira_principal) ??
        formatKmh(s?.vel_esteira) ??
        formatKmh(s?.vel_esteira_kmh);

      if (!activity || !sessionDate) return null;
      const volumeRaw = asNumberOrNull(s?.volume_total_km ?? s?.volumeTotalKm);
      const treadmillSpeedFinal = treadmillSpeed ?? formatKmhFromPaceTarget(paceTarget);
      const bike = parseBike(structure);
      const segments = parseSegments(structure);
      const blocks = groupBlocks(segments);
      const treadmillTelemetry = computeTreadmillTelemetry({
        structure,
        paceTarget,
        treadmillSpeed: treadmillSpeedFinal,
        restInterval,
        segments,
      });
      const computedBodyKm =
        treadmillTelemetry?.rule === "A"
          ? (treadmillTelemetry.volumeBodyKm as number | undefined)
          : treadmillTelemetry?.rule === "B"
            ? (treadmillTelemetry.volumeTotalKm as number | undefined)
            : undefined;
      const plannedKm = (() => {
        if (volumeRaw !== null) return Math.max(0, Math.round(volumeRaw));
        const interval = parseInterval(structure);
        const sumKm = sumDistanceKm(segments) + (interval ? interval.reps * interval.distTiroKm : 0);
        const base = computedBodyKm ?? sumKm;
        if (Number.isFinite(base) && base > 0) return Math.max(0, Math.round(base));
        return parsePlannedKmFromStrings(activity, structure, distanceRaw);
      })();

      const details = {
        source: "plano_treinamento_v2",
        athlete: athleteName,
        status: typeof s?.status === "string" ? s.status.trim() : null,
        suggestedShoe: typeof s?.tenis_sugerido === "string" ? s.tenis_sugerido.trim() : null,
        warmupKmh,
        cooldownKmh,
        modalities: inferModalities(activity, structure),
        bike,
        segments,
        blocks,
        treadmillTelemetry,
        consistency: {
          plannedKm,
          computedBodyKm: computedBodyKm ?? null,
        },
      };

      return {
        sessionDate,
        dayName: dayName || null,
        activity,
        paceTarget: paceTarget && paceTarget !== "-" ? paceTarget : null,
        treadmillSpeed: treadmillSpeedFinal,
        restInterval: restInterval && restInterval !== "-" ? restInterval : null,
        structure,
        plannedKm,
        detailsJson: JSON.stringify(details),
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
      detailsJson: string;
    }>;

  if (sessions.length === 0) { res.status(400).json({ error: "no sessions parsed" }); return; }

  for (const s of sessions) {
    await db.execute(sql`
      INSERT INTO procoach_plan_sessions
        (athlete_id, session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, details_json, created_at, updated_at)
      VALUES
        (${athleteId}, ${s.sessionDate}, ${s.dayName}, ${s.activity}, ${s.paceTarget}, ${s.treadmillSpeed}, ${s.restInterval}, ${s.structure}, ${s.plannedKm}, ${s.detailsJson}::jsonb, NOW(), NOW())
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
    firstDate: sessions[0]!.sessionDate,
    lastDate: sessions[sessions.length - 1]!.sessionDate,
  });
});

async function getRainProbability(dateISO: string, lat = -23.6087, lon = -46.6676): Promise<number> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return 0;
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const r = await fetch(url);
    if (!r.ok) return 0;
    const data = await r.json() as any;
    let pop = 0;
    for (const item of data.list || []) {
      if (item.dt_txt.startsWith(dateISO)) {
        pop = Math.max(pop, item.pop);
      }
    }
    return Math.round(pop * 100);
  } catch {
    return 0;
  }
}

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
      // Prioriza Velocidade na esteira ocultando o pace de rua
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

router.get("/procoach/me/strength/catalog", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.max(1, Math.min(25, Number(req.query.limit) || 12));
  await ensureStrengthCatalogSeed();

  const like = q ? `%${q.toLowerCase()}%` : null;
  const rows = await db.execute(sql`
    SELECT id, name, primary_muscles, secondary_muscles, equipment, pattern, is_unilateral
    FROM procoach_strength_exercise_catalog
    WHERE
      (${like} IS NULL)
      OR lower(name) LIKE ${like}
      OR (aliases::text ILIKE ${`%${q}%`})
    ORDER BY name ASC
    LIMIT ${limit}
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ items: rows.rows });
});

router.get("/procoach/me/strength/templates", async (_req: Request, res: Response) => {
  await ensureStrengthTables();
  const athleteId = await getOrCreateMonoAthleteId();

  const templatesRows = await db.execute(sql`
    SELECT code, name, notes
    FROM procoach_strength_templates
    WHERE athlete_id = ${athleteId}
    ORDER BY code ASC
  `) as { rows: Array<{ code: string; name: string; notes: string | null }> };

  const exRows = await db.execute(sql`
    SELECT
      e.template_code AS template_code,
      e.order_index AS order_index,
      e.catalog_exercise_id AS catalog_exercise_id,
      COALESCE(NULLIF(e.exercise_name_override, ''), c.name) AS name,
      e.sets AS sets,
      e.reps AS reps,
      e.rest_sec AS rest_sec,
      e.rpe_target AS rpe_target,
      e.load AS load,
      e.tempo AS tempo,
      e.notes AS notes
    FROM procoach_strength_template_exercises e
    LEFT JOIN procoach_strength_exercise_catalog c ON c.id = e.catalog_exercise_id
    WHERE e.athlete_id = ${athleteId}
    ORDER BY e.template_code ASC, e.order_index ASC
  `) as { rows: Array<Record<string, unknown>> };

  const base = (code: StrengthTemplateCode) => ({ code, name: "", notes: null as string | null, exercises: [] as Array<Record<string, unknown>> });
  const templates: Record<StrengthTemplateCode, ReturnType<typeof base>> = { A: base("A"), B: base("B"), C: base("C") };
  for (const t of templatesRows.rows) {
    const code = String(t.code ?? "").toUpperCase() as StrengthTemplateCode;
    if (code === "A" || code === "B" || code === "C") {
      templates[code] = { ...templates[code], name: t.name ?? "", notes: t.notes ?? null };
    }
  }
  for (const r of exRows.rows) {
    const code = String((r as any).template_code ?? "").toUpperCase() as StrengthTemplateCode;
    if (!(code === "A" || code === "B" || code === "C")) continue;
    templates[code].exercises.push({
      catalogExerciseId: (r as any).catalog_exercise_id ?? null,
      name: (r as any).name ?? null,
      sets: (r as any).sets ?? null,
      reps: (r as any).reps ?? null,
      restSec: (r as any).rest_sec ?? null,
      rpeTarget: (r as any).rpe_target ?? null,
      load: (r as any).load ?? null,
      tempo: (r as any).tempo ?? null,
      notes: (r as any).notes ?? null,
    });
  }

  res.json({ templates });
});

router.put("/procoach/me/strength/templates/:code", async (req: Request, res: Response) => {
  await ensureStrengthTables();
  const athleteId = await getOrCreateMonoAthleteId();
  const codeRaw = String(req.params.code ?? "").toUpperCase().trim();
  const code = codeRaw as StrengthTemplateCode;
  if (!(code === "A" || code === "B" || code === "C")) {
    res.status(400).json({ error: "invalid template code" });
    return;
  }

  const body = req.body as any;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : null;
  const exercisesIn = Array.isArray(body?.exercises) ? body.exercises : [];

  await db.execute(sql`
    INSERT INTO procoach_strength_templates (athlete_id, code, name, notes, updated_at)
    VALUES (${athleteId}, ${code}, ${name}, ${notes}, NOW())
    ON CONFLICT (athlete_id, code)
    DO UPDATE SET
      name = EXCLUDED.name,
      notes = EXCLUDED.notes,
      updated_at = NOW()
  `);

  await db.execute(sql`
    DELETE FROM procoach_strength_template_exercises
    WHERE athlete_id = ${athleteId} AND template_code = ${code}
  `);

  const limit = Math.min(60, exercisesIn.length);
  for (let i = 0; i < limit; i++) {
    const e = exercisesIn[i] ?? {};
    const catalogExerciseIdRaw = e.catalogExerciseId ?? e.catalog_exercise_id ?? e.catalogExerciseID ?? null;
    const catalogExerciseId = catalogExerciseIdRaw === null || catalogExerciseIdRaw === undefined || catalogExerciseIdRaw === "" ? null : Number(catalogExerciseIdRaw);
    const exerciseNameOverride =
      typeof e.name === "string"
        ? e.name.trim()
        : typeof e.exercise_name_override === "string"
          ? e.exercise_name_override.trim()
          : null;
    const sets = e.sets === undefined || e.sets === null || e.sets === "" ? null : Math.max(0, Math.round(Number(e.sets)));
    const reps = e.reps === undefined || e.reps === null || e.reps === "" ? null : String(e.reps).trim();
    const restSec = e.restSec ?? e.rest_sec;
    const rest = restSec === undefined || restSec === null || restSec === "" ? null : Math.max(0, Math.round(Number(restSec)));
    const rpeTargetRaw = e.rpeTarget ?? e.rpe_target;
    const rpeTarget = rpeTargetRaw === undefined || rpeTargetRaw === null || rpeTargetRaw === "" ? null : Number(rpeTargetRaw);
    const load = e.load === undefined || e.load === null || e.load === "" ? null : String(e.load).trim();
    const tempo = e.tempo === undefined || e.tempo === null || e.tempo === "" ? null : String(e.tempo).trim();
    const exNotes = e.notes === undefined || e.notes === null || e.notes === "" ? null : String(e.notes).trim();

    if (!catalogExerciseId && !exerciseNameOverride) continue;

    await db.execute(sql`
      INSERT INTO procoach_strength_template_exercises
        (athlete_id, template_code, order_index, catalog_exercise_id, exercise_name_override, sets, reps, rest_sec, rpe_target, load, tempo, notes, updated_at)
      VALUES
        (${athleteId}, ${code}, ${i}, ${Number.isFinite(catalogExerciseId as any) ? catalogExerciseId : null}, ${exerciseNameOverride}, ${sets}, ${reps}, ${rest}, ${rpeTarget}, ${load}, ${tempo}, ${exNotes}, NOW())
      ON CONFLICT (athlete_id, template_code, order_index)
      DO UPDATE SET
        catalog_exercise_id = EXCLUDED.catalog_exercise_id,
        exercise_name_override = EXCLUDED.exercise_name_override,
        sets = EXCLUDED.sets,
        reps = EXCLUDED.reps,
        rest_sec = EXCLUDED.rest_sec,
        rpe_target = EXCLUDED.rpe_target,
        load = EXCLUDED.load,
        tempo = EXCLUDED.tempo,
        notes = EXCLUDED.notes,
        updated_at = NOW()
    `);
  }

  res.json({ ok: true, code });
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

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - diff);
  return monday;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function buildWeeklyPdfBuffer(params: {
  athleteName: string;
  weekStartISO: string;
  weekEndISO: string;
  plannedSessions: Array<{
    session_date: string;
    day_name: string | null;
    activity: string;
    pace_target: string | null;
    treadmill_speed: string | null;
    rest_interval: string | null;
    structure: string | null;
    planned_km: number;
  }>;
  workouts: Array<{
    entry_date: string;
    type: string;
    distance_km: number;
    duration_min: number;
    week: number;
  }>;
}): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Relatório Semanal — ProCoach OS", { align: "left" });
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor("#444").text(`${params.athleteName} · ${params.weekStartISO} → ${params.weekEndISO}`);
    doc.fillColor("#000");
    doc.moveDown(1);

    doc.fontSize(13).text("Plano (planejado)", { underline: true });
    doc.moveDown(0.5);
    if (params.plannedSessions.length === 0) {
      doc.fontSize(11).fillColor("#444").text("Nenhum treino planejado para esta semana.");
      doc.fillColor("#000");
    } else {
      for (const s of params.plannedSessions) {
        const left = `${s.session_date}${s.day_name ? ` (${s.day_name})` : ""} · ${s.activity}`;
        const rightParts: string[] = [];
        if (s.planned_km > 0) rightParts.push(`${s.planned_km} km`);
        if (s.pace_target) rightParts.push(`pace ${s.pace_target}`);
        if (s.treadmill_speed) rightParts.push(`esteira ${s.treadmill_speed}`);
        if (s.rest_interval) rightParts.push(`rep ${s.rest_interval}`);
        doc.fontSize(11).text(left);
        if (rightParts.length > 0) doc.fillColor("#444").text(rightParts.join(" · ")).fillColor("#000");
        if (s.structure) doc.fillColor("#444").text(s.structure).fillColor("#000");
        doc.moveDown(0.5);
      }
    }

    doc.moveDown(0.5);
    doc.fontSize(13).text("Execução (concluído)", { underline: true });
    doc.moveDown(0.5);
    if (params.workouts.length === 0) {
      doc.fontSize(11).fillColor("#444").text("Nenhum treino concluído registrado nesta semana.");
      doc.fillColor("#000");
    } else {
      for (const w of params.workouts) {
        const line = `${w.entry_date} · ${w.type} · ${w.distance_km} km · ${w.duration_min} min`;
        doc.fontSize(11).text(line);
      }
    }

    doc.end();
  });
}

async function sendTelegramDocument(params: {
  filename: string;
  fileBytes: Buffer;
  caption?: string;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const boundary = "----ProCoachBoundary" + Date.now();
  const parts: string[] = [
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`,
  ];
  if (params.caption && params.caption.trim().length > 0) {
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${params.caption}`
    );
    parts.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown`
    );
  }
  parts.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${params.filename}"\r\nContent-Type: application/pdf\r\n\r\n`
  );
  const closing = `\r\n--${boundary}--\r\n`;

  const headerBuffer = Buffer.from(parts.join("\r\n") + "\r\n");
  const closingBuffer = Buffer.from(closing);
  const body = Buffer.concat([headerBuffer, params.fileBytes, closingBuffer]);

  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
    body,
  });
}

async function sendResendEmailWithPdf(params: {
  to: string;
  subject: string;
  html: string;
  filename: string;
  pdfBytes: Buffer;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "ProCoach OS <onboarding@resend.dev>";
  if (!apiKey) return;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      attachments: [
        {
          filename: params.filename,
          content: params.pdfBytes.toString("base64"),
          content_type: "application/pdf",
        },
      ],
    }),
  });
}

router.get(["/procoach/me/export", "/procoach/export"], async (_req: Request, res: Response) => {
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const athlete = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.id, athleteId) as any)
    .limit(1);

  const planRows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km, details_json
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId}
    ORDER BY session_date ASC
  `) as { rows: Array<Record<string, unknown>> };

  const workouts = await db.execute(sql`
    SELECT entry_date, type, distance_km, duration_min, week, shoe_id, source, external_id, injury_alert, created_at
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
    ORDER BY entry_date DESC
    LIMIT 365
  `) as { rows: Array<Record<string, unknown>> };

  const weekly = await db.execute(sql`
    SELECT week, COALESCE(SUM(distance_km), 0)::int AS completed_km
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
      AND type = 'corrida'
      AND distance_km >= 3
    GROUP BY week
    ORDER BY week ASC
  `) as { rows: Array<Record<string, unknown>> };

  res.json({
    athlete: athlete[0] ?? null,
    planSessions: planRows.rows,
    workouts: workouts.rows,
    weeklyCompleted: weekly.rows,
  });
});

router.get(["/procoach/me/weekly-report.pdf", "/procoach/weekly-report.pdf"], async (req: Request, res: Response) => {
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const weekStartRaw = typeof req.query.weekStart === "string" ? req.query.weekStart : "";
  const weekStartISO = /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ? weekStartRaw : isoDateOnly(mondayOf(new Date()));
  const weekEndISO = isoDateOnly(addDays(new Date(`${weekStartISO}T00:00:00`), 6));

  const athlete = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.id, athleteId) as any)
    .limit(1);

  const planned = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId}
      AND session_date >= ${weekStartISO}
      AND session_date <= ${weekEndISO}
    ORDER BY session_date ASC
  `) as { rows: Array<any> };

  const workouts = await db.execute(sql`
    SELECT entry_date, type, distance_km, duration_min, week
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
      AND entry_date >= ${weekStartISO}
      AND entry_date <= ${weekEndISO}
    ORDER BY entry_date ASC
  `) as { rows: Array<any> };

  const pdfBytes = await buildWeeklyPdfBuffer({
    athleteName: athlete[0]?.name ?? "Atleta",
    weekStartISO,
    weekEndISO,
    plannedSessions: planned.rows.map((r) => ({
      session_date: String(r.session_date),
      day_name: r.day_name ? String(r.day_name) : null,
      activity: String(r.activity),
      pace_target: r.pace_target ? String(r.pace_target) : null,
      treadmill_speed: r.treadmill_speed ? String(r.treadmill_speed) : null,
      rest_interval: r.rest_interval ? String(r.rest_interval) : null,
      structure: r.structure ? String(r.structure) : null,
      planned_km: Number(r.planned_km ?? 0),
    })),
    workouts: workouts.rows.map((r) => ({
      entry_date: String(r.entry_date),
      type: String(r.type),
      distance_km: Number(r.distance_km ?? 0),
      duration_min: Number(r.duration_min ?? 0),
      week: Number(r.week ?? 0),
    })),
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename=\"weekly-report-${weekStartISO}.pdf\"`);
  res.send(pdfBytes);
});

router.post(["/procoach/me/weekly-report/send", "/procoach/weekly-report/send"], async (req: Request, res: Response) => {
  const secret = req.headers["x-cron-secret"];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const weekStartRaw = typeof req.body?.weekStart === "string" ? req.body.weekStart : undefined;
  const weekStartISO = weekStartRaw && /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ? weekStartRaw : isoDateOnly(mondayOf(new Date()));

  const athleteId = await getOrCreateMonoAthleteId();
  const athlete = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.id, athleteId) as any)
    .limit(1);

  const weekEndISO = isoDateOnly(addDays(new Date(`${weekStartISO}T00:00:00`), 6));
  const planned = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId}
      AND session_date >= ${weekStartISO}
      AND session_date <= ${weekEndISO}
    ORDER BY session_date ASC
  `) as { rows: Array<any> };
  const workouts = await db.execute(sql`
    SELECT entry_date, type, distance_km, duration_min, week
    FROM procoach_workout_entries
    WHERE athlete_id = ${athleteId}
      AND entry_date >= ${weekStartISO}
      AND entry_date <= ${weekEndISO}
    ORDER BY entry_date ASC
  `) as { rows: Array<any> };

  const pdfBytes = await buildWeeklyPdfBuffer({
    athleteName: athlete[0]?.name ?? "Atleta",
    weekStartISO,
    weekEndISO,
    plannedSessions: planned.rows.map((r) => ({
      session_date: String(r.session_date),
      day_name: r.day_name ? String(r.day_name) : null,
      activity: String(r.activity),
      pace_target: r.pace_target ? String(r.pace_target) : null,
      treadmill_speed: r.treadmill_speed ? String(r.treadmill_speed) : null,
      rest_interval: r.rest_interval ? String(r.rest_interval) : null,
      structure: r.structure ? String(r.structure) : null,
      planned_km: Number(r.planned_km ?? 0),
    })),
    workouts: workouts.rows.map((r) => ({
      entry_date: String(r.entry_date),
      type: String(r.type),
      distance_km: Number(r.distance_km ?? 0),
      duration_min: Number(r.duration_min ?? 0),
      week: Number(r.week ?? 0),
    })),
  });

  const filename = `weekly-report-${weekStartISO}.pdf`;
  const caption = `📄 *Relatório semanal*\n${weekStartISO} → ${weekEndISO}`;
  await sendTelegramDocument({ filename, fileBytes: pdfBytes, caption });

  const emailTo = process.env.REPORT_EMAIL_TO;
  if (emailTo) {
    await sendResendEmailWithPdf({
      to: emailTo,
      subject: `Relatório semanal — ${weekStartISO} → ${weekEndISO}`,
      html: `<p>Segue o relatório semanal em PDF.</p><p>${weekStartISO} → ${weekEndISO}</p>`,
      filename,
      pdfBytes,
    });
  }

  res.json({ sent: true, weekStart: weekStartISO, weekEnd: weekEndISO });
});

router.post(["/procoach/me/daily-briefing/send", "/procoach/daily-briefing/send"], async (req: Request, res: Response) => {
  const secret = req.headers["x-cron-secret"];
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const athleteId = await getOrCreateMonoAthleteId();
  const tomorrowISO = getSaoPauloTomorrowKey();

  const rows = await db.execute(sql`
    SELECT session_date, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athleteId} AND session_date = ${tomorrowISO}
    LIMIT 1
  `) as { rows: Array<any> };

  const session = rows.rows[0];
  if (!session) {
    await sendTelegram(`🌙 *Briefing Noturno* (${tomorrowISO})\n\nAmanhã é dia de *Descanso* (ou treino não planejado). Aproveite para recuperar o corpo!`);
    res.json({ sent: true, date: tomorrowISO, session: null });
    return;
  }

  const msg = `🌙 *Briefing de Amanhã* (${tomorrowISO})\n\n` +
              `🏃 *Atividade:* ${session.activity}\n` +
              (session.planned_km ? `📏 *Volume:* ${session.planned_km} km\n` : "") +
              (session.pace_target ? `⏱️ *Pace Alvo:* ${session.pace_target}\n` : "") +
              (session.structure ? `📋 *Estrutura:* ${session.structure}\n` : "");

  await sendTelegram(msg);
  res.json({ sent: true, date: tomorrowISO, session });
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

  let session = rows.rows[0] ? { ...rows.rows[0] } : null;

  if (session) {
    const lat = req.query.lat ? Number(req.query.lat) : -23.6087;
    const lon = req.query.lon ? Number(req.query.lon) : -46.6676;
    const rainProb = await getRainProbability(date, lat, lon);
    const suggestTreadmill = rainProb > 70;
    Object.assign(session, { suggestTreadmill, rainProbability: rainProb });
    if (suggestTreadmill && session.treadmill_speed) {
      // Prioriza Velocidade na esteira ocultando o pace de rua
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

router.get("/procoach/weather", async (req: Request, res: Response) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "OPENWEATHER_API_KEY não configurada no .env" });
      return;
    }

    const lat = req.query.lat ? Number(req.query.lat) : -23.6087;
    const lon = req.query.lon ? Number(req.query.lon) : -46.6676;

    const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;

    const [currRes, foreRes] = await Promise.all([fetch(currentUrl), fetch(forecastUrl)]);
    
    if (!currRes.ok || !foreRes.ok) {
      res.status(502).json({ error: "Weather API error" });
      return;
    }
    
    const currData = await currRes.json() as any;
    const foreData = await foreRes.json() as any;

    const todayISO = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    let min = currData.main?.temp_min ?? 999;
    let max = currData.main?.temp_max ?? -999;
    let pop = 0;

    for (const item of foreData.list || []) {
      if (item.dt_txt.startsWith(todayISO)) {
        min = Math.min(min, item.main.temp_min);
        max = Math.max(max, item.main.temp_max);
        pop = Math.max(pop, item.pop);
      }
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const isDay = nowSec >= currData.sys?.sunrise && nowSec <= currData.sys?.sunset ? 1 : 0;

    res.json({
      temperature: currData.main?.temp ? Math.round(currData.main.temp) : null,
      weathercode: mapOpenWeatherToWMO(currData.weather?.[0]?.id || 800),
      windspeed: currData.wind?.speed ? Math.round(currData.wind.speed * 3.6) : null,
      is_day: isDay,
      min: min !== 999 ? Math.round(min) : null,
      max: max !== -999 ? Math.round(max) : null,
      rainProbability: Math.round(pop * 100)
    });
  } catch (err) {
    console.error("Erro ao buscar clima:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;
