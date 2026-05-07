import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc } from "@workspace/db";
import { db } from "@workspace/db";
import {
  athletesTable,
  workoutEntriesTable,
  weeklyStatsTable,
  insertAthleteSchema,
} from "@workspace/db/schema";

const router: IRouter = Router();

function roundKm(val: number): number {
  return Math.round(val);
}

router.post("/procoach/athletes/sync", async (req: Request, res: Response) => {
  // Validação em tempo de execução com Zod
  const parseResult = insertAthleteSchema.safeParse(req.body);

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
  const { date, distanceKm, type, durationMin, week, injuryAlert } = req.body as {
    date: string;
    distanceKm: number;
    type: string;
    durationMin: number;
    week: number;
    injuryAlert?: string;
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

  const [entry] = await db
    .insert(workoutEntriesTable)
    .values({
      athleteId,
      entryDate: date,
      distanceKm: roundedKm,
      type: type as any,
      durationMin,
      week,
      injuryAlert: injuryAlert ?? null,
    })
    .returning();

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

export default router;
