import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql } from "@workspace/db";
import { db } from "@workspace/db";
import { shoesTable, workoutEntriesTable } from "@workspace/db/schema";
import { ensureGelTables, ensureShoesTables, getOrCreateMonoAthleteId } from "./migrations";
import { normalizeEntryDate, sendTelegram } from "./procoach-utils";

const router: IRouter = Router();

router.get("/procoach/me/shoes", async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();

  const rows = await db.execute(sql`
    SELECT s.id, s.nickname, s.brand, s.model, s.start_date, s.initial_km, s.target_km, s.retired_at, s.created_at, s.updated_at,
      (s.initial_km + COALESCE(SUM(w.distance_km), 0))::int AS km_total, MAX(w.entry_date) AS last_used_at
    FROM procoach_shoes s
    LEFT JOIN procoach_workout_entries w ON w.athlete_id = s.athlete_id AND w.shoe_id = s.id
    WHERE s.athlete_id = ${athleteId}
    GROUP BY s.id
    ORDER BY (s.retired_at IS NULL) DESC, s.retired_at DESC NULLS LAST, s.updated_at DESC
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ shoes: rows.rows });
});

router.post("/procoach/me/shoes", async (req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  await ensureShoesTables();
  const body = req.body as { nickname?: string; brand?: string | null; model?: string | null; startDate?: string | null; initialKm?: number | null; targetKm?: number | null; };

  const nickname = String(body.nickname ?? "").trim();
  if (!nickname) {
    res.status(400).json({ error: "nickname é obrigatório" });
    return;
  }

  const [created] = await db.insert(shoesTable).values({
      athleteId, nickname,
      brand: body.brand ? String(body.brand).trim() : null,
      model: body.model ? String(body.model).trim() : null,
      startDate: body.startDate ? String(body.startDate).trim() : null,
      initialKm: Math.max(0, Math.round(Number(body.initialKm ?? 0))),
      targetKm: Math.max(1, Math.round(Number(body.targetKm ?? 500))),
      updatedAt: new Date(),
    }).returning();

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

  const body = req.body as { nickname?: string; brand?: string | null; model?: string | null; startDate?: string | null; initialKm?: number | null; targetKm?: number | null; };
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (body.nickname !== undefined) patch.nickname = String(body.nickname ?? "").trim();
  if (body.brand !== undefined) patch.brand = body.brand ? String(body.brand).trim() : null;
  if (body.model !== undefined) patch.model = body.model ? String(body.model).trim() : null;
  if (body.startDate !== undefined) patch.startDate = body.startDate ? String(body.startDate).trim() : null;
  if (body.initialKm !== undefined) patch.initialKm = Math.max(0, Math.round(Number(body.initialKm ?? 0)));
  if (body.targetKm !== undefined) patch.targetKm = Math.max(1, Math.round(Number(body.targetKm ?? 500)));

  const [updated] = await db.update(shoesTable).set(patch as any).where(and(eq(shoesTable.id, id), eq(shoesTable.athleteId, athleteId)) as any).returning();
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

  const [updated] = await db.update(shoesTable).set({ retiredAt: new Date(), updatedAt: new Date() }).where(and(eq(shoesTable.id, id), eq(shoesTable.athleteId, athleteId)) as any).returning();
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
    WHERE athlete_id = ${athleteId} AND source = 'strava' AND type = 'corrida' AND shoe_id IS NULL
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

  const shoes = await db.select({ id: shoesTable.id }).from(shoesTable).where(and(eq(shoesTable.id, shoeId), eq(shoesTable.athleteId, athleteId)) as any).limit(1);
  if (!shoes[0]) {
    res.status(404).json({ error: "Tênis não encontrado" });
    return;
  }

  const workouts = await db.select({ id: workoutEntriesTable.id }).from(workoutEntriesTable).where(and(eq(workoutEntriesTable.id, workoutId), eq(workoutEntriesTable.athleteId, athleteId)) as any).limit(1);
  if (!workouts[0]) {
    res.status(404).json({ error: "Treino não encontrado" });
    return;
  }

  const [updated] = await db.update(workoutEntriesTable).set({ shoeId }).where(and(eq(workoutEntriesTable.id, workoutId), eq(workoutEntriesTable.athleteId, athleteId)) as any).returning();
  res.json({ entry: updated ?? null });
});

router.get("/procoach/me/gel-stock", async (_req: Request, res: Response) => {
  await ensureGelTables();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(sql`SELECT gels_in_stock FROM procoach_gel_stock WHERE athlete_id = ${athleteId} LIMIT 1`) as { rows: Array<{ gels_in_stock: number | string }> };
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

  const beforeRows = await db.execute(sql`SELECT gels_in_stock FROM procoach_gel_stock WHERE athlete_id = ${athleteId} LIMIT 1`) as { rows: Array<{ gels_in_stock: number | string }> };
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

export default router;