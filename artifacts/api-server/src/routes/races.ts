import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "@workspace/db";
import { db } from "@workspace/db";
import { athletesTable } from "@workspace/db/schema";
import { ensureAthletesRacesColumn, getOrCreateMonoAthleteId } from "./migrations";
import { getRaceWeatherStr } from "./procoach-utils";

const router: IRouter = Router();

// ─── Gerenciamento de Provas (Races) ──────────────────────────────────────────
router.post("/procoach/athletes/:deviceId/races", async (req: Request, res: Response) => {
  const deviceId = String(req.params.deviceId);
  const raceData = req.body;
  
  await ensureAthletesRacesColumn();
  const athleteRows = await db.execute(sql`SELECT id, races FROM procoach_athletes WHERE device_id = ${deviceId} LIMIT 1`) as any;
  const athlete = athleteRows.rows[0];
  if (!athlete) {
    res.status(404).json({ error: "Athlete not found" });
    return;
  }
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

  await db.execute(sql`
    UPDATE procoach_athletes
    SET macrocycle_race_id = ${raceId}, updated_at = NOW()
    WHERE id = ${athletes[0].id}
  `);

  res.json({ success: true, macrocycleRaceId: raceId });
});

router.post("/procoach/races/:raceId/result", async (req: Request, res: Response) => {
  const raceId = req.params.raceId;
  const { finishTime, finishPace, weatherCondition } = req.body;

  try {
    const athleteId = await getOrCreateMonoAthleteId();
    await ensureAthletesRacesColumn();

    const athleteRows = await db.execute(sql`SELECT id, races FROM procoach_athletes WHERE id = ${athleteId} LIMIT 1`) as any;
    const athlete = athleteRows.rows[0];
    if (!athlete) {
      res.status(404).json({ error: "Atleta não encontrado" });
      return;
    }

    let races = typeof athlete.races === "string" ? JSON.parse(athlete.races) : (athlete.races || []);
    const targetRace = races.find((r: any) => String(r.id) === String(raceId));
    if (!targetRace) {
      res.status(404).json({ error: "Prova não encontrada no calendário." });
      return;
    }

    const finalWeather = (!weatherCondition || weatherCondition.trim() === "") ? await getRaceWeatherStr(targetRace.date || targetRace.data) : weatherCondition;
    races = races.map((race: any) => (String(race.id) === String(raceId)) ? { ...race, finishTime, finishPace, weatherCondition: finalWeather } : race);

    await db.execute(sql`UPDATE procoach_athletes SET races = ${JSON.stringify(races)}::jsonb, updated_at = NOW() WHERE id = ${athlete.id}`);
    res.json({ success: true, message: "Resultado salvo com sucesso" });
  } catch (err) {
    console.error("[API] Erro ao salvar resultado da prova:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;